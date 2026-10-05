import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ActorType, NotificationRecipientType, StaffRole } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EnvService } from '../../../config/env.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { PasswordService } from '../../auth-common/services/password.service';
import { TokenHashService } from '../../auth-common/services/token-hash.service';
import { EmailQueue } from '../../email/queue/email.queue';
import type { ClientContext } from '../../staff-auth/staff-auth.service';
import type { CreateStaffInvitationDto } from '../dto/create-staff-invitation.dto';
import {
  assertMayGrantRole,
  type GrantableRole,
  type GrantingActor,
} from '../../../common/auth/assert-may-grant-role';
import { resolveRoles, roleNamesFor } from '../../../common/auth/role-union';
import { ALL_PERMISSION_KEYS } from '../../../common/auth/permissions';
import {
  NO_ROLES,
  NO_ROLES_MESSAGE,
  normaliseRoleIds,
  rolesOnCreate,
  setStaffRoles,
} from '../../../common/auth/role-assignment';

/**
 * The seven seeded roles, whose keys mirror the legacy enum's spelling.
 *
 * Nothing else has one — not a role an operator invented, and not the
 * three access tiers (`admin`, `support`, `readonly`). So the legacy
 * `role` column is NULL for somebody holding only those, which is why
 * it is nullable: writing an enum that names a different role is a lie
 * a stale reader could act on.
 */
const LEGACY_ROLE_KEYS = new Set([
  'super_admin',
  'seller_approval_admin',
  'call_agent',
  'warehouse_staff',
  'warehouse_supervisor',
  'manual_placement_admin',
  'finance',
]);

/** Everything a view of an invitation needs, in one place. */
const INVITATION_SELECT = {
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

/** The live roles out of a loaded assignment list. */
function liveStaffRoles<T extends { deletedAt: Date | null }>(
  assignments: readonly { role: T }[],
): readonly T[] {
  return assignments.map((a) => a.role).filter((r) => r.deletedAt === null);
}

/** The enum spelling of the first role that has one, else null. */
function legacyEnumFor(roleKeys: readonly string[]): StaffRole | null {
  const match = roleKeys.find((k) => LEGACY_ROLE_KEYS.has(k));
  return match === undefined ? null : (match.toUpperCase() as StaffRole);
}

/**
 * Phase 1B — admin staff invitations.
 *
 * - `create()` issues a one-time-use plaintext token (returned ONCE in
 *   the response + emailed to the invitee). DB stores the sha256 of the
 *   token; on accept we sha256 the presented token + look it up.
 * - `accept()` consumes the token, creates a `staff_users` row with the
 *   invite-time role, marks the invitation USED, returns the staff id
 *   for the auth flow to issue tokens.
 * - All writes audited; SUPER_ADMIN-only at the controller layer.
 */
const DEFAULT_EXPIRES_IN_DAYS = 7;

export interface InvitationListItem {
  readonly id: string;
  readonly email: string;
  /** LEGACY enum — null when no offered role has a spelling. */
  readonly role: StaffRole | null;
  /** `staff_roles.id`s the invitation offers, in the order chosen. */
  readonly roleIds: readonly string[];
  /** Their names, same order — what a screen should show. */
  readonly roleNames: readonly string[];
  readonly invitedById: string;
  readonly acceptedById: string | null;
  readonly expiresAt: string;
  readonly usedAt: string | null;
  readonly createdAt: string;
  readonly deletedAt: string | null;
}

export interface CreatedInvitation extends InvitationListItem {
  readonly token: string;
  readonly inviteUrl: string;
}

@Injectable()
export class StaffInvitationService {
  private readonly logger = new Logger(StaffInvitationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly hashes: TokenHashService,
    private readonly password: PasswordService,
    private readonly audit: AuditLogService,
    private readonly email: EmailQueue,
  ) {}

  private async sendInvitationEmail(
    to: string,
    /** "Call agent and Support" — what the person reads, not an enum. */
    role: string,
    inviteUrl: string,
    expiresAt: Date,
  ): Promise<void> {
    try {
      await this.email.enqueue({
        templateCode: 'staff.invitation.email',
        recipient: { type: NotificationRecipientType.SELLER, email: to },
        variables: {
          role,
          invite_url: inviteUrl,
          expires_at: expiresAt.toISOString(),
          expires_at_display: expiresAt.toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
        },
        triggerEvent: 'staff.invitation.created',
      });
    } catch {
      // Best-effort: a queue failure must not block the invite.
      // The admin still has the link in the reveal card.
    }
  }

  /**
   * What the person doing the granting can themselves do.
   *
   * Read from the database rather than taken from the caller: the guard
   * already resolved it onto the request, but a service that trusts a
   * permission list handed to it is one refactor away from trusting one
   * that came from a body. One indexed lookup on a path that invites a
   * colleague is not a cost worth arguing about.
   */
  private async grantingActor(staffId: string): Promise<GrantingActor> {
    const me = await this.prisma.client.staffUser.findFirst({
      where: { id: staffId, deletedAt: null },
      select: {
        roles: {
          orderBy: [{ grantedAt: 'asc' as const }, { roleId: 'asc' as const }],
          select: {
            role: {
              select: {
                key: true,
                name: true,
                isSuperAdmin: true,
                deletedAt: true,
                permissions: { select: { permission: true } },
              },
            },
          },
        },
      },
    });
    if (me === null) {
      // Their own account went away mid-request. Refusing is the only
      // safe answer: an unknown actor holds nothing we can check against.
      throw new NotFoundException({ code: 'STAFF_NOT_FOUND', message: 'Staff user not found' });
    }
    // Every role they hold, not the first: this read was through the
    // single-role relation, which under multi-role is the TRANSITIONAL
    // `role_id`. It fails CLOSED — the actor is judged on a narrower set
    // than they really hold — so it is not a hole, but a super admin
    // whose super-admin role happened to be their SECOND would have been
    // refused a grant they are plainly entitled to make.
    const live = me.roles.map((r) => r.role).filter((r) => r.deletedAt === null);
    return {
      isSuperuser: live.some((r) => r.isSuperAdmin),
      permissions: resolveRoles(me.roles, ALL_PERMISSION_KEYS).permissions,
    };
  }

  /**
   * The roles an id list names, as grant targets.
   *
   * A missing id is a 404 naming NOTHING about which one — role ids are
   * not secrets, but answering "that one exists and that one does not"
   * for a list is a worse message than "one of these is not a role".
   * Every id is resolved BEFORE anything is written, so an invitation is
   * never half-created.
   */
  private async rolesToGrant(
    roleIds: readonly string[],
  ): Promise<readonly (GrantableRole & { id: string; key: string })[]> {
    const ids = normaliseRoleIds(roleIds);
    if (ids.length === 0) {
      throw new BadRequestException({ code: NO_ROLES, message: NO_ROLES_MESSAGE });
    }
    const found = await this.prisma.client.staffRoleDefinition.findMany({
      where: { id: { in: [...ids] }, deletedAt: null },
      select: {
        id: true,
        key: true,
        name: true,
        isSuperAdmin: true,
        permissions: { select: { permission: true } },
      },
    });
    if (found.length !== ids.length) {
      throw new NotFoundException({
        code: 'ROLE_NOT_FOUND',
        message: 'One of those roles does not exist',
      });
    }
    // Returned in the ORDER ASKED FOR, not the order the database
    // happened to return: the first role becomes the legacy label and
    // the primary name in an audit row, and that must be the operator's
    // choice rather than an id sort.
    const byId = new Map(found.map((r) => [r.id, r]));
    return ids.map((id) => {
      const r = byId.get(id);
      // Unreachable — the length check above covers it.
      if (r === undefined)
        throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'No such role' });
      return {
        id: r.id,
        key: r.key,
        name: r.name,
        isSuperuser: r.isSuperAdmin,
        permissions: r.permissions.map((p) => p.permission),
      };
    });
  }

  async create(
    input: CreateStaffInvitationDto,
    actor: { staffId: string },
    ctx: ClientContext,
  ): Promise<CreatedInvitation> {
    // BEFORE anything is written or emailed: an invitation carries the
    // roles, and accepting it connects them for real, so the escalation
    // check happens here even though the privilege lands later. EVERY
    // role is checked — a list is only as safe as its most powerful
    // entry, and checking the first would let the second through.
    const roles = await this.rolesToGrant(input.roleIds);
    const granter = await this.grantingActor(actor.staffId);
    for (const role of roles) assertMayGrantRole(granter, role);

    const emailLower = input.email.trim().toLowerCase();

    // Refuse if a staff account already exists.
    const existing = await this.prisma.client.staffUser.findUnique({
      where: { email: emailLower },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'A staff account already exists for this email',
      });
    }

    // Refuse if there's a live pending invitation.
    const live = await this.findLive(emailLower);
    if (live) {
      throw new ConflictException({
        code: 'INVITATION_ALREADY_PENDING',
        message: `A pending invitation already exists for ${input.email}. Resend it instead.`,
      });
    }

    const plaintext = this.hashes.generateInvitationToken();
    const tokenHash = this.hashes.sha256Hex(plaintext);
    const expiresAt = new Date(
      Date.now() + (input.expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS) * 86_400_000,
    );

    const row = await this.prisma.client.staffInvitation.create({
      data: {
        email: input.email,
        token: tokenHash,
        // Display and history; null when no invited role has an enum
        // spelling, which is the ordinary case for the access tiers.
        role: legacyEnumFor(roles.map((r) => r.key)),
        invitedById: actor.staffId,
        expiresAt,
        roles: { create: roles.map((r) => ({ roleId: r.id })) },
      },
      select: INVITATION_SELECT,
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: actor.staffId,
      action: 'staff.staff_invitation.created',
      entityType: 'staff_invitation',
      entityId: row.id,
      severity: 'MEDIUM',
      changes: { email: input.email, roles: roles.map((r) => r.name) },
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });

    const url = this.inviteUrlFor(plaintext);
    await this.sendInvitationEmail(input.email, roleNamesFor(roles), url, expiresAt);
    return {
      ...this.toView(row),
      token: plaintext,
      inviteUrl: url,
    };
  }

  /**
   * Invitations still waiting on somebody.
   *
   * USED ones are excluded. An accepted invitation is not pending — the
   * person it created is in the staff list above it, so showing both
   * made somebody appear as an active Call agent AND an outstanding
   * SUPER_ADMIN invitation, which is a contradiction the screen cannot
   * explain. The row it left behind is history, and history that looks
   * like a to-do item is worse than no history.
   *
   * EXPIRED ones stay: an invitation nobody accepted in time still needs
   * a decision — resend it or revoke it — and hiding it is how a
   * colleague waits a week for a link that will never work.
   */
  async list(): Promise<{ items: InvitationListItem[]; total: number }> {
    const rows = await this.prisma.client.staffInvitation.findMany({
      where: { deletedAt: null, usedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: INVITATION_SELECT,
    });
    return { items: rows.map((r) => this.toView(r)), total: rows.length };
  }

  async resend(
    invitationId: string,
    actor: { staffId: string },
    ctx: ClientContext,
  ): Promise<CreatedInvitation> {
    const existing = await this.prisma.client.staffInvitation.findUnique({
      where: { id: invitationId },
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

    const updated = await this.prisma.client.staffInvitation.update({
      where: { id: invitationId },
      data: { token: tokenHash, expiresAt },
      select: INVITATION_SELECT,
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: actor.staffId,
      action: 'staff.staff_invitation.resent',
      entityType: 'staff_invitation',
      entityId: invitationId,
      severity: 'MEDIUM',
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });

    const view = this.toView(updated);
    const url = this.inviteUrlFor(plaintext);
    await this.sendInvitationEmail(
      updated.email,
      roleNamesFor(view.roleNames.map((name) => ({ name }))),
      url,
      expiresAt,
    );
    return { ...view, token: plaintext, inviteUrl: url };
  }

  async softDelete(
    invitationId: string,
    actor: { staffId: string },
    ctx: ClientContext,
  ): Promise<void> {
    const existing = await this.prisma.client.staffInvitation.findUnique({
      where: { id: invitationId },
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
        message: 'Cannot delete a redeemed invitation',
      });
    }
    await this.prisma.client.staffInvitation.update({
      where: { id: invitationId },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: actor.staffId,
      action: 'staff.staff_invitation.revoked',
      entityType: 'staff_invitation',
      entityId: invitationId,
      severity: 'MEDIUM',
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
  }

  /**
   * Accept an invitation — creates the staff_users row + marks the
   * invitation USED in one tx. The caller (controller) then issues
   * a session via the staff-auth refresh flow.
   */
  async accept(
    plaintextToken: string,
    plaintextPassword: string,
    ctx: ClientContext,
  ): Promise<{ staffId: string; email: string; role: StaffRole | null }> {
    const tokenHash = this.hashes.sha256Hex(plaintextToken);
    const inv = await this.prisma.client.staffInvitation.findUnique({
      where: { token: tokenHash },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        usedAt: true,
        deletedAt: true,
        roles: {
          orderBy: [{ grantedAt: 'asc' as const }, { roleId: 'asc' as const }],
          select: { role: { select: { id: true, key: true, deletedAt: true } } },
        },
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
        message: 'Invitation has expired; ask an admin to resend it',
      });
    }
    const emailLower = inv.email.trim().toLowerCase();
    const existingStaff = await this.prisma.client.staffUser.findUnique({
      where: { email: emailLower },
      select: { id: true },
    });
    if (existingStaff) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'A staff account already exists for this email',
      });
    }

    // The roles the invitation actually offers, live ones only. A role
    // deleted between sending and accepting is dropped — granting a
    // deleted role would leave somebody holding permissions nobody can
    // see or edit on the roles screen.
    const offered = inv.roles.map((r) => r.role).filter((r) => r.deletedAt === null);
    if (offered.length === 0) {
      // Every offered role is gone, OR this invitation predates the
      // join table and its enum names a role that has since been
      // deleted. Either way there is nothing to grant and accepting
      // would create an account that cannot sign in (the guard reads
      // zero live roles and answers UNAUTHORIZED).
      throw new BadRequestException({
        code: 'INVITATION_ROLES_GONE',
        message:
          'The role this invitation was sent for no longer exists. Ask an admin to send a new one.',
      });
    }

    const passwordHash = await this.password.hash(plaintextPassword);
    const now = new Date();

    const created = await this.prisma.client.$transaction(async (tx) => {
      const re = await tx.staffInvitation.findUnique({
        where: { id: inv.id },
        select: { usedAt: true },
      });
      if (re?.usedAt !== null) {
        throw new ConflictException({
          code: 'INVITATION_ALREADY_USED',
          message: 'This invitation has already been used',
        });
      }
      const staff = await tx.staffUser.create({
        data: {
          email: emailLower,
          emailDisplay: inv.email,
          passwordHash,
          // Display and history; null when no offered role has an enum
          // spelling (every access tier, and every custom role).
          role: legacyEnumFor(offered.map((r) => r.key)),
          emailVerifiedAt: now,
          ...rolesOnCreate(offered.map((r) => r.id)),
        },
        select: { id: true, email: true, role: true },
      });
      await tx.staffInvitation.update({
        where: { id: inv.id },
        data: { usedAt: now, acceptedById: staff.id },
      });
      return staff;
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: created.id,
      action: 'staff.staff_invitation.accepted',
      entityType: 'staff_user',
      entityId: created.id,
      severity: 'MEDIUM',
      changes: { invitationId: inv.id, roleIds: offered.map((r) => r.id), email: inv.email },
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });

    // A note confirming the account exists, where to sign in, and which
    // address is the username.
    //
    // Best-effort AFTER the account is committed: the person is about to
    // be signed in and a mail fault must not undo an account that now
    // exists, nor answer with an error to someone whose signup worked.
    //
    // Worth sending even though they are already logged in — the value is
    // three days later, on a different device, when the question is
    // "which of my addresses was it, and where do I go". That is exactly
    // when nobody has the invitation email any more.
    try {
      await this.email.enqueue({
        templateCode: 'staff.welcome.email',
        recipient: {
          type: NotificationRecipientType.STAFF,
          id: created.id,
          email: created.email,
        },
        variables: {
          email: created.email,
          role: created.role,
          login_url: `${this.env.adminAppUrl}/login`,
          support_email: this.env.supportEmail,
        },
        triggerEvent: 'staff.invitation.accepted',
      });
    } catch (e) {
      this.logger.error(
        { staffId: created.id, err: (e as Error).message },
        'Staff welcome email could not be queued; the account IS created',
      );
    }

    return { staffId: created.id, email: created.email, role: created.role };
  }

  // ── Active staff users (admin "team" page) ─────────────────────────

  async listStaff(): Promise<
    Array<{
      id: string;
      email: string;
      emailDisplay: string;
      /** Legacy enum, display only — null for a custom-role-only person. */
      role: StaffRole | null;
      /** The FIRST role held — a label. `roleIds` is all of them. */
      roleId: string;
      roleName: string;
      roleIds: readonly string[];
      roleNames: readonly string[];
      emailVerifiedAt: string | null;
      lastLoginAt: string | null;
      createdAt: string;
      deletedAt: string | null;
    }>
  > {
    const rows = await this.prisma.client.staffUser.findMany({
      orderBy: [{ deletedAt: 'asc' }, { createdAt: 'desc' }],
      take: 500,
      select: {
        id: true,
        email: true,
        emailDisplay: true,
        role: true,
        // Through the JOIN TABLE, not the transitional `role_id`: the
        // staff list is what somebody reads to see who can do what, and
        // showing ONE role for a person holding three is a wrong answer
        // that looks like a right one.
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
      role: r.role,
      roleId: liveStaffRoles(r.roles)[0]?.id ?? '',
      roleName: liveStaffRoles(r.roles)[0]?.name ?? '',
      roleIds: liveStaffRoles(r.roles).map((x) => x.id),
      roleNames: liveStaffRoles(r.roles).map((x) => x.name),
      emailVerifiedAt: r.emailVerifiedAt?.toISOString() ?? null,
      lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      deletedAt: r.deletedAt?.toISOString() ?? null,
    }));
  }

  /**
   * REPLACE the set of roles somebody holds.
   *
   * Takes role ROW ids, not enum values — that is what lets a person be
   * given a role somebody invented this morning — and SEVERAL of them,
   * because the job functions and the access tiers are two axes: "call
   * agent who also handles tickets" is two roles, not a bespoke eighth.
   *
   * The legacy `staff_users.role` column is written with the enum
   * spelling of the first role that HAS one, and left NULL when none
   * does. It is no longer consulted for authorisation anywhere, so a
   * null is honest where a borrowed enum would be a lie.
   */
  async setRoles(
    targetStaffId: string,
    newRoleIds: readonly string[],
    actor: { staffId: string },
    ctx: ClientContext,
  ): Promise<{
    id: string;
    roleIds: readonly string[];
    roleNames: readonly string[];
    /**
     * The FIRST role, so the response keeps the shape the single-role
     * `/role` route's callers already read. They are still live across
     * the deploy that introduces `/roles`, and a field that silently
     * became `undefined` would show up as a blank in a toast rather
     * than as an error anybody notices.
     */
    roleId: string;
    roleName: string;
  }> {
    if (targetStaffId === actor.staffId) {
      throw new BadRequestException({
        code: 'CANNOT_CHANGE_OWN_ROLE',
        message:
          'You cannot change your own roles. Ask another super admin — this is what stops somebody removing their own way back in.',
      });
    }
    const [before, targets] = await Promise.all([
      this.prisma.client.staffUser.findUnique({
        where: { id: targetStaffId },
        select: {
          id: true,
          deletedAt: true,
          roles: {
            orderBy: [{ grantedAt: 'asc' as const }, { roleId: 'asc' as const }],
            select: { role: { select: { id: true, name: true, deletedAt: true } } },
          },
        },
      }),
      this.rolesToGrant(newRoleIds),
    ]);
    if (!before || before.deletedAt !== null) {
      throw new NotFoundException({ code: 'STAFF_NOT_FOUND', message: 'Staff user not found' });
    }

    const held = before.roles.map((r) => r.role).filter((r) => r.deletedAt === null);
    const sameSet =
      held.length === targets.length && held.every((r) => targets.some((t) => t.id === r.id));
    if (sameSet) {
      return {
        id: before.id,
        roleIds: targets.map((t) => t.id),
        roleNames: targets.map((t) => t.name),
        roleId: targets[0]?.id ?? '',
        roleName: targets[0]?.name ?? '',
      };
    }

    // The guards above are both about not LOSING access — your own
    // roles, and the last super admin. This one is about not GAINING
    // it: a `staff.manage` holder must not be able to promote a
    // colleague past themselves and then use that account. Checked for
    // EVERY role in the set, because a list is only as safe as its most
    // powerful entry.
    const granter = await this.grantingActor(actor.staffId);
    for (const target of targets) assertMayGrantRole(granter, target);

    const keepsSuperAdmin = targets.some((t) => t.isSuperuser);

    // Somebody must be left who can put things back. Counting inside the
    // write's transaction so two concurrent demotions cannot both see a
    // survivor that the other is removing.
    await this.prisma.client.$transaction(async (tx) => {
      const superAdminsLeft = await tx.staffUserRoleAssignment.count({
        where: {
          staffUserId: { not: targetStaffId },
          user: { deletedAt: null },
          role: { isSuperAdmin: true, deletedAt: null },
        },
      });
      if (!keepsSuperAdmin && superAdminsLeft === 0) {
        throw new BadRequestException({
          code: 'LAST_SUPER_ADMIN',
          message:
            'This is the last super admin. Moving them off that role would leave nobody able to manage roles or staff.',
        });
      }
      await setStaffRoles(
        tx,
        targetStaffId,
        targets.map((t) => t.id),
      );
      await tx.staffUser.update({
        where: { id: targetStaffId },
        data: { role: legacyEnumFor(targets.map((t) => t.key)) },
      });
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: actor.staffId,
      action: 'staff.staff_user.role_changed',
      entityType: 'staff_user',
      entityId: targetStaffId,
      severity: 'HIGH',
      changes: {
        before: held.map((r) => r.name),
        after: targets.map((t) => t.name),
      },
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
    return {
      id: targetStaffId,
      roleIds: targets.map((t) => t.id),
      roleNames: targets.map((t) => t.name),
      roleId: targets[0]?.id ?? '',
      roleName: targets[0]?.name ?? '',
    };
  }

  async deactivate(
    targetStaffId: string,
    actor: { staffId: string },
    ctx: ClientContext,
  ): Promise<void> {
    if (targetStaffId === actor.staffId) {
      throw new BadRequestException({
        code: 'CANNOT_DEACTIVATE_SELF',
        message: 'A SUPER_ADMIN cannot deactivate their own account',
      });
    }
    const target = await this.prisma.client.staffUser.findUnique({
      where: { id: targetStaffId },
      select: { id: true, deletedAt: true },
    });
    if (!target) {
      throw new NotFoundException({
        code: 'STAFF_NOT_FOUND',
        message: 'Staff user not found',
      });
    }
    if (target.deletedAt !== null) return;
    const removed = await this.prisma.client.$transaction(async (tx) => {
      const now = new Date();
      const changed = await tx.staffUser.updateMany({
        where: { id: targetStaffId, deletedAt: null },
        data: { deletedAt: now },
      });
      if (changed.count === 0) return false;
      // Their sessions end now. Every guard re-reads the user, but a
      // removed person's session rows must not stay live until they expire.
      await tx.staffRefreshToken.updateMany({
        where: { staffUserId: targetStaffId, revokedAt: null },
        data: { revokedAt: now },
      });
      return true;
    });
    if (!removed) return;
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: actor.staffId,
      action: 'staff.staff_user.deactivated',
      entityType: 'staff_user',
      entityId: targetStaffId,
      severity: 'HIGH',
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private async findLive(emailLower: string): Promise<{ id: string } | null> {
    return this.prisma.client.staffInvitation.findFirst({
      where: {
        email: { equals: emailLower, mode: 'insensitive' },
        usedAt: null,
        deletedAt: null,
        expiresAt: { gte: new Date() },
      },
      select: { id: true },
    });
  }

  private inviteUrlFor(plaintext: string): string {
    return `${this.env.adminAppUrl}/auth/accept-invitation?token=${plaintext}`;
  }

  private toView(row: {
    id: string;
    email: string;
    role: StaffRole | null;
    invitedById: string;
    acceptedById: string | null;
    expiresAt: Date;
    usedAt: Date | null;
    createdAt: Date;
    deletedAt: Date | null;
    roles: readonly { role: { id: string; name: string; deletedAt: Date | null } }[];
  }): InvitationListItem {
    // A role deleted since the invitation was sent is dropped rather
    // than shown: accepting will not grant it, so listing it would
    // promise something the accept cannot deliver.
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
}
