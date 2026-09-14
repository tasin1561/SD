import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  NotificationRecipientType,
  Prisma,
  SellerStoreKind,
  type ResellerStoreStatus,
} from '@skydrop/db';
import { EnvService } from '../../../config/env.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { StoreRoleKey } from '../../../common/auth/store-permissions';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { TokenHashService } from '../../auth-common/services/token-hash.service';
import { EmailQueue } from '../../email/queue/email.queue';
import { acceptsInvitations } from './reseller-store-lifecycle';

const INVITATION_TTL_DAYS = 7;

/** Who is inviting: the seller behind the store, or the store's own team. */
export type InvitingActor =
  | { readonly kind: 'SELLER'; readonly sellerUserId: string; readonly name: string }
  | {
      readonly kind: 'STORE';
      readonly storeUserId: string;
      readonly name: string;
      readonly isOwner: boolean;
    };

export interface StoreMemberView {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly roleKey: string;
  readonly roleName: string;
  readonly isOwner: boolean;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
}

export interface StoreInvitationView {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly roleKey: string;
  readonly roleName: string;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface StoreTeamView {
  readonly members: readonly StoreMemberView[];
  readonly invitations: readonly StoreInvitationView[];
  readonly roles: ReadonlyArray<{
    readonly key: string;
    readonly name: string;
    readonly description: string | null;
  }>;
}

/** A reseller store, as much of it as the team flows need. */
export interface StoreRef {
  readonly id: string;
  readonly name: string;
  readonly displayName: string | null;
  readonly status: ResellerStoreStatus | null;
  readonly sellerId: string;
}

export interface PendingInvitationEmail {
  readonly invitationId: string;
  readonly plaintext: string;
  readonly email: string;
  readonly fullName: string;
  readonly roleName: string;
  readonly storeName: string;
  readonly inviterName: string;
  readonly expiresAt: Date;
}

/**
 * RS-2 — a reseller store's team: invitations, roles, removal.
 *
 * Every read and write is scoped by the store id in the WHERE clause —
 * the store user's from their TOKEN, the seller's after proving the store
 * is theirs — so a miss is a 404 that says nothing about whether the row
 * exists. The last owner cannot be demoted or removed; the count runs
 * INSIDE the write's transaction so two concurrent demotions cannot each
 * see the owner the other is removing.
 *
 * Accepting an invitation lives in `store-auth` (it signs the person in);
 * this module writes the row that flow spends.
 */
@Injectable()
export class StoreTeamService {
  private readonly logger = new Logger(StoreTeamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly hashes: TokenHashService,
    private readonly audit: AuditLogService,
    private readonly email: EmailQueue,
  ) {}

  // ── Invitations ────────────────────────────────────────────────────

  /**
   * Write an invitation row in the caller's transaction and return what
   * the email needs. The caller sends the email AFTER its commit
   * (`sendInvitationEmail`), so a rolled-back approval never mails a link
   * to a store that did not open.
   */
  async createInvitationRow(
    tx: Prisma.TransactionClient,
    input: {
      readonly storeId: string;
      readonly storeName: string;
      readonly email: string;
      readonly fullName: string;
      readonly roleKey: StoreRoleKey;
      readonly actor: InvitingActor;
    },
  ): Promise<PendingInvitationEmail> {
    const emailLower = input.email.trim().toLowerCase();

    if (input.roleKey === 'owner' && input.actor.kind === 'STORE' && !input.actor.isOwner) {
      throw new ForbiddenException({
        code: 'OWNER_GRANT_REQUIRES_OWNER',
        message: 'Only an owner of this store can invite another owner.',
      });
    }

    const role = await tx.storeRoleDefinition.findFirst({
      where: { storeId: input.storeId, key: input.roleKey, deletedAt: null },
      select: { id: true, name: true },
    });
    if (role === null) {
      throw new NotFoundException({
        code: 'ROLE_NOT_FOUND',
        message: 'No such role in this store',
      });
    }

    const existingUser = await tx.storeUser.findUnique({
      where: { email: emailLower },
      select: { storeId: true },
    });
    if (existingUser !== null) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message:
          existingUser.storeId === input.storeId
            ? 'This person is already on the team.'
            : // Never names the other store: who else resells on the
              // platform is not this store's business.
              'That email already has a store login.',
      });
    }

    // An expired invitation still holds the one-live partial unique (an
    // index predicate cannot read the clock), so it is retired first.
    await tx.storeUserInvitation.updateMany({
      where: {
        email: { equals: emailLower, mode: 'insensitive' },
        usedAt: null,
        deletedAt: null,
        expiresAt: { lte: new Date() },
      },
      data: { deletedAt: new Date() },
    });

    const plaintext = this.hashes.generateInvitationToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000);
    let row: { id: string };
    try {
      row = await tx.storeUserInvitation.create({
        data: {
          storeId: input.storeId,
          email: input.email.trim(),
          fullName: input.fullName.trim(),
          token: this.hashes.sha256Hex(plaintext),
          roleId: role.id,
          invitedByActorType: input.actor.kind === 'SELLER' ? ActorType.SELLER : ActorType.STORE,
          invitedById:
            input.actor.kind === 'SELLER' ? input.actor.sellerUserId : input.actor.storeUserId,
          expiresAt,
        },
        select: { id: true },
      });
    } catch (err) {
      // store_user_invitations_one_live_uq doing its job.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'INVITATION_ALREADY_PENDING',
          message: 'That email already has a pending invitation.',
        });
      }
      throw err;
    }

    return {
      invitationId: row.id,
      plaintext,
      email: input.email.trim(),
      fullName: input.fullName.trim(),
      roleName: role.name,
      storeName: input.storeName,
      inviterName: input.actor.name,
      expiresAt,
    };
  }

  /** CREDENTIAL message (NOTIF-9): email only, best-effort after commit. */
  async sendInvitationEmail(p: PendingInvitationEmail): Promise<void> {
    try {
      await this.email.enqueue({
        templateCode: 'store.invitation.email',
        recipient: { type: NotificationRecipientType.STORE_USER, email: p.email },
        variables: {
          full_name: p.fullName,
          store_name: p.storeName,
          inviter_name: p.inviterName,
          role: p.roleName,
          invite_url: `${this.env.resellerAppUrl}/auth/accept-invitation?token=${p.plaintext}`,
          expires_at_display: p.expiresAt.toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
        },
        triggerEvent: 'store.team_invitation.created',
      });
    } catch (err) {
      this.logger.warn(
        { invitationId: p.invitationId, err: err instanceof Error ? err.message : String(err) },
        'Store invitation email could not be queued; the invitation row stands',
      );
    }
  }

  /** The seller invites somebody into one of their reseller stores. */
  async inviteAsSeller(
    sellerId: string,
    storeId: string,
    input: { email: string; fullName: string; roleKey: StoreRoleKey },
    actor: { sellerUserId: string; name: string },
  ): Promise<StoreInvitationView> {
    const store = await this.sellerStore(sellerId, storeId);
    return this.invite(store, input, { kind: 'SELLER', ...actor });
  }

  /** A store's own team invites a colleague. */
  async inviteAsStore(
    user: AuthenticatedStoreUser,
    input: { email: string; fullName: string; roleKey: StoreRoleKey },
  ): Promise<StoreInvitationView> {
    const store = await this.storeById(user.storeId);
    return this.invite(store, input, {
      kind: 'STORE',
      storeUserId: user.id,
      name: user.fullName,
      isOwner: user.roleKey === 'owner',
    });
  }

  async revokeInvitation(
    storeId: string,
    invitationId: string,
    actor: { type: ActorType; id: string; sellerId: string },
  ): Promise<void> {
    // Scoped by store in the WHERE; guarded on "still live".
    const changed = await this.prisma.client.storeUserInvitation.updateMany({
      where: { id: invitationId, storeId, usedAt: null, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (changed.count === 0) {
      throw new NotFoundException({
        code: 'INVITATION_NOT_FOUND',
        message: 'No pending invitation with that id',
      });
    }
    await this.audit.log({
      actorType: actor.type,
      ...(actor.type === ActorType.STAFF ? { staffUserId: actor.id } : { actorId: actor.id }),
      sellerId: actor.sellerId,
      action: 'store.team_invitation.revoked',
      entityType: 'store_user_invitation',
      entityId: invitationId,
      severity: 'MEDIUM',
      metadata: { storeId },
    });
  }

  // ── Team reads ─────────────────────────────────────────────────────

  async team(storeId: string): Promise<StoreTeamView> {
    const [members, invitations, roles] = await Promise.all([
      this.prisma.client.storeUser.findMany({
        where: { storeId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        take: 200,
        select: {
          id: true,
          emailDisplay: true,
          fullName: true,
          lastLoginAt: true,
          createdAt: true,
          role: { select: { key: true, name: true, isOwner: true } },
        },
      }),
      this.prisma.client.storeUserInvitation.findMany({
        where: { storeId, usedAt: null, deletedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          email: true,
          fullName: true,
          expiresAt: true,
          createdAt: true,
          role: { select: { key: true, name: true } },
        },
      }),
      this.prisma.client.storeRoleDefinition.findMany({
        where: { storeId, deletedAt: null },
        orderBy: [{ isOwner: 'desc' }, { createdAt: 'asc' }],
        select: { key: true, name: true, description: true },
      }),
    ]);
    return {
      members: members.map((m) => ({
        id: m.id,
        email: m.emailDisplay,
        fullName: m.fullName,
        roleKey: m.role.key,
        roleName: m.role.name,
        isOwner: m.role.isOwner,
        lastLoginAt: m.lastLoginAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        fullName: i.fullName,
        roleKey: i.role.key,
        roleName: i.role.name,
        expiresAt: i.expiresAt.toISOString(),
        createdAt: i.createdAt.toISOString(),
      })),
      roles,
    };
  }

  // ── Members ────────────────────────────────────────────────────────

  async changeRole(
    user: AuthenticatedStoreUser,
    memberId: string,
    roleKey: StoreRoleKey,
  ): Promise<StoreMemberView> {
    if (memberId === user.id) {
      throw new BadRequestException({
        code: 'CANNOT_CHANGE_OWN_ROLE',
        message:
          'You cannot change your own role. Ask another owner — this is what stops somebody removing their own way back in.',
      });
    }
    if (roleKey === 'owner' && user.roleKey !== 'owner') {
      throw new ForbiddenException({
        code: 'OWNER_GRANT_REQUIRES_OWNER',
        message: 'Only an owner of this store can make somebody an owner.',
      });
    }
    const [target, role] = await Promise.all([
      this.prisma.client.storeUser.findFirst({
        where: { id: memberId, storeId: user.storeId, deletedAt: null },
        select: { id: true, roleId: true, role: { select: { name: true, isOwner: true } } },
      }),
      this.prisma.client.storeRoleDefinition.findFirst({
        where: { storeId: user.storeId, key: roleKey, deletedAt: null },
        select: { id: true, name: true, isOwner: true },
      }),
    ]);
    if (target === null) {
      throw new NotFoundException({ code: 'MEMBER_NOT_FOUND', message: 'No such team member' });
    }
    if (role === null) {
      throw new NotFoundException({
        code: 'ROLE_NOT_FOUND',
        message: 'No such role in this store',
      });
    }
    if (target.role.isOwner && user.roleKey !== 'owner') {
      throw new ForbiddenException({
        code: 'OWNER_CHANGE_REQUIRES_OWNER',
        message: 'Only an owner of this store can change what an owner may do.',
      });
    }

    if (target.roleId !== role.id) {
      await this.prisma.client.$transaction(async (tx) => {
        if (target.role.isOwner && !role.isOwner)
          await this.assertAnotherOwner(tx, user.storeId, memberId);
        // Guarded on the role READ, so a concurrent change is not overwritten.
        const changed = await tx.storeUser.updateMany({
          where: { id: memberId, storeId: user.storeId, roleId: target.roleId, deletedAt: null },
          data: { roleId: role.id },
        });
        if (changed.count === 0) {
          throw new ConflictException({
            code: 'MEMBER_CHANGED',
            message: 'This person changed while you were looking. Try again.',
          });
        }
      });
      await this.audit.log({
        actorType: ActorType.STORE,
        actorId: user.id,
        sellerId: user.sellerId,
        action: 'store.team_member.role_changed',
        entityType: 'store_user',
        entityId: memberId,
        severity: 'MEDIUM',
        changes: { before: target.role.name, after: role.name },
        metadata: { storeId: user.storeId },
      });
    }
    const member = (await this.team(user.storeId)).members.find((m) => m.id === memberId);
    if (member === undefined) {
      throw new NotFoundException({ code: 'MEMBER_NOT_FOUND', message: 'No such team member' });
    }
    return member;
  }

  async removeMember(user: AuthenticatedStoreUser, memberId: string): Promise<void> {
    if (memberId === user.id) {
      throw new BadRequestException({
        code: 'CANNOT_REMOVE_SELF',
        message: 'You cannot remove your own access. Ask another owner.',
      });
    }
    const target = await this.prisma.client.storeUser.findFirst({
      where: { id: memberId, storeId: user.storeId, deletedAt: null },
      select: { id: true, role: { select: { isOwner: true } } },
    });
    if (target === null) {
      throw new NotFoundException({ code: 'MEMBER_NOT_FOUND', message: 'No such team member' });
    }
    if (target.role.isOwner && user.roleKey !== 'owner') {
      throw new ForbiddenException({
        code: 'OWNER_CHANGE_REQUIRES_OWNER',
        message: 'Only an owner of this store can remove an owner.',
      });
    }
    await this.prisma.client.$transaction(async (tx) => {
      if (target.role.isOwner) await this.assertAnotherOwner(tx, user.storeId, memberId);
      const changed = await tx.storeUser.updateMany({
        where: { id: memberId, storeId: user.storeId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (changed.count === 0) return;
      // Their sessions end now, not when the access token runs out.
      await tx.storeRefreshToken.updateMany({
        where: { storeUserId: memberId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    await this.audit.log({
      actorType: ActorType.STORE,
      actorId: user.id,
      sellerId: user.sellerId,
      action: 'store.team_member.removed',
      entityType: 'store_user',
      entityId: memberId,
      severity: 'HIGH',
      metadata: { storeId: user.storeId },
    });
  }

  // ── internals ──────────────────────────────────────────────────────

  private async invite(
    store: StoreRef,
    input: { email: string; fullName: string; roleKey: StoreRoleKey },
    actor: InvitingActor,
  ): Promise<StoreInvitationView> {
    if (store.status === null || !acceptsInvitations(store.status)) {
      throw new ConflictException({
        code: 'STORE_NOT_OPEN_FOR_INVITATIONS',
        message: 'Invitations go out once the store is open (active or paused).',
      });
    }
    const pending = await this.prisma.client.$transaction((tx) =>
      this.createInvitationRow(tx, {
        storeId: store.id,
        storeName: store.displayName ?? store.name,
        email: input.email,
        fullName: input.fullName,
        roleKey: input.roleKey,
        actor,
      }),
    );
    await this.audit.log({
      actorType: actor.kind === 'SELLER' ? ActorType.SELLER : ActorType.STORE,
      actorId: actor.kind === 'SELLER' ? actor.sellerUserId : actor.storeUserId,
      sellerId: store.sellerId,
      action: 'store.team_invitation.created',
      entityType: 'store_user_invitation',
      entityId: pending.invitationId,
      severity: 'MEDIUM',
      metadata: { storeId: store.id, email: pending.email, role: input.roleKey },
    });
    await this.sendInvitationEmail(pending);
    const view = (await this.team(store.id)).invitations.find((i) => i.id === pending.invitationId);
    if (view === undefined) {
      throw new NotFoundException({ code: 'INVITATION_NOT_FOUND', message: 'Invitation vanished' });
    }
    return view;
  }

  private async assertAnotherOwner(
    tx: Prisma.TransactionClient,
    storeId: string,
    exceptUserId: string,
  ): Promise<void> {
    const others = await tx.storeUser.count({
      where: { storeId, deletedAt: null, id: { not: exceptUserId }, role: { isOwner: true } },
    });
    if (others === 0) {
      throw new BadRequestException({
        code: 'LAST_OWNER',
        message: 'This is the last owner. Nobody would be left able to manage the store.',
      });
    }
  }

  /** The store, proven to be THIS seller's reseller store. */
  async sellerStore(sellerId: string, storeId: string): Promise<StoreRef> {
    const store = await this.prisma.client.sellerStore.findFirst({
      where: { id: storeId, sellerId, kind: SellerStoreKind.RESELLER, deletedAt: null },
      select: { id: true, name: true, displayName: true, status: true, sellerId: true },
    });
    if (store === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such reseller store' });
    }
    return store;
  }

  private async storeById(storeId: string): Promise<StoreRef> {
    const store = await this.prisma.client.sellerStore.findFirst({
      where: { id: storeId, kind: SellerStoreKind.RESELLER, deletedAt: null },
      select: { id: true, name: true, displayName: true, status: true, sellerId: true },
    });
    if (store === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such reseller store' });
    }
    return store;
  }
}
