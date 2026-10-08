import { Injectable } from '@nestjs/common';
import { Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/** One stored row: what one associate sells one product at. */
export interface StoredAssociatePrice {
  readonly variantId: string;
  readonly retailPriceInr: Prisma.Decimal;
  readonly setByStoreUserId: string | null;
  readonly updatedAt: Date;
}

/** One line of a copy-from write: the price to put on the target row. */
export interface AssociatePriceWrite {
  readonly variantId: string;
  readonly retailPriceInr: string;
}

/**
 * ASSOC-1 — the ONLY toucher of `associate_prices`.
 *
 * ── WHY ONE SERVICE OWNS THE TABLE ───────────────────────────────────
 * Every row here is a commercial decision that binds an order's retail
 * price, and three different places want to read or write it: the
 * reseller's pricing screen, the bulk copy, and the order create that
 * fixes the retail from the associate's row. The `BinPolicyService` /
 * `WarehouseResolverService` discipline — one reader, one writer — is
 * what stops a fourth place inventing a fallback. There is deliberately
 * NO fallback and NO markup rule: a product with no row is refused BY
 * NAME rather than priced at something nobody chose.
 *
 * ── THE CROSS-MODULE SURFACE IS `pricesFor`, AND NOTHING ELSE ────────
 * `ResellerAssociatesModule` exports this service so the order path can
 * ask "what does this person sell these products at". The write methods
 * exist for `AssociateService` inside this module, which is where the
 * seller's-range check and the audit row live — a caller reaching past
 * it would write a price nobody checked against the seller's terms.
 *
 * ── STORE ID IS CARRIED, NOT DERIVED ─────────────────────────────────
 * `associate_prices.store_id` is denormalised from the user on purpose
 * (see the schema comment): every read here is scoped by store, and a
 * join for it on each one is a join that will eventually be forgotten.
 * The writes stamp it from the caller's TOKEN, never from a request.
 */
@Injectable()
export class AssociatePriceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every price this store user holds for these variants, by variantId.
   *
   * CALL INSIDE THE CALLER'S TRANSACTION. The order path reads this to
   * decide what a line is sold at and then writes the order from it; read
   * outside the write's transaction, a price edited in between would
   * leave the order stamped with a figure that was never on the screen.
   * A variant with no row is ABSENT from the map — never zero, which is
   * a price, and never a default, which is the fallback this table
   * deliberately does not have.
   */
  async pricesFor(
    tx: Prisma.TransactionClient,
    storeUserId: string,
    variantIds: readonly string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    const out = new Map<string, Prisma.Decimal>();
    const ids = [...new Set(variantIds)];
    if (ids.length === 0) return out;
    const rows = await tx.associatePrice.findMany({
      where: { storeUserId, variantId: { in: ids } },
      select: { variantId: true, retailPriceInr: true },
    });
    for (const r of rows) out.set(r.variantId, r.retailPriceInr);
    return out;
  }

  /** One associate's whole stored list — the pricing screen's left-hand side. */
  async rowsFor(storeUserId: string): Promise<readonly StoredAssociatePrice[]> {
    return this.prisma.client.associatePrice.findMany({
      where: { storeUserId },
      select: {
        variantId: true,
        retailPriceInr: true,
        setByStoreUserId: true,
        updatedAt: true,
      },
    });
  }

  /** Every price held by anybody at one store — the roster's counts. */
  async rowsForStore(
    storeId: string,
  ): Promise<ReadonlyArray<StoredAssociatePrice & { readonly storeUserId: string }>> {
    return this.prisma.client.associatePrice.findMany({
      where: { storeId },
      select: {
        storeUserId: true,
        variantId: true,
        retailPriceInr: true,
        setByStoreUserId: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Set one price, creating the row or replacing the figure on it.
   *
   * An upsert on the `(store_user_id, variant_id)` unique rather than a
   * read-then-write: under READ COMMITTED two people on the pricing
   * screen both read "no row" and both insert, and one of them loses to
   * the index with a 500 instead of simply overwriting.
   *
   * Returns what was there BEFORE, so the caller can report an overwrite
   * rather than performing one silently. That read is for the REPORT and
   * is not a guard: the upsert decides, and the worst a lost race costs
   * is an audit line naming a figure that had already been replaced —
   * never a lost write and never a duplicate row.
   */
  async set(
    input: {
      readonly storeId: string;
      readonly storeUserId: string;
      readonly variantId: string;
      readonly retailPriceInr: string;
      readonly setByStoreUserId: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{ readonly previousInr: Prisma.Decimal | null }> {
    const client = tx ?? this.prisma.client;
    const existing = await client.associatePrice.findUnique({
      where: {
        storeUserId_variantId: { storeUserId: input.storeUserId, variantId: input.variantId },
      },
      select: { retailPriceInr: true },
    });
    await client.associatePrice.upsert({
      where: {
        storeUserId_variantId: { storeUserId: input.storeUserId, variantId: input.variantId },
      },
      create: {
        storeId: input.storeId,
        storeUserId: input.storeUserId,
        variantId: input.variantId,
        retailPriceInr: new Prisma.Decimal(input.retailPriceInr),
        setByStoreUserId: input.setByStoreUserId,
      },
      update: {
        retailPriceInr: new Prisma.Decimal(input.retailPriceInr),
        setByStoreUserId: input.setByStoreUserId,
      },
    });
    return { previousInr: existing?.retailPriceInr ?? null };
  }
}
