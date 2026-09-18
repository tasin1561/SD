import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CustomerRiskLevel, Prisma } from '@skydrop/db';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { StoreRequestNotifier } from '../../store-order-request/services/store-request-notifier.service';

type TxOrClient = Prisma.TransactionClient | PrismaService['client'];

const VIEW_SELECT = {
  id: true,
  sellerId: true,
  phoneE164: true,
  name: true,
  email: true,
  altPhoneE164: true,
  totalOrdersCount: true,
  successfulOrdersCount: true,
  rtoCount: true,
  refusedCount: true,
  fakeOrdersCount: true,
  riskLevel: true,
  riskNotes: true,
  preferredLanguage: true,
  firstOrderAt: true,
  lastOrderAt: true,
  createdAt: true,
} satisfies Prisma.CustomerSelect;

export type CustomerView = Prisma.CustomerGetPayload<{ select: typeof VIEW_SELECT }>;

export interface FindOrCreateCustomerInput {
  sellerId: string;
  /**
   * RS-5: the reseller store that sold to this person, when it was one.
   * A store's customer is a separate identity from the seller's own
   * customer with the same phone (ORD-7 generalised). Omitted/null = the
   * seller's own customer, exactly as before.
   */
  resellerStoreId?: string | null;
  phoneE164: string;
  name?: string | null;
  email?: string | null;
  altPhoneE164?: string | null;
  preferredLanguage?: string | null;
}

/** Editable fields only — phoneE164/sellerId are intentionally absent (ORD-7). */
export interface UpdateCustomerInput {
  name?: string | null;
  email?: string | null;
  altPhoneE164?: string | null;
  riskNotes?: string | null;
  preferredLanguage?: string;
}

export interface ListCustomersQuery {
  page?: number;
  pageSize?: number;
  search?: string;
}

const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * ORD-7 — per-seller customer identity.
 *
 * Dedup key is `(sellerId, phoneE164)`. Phone is immutable once set:
 * `update()` has no phoneE164 parameter by construction, so there is no
 * code path that mutates it. name/email/altPhone/riskNotes/language are
 * editable; counters and riskLevel are owned by the order lifecycle and
 * admin tooling, not the seller edit path.
 *
 * `findOrCreate` is the resolver OrderService.create uses to attach
 * `customerId` from the recipient phone. It is race-safe (upsert on the
 * compound unique) and revives a soft-deleted customer on a new order —
 * a fresh order means the customer is active again — without clobbering
 * their existing name/email.
 */
@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);

  constructor(
    private readonly prisma: PrismaService,
    // 2026-09-18 (owner): a reseller store's customer may be changed by
    // either party, and the other is told. The notifier imports nothing
    // order-shaped, so this closes no cycle.
    private readonly notifier: StoreRequestNotifier,
  ) {}

  /**
   * RS-5: identity is per OWNER — the seller, or one of their reseller
   * stores — held by two PARTIAL uniques Prisma cannot target, so this is
   * find-then-create under `AdvisoryLock.CUSTOMER_IDENTITY` on (owner,
   * phone) rather than an upsert. Call it inside the caller's transaction
   * (every caller does): the lock is transaction-scoped, and a second
   * concurrent order for the same new phone waits here and then finds the
   * row, instead of hitting the unique and aborting its whole order.
   */
  async findOrCreate(client: TxOrClient, input: FindOrCreateCustomerInput): Promise<CustomerView> {
    const phoneE164 = input.phoneE164.trim();
    if (!E164.test(phoneE164)) {
      throw new BadRequestException(
        `customer phone must be E.164 (+<country><number>), got "${input.phoneE164}"`,
      );
    }
    const resellerStoreId = input.resellerStoreId ?? null;
    await takeAdvisoryLock(
      client,
      AdvisoryLock.CUSTOMER_IDENTITY,
      `${resellerStoreId ?? input.sellerId}|${phoneE164}`,
    );
    const existing = await client.customer.findFirst({
      where: { sellerId: input.sellerId, resellerStoreId, phoneE164 },
      select: { id: true, deletedAt: true },
    });
    if (existing !== null) {
      // Re-encounter: do NOT overwrite curated name/email from a new
      // order's recipient fields; only revive if it had been removed.
      return client.customer.update({
        where: { id: existing.id },
        data: existing.deletedAt === null ? {} : { deletedAt: null },
        select: VIEW_SELECT,
      });
    }
    return client.customer.create({
      data: {
        sellerId: input.sellerId,
        resellerStoreId,
        phoneE164,
        name: input.name ?? null,
        email: input.email ?? null,
        altPhoneE164: input.altPhoneE164 ?? null,
        preferredLanguage: input.preferredLanguage ?? 'en',
      },
      select: VIEW_SELECT,
    });
  }

  /**
   * Bump the per-seller order aggregates when a new order is attached.
   * Called inside OrderService.create's transaction.
   */
  async recordNewOrder(client: TxOrClient, customerId: string, now: Date): Promise<void> {
    const existing = await client.customer.findUnique({
      where: { id: customerId },
      select: { firstOrderAt: true },
    });
    await client.customer.update({
      where: { id: customerId },
      data: {
        totalOrdersCount: { increment: 1 },
        lastOrderAt: now,
        // first_order_at is write-once: only set it if still null.
        ...(existing?.firstOrderAt ? {} : { firstOrderAt: now }),
      },
    });
  }

  /**
   * A customer of this SELLER's — their own, or one a reseller store of
   * theirs sold to.
   *
   * AMENDED 2026-09-16 (owner): RS-5 kept a store's customers out of
   * here entirely. The seller now reads them, because they read the
   * ORDER in full and a phone number they can see on one screen must
   * resolve on the next. READING is all that widened: `update` and
   * `softDelete` go through `getOwnById` and still refuse a store's row —
   * the store maintains its own customers, and a seller editing a person
   * they never spoke to would overwrite the store's record of them.
   */
  async getById(sellerId: string, id: string): Promise<CustomerView> {
    const customer = await this.prisma.client.customer.findFirst({
      where: { id, sellerId, deletedAt: null },
      select: VIEW_SELECT,
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return customer;
  }

  /**
   * A customer row this SELLER may change.
   *
   * AMENDED 2026-09-18 (owner): their own, AND one of their reseller
   * stores'. RS-5 kept a store's customers out of every write, and
   * 2026-09-16 opened only the read. The owner has now opened the write
   * too, on the same argument the read was opened on: the seller sees the
   * order in full, rings that customer about a failed delivery and takes
   * the loss when the parcel comes back, so a wrong second phone number
   * is theirs to fix. The STORE is told what changed, because it spoke to
   * that person and must not hear it from them.
   *
   * What did NOT widen is IDENTITY: the phone is not an editable field
   * anywhere (ORD-7 — it is what tells one customer from another), and
   * the two partial uniques stand, so nothing here can merge a store's
   * customer into the seller's own or the other way about.
   *
   * Returns the store id when the row belongs to one, so the caller knows
   * whom to tell.
   */
  private async getEditableById(
    sellerId: string,
    id: string,
  ): Promise<CustomerView & { resellerStoreId: string | null }> {
    const customer = await this.prisma.client.customer.findFirst({
      where: { id, sellerId, deletedAt: null },
      select: { ...VIEW_SELECT, resellerStoreId: true },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return customer;
  }

  /** The seller's OWN customer row — the one they may also DELETE. */
  private async getOwnById(sellerId: string, id: string): Promise<CustomerView> {
    const customer = await this.prisma.client.customer.findFirst({
      where: { id, sellerId, resellerStoreId: null, deletedAt: null },
      select: VIEW_SELECT,
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return customer;
  }

  /** RS-5 — one of a reseller store's OWN customers (the id is the token's store). */
  async getForStore(storeId: string, id: string): Promise<CustomerView> {
    const customer = await this.prisma.client.customer.findFirst({
      where: { id, resellerStoreId: storeId, deletedAt: null },
      select: VIEW_SELECT,
    });
    if (!customer) {
      throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'No such customer' });
    }
    return customer;
  }

  /** RS-5 — a reseller store's own customers, newest buyer first. */
  async listForStore(
    storeId: string,
    query: ListCustomersQuery,
  ): Promise<{ items: CustomerView[]; total: number; page: number; pageSize: number }> {
    return this.listWhere({ resellerStoreId: storeId, deletedAt: null }, query);
  }

  async list(
    sellerId: string,
    query: ListCustomersQuery,
  ): Promise<{ items: CustomerView[]; total: number; page: number; pageSize: number }> {
    // Every customer of this seller's — their own and their reseller
    // stores' (2026-09-16, owner). A store's list stays its own.
    return this.listWhere({ sellerId, deletedAt: null }, query);
  }

  private async listWhere(
    base: Prisma.CustomerWhereInput,
    query: ListCustomersQuery,
  ): Promise<{ items: CustomerView[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.CustomerWhereInput = { ...base };
    if (query.search) {
      where.OR = [
        { phoneE164: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.client.customer.findMany({
        where,
        orderBy: { lastOrderAt: { sort: 'desc', nulls: 'last' } },
        take: pageSize,
        skip: (page - 1) * pageSize,
        select: VIEW_SELECT,
      }),
      this.prisma.client.customer.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  /**
   * Edit mutable customer fields. phoneE164 cannot be passed in — it is
   * immutable by construction (ORD-7). sellerId is taken from the caller's
   * auth context, never the body, so the seller scope can't be moved.
   */
  async update(
    sellerId: string,
    id: string,
    input: UpdateCustomerInput,
    /** RS-5: set when a reseller STORE is changing its own customer. */
    storeScope?: { readonly storeId: string },
  ): Promise<CustomerView & { resellerStoreId: string | null }> {
    // Existence + ownership check (also guards soft-deleted). Either the
    // seller's own row or one of their stores' (owner, 2026-09-18).
    const before = await this.getEditableById(sellerId, id);
    if (storeScope !== undefined && before.resellerStoreId !== storeScope.storeId) {
      // A store reaching for the seller's own customer, or another
      // store's. A 404 rather than a 403: saying more confirms it exists.
      throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'No such customer' });
    }
    const data: Prisma.CustomerUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.email !== undefined) data.email = input.email;
    if (input.altPhoneE164 !== undefined) data.altPhoneE164 = input.altPhoneE164;
    if (input.riskNotes !== undefined) data.riskNotes = input.riskNotes;
    if (input.preferredLanguage !== undefined) {
      data.preferredLanguage = input.preferredLanguage;
    }
    const saved = await this.prisma.client.customer.update({
      where: { id },
      data,
      select: { ...VIEW_SELECT, resellerStoreId: true },
    });
    // A reseller store's customer has two parties who read it, so
    // whoever did NOT make the change is told — the same rule an order
    // change follows (owner, 2026-09-18). Never throws (NOTIF-1).
    if (before.resellerStoreId !== null) {
      await this.tellTheOtherSide(
        before,
        saved,
        this.describeCustomerChange(before, input),
        storeScope !== undefined,
      );
    }
    return saved;
  }

  /** Never throws: the customer row is the durable fact. */
  private async tellTheOtherSide(
    before: CustomerView & { resellerStoreId: string | null },
    saved: CustomerView,
    changes: string,
    byStore: boolean,
  ): Promise<void> {
    const storeId = before.resellerStoreId;
    if (storeId === null || changes === '') return;
    try {
      const [seller, store] = await Promise.all([
        this.prisma.client.seller.findUnique({
          where: { id: before.sellerId },
          select: { companyName: true },
        }),
        this.prisma.client.sellerStore.findUnique({
          where: { id: storeId },
          select: { name: true, displayName: true },
        }),
      ]);
      // Keyed on the row and the moment, so a retry of one edit is one
      // notice (NOTIF-2's dedup gate does the rest).
      const eventKey = `${saved.id}:${Date.now()}`;
      const customerName = saved.name ?? saved.phoneE164;
      if (byStore) {
        await this.notifier.customerChangedByStore({
          sellerId: before.sellerId,
          eventKey,
          storeName: store?.displayName ?? store?.name ?? 'a reseller store',
          customerName,
          changes,
        });
        return;
      }
      await this.notifier.customerChangedBySeller({
        storeId,
        eventKey,
        sellerName: seller?.companyName ?? 'Your seller',
        customerName,
        changes,
      });
    } catch (err) {
      this.logger.warn(
        { customerId: saved.id, err: err instanceof Error ? err.message : err },
        'Could not tell the other side that a reseller store’s customer was changed',
      );
    }
  }

  /** What a customer edit moved, old → new — for the other side's notice. */
  describeCustomerChange(before: CustomerView, input: UpdateCustomerInput): string {
    const labels: Readonly<Record<string, string>> = {
      name: 'Name',
      email: 'Email',
      altPhoneE164: 'Second phone',
      riskNotes: 'Notes',
      preferredLanguage: 'Language',
    };
    const out: string[] = [];
    for (const [key, label] of Object.entries(labels)) {
      const next = (input as Record<string, unknown>)[key];
      if (next === undefined) continue;
      const prev = (before as unknown as Record<string, unknown>)[key];
      const show = (v: unknown): string => (v === null || v === '' ? '(blank)' : String(v));
      if (show(prev) === show(next)) continue;
      out.push(`${label}: ${show(prev)} → ${show(next)}`);
    }
    return out.join('\n');
  }

  /** Soft-delete (user-facing data — CLAUDE.md soft-delete rule). */
  async softDelete(sellerId: string, id: string): Promise<void> {
    // The seller's OWN row only. Deleting is not correcting: a store's
    // customer row is the store's record of somebody it sold to, and its
    // own screens read it — removing it takes a person off their list,
    // which is a decision about the store's business, not the seller's.
    await this.getOwnById(sellerId, id);
    await this.prisma.client.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // CustomerRiskLevel re-exported for callers building filters without a
  // direct @skydrop/db import at the call site.
  static readonly RiskLevel = CustomerRiskLevel;
}
