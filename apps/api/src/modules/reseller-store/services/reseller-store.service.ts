import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  Prisma,
  ResellerStoreEventKind,
  ResellerStoreOrigin,
  ResellerStoreStatus,
  ResellerWalletManager,
  SellerStatus,
  SellerStoreKind,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import type { StoreRoleKey } from '../../../common/auth/store-permissions';
import { provisionDefaultStoreRoles } from '../../../common/auth/store-role-provisioning';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderReadService } from '../../order/services/order-read.service';
import {
  canTake,
  initialStatusFor,
  isTerminalStoreStatus,
  refusalFor,
  ruleFor,
  type ResellerStoreAction,
} from './reseller-store-lifecycle';
import { ResellerStoreNotifier } from './reseller-store-notifier.service';
import {
  StoreTeamService,
  type PendingInvitationEmail,
  type StoreTeamView,
} from './store-team.service';

/**
 * WHO is acting on a reseller store. The audit row and the history row
 * both say which: "the seller approved it" and "we created it for them"
 * are different facts, and only one of them is ours to answer for.
 */
export type ResellerActor =
  | { readonly kind: 'SELLER'; readonly sellerUserId: string; readonly name: string }
  | { readonly kind: 'STAFF'; readonly staffId: string };

export interface ResellerStoreView {
  readonly id: string;
  readonly sellerId: string;
  readonly sellerCompanyName: string;
  readonly name: string;
  readonly displayName: string | null;
  readonly status: ResellerStoreStatus;
  readonly origin: ResellerStoreOrigin;
  readonly walletManagedBy: ResellerWalletManager;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly note: string | null;
  readonly memberCount: number;
  readonly createdAt: string;
  readonly statusChangedAt: string | null;
}

export interface ResellerStoreEventView {
  readonly id: string;
  readonly kind: ResellerStoreEventKind;
  readonly fromStatus: ResellerStoreStatus | null;
  readonly toStatus: ResellerStoreStatus | null;
  readonly actorType: ActorType;
  readonly note: string | null;
  readonly data: Prisma.JsonValue | null;
  readonly createdAt: string;
}

export interface ResellerStoreDetail extends ResellerStoreView {
  readonly logoUrl: string | null;
  readonly events: readonly ResellerStoreEventView[];
  readonly team: StoreTeamView;
}

export interface CreateResellerStoreInput {
  readonly name: string;
  readonly displayName?: string;
  readonly contactEmail?: string;
  readonly contactPhone?: string;
  readonly walletManagedBy?: ResellerWalletManager;
  readonly note?: string;
  readonly invite?: { email: string; fullName: string; roleKey: StoreRoleKey };
}

const VIEW_SELECT = {
  id: true,
  sellerId: true,
  name: true,
  displayName: true,
  status: true,
  origin: true,
  walletManagedBy: true,
  contactEmail: true,
  contactPhone: true,
  note: true,
  logoKey: true,
  createdAt: true,
  statusChangedAt: true,
  seller: { select: { companyName: true } },
  _count: { select: { storeUsers: { where: { deletedAt: null } } } },
} as const;

type ViewRow = Prisma.SellerStoreGetPayload<{ select: typeof VIEW_SELECT }>;

function actorFields(actor: ResellerActor): {
  actorType: ActorType;
  actorId: string;
  staffUserId?: string;
} {
  return actor.kind === 'STAFF'
    ? { actorType: ActorType.STAFF, actorId: actor.staffId, staffUserId: actor.staffId }
    : { actorType: ActorType.SELLER, actorId: actor.sellerUserId };
}

function blankToNull(v: string | undefined): string | null {
  const t = v?.trim();
  return t === undefined || t === '' ? null : t;
}

/**
 * RS-1 — the ONLY writer of a reseller store's life.
 *
 * ── THE GUARD IS IN THE WRITE ────────────────────────────────────────
 * Every transition is a guarded `updateMany` on the status it READ, in
 * the same transaction as its history row. Two sellers' tabs approving
 * and rejecting the same store cannot both succeed: the second finds
 * `count === 0` and is told the store changed.
 *
 * ── CHANNEL STORES ARE UNTOUCHED ─────────────────────────────────────
 * Every query here carries `kind: RESELLER`, and `SellerStoreService`
 * carries `kind: CHANNEL`, so neither can reach the other's rows.
 */
@Injectable()
export class ResellerStoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly spaces: SpacesService,
    private readonly orders: OrderReadService,
    private readonly team: StoreTeamService,
    private readonly notifier: ResellerStoreNotifier,
  ) {}

  // ── Create ─────────────────────────────────────────────────────────

  /**
   * The seller creates a store for themselves (ACTIVE at once, optionally
   * with its first user invited) — or Skydrop creates one FOR a seller
   * (PENDING_SELLER_APPROVAL, the seller told in-app and by email).
   */
  async create(
    sellerId: string,
    input: CreateResellerStoreInput,
    actor: ResellerActor,
  ): Promise<ResellerStoreDetail> {
    const name = input.name.trim();
    if (name === '') {
      throw new BadRequestException({
        code: 'STORE_NAME_REQUIRED',
        message: 'Give the store a name',
      });
    }
    const origin = actor.kind === 'STAFF' ? ResellerStoreOrigin.ADMIN : ResellerStoreOrigin.SELLER;
    const status = initialStatusFor(origin);
    if (input.invite !== undefined && status !== ResellerStoreStatus.ACTIVE) {
      // An admin-created store has no team until the seller agrees to it.
      throw new BadRequestException({
        code: 'INVITE_AFTER_APPROVAL',
        message: 'The seller invites the store’s first user when they approve it.',
      });
    }

    const seller = await this.prisma.client.seller.findFirst({
      where: { id: sellerId, deletedAt: null },
      select: { id: true, status: true, companyName: true },
    });
    if (seller === null) {
      throw new NotFoundException({ code: 'SELLER_NOT_FOUND', message: 'No such seller' });
    }
    if (seller.status !== SellerStatus.APPROVED) {
      throw new ConflictException({
        code: 'SELLER_NOT_ACTIVE',
        message: 'A reseller store can only be opened for an approved seller.',
      });
    }

    let created: { id: string; pending: PendingInvitationEmail | null };
    try {
      created = await this.prisma.client.$transaction(async (tx) => {
        const now = new Date();
        const store = await tx.sellerStore.create({
          data: {
            sellerId,
            name,
            note: blankToNull(input.note),
            kind: SellerStoreKind.RESELLER,
            // Never the default: that is where the seller's OWN orders go
            // (and the CHECK constraint refuses it besides).
            isDefault: false,
            isActive: true,
            status,
            origin,
            walletManagedBy: input.walletManagedBy ?? ResellerWalletManager.SELLER,
            displayName: blankToNull(input.displayName),
            contactEmail: blankToNull(input.contactEmail),
            contactPhone: blankToNull(input.contactPhone),
            statusChangedAt: now,
          },
          select: { id: true },
        });
        await provisionDefaultStoreRoles(tx, store.id);
        await tx.resellerStoreEvent.create({
          data: {
            storeId: store.id,
            kind: ResellerStoreEventKind.CREATED,
            toStatus: status,
            ...this.eventActor(actor),
            data: {
              origin,
              walletManagedBy: input.walletManagedBy ?? ResellerWalletManager.SELLER,
            },
          },
        });
        const pending =
          input.invite === undefined || actor.kind !== 'SELLER'
            ? null
            : await this.team.createInvitationRow(tx, {
                storeId: store.id,
                storeName: blankToNull(input.displayName) ?? name,
                email: input.invite.email,
                fullName: input.invite.fullName,
                roleKey: input.invite.roleKey,
                actor: { kind: 'SELLER', sellerUserId: actor.sellerUserId, name: actor.name },
              });
        return { id: store.id, pending };
      });
    } catch (err) {
      // (seller, name) unique — shared with the seller's channel stores.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = String((err.meta as { target?: unknown } | undefined)?.target ?? '');
        if (target.includes('name') || target.includes('seller_id')) {
          throw new ConflictException({
            code: 'STORE_NAME_TAKEN',
            message: `This seller already has a store called “${name}”.`,
          });
        }
      }
      throw err;
    }

    await this.audit.log({
      ...actorFields(actor),
      sellerId,
      action: 'reseller_store.created',
      entityType: 'seller_store',
      entityId: created.id,
      severity: 'MEDIUM',
      metadata: { name, origin, status, invited: created.pending !== null },
    });
    if (created.pending !== null) await this.team.sendInvitationEmail(created.pending);
    if (origin === ResellerStoreOrigin.ADMIN) {
      await this.notifier.pendingApproval({ storeId: created.id, sellerId, storeName: name });
    }
    return this.detail(created.id, sellerId);
  }

  // ── Transitions ────────────────────────────────────────────────────

  async approve(
    sellerId: string,
    storeId: string,
    actor: ResellerActor & { kind: 'SELLER' },
    invite?: { email: string; fullName: string; roleKey: StoreRoleKey },
  ): Promise<ResellerStoreDetail> {
    return this.transition(sellerId, storeId, 'APPROVE', actor, { invite });
  }

  async reject(sellerId: string, storeId: string, actor: ResellerActor, reason: string) {
    return this.transition(sellerId, storeId, 'REJECT', actor, { reason });
  }

  async pause(sellerId: string, storeId: string, actor: ResellerActor, reason?: string) {
    return this.transition(sellerId, storeId, 'PAUSE', actor, { reason });
  }

  async resume(sellerId: string, storeId: string, actor: ResellerActor) {
    return this.transition(sellerId, storeId, 'RESUME', actor, {});
  }

  /**
   * RS-1: CLOSED only when no order of the store is in flight. Phase 1
   * files no order under a reseller store (SellerStoreService refuses
   * one), so today this always passes — the check is written now so it
   * holds the day store orders arrive. It runs INSIDE the transaction,
   * AFTER the status has moved: the store row is then locked by our
   * update, and an order create that locks the store row (FOR SHARE, as
   * phase 3 must) cannot slip in between the check and the close.
   * The store wallet's settlement (RS-1) joins this check in phase 3.
   */
  async close(sellerId: string, storeId: string, actor: ResellerActor, reason: string) {
    return this.transition(sellerId, storeId, 'CLOSE', actor, { reason });
  }

  private async transition(
    sellerId: string,
    storeId: string,
    action: ResellerStoreAction,
    actor: ResellerActor,
    opts: {
      reason?: string | undefined;
      invite?: { email: string; fullName: string; roleKey: StoreRoleKey } | undefined;
    },
  ): Promise<ResellerStoreDetail> {
    const rule = ruleFor(action);
    const reason = opts.reason?.trim() ?? '';
    if (rule.needsReason && reason.length < 10) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'Say why, in at least 10 characters. The store and the seller both read it.',
      });
    }

    const store = await this.prisma.client.sellerStore.findFirst({
      where: { id: storeId, sellerId, kind: SellerStoreKind.RESELLER, deletedAt: null },
      select: { id: true, name: true, displayName: true, status: true },
    });
    if (store === null || store.status === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such reseller store' });
    }
    const from = store.status;
    if (!canTake(action, from)) {
      throw new ConflictException({
        code: 'RESELLER_STORE_INVALID_TRANSITION',
        message: refusalFor(action, from),
      });
    }

    const pending = await this.prisma.client.$transaction(async (tx) => {
      const now = new Date();
      const moved = await tx.sellerStore.updateMany({
        where: { id: storeId, sellerId, kind: SellerStoreKind.RESELLER, status: from },
        data: { status: rule.to, statusChangedAt: now },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: 'RESELLER_STORE_CHANGED',
          message: 'This store changed while you were looking at it. Reload and try again.',
        });
      }
      if (action === 'CLOSE' && (await this.orders.hasOrdersInFlightForStore(storeId, tx))) {
        throw new ConflictException({
          code: 'STORE_HAS_ORDERS_IN_FLIGHT',
          message:
            'This store still has orders on their way. Pause it, and close it once they finish.',
        });
      }
      if (isTerminalStoreStatus(rule.to)) {
        // A closed or rejected store's team is done: sessions end now and
        // nothing pending can be accepted.
        await tx.storeRefreshToken.updateMany({
          where: { storeUser: { storeId }, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.storeUserInvitation.updateMany({
          where: { storeId, usedAt: null, deletedAt: null },
          data: { deletedAt: now },
        });
      }
      await tx.resellerStoreEvent.create({
        data: {
          storeId,
          kind: rule.event,
          fromStatus: from,
          toStatus: rule.to,
          ...this.eventActor(actor),
          note: reason === '' ? null : reason,
        },
      });
      if (action === 'APPROVE' && opts.invite !== undefined && actor.kind === 'SELLER') {
        return this.team.createInvitationRow(tx, {
          storeId,
          storeName: store.displayName ?? store.name,
          email: opts.invite.email,
          fullName: opts.invite.fullName,
          roleKey: opts.invite.roleKey,
          actor: { kind: 'SELLER', sellerUserId: actor.sellerUserId, name: actor.name },
        });
      }
      return null;
    });

    await this.audit.log({
      ...actorFields(actor),
      sellerId,
      // reseller_store.approved / .rejected / .paused / .resumed / .closed
      action: `reseller_store.${rule.event.toLowerCase()}`,
      entityType: 'seller_store',
      entityId: storeId,
      severity: rule.severity,
      changes: { from, to: rule.to },
      metadata: { name: store.name, reason: reason === '' ? null : reason },
    });
    if (pending !== null) await this.team.sendInvitationEmail(pending);
    return this.detail(storeId, sellerId);
  }

  /** RS-6 decision 6 — who manages the store's wallet. Recorded now; read in phase 3. */
  async setWalletManager(
    sellerId: string,
    storeId: string,
    walletManagedBy: ResellerWalletManager,
    actor: ResellerActor,
  ): Promise<ResellerStoreDetail> {
    const store = await this.prisma.client.sellerStore.findFirst({
      where: { id: storeId, sellerId, kind: SellerStoreKind.RESELLER, deletedAt: null },
      select: { status: true, walletManagedBy: true },
    });
    if (store === null || store.status === null || store.walletManagedBy === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such reseller store' });
    }
    if (isTerminalStoreStatus(store.status)) {
      throw new ConflictException({
        code: 'STORE_IS_FINAL',
        message: 'A closed or rejected store cannot change who manages its wallet.',
      });
    }
    if (store.walletManagedBy === walletManagedBy) return this.detail(storeId, sellerId);

    const before = store.walletManagedBy;
    const status = store.status;
    await this.prisma.client.$transaction(async (tx) => {
      const changed = await tx.sellerStore.updateMany({
        where: {
          id: storeId,
          sellerId,
          kind: SellerStoreKind.RESELLER,
          status,
          walletManagedBy: before,
        },
        data: { walletManagedBy },
      });
      if (changed.count === 0) {
        throw new ConflictException({
          code: 'RESELLER_STORE_CHANGED',
          message: 'This store changed while you were looking at it. Reload and try again.',
        });
      }
      await tx.resellerStoreEvent.create({
        data: {
          storeId,
          kind: ResellerStoreEventKind.WALLET_MANAGER_CHANGED,
          ...this.eventActor(actor),
          data: { from: before, to: walletManagedBy },
        },
      });
    });
    await this.audit.log({
      ...actorFields(actor),
      sellerId,
      action: 'reseller_store.wallet_manager_changed',
      entityType: 'seller_store',
      entityId: storeId,
      severity: 'MEDIUM',
      changes: { from: before, to: walletManagedBy },
    });
    return this.detail(storeId, sellerId);
  }

  // ── Reads ──────────────────────────────────────────────────────────

  async listForSeller(sellerId: string): Promise<readonly ResellerStoreView[]> {
    const rows = await this.prisma.client.sellerStore.findMany({
      where: { sellerId, kind: SellerStoreKind.RESELLER, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }],
      select: VIEW_SELECT,
    });
    return rows.map((r) => this.toView(r));
  }

  async listForAdmin(filter: {
    sellerId?: string;
    status?: ResellerStoreStatus;
  }): Promise<readonly ResellerStoreView[]> {
    const rows = await this.prisma.client.sellerStore.findMany({
      where: {
        kind: SellerStoreKind.RESELLER,
        deletedAt: null,
        ...(filter.sellerId === undefined ? {} : { sellerId: filter.sellerId }),
        ...(filter.status === undefined ? {} : { status: filter.status }),
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
      select: VIEW_SELECT,
    });
    return rows.map((r) => this.toView(r));
  }

  /** One store. `sellerId` null is the admin read (any seller). */
  async detail(storeId: string, sellerId: string | null): Promise<ResellerStoreDetail> {
    const row = await this.prisma.client.sellerStore.findFirst({
      where: {
        id: storeId,
        kind: SellerStoreKind.RESELLER,
        deletedAt: null,
        ...(sellerId === null ? {} : { sellerId }),
      },
      select: {
        ...VIEW_SELECT,
        resellerEvents: { orderBy: { createdAt: 'asc' }, take: 500 },
      },
    });
    if (row === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such reseller store' });
    }
    return {
      ...this.toView(row),
      logoUrl: await this.presign(row.logoKey),
      events: row.resellerEvents.map((e) => ({
        id: e.id,
        kind: e.kind,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actorType: e.actorType,
        note: e.note,
        data: e.data,
        createdAt: e.createdAt.toISOString(),
      })),
      team: await this.team.team(storeId),
    };
  }

  // ── internals ──────────────────────────────────────────────────────

  private eventActor(actor: ResellerActor): { actorType: ActorType; actorId: string } {
    return actor.kind === 'STAFF'
      ? { actorType: ActorType.STAFF, actorId: actor.staffId }
      : { actorType: ActorType.SELLER, actorId: actor.sellerUserId };
  }

  private toView(r: ViewRow): ResellerStoreView {
    // The CHECK constraint makes these non-null on a reseller row; the
    // fallbacks exist only to satisfy the type, never to invent a value.
    return {
      id: r.id,
      sellerId: r.sellerId,
      sellerCompanyName: r.seller.companyName,
      name: r.name,
      displayName: r.displayName,
      status: r.status ?? ResellerStoreStatus.PENDING_SELLER_APPROVAL,
      origin: r.origin ?? ResellerStoreOrigin.SELLER,
      walletManagedBy: r.walletManagedBy ?? ResellerWalletManager.SELLER,
      contactEmail: r.contactEmail,
      contactPhone: r.contactPhone,
      note: r.note,
      memberCount: r._count.storeUsers,
      createdAt: r.createdAt.toISOString(),
      statusChangedAt: r.statusChangedAt?.toISOString() ?? null,
    };
  }

  private async presign(key: string | null): Promise<string | null> {
    if (key === null) return null;
    try {
      return await this.spaces.presignGetUrl(key);
    } catch {
      return null;
    }
  }
}
