import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

type TxOrClient = Prisma.TransactionClient | PrismaService['client'];

export interface AddressParts {
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  stateProvince: string;
  postalCode: string;
}

const VIEW_SELECT = {
  id: true,
  customerId: true,
  line1: true,
  line2: true,
  landmark: true,
  city: true,
  stateProvince: true,
  postalCode: true,
  seenCount: true,
  firstSeenAt: true,
  lastSeenAt: true,
  rtoCountAtAddress: true,
  successfulCountAtAddress: true,
} satisfies Prisma.OrderRecipientAddressCacheSelect;

export type CachedAddressView = Prisma.OrderRecipientAddressCacheGetPayload<{
  select: typeof VIEW_SELECT;
}>;

export interface AutocompleteQuery {
  customerId?: string;
  search?: string;
  limit?: number;
}

/**
 * Recipient-address autocomplete cache (locked decision #4: feeds
 * autocomplete on MANUAL entry only — the caller, OrderService.create,
 * only invokes recordAddress for source=MANUAL so bulk imports don't
 * pollute the suggestion list).
 *
 * Identity is `(customerId, addressHash)`. The hash is a normalised
 * SHA-256 so cosmetic variants ("12, MG Road" vs "12  mg road") collapse
 * to one cached entry whose seenCount/lastSeenAt track recency. This is
 * convenience/aggregation data, not user-facing records and with no
 * deletedAt column — so DELETE is a hard delete (CLAUDE.md transient-row
 * rule). Customer cascade-deletes its cache rows.
 *
 * Not a secret — plain node:crypto, no auth-domain coupling.
 */
@Injectable()
export class RecipientAddressCacheService {
  constructor(private readonly prisma: PrismaService) {}

  /** Normalise then SHA-256. Stable across whitespace/case/punctuation. */
  static computeHash(parts: AddressParts): string {
    const norm = (s: string | null | undefined): string =>
      (s ?? '').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
    const canonical = [
      norm(parts.line1),
      norm(parts.line2),
      norm(parts.landmark),
      norm(parts.city),
      norm(parts.stateProvince),
      norm(parts.postalCode),
    ].join('|');
    return createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Upsert the customer's address into the cache. New address → row with
   * seenCount 1; repeat → seenCount++ , lastSeenAt refreshed, and the
   * stored fields refreshed to the latest spelling. RTO/success counters
   * are owned by the shipment lifecycle (Module 8+), not touched here.
   */
  async recordAddress(
    client: TxOrClient,
    customerId: string,
    parts: AddressParts,
    now: Date,
  ): Promise<void> {
    const addressHash = RecipientAddressCacheService.computeHash(parts);
    await client.orderRecipientAddressCache.upsert({
      where: { customerId_addressHash: { customerId, addressHash } },
      create: {
        customerId,
        addressHash,
        line1: parts.line1,
        line2: parts.line2 ?? null,
        landmark: parts.landmark ?? null,
        city: parts.city,
        stateProvince: parts.stateProvince,
        postalCode: parts.postalCode,
        firstSeenAt: now,
        lastSeenAt: now,
        seenCount: 1,
      },
      update: {
        seenCount: { increment: 1 },
        lastSeenAt: now,
        line1: parts.line1,
        line2: parts.line2 ?? null,
        landmark: parts.landmark ?? null,
        city: parts.city,
        stateProvince: parts.stateProvince,
        postalCode: parts.postalCode,
      },
    });
  }

  /** Autocomplete suggestions, most-used + most-recent first. */
  async autocomplete(sellerId: string, query: AutocompleteQuery): Promise<CachedAddressView[]> {
    const limit = Math.min(Math.max(query.limit ?? 10, 1), 50);
    const where: Prisma.OrderRecipientAddressCacheWhereInput = {
      // Seller scope enforced through the customer relation.
      customer: { sellerId, deletedAt: null },
    };
    if (query.customerId) where.customerId = query.customerId;
    if (query.search) {
      where.OR = [
        { line1: { contains: query.search, mode: 'insensitive' } },
        { city: { contains: query.search, mode: 'insensitive' } },
        { postalCode: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.client.orderRecipientAddressCache.findMany({
      where,
      orderBy: [{ seenCount: 'desc' }, { lastSeenAt: 'desc' }],
      take: limit,
      select: VIEW_SELECT,
    });
  }

  async getById(sellerId: string, id: string): Promise<CachedAddressView> {
    const row = await this.prisma.client.orderRecipientAddressCache.findFirst({
      where: { id, customer: { sellerId, deletedAt: null } },
      select: VIEW_SELECT,
    });
    if (!row) {
      throw new NotFoundException(`Recipient address ${id} not found`);
    }
    return row;
  }

  /** Hard delete (transient aggregation row — no deletedAt column). */
  async remove(sellerId: string, id: string): Promise<void> {
    await this.getById(sellerId, id); // scope/ownership guard
    await this.prisma.client.orderRecipientAddressCache.delete({ where: { id } });
  }
}
