import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerRiskLevel, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

  async findOrCreate(client: TxOrClient, input: FindOrCreateCustomerInput): Promise<CustomerView> {
    const phoneE164 = input.phoneE164.trim();
    if (!E164.test(phoneE164)) {
      throw new BadRequestException(
        `customer phone must be E.164 (+<country><number>), got "${input.phoneE164}"`,
      );
    }
    return client.customer.upsert({
      where: { sellerId_phoneE164: { sellerId: input.sellerId, phoneE164 } },
      create: {
        sellerId: input.sellerId,
        phoneE164,
        name: input.name ?? null,
        email: input.email ?? null,
        altPhoneE164: input.altPhoneE164 ?? null,
        preferredLanguage: input.preferredLanguage ?? 'en',
      },
      // Re-encounter: do NOT overwrite seller-curated name/email from a
      // new order's recipient fields; only revive if it had been removed.
      update: { deletedAt: null },
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

  async list(
    sellerId: string,
    query: ListCustomersQuery,
  ): Promise<{ items: CustomerView[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.CustomerWhereInput = { sellerId, deletedAt: null };
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
  async update(sellerId: string, id: string, input: UpdateCustomerInput): Promise<CustomerView> {
    // Existence + ownership check (also guards soft-deleted).
    await this.getById(sellerId, id);
    const data: Prisma.CustomerUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.email !== undefined) data.email = input.email;
    if (input.altPhoneE164 !== undefined) data.altPhoneE164 = input.altPhoneE164;
    if (input.riskNotes !== undefined) data.riskNotes = input.riskNotes;
    if (input.preferredLanguage !== undefined) {
      data.preferredLanguage = input.preferredLanguage;
    }
    return this.prisma.client.customer.update({
      where: { id },
      data,
      select: VIEW_SELECT,
    });
  }

  /** Soft-delete (user-facing data — CLAUDE.md soft-delete rule). */
  async softDelete(sellerId: string, id: string): Promise<void> {
    await this.getById(sellerId, id);
    await this.prisma.client.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // CustomerRiskLevel re-exported for callers building filters without a
  // direct @skydrop/db import at the call site.
  static readonly RiskLevel = CustomerRiskLevel;
}
