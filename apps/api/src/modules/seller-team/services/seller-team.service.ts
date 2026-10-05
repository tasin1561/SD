import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, NotificationRecipientType, SellerUserRole } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EnvService } from '../../../config/env.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { PasswordService } from '../../auth-common/services/password.service';
import { TokenHashService } from '../../auth-common/services/token-hash.service';
import { EmailQueue } from '../../email/queue/email.queue';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import type { CreateTeamInvitationDto } from '../dto/create-team-invitation.dto';
/** The six defaults, whose keys mirror the legacy enum's spelling. */
const LEGACY_SELLER_ROLE_KEYS = new Set([
  'owner',
  'admin',
  'ops',
  'inventory',
  'finance',
  'viewer',
]);

import {
  assertMayGrantRole,
  type GrantableRole,
  type GrantingActor,
} from '../../../common/auth/assert-may-grant-role';
import { resolveRoles, roleNamesFor } from '../../../common/auth/role-union';
import { ALL_SELLER_PERMISSION_KEYS } from '../../../common/auth/seller-permissions';
import {
  NO_ROLES,
  NO_ROLES_MESSAGE,
  normaliseRoleIds,
  rolesOnCreate,
  setSellerUserRoles,
} from '../../../common/auth/role-assignment';

/** The enum spelling of the first role that has one, else null. */
function legacySellerEnumFor(roleKeys: readonly string[]): SellerUserRole | null {
  const match = roleKeys.find((k) => LEGACY_SELLER_ROLE_KEYS.has(k));
  return match === undefined ? null : (match.toUpperCase() as SellerUserRole);
}

/** The live roles out of a loaded assignment list. */
function liveRolesOf<T extends { deletedAt: Date | null }>(
  assignments: readonly { role: T }[],
): readonly T[] {
  return assignments.map((a) => a.role).filter((r) => r.deletedAt === null);
}

/** Every role a person holds, oldest grant first. */
const SELLER_ROLE_ASSIGNMENTS = {
  orderBy: [{ grantedAt: 'asc' as const }, { roleId: 'asc' as const }],
  select: {
    role: {
      select: {
        id: true,
        key: true,
        name: true,
        isOwner: true,
        deletedAt: true,
        permissions: { select: { permission: true } },
      },
    },
  },
};

const DEFAULT_EXPIRES_IN_DAYS = 7;

export interface TeamInvitationView {
  readonly id: string;
  readonly email: string;
  /** LEGACY enum — null when no offered role has a spelling. */
  readonly role: SellerUserRole | null;
  /** `seller_roles.id`s the invitation offers, in the order chosen. */
  readonly roleIds: readonly string[];
  readonly roleNames: readonly string[];
  readonly invitedById: string;
  readonly acceptedById: string | null;
  readonly expiresAt: string;
  readonly usedAt: string | null;
  readonly createdAt: string;
  readonly deletedAt: string | null;
}

export interface CreatedTeamInvitation extends TeamInvitationView {
  readonly token: string;
  readonly inviteUrl: string;
}

export interface TeamMemberView {
  readonly id: string;
  readonly email: string;
  readonly emailDisplay: string;
  readonly fullName: string;
  /** Legacy enum, display only — null for a custom-role-only person. */
  readonly role: SellerUserRole | null;
  /** The FIRST role held — a label. `roleIds` is all of them. */
  readonly roleId: string;
  readonly roleName: string;
  readonly roleIds: readonly string[];
  readonly roleNames: readonly string[];
  readonly emailVerifiedAt: string | null;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
  readonly deletedAt: string | null;
  readonly isYou: boolean;
}

/**
 * Seller team management — invitations + member roles.
 *
 * RBAC at the controller layer:
 *   - All write paths require OWNER or ADMIN.
 *   - Read paths are open to any role (any team member sees the team).
 *
 * Ownership transfer + last-OWNER protection enforced in updateRole +
 * deactivate (cannot leave the company with zero OWNERs).
 */
@Injectable()
export class SellerTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly hashes: TokenHashService,
    private readonly password: PasswordService,
    private readonly audit: AuditLogService,
    private readonly email: EmailQueue,
  ) {}

  // ── Invitations ────────────────────────────────────────────────────

  /**
   * What the person doing the granting can themselves do, within this
   * company.
   *
   * Read from the database rather than taken from the caller — the same
   * argument as the staff side: a service that trusts a permission list
   * handed to it is one refactor away from trusting one off a body.
   */
  private async grantingActor(sellerId: string, sellerUserId: string): Promise<GrantingActor> {
    const me = await this.prisma.client.sellerUser.findFirst({
      where: { id: sellerUserId, sellerId, deletedAt: null },
      select: { roles: SELLER_ROLE_ASSIGNMENTS },
    });
    if (me === null) {
      throw new NotFoundException({ code: 'MEMBER_NOT_FOUND', message: 'Team member not found' });
    }
    // Read from every role they hold: an actor who is Finance AND Ops
    // may delegate either, and asking only the first would refuse a
    // grant they are plainly entitled to make.
    const live = me.roles.map((r) => r.role).filter((r) => r.deletedAt === null);
    return {
      isSuperuser: live.some((r) => r.isOwner),
      permissions: resolveRoles(me.roles, ALL_SELLER_PERMISSION_KEYS).permissions,
    };
  }

  /**
   * The roles an id list names, as grant targets, SCOPED to this
   * company — a role id from another seller must not be assignable, and
   * the scoping is in the WHERE clause so a miss is indistinguishable
   * from a role that does not exist.
   *
   * Resolved BEFORE anything is written, so an invitation is never
   * half-created, and returned in the order ASKED FOR because the first
   * role becomes the legacy label.
   */
  private async rolesToGrant(
    sellerId: string,
    roleIds: readonly string[],
  ): Promise<readonly (GrantableRole & { id: string; key: string })[]> {
    const ids = normaliseRoleIds(roleIds);
    if (ids.length === 0) {
      throw new BadRequestException({ code: NO_ROLES, message: NO_ROLES_MESSAGE });
    }
    const found = await this.prisma.client.sellerRoleDefinition.findMany({
      where: { id: { in: [...ids] }, sellerId, deletedAt: null },
      select: {
        id: true,
        key: true,
        name: true,
        isOwner: true,
        permissions: { select: { permission: true } },
      },
    });
    if (found.length !== ids.length) {
      throw new NotFoundException({
        code: 'ROLE_NOT_FOUND',
        message: 'One of those roles does not exist',
      });
    }
    const byId = new Map(found.map((r) => [r.id, r]));
    return ids.map((id) => {
      const r = byId.get(id);
      // Unreachable — the length check above covers it.
      if (r === undefined) {
        throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'No such role' });
      }
      return {
        id: r.id,
        key: r.key,
        name: r.name,
        isSuperuser: r.isOwner,
        permissions: r.permissions.map((p) => p.permission),
      };
    });
  }

  async invite(
    sellerId: string,
    input: CreateTeamInvitationDto,
    actor: { sellerUserId: string },
    ctx: ClientContext,
  ): Promise<CreatedTeamInvitation> {
    // BEFORE anything is written or emailed: the invitation carries the
    // role and accepting it connects that role for real, so a
    // `team.manage` holder inviting an address they control as OWNER is
    // refused here rather than at the moment the privilege lands.
    // EVERY role is checked — a list is only as safe as its most
    // powerful entry, and checking the first would let the second
    // through.
    const roles = await this.rolesToGrant(sellerId, input.roleIds);
    const granter = await this.grantingActor(sellerId, actor.sellerUserId);
    for (const role of roles) assertMayGrantRole(granter, role);

    const emailLower = input.email.trim().toLowerCase();

    // Refuse if a SellerUser with this email already exists ANYWHERE
    // — emails are globally unique on seller_users.
    const existing = await this.prisma.client.sellerUser.findUnique({
      where: { email: emailLower },
      select: { id: true, sellerId: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message:
          existing.sellerId === sellerId
            ? 'This person is already a team member.'
            : // Deliberately does NOT say it belongs to another seller.
              // Naming the neighbour confirms who else is on the
              // platform, which is not this company's business.
              'That email already has a Skydrop login.',
      });
    }

    // Pending invitations are checked ACROSS every seller, not just this
    // one. `seller_users.email` is globally unique, so if two companies
    // both invite the same person the first to accept wins and the second
    // gets a failure at the moment they click the link — the same shape
    // as the seller-invite bug, one table over.
    const live = await this.findLive(sellerId, emailLower);
    const elsewhere =
      live === null
        ? await this.prisma.client.sellerUserInvitation.findFirst({
            where: {
              email: emailLower,
              deletedAt: null,
              usedAt: null,
              expiresAt: { gt: new Date() },
            },
            select: { id: true },
          })
        : null;
    if (live || elsewhere) {
      throw new ConflictException({
        code: 'INVITATION_ALREADY_PENDING',
        message: live
          ? `A pending invitation already exists for ${input.email}. Resend it instead.`
          : 'That email already has a pending invitation.',
      });
    }

    const plaintext = this.hashes.generateInvitationToken();
    const tokenHash = this.hashes.sha256Hex(plaintext);
    const expiresAt = new Date(
      Date.now() + (input.expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS) * 86_400_000,
    );

    const row = await this.prisma.client.sellerUserInvitation.create({
      data: {
        sellerId,
        email: input.email,
        token: tokenHash,
        // Display and history; null when no invited role has an enum
        // spelling, which is every role the company invented.
        role: legacySellerEnumFor(roles.map((r) => r.key)),
        invitedById: actor.sellerUserId,
        expiresAt,
        roles: { create: roles.map((r) => ({ roleId: r.id })) },
      },
      select: this.invitationSelect,
    });

    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId,
      action: 'seller.team_invitation.created',
      entityType: 'seller_user_invitation',
      entityId: row.id,
      severity: 'MEDIUM',
      changes: { email: input.email, roles: roles.map((r) => r.name), fullName: input.fullName },
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });

    const url = this.inviteUrlFor(plaintext);
    await this.sendInvitationEmail(
      input.email,
      input.fullName,
      roleNamesFor(roles),
      url,
      expiresAt,
    );
    return { ...this.toInvView(row), token: plaintext, inviteUrl: url };
  }

  /**
   * Invitations still waiting on somebody. USED ones are excluded —
   * see the note on `StaffInvitationService.list`; the seller team page
   * had exactly the same contradiction.
   */
  async listInvitations(sellerId: string): Promise<{ items: TeamInvitationView[]; total: number }> {
    const rows = await this.prisma.client.sellerUserInvitation.findMany({
      where: { sellerId, deletedAt: null, usedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: this.invitationSelect,
    });
    return { items: rows.map((r) => this.toInvView(r)), total: rows.length };
  }

  async resendInvitation(
    sellerId: string,
    invitationId: string,
    _actor: { sellerUserId: string },
    ctx: ClientContext,
  ): Promise<CreatedTeamInvitation> {
    const existing = await this.prisma.client.sellerUserInvitation.findFirst({
      where: { id: invitationId, sellerId },
      select: { id: true, email: true, usedAt: true, deletedAt: true },
    });
    if (!existing || existing.deletedAt !== null) {
      throw new NotFoundException({
        code: 'INVITATION_NOT_FOUND',
        message: 'Invitation not found',
      });
    }
    if (existing.usedAt !== null) {
      throw new ConflictException({
        code: 'INVITATION_ALREADY_USED',
        message: 'Invitation has already been used',
      });
    }

    const plaintext = this.hashes.generateInvitationToken();
    const tokenHash = this.hashes.sha256Hex(plaintext);
    const expiresAt = new Date(Date.now() + DEFAULT_EXPIRES_IN_DAYS * 86_400_000);

    const updated = await this.prisma.client.sellerUserInvitation.update({
      where: { id: invitationId },
      data: { token: tokenHash, expiresAt },
      select: this.invitationSelect,
    });

    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId,
      action: 'seller.team_invitation.resent',
      entityType: 'seller_user_invitation',
      entityId: invitationId,
      severity: 'MEDIUM',
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });

    const view = this.toInvView(updated);
    const url = this.inviteUrlFor(plaintext);
    await this.sendInvitationEmail(
      updated.email,
      updated.email,
      roleNamesFor(view.roleNames.map((name) => ({ name }))),
      url,
      expiresAt,
    );
    return { ...view, token: plaintext, inviteUrl: url };
  }

  async revokeInvitation(
    sellerId: string,
    invitationId: string,
    _actor: { sellerUserId: string },
    ctx: ClientContext,
  ): Promise<void> {
    const existing = await this.prisma.client.sellerUserInvitation.findFirst({
      where: { id: invitationId, sellerId },
      select: { id: true, usedAt: true, deletedAt: true },
    });
    if (!existing || existing.deletedAt !== null) {
      throw new NotFoundException({
        code: 'INVITATION_NOT_FOUND',
        message: 'Invitation not found',
      });
    }
    if (existing.usedAt !== null) {
      throw new ConflictException({
        code: 'INVITATION_ALREADY_USED',
        message: 'Cannot revoke a redeemed invitation',
      });
    }
    await this.prisma.client.sellerUserInvitation.update({
      where: { id: invitationId },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId,
      action: 'seller.team_invitation.revoked',
      entityType: 'seller_user_invitation',
      entityId: invitationId,
      severity: 'MEDIUM',
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
  }

  /**
   * Accept a team invitation. Creates the SellerUser row + marks the
   * invitation USED in one tx. Returns the email so the caller's
   * auth flow can issue a session.
   */
  async accept(
    plaintextToken: string,
    plaintextPassword: string,
    fullName: string,
    ctx: ClientContext,
  ): Promise<{
    sellerUserId: string;
    email: string;
    role: SellerUserRole | null;
    sellerId: string;
  }> {
    const tokenHash = this.hashes.sha256Hex(plaintextToken);
    const inv = await this.prisma.client.sellerUserInvitation.findUnique({
      where: { token: tokenHash },
      select: {
        id: true,
        sellerId: true,
        email: true,
        role: true,
        roles: {
          orderBy: [{ grantedAt: 'asc' as const }, { roleId: 'asc' as const }],
          select: { role: { select: { id: true, key: true, deletedAt: true } } },
        },
        expiresAt: true,
        usedAt: true,
        deletedAt: true,
      },
    });
    if (!inv || inv.deletedAt !== null) {
      throw new NotFoundException({
        code: 'INVALID_INVITATION',
        message: 'Invitation not found or revoked',
      });
    }
    if (inv.usedAt !== null) {
      throw new ConflictException({
        code: 'INVITATION_ALREADY_USED',
        message: 'This invitation has already been used',
      });
    }
    if (inv.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException({
        code: 'INVITATION_EXPIRED',
        message: 'Invitation has expired; ask the team owner to resend it',
      });
    }
    const emailLower = inv.email.trim().toLowerCase();
    const existingUser = await this.prisma.client.sellerUser.findUnique({
      where: { email: emailLower },
      select: { id: true },
    });
    if (existingUser) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'A user with this email already exists',
      });
    }

    const passwordHash = await this.password.hash(plaintextPassword);
    const now = new Date();

    // The roles the invitation actually offers, live ones only. One
    // deleted between sending and accepting is dropped — granting it
    // would leave somebody holding permissions nobody can see or edit.
    const offered = inv.roles.map((r) => r.role).filter((r) => r.deletedAt === null);
    if (offered.length === 0) {
      // Nothing to grant, and accepting would create an account that
      // cannot sign in at all (the guard reads zero live roles).
      throw new BadRequestException({
        code: 'INVITATION_ROLES_GONE',
        message:
          'The role this invitation was sent for no longer exists. Ask the account owner to send a new one.',
      });
    }

    const created = await this.prisma.client.$transaction(async (tx) => {
      const re = await tx.sellerUserInvitation.findUnique({
        where: { id: inv.id },
        select: { usedAt: true },
      });
      if (re?.usedAt !== null) {
        throw new ConflictException({
          code: 'INVITATION_ALREADY_USED',
          message: 'This invitation has already been used',
        });
      }
      const user = await tx.sellerUser.create({
        data: {
          sellerId: inv.sellerId,
          email: emailLower,
          emailDisplay: inv.email,
          passwordHash,
          fullName,
          role: legacySellerEnumFor(offered.map((r) => r.key)),
          emailVerifiedAt: now,
          ...rolesOnCreate(offered.map((r) => r.id)),
        },
        select: { id: true, email: true, role: true, sellerId: true },
      });
      await tx.sellerUserInvitation.update({
        where: { id: inv.id },
        data: { usedAt: now, acceptedById: user.id },
      });
      return user;
    });

    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId: created.sellerId,
      action: 'seller.team_invitation.accepted',
      entityType: 'seller_user',
      entityId: created.id,
      severity: 'MEDIUM',
      changes: { invitationId: inv.id, roleIds: offered.map((r) => r.id), email: inv.email },
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });

    return {
      sellerUserId: created.id,
      email: created.email,
      role: created.role,
      sellerId: created.sellerId,
    };
  }

  // ── Team members ───────────────────────────────────────────────────

  async listMembers(sellerId: string, currentUserId: string): Promise<TeamMemberView[]> {
    const rows = await this.prisma.client.sellerUser.findMany({
      where: { sellerId },
      orderBy: [{ deletedAt: 'asc' }, { createdAt: 'asc' }],
      take: 200,
      select: {
        id: true,
        email: true,
        emailDisplay: true,
        fullName: true,
        role: true,
        roles: {
          orderBy: [{ grantedAt: 'asc' as const }, { roleId: 'asc' as const }],
          select: { role: { select: { id: true, name: true, deletedAt: true } } },
        },
        emailVerifiedAt: true,
        lastLoginAt: true,
        createdAt: true,
        deletedAt: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      emailDisplay: r.emailDisplay,
      fullName: r.fullName,
      role: r.role,
      // The FIRST live role is the label; `roleIds` is what the screen
      // should actually show, because a person may hold several.
      roleId: liveRolesOf(r.roles)[0]?.id ?? '',
      roleName: liveRolesOf(r.roles)[0]?.name ?? '',
      roleIds: liveRolesOf(r.roles).map((x) => x.id),
      roleNames: liveRolesOf(r.roles).map((x) => x.name),
      emailVerifiedAt: r.emailVerifiedAt?.toISOString() ?? null,
      lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      deletedAt: r.deletedAt?.toISOString() ?? null,
      isYou: r.id === currentUserId,
    }));
  }

  /**
   * REPLACE the roles a team member holds.
   *
   * Takes role ROW ids, not enum values — that is what lets somebody be
   * given a role the company invented this morning — and SEVERAL,
   * because "handles inbound stock and the wallet" is two roles rather
   * than a seventh one invented for one person. The legacy `role`
   * column is kept in step only for the six defaults; a custom role has
   * no enum spelling and the column is no longer consulted for
   * authorisation, so it is left NULL rather than filled with a lie.
   */
  async setRoles(
    sellerId: string,
    targetUserId: string,
    newRoleIds: readonly string[],
    actor: { sellerUserId: string },
    ctx: ClientContext,
  ): Promise<{ id: string; roleIds: readonly string[]; roleNames: readonly string[] }> {
    if (targetUserId === actor.sellerUserId) {
      throw new BadRequestException({
        code: 'CANNOT_CHANGE_OWN_ROLE',
        message:
          'You cannot change your own roles. Ask another owner — this is what stops somebody removing their own way back in.',
      });
    }
    const [target, targets] = await Promise.all([
      this.prisma.client.sellerUser.findFirst({
        where: { id: targetUserId, sellerId },
        select: {
          id: true,
          deletedAt: true,
          roles: {
            orderBy: [{ grantedAt: 'asc' as const }, { roleId: 'asc' as const }],
            select: { role: { select: { id: true, name: true, isOwner: true, deletedAt: true } } },
          },
        },
      }),
      // Scoped by sellerId inside `rolesToGrant`: a role id from another
      // company must not be assignable, and the id is not a secret.
      this.rolesToGrant(sellerId, newRoleIds),
    ]);
    if (!target || target.deletedAt !== null) {
      throw new NotFoundException({ code: 'MEMBER_NOT_FOUND', message: 'Team member not found' });
    }

    const held = liveRolesOf(target.roles);
    const sameSet =
      held.length === targets.length && held.every((r) => targets.some((t) => t.id === r.id));
    if (sameSet) {
      return {
        id: target.id,
        roleIds: targets.map((t) => t.id),
        roleNames: targets.map((t) => t.name),
      };
    }

    // The LAST_OWNER guard below is about not losing access. This one is
    // about not gaining it: `team.manage` covered assigning ANY role,
    // OWNER included, so somebody could promote a colleague past
    // themselves and then borrow that login. Checked for EVERY role in
    // the set.
    const granter = await this.grantingActor(sellerId, actor.sellerUserId);
    for (const t of targets) assertMayGrantRole(granter, t);

    const wasOwner = held.some((r) => r.isOwner);
    const staysOwner = targets.some((t) => t.isSuperuser);

    await this.prisma.client.$transaction(async (tx) => {
      // Somebody must be left who can get back in. Counted INSIDE the
      // write's transaction, so two concurrent demotions cannot each see
      // the owner the other is removing.
      if (wasOwner && !staysOwner) {
        const otherOwners = await tx.sellerUserRoleAssignment.count({
          where: {
            sellerUserId: { not: targetUserId },
            user: { sellerId, deletedAt: null },
            role: { isOwner: true, deletedAt: null },
          },
        });
        if (otherOwners === 0) {
          throw new BadRequestException({
            code: 'LAST_OWNER',
            message:
              'This is the last owner. Moving them off that role would leave nobody able to manage the account.',
          });
        }
      }
      await setSellerUserRoles(
        tx,
        targetUserId,
        targets.map((t) => t.id),
      );
      await tx.sellerUser.update({
        where: { id: targetUserId },
        data: { role: legacySellerEnumFor(targets.map((t) => t.key)) },
      });
    });

    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId,
      action: 'seller.team_member.role_changed',
      entityType: 'seller_user',
      entityId: targetUserId,
      severity: 'MEDIUM',
      changes: { before: held.map((r) => r.name), after: targets.map((t) => t.name) },
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
    return {
      id: targetUserId,
      roleIds: targets.map((t) => t.id),
      roleNames: targets.map((t) => t.name),
    };
  }

  async deactivate(
    sellerId: string,
    targetUserId: string,
    actor: { sellerUserId: string },
    ctx: ClientContext,
  ): Promise<void> {
    if (targetUserId === actor.sellerUserId) {
      throw new BadRequestException({
        code: 'CANNOT_DEACTIVATE_SELF',
        message: 'You cannot deactivate your own account',
      });
    }
    const target = await this.prisma.client.sellerUser.findFirst({
      where: { id: targetUserId, sellerId },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!target) {
      throw new NotFoundException({
        code: 'MEMBER_NOT_FOUND',
        message: 'Team member not found',
      });
    }
    if (target.deletedAt !== null) return;

    // Last-OWNER protection.
    if (target.role === 'OWNER') {
      const otherOwners = await this.prisma.client.sellerUser.count({
        where: {
          sellerId,
          role: 'OWNER',
          deletedAt: null,
          id: { not: targetUserId },
        },
      });
      if (otherOwners === 0) {
        throw new BadRequestException({
          code: 'LAST_OWNER',
          message: 'Cannot deactivate the last OWNER. Transfer ownership first.',
        });
      }
    }
    const removed = await this.prisma.client.$transaction(async (tx) => {
      const now = new Date();
      const changed = await tx.sellerUser.updateMany({
        where: { id: targetUserId, sellerId, deletedAt: null },
        data: { deletedAt: now },
      });
      if (changed.count === 0) return false;
      // Their sessions end now. Every guard re-reads the user, but a
      // removed person's session rows must not stay live until they expire.
      await tx.sellerRefreshToken.updateMany({
        where: { sellerUserId: targetUserId, revokedAt: null },
        data: { revokedAt: now },
      });
      return true;
    });
    if (!removed) return;
    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId,
      action: 'seller.team_member.deactivated',
      entityType: 'seller_user',
      entityId: targetUserId,
      severity: 'HIGH',
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private invitationSelect = {
    id: true,
    email: true,
    role: true,
    invitedById: true,
    acceptedById: true,
    expiresAt: true,
    usedAt: true,
    createdAt: true,
    deletedAt: true,
    roles: {
      orderBy: [{ grantedAt: 'asc' as const }, { roleId: 'asc' as const }],
      select: { role: { select: { id: true, key: true, name: true, deletedAt: true } } },
    },
  };

  private async findLive(sellerId: string, emailLower: string): Promise<{ id: string } | null> {
    return this.prisma.client.sellerUserInvitation.findFirst({
      where: {
        sellerId,
        email: { equals: emailLower, mode: 'insensitive' },
        usedAt: null,
        deletedAt: null,
        expiresAt: { gte: new Date() },
      },
      select: { id: true },
    });
  }

  private inviteUrlFor(plaintext: string): string {
    return `${this.env.sellerAppUrl}/auth/accept-team-invitation?token=${plaintext}`;
  }

  private toInvView(row: {
    id: string;
    email: string;
    role: SellerUserRole | null;
    invitedById: string;
    acceptedById: string | null;
    expiresAt: Date;
    usedAt: Date | null;
    createdAt: Date;
    deletedAt: Date | null;
    roles: readonly { role: { id: string; name: string; deletedAt: Date | null } }[];
  }): TeamInvitationView {
    // A role deleted since the invitation was sent is dropped: accepting
    // will not grant it, so listing it would promise something the
    // accept cannot deliver.
    const live = row.roles.map((r) => r.role).filter((r) => r.deletedAt === null);
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      roleIds: live.map((r) => r.id),
      roleNames: live.map((r) => r.name),
      invitedById: row.invitedById,
      acceptedById: row.acceptedById,
      expiresAt: row.expiresAt.toISOString(),
      usedAt: row.usedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    };
  }

  private async sendInvitationEmail(
    to: string,
    fullName: string,
    /** "Operations and Finance" — what the person reads, not an enum. */
    role: string,
    inviteUrl: string,
    expiresAt: Date,
  ): Promise<void> {
    try {
      await this.email.enqueue({
        templateCode: 'seller.team_invitation.email',
        recipient: { type: NotificationRecipientType.SELLER, email: to },
        variables: {
          full_name: fullName,
          role,
          invite_url: inviteUrl,
          expires_at: expiresAt.toISOString(),
          expires_at_display: expiresAt.toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
        },
        triggerEvent: 'seller.team_invitation.created',
      });
    } catch {
      // Best-effort.
    }
  }
}
