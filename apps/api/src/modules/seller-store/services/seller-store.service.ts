import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, AuditSeverity, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';

export interface StoreView {
  readonly id: string;
  readonly name: string;
  readonly note: string | null;
  readonly isDefault: boolean;
  readonly isActive: boolean;
  readonly orderCount: number;
  readonly createdAt: string;
}

/** The name every seller's first shopfront is given. */
export const DEFAULT_STORE_NAME = 'Default store';

/**
 * A seller's shopfronts — the ONLY writer of `seller_stores`.
 *
 * ── WHAT A STORE IS ──────────────────────────────────────────────────
 * A brand a seller sells under. Catalog, stock, wallet and courier
 * accounts stay per SELLER: the goods are the same goods on the same
 * shelf, and splitting stock per store would leave one brand unable to
 * sell while its sibling has forty units idle in the same bin. So a
 * store is an attribute of an ORDER — which shopfront the sale came
 * from — and that is what keeps this a small change rather than a
 * second tenancy layer.
 *
 * ── THE RULES LIVE IN THE WRITE, NOT BEFORE IT ───────────────────────
 * "Exactly one default" is a partial unique index, not a check: two
 * tabs both promoting a default would otherwise both read "no other
 * default" and both succeed, leaving order create with two defaults to
 * choose between. Every guard here that reads before writing is either
 * inside the same transaction as its write or guarded on the state it
 * read.
 */
@Injectable()
export class SellerStoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * The first store, created in the SAME transaction as the seller.
   *
   * This is what lets `orders.store_id` be NOT NULL: there has never
   * been a moment when a seller existed without somewhere for their
   * orders to belong. Takes the caller's tx for exactly that reason —
   * a company and its shopfront come up together or not at all.
   */
  async createDefaultFor(tx: Prisma.TransactionClient, sellerId: string): Promise<{ id: string }> {
    return tx.sellerStore.create({
      data: { sellerId, name: DEFAULT_STORE_NAME, isDefault: true, isActive: true },
      select: { id: true },
    });
  }

  async list(sellerId: string, includeInactive = true): Promise<readonly StoreView[]> {
    const rows = await this.prisma.client.sellerStore.findMany({
      where: {
        sellerId,
        deletedAt: null,
        ...(includeInactive ? {} : { isActive: true }),
      },
      // Default first, then alphabetical: the one that matters is the
      // one pre-selected everywhere else.
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        note: true,
        isDefault: true,
        isActive: true,
        createdAt: true,
        _count: { select: { orders: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      note: r.note,
      isDefault: r.isDefault,
      isActive: r.isActive,
      // Shown because it is what makes deactivating one a real decision
      // rather than a tidy-up.
      orderCount: r._count.orders,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Resolve the store an order should be filed under.
   *
   * Given one, it must belong to THIS seller and be active — a store id
   * from another seller is an IDOR with money behind it, and one that
   * is inactive is a shopfront somebody deliberately closed. Given
   * none, the seller's default.
   *
   * Returns the NAME as well, because the order snapshots it (ORD-6):
   * renaming a store must not rewrite what a past customer was told.
   */
  async resolveForOrder(
    sellerId: string,
    storeId: string | null | undefined,
  ): Promise<{ id: string; name: string }> {
    if (storeId != null && storeId !== '') {
      const store = await this.prisma.client.sellerStore.findFirst({
        // sellerId in the WHERE, never fetched-then-compared: a miss is
        // a 404 that says nothing about whether the row exists.
        where: { id: storeId, sellerId, deletedAt: null },
        select: { id: true, name: true, isActive: true },
      });
      if (store === null) {
        throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such store' });
      }
      if (!store.isActive) {
        throw new ConflictException({
          code: 'STORE_INACTIVE',
          message: `“${store.name}” is not taking new orders. Reactivate it, or choose another.`,
        });
      }
      return { id: store.id, name: store.name };
    }

    const fallback = await this.prisma.client.sellerStore.findFirst({
      where: { sellerId, isDefault: true, deletedAt: null },
      select: { id: true, name: true },
    });
    if (fallback === null) {
      // Not reachable for a seller created after this shipped, and not
      // silently papered over either: an order filed under no store
      // would be invisible to every filter that exists from here on.
      throw new ConflictException({
        code: 'NO_DEFAULT_STORE',
        message: 'This seller has no default store, so an order cannot be filed under one.',
      });
    }
    return fallback;
  }

  async create(
    sellerId: string,
    input: { name: string; note?: string | null },
    actor: { sellerUserId: string | null },
  ): Promise<StoreView> {
    const name = input.name.trim();
    if (name === '') {
      throw new BadRequestException({
        code: 'STORE_NAME_REQUIRED',
        message: 'Give the store a name',
      });
    }

    let created;
    try {
      created = await this.prisma.client.sellerStore.create({
        data: {
          sellerId,
          name,
          note: input.note?.trim() === '' ? null : (input.note ?? null),
          // Never the default. Promoting one is its own act, so adding
          // a store can never quietly move where new orders are filed.
          isDefault: false,
          isActive: true,
        },
        select: { id: true },
      });
    } catch (err) {
      // The unique on (seller, name) doing its job. Caught rather than
      // pre-checked: a read-then-write lets two tabs both create
      // “Instagram”.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'STORE_NAME_TAKEN',
          message: `You already have a store called “${name}”.`,
        });
      }
      throw err;
    }

    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId,
      // The PERSON at the company, when there is one. Kept in metadata
      // because the audit row's typed fields stop at the seller, and
      // "who at this company renamed the store" is the question asked
      // later.
      actorId: actor.sellerUserId,
      action: 'seller.store.created',
      entityType: 'seller_store',
      entityId: created.id,
      severity: AuditSeverity.LOW,
      metadata: { name },
    });
    return this.one(sellerId, created.id);
  }

  async update(
    sellerId: string,
    storeId: string,
    input: { name?: string; note?: string | null },
    actor: { sellerUserId: string | null },
  ): Promise<StoreView> {
    const before = await this.prisma.client.sellerStore.findFirst({
      where: { id: storeId, sellerId, deletedAt: null },
      select: { name: true, note: true },
    });
    if (before === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such store' });
    }

    const name = input.name?.trim();
    if (name !== undefined && name === '') {
      throw new BadRequestException({
        code: 'STORE_NAME_REQUIRED',
        message: 'Give the store a name',
      });
    }

    try {
      await this.prisma.client.sellerStore.update({
        where: { id: storeId },
        data: {
          ...(name === undefined ? {} : { name }),
          ...(input.note === undefined ? {} : { note: input.note === '' ? null : input.note }),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'STORE_NAME_TAKEN',
          message: `You already have a store called “${String(name)}”.`,
        });
      }
      throw err;
    }

    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId,
      // The PERSON at the company, when there is one. Kept in metadata
      // because the audit row's typed fields stop at the seller, and
      // "who at this company renamed the store" is the question asked
      // later.
      actorId: actor.sellerUserId,
      action: 'seller.store.updated',
      entityType: 'seller_store',
      entityId: storeId,
      severity: AuditSeverity.LOW,
      // A rename does NOT touch past orders — they carry the name they
      // were placed under (ORD-6) — so the old name only survives here.
      metadata: { before, after: { name: name ?? before.name } },
    });
    return this.one(sellerId, storeId);
  }

  /**
   * Promote a store to default.
   *
   * Both halves in ONE transaction. The partial unique means demoting
   * the old default and promoting the new one cannot be two statements
   * with a gap between them — in that gap there are two defaults, and
   * the index would refuse the second write with the first already
   * committed.
   */
  async makeDefault(
    sellerId: string,
    storeId: string,
    actor: { sellerUserId: string | null },
  ): Promise<StoreView> {
    const target = await this.prisma.client.sellerStore.findFirst({
      where: { id: storeId, sellerId, deletedAt: null },
      select: { id: true, name: true, isActive: true, isDefault: true },
    });
    if (target === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such store' });
    }
    if (!target.isActive) {
      throw new ConflictException({
        code: 'STORE_INACTIVE',
        message: 'A closed store cannot be the default — new orders would be filed under it.',
      });
    }
    if (target.isDefault) return this.one(sellerId, storeId);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.sellerStore.updateMany({
        where: { sellerId, isDefault: true, deletedAt: null },
        data: { isDefault: false },
      });
      await tx.sellerStore.update({ where: { id: storeId }, data: { isDefault: true } });
    });

    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId,
      // The PERSON at the company, when there is one. Kept in metadata
      // because the audit row's typed fields stop at the seller, and
      // "who at this company renamed the store" is the question asked
      // later.
      actorId: actor.sellerUserId,
      action: 'seller.store.made_default',
      entityType: 'seller_store',
      entityId: storeId,
      // Where every new order lands from now on, including every CSV
      // row that names no store.
      severity: AuditSeverity.MEDIUM,
      metadata: { name: target.name },
    });
    return this.one(sellerId, storeId);
  }

  /**
   * Open or close a shopfront.
   *
   * Closing blocks NEW orders and keeps every past one resolving — the
   * same shape as retiring a bank account. The DEFAULT cannot be closed
   * while it is the default: order create pre-selects it, and a closed
   * pre-selection is a form that refuses its own initial state.
   */
  async setActive(
    sellerId: string,
    storeId: string,
    isActive: boolean,
    actor: { sellerUserId: string | null },
  ): Promise<StoreView> {
    const store = await this.prisma.client.sellerStore.findFirst({
      where: { id: storeId, sellerId, deletedAt: null },
      select: { name: true, isDefault: true },
    });
    if (store === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such store' });
    }
    if (!isActive && store.isDefault) {
      throw new ConflictException({
        code: 'STORE_IS_DEFAULT',
        message:
          'This is the default store, so new orders are filed under it. Make another store the default first.',
      });
    }

    // Guarded on what was read: a concurrent promote-to-default must
    // not have its store closed underneath it.
    const changed = await this.prisma.client.sellerStore.updateMany({
      where: { id: storeId, sellerId, deletedAt: null, isDefault: store.isDefault },
      data: { isActive },
    });
    if (changed.count === 0) {
      throw new ConflictException({
        code: 'STORE_CHANGED',
        message: 'This store changed while you were looking at it. Try again.',
      });
    }

    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId,
      // The PERSON at the company, when there is one. Kept in metadata
      // because the audit row's typed fields stop at the seller, and
      // "who at this company renamed the store" is the question asked
      // later.
      actorId: actor.sellerUserId,
      action: isActive ? 'seller.store.reopened' : 'seller.store.closed',
      entityType: 'seller_store',
      entityId: storeId,
      severity: AuditSeverity.LOW,
      metadata: { name: store.name },
    });
    return this.one(sellerId, storeId);
  }

  private async one(sellerId: string, storeId: string): Promise<StoreView> {
    const all = await this.list(sellerId);
    const found = all.find((s) => s.id === storeId);
    if (found === undefined) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such store' });
    }
    return found;
  }
}
