import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, OrderStatus, Prisma, SellerStoreKind } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import { ResellerStockGateService } from '../../reseller-order-gate/services/reseller-stock-gate.service';
/*
  RS-8/RS-9's own cohort loader and scorecard, imported as FILES rather
  than through their module. Both are plain functions over the caller's
  Prisma client with no DI of their own — the same shape (and the same
  precedent) as `reseller-stock-gate.service.ts` reaching for
  `reseller-visible-stock.ts`. Importing `ResellerReportsModule` would
  pull a store P&L, an expense book and a BullMQ worker into a module
  that needs one pure function and one query, and would be the first
  edge of a cycle the moment reports wanted an associate's figures.
*/
import {
  chunks,
  loadOrderFacts,
  type OrderFact,
} from '../../reseller-reports/services/reseller-order-facts';
import { scorecard } from '../../reseller-reports/services/reseller-scorecard';
import { AssociatePriceService } from './associate-price.service';
import {
  checkAssociatePrice,
  isWithinRange,
  type AssociatePriceRange,
} from './associate-price-rules';

/** The role key that makes somebody an associate (ASSOC-1, a fixed key). */
const ASSOCIATE_ROLE_KEY = 'associate';

const ZERO = new Prisma.Decimal(0);

/**
 * A percentage as a number, from RS-9's own string.
 *
 * `scorecard()` formats its rates to one decimal place as strings; this
 * contract wants numbers. Parsing its output rather than recomputing the
 * division is deliberate — there is then exactly ONE place that decides
 * what the denominator is, and a null stays null rather than becoming 0.
 */
function pct(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * Is this order DELIVERED, as the scorecard counts it?
 *
 * Asked OF the scorecard, over a one-order array, rather than mirroring
 * its `fate === 'delivered' && status !== LOST_IN_TRANSIT` branch here.
 * The mirror is two lines and would drift the first time a terminal
 * moved; this cannot disagree with the counts in the same response, and
 * it is arithmetic over a handful of lines.
 */
function delivered(fact: OrderFact): boolean {
  return (
    scorecard([
      {
        status: fact.status,
        everConfirmed: fact.everConfirmed,
        lines: fact.lines.map((l) => ({
          quantity: l.quantity,
          transferInr: l.transferInr,
          retailInr: l.retailInr,
          unitCostInr: null,
        })),
      },
    ]).delivered === 1
  );
}

/** One product the store may sell, with the seller's bounds on its retail. */
interface SellableProduct {
  readonly variantId: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly skuCode: string;
  readonly range: AssociatePriceRange;
  readonly suggestedRetailInr: string | null;
}

export interface AssociateSummary {
  readonly storeUserId: string;
  readonly fullName: string;
  readonly email: string;
  /** ASSOC-1 — set when this person may place no NEW orders. */
  readonly ordersPausedAt: string | null;
  readonly lastLoginAt: string | null;
  /** How many of the store's sellable products this person has a price for. */
  readonly pricedProducts: number;
  readonly unpricedProducts: number;
  /**
   * Prices that no longer sit inside the seller's range — through the
   * SELLER moving it, not through anybody here doing anything. The thing
   * that silently stops somebody selling, so it is on the roster.
   */
  readonly outOfRangePrices: number;
}

/**
 * Somebody invited onto the associate role who has not accepted yet.
 *
 * ── WHY THE ROSTER CARRIES THESE AT ALL ──────────────────────────────
 * Found by the owner, on production, looking at the real screen: an
 * invitation had been sent twenty minutes earlier and the page said "No
 * associates yet". Nothing on it disagreed — the roster read accepted
 * MEMBERS, and an invitation is not one until it is used.
 *
 * But the screen is where somebody invites, so it is where they come
 * back to see whether it worked; telling them there is nobody is telling
 * them it failed. Worse, it is the only place a store would think to
 * resend or revoke, and neither was reachable.
 */
export interface AssociateInviteSummary {
  readonly invitationId: string;
  readonly fullName: string;
  readonly email: string;
  readonly invitedAt: string;
  readonly expiresAt: string;
}

export interface AssociateListView {
  /** The denominator for every person's counts: what the store may sell at all. */
  readonly sellableProducts: number;
  readonly associates: readonly AssociateSummary[];
  /** Invited, not yet accepted — see `AssociateInviteSummary`. */
  readonly pendingInvitations: readonly AssociateInviteSummary[];
}

export interface AssociatePriceRow {
  readonly variantId: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly skuCode: string;
  /** This person's price, or null when nobody has set one. No fallback. */
  readonly retailPriceInr: string | null;
  readonly minRetailInr: string | null;
  readonly maxRetailInr: string | null;
  readonly suggestedRetailInr: string | null;
  /** True when a stored price has been left outside the seller's range. */
  readonly outOfRange: boolean;
  readonly setAt: string | null;
}

export interface AssociatePricesView {
  readonly storeUserId: string;
  readonly fullName: string;
  readonly email: string;
  readonly ordersPausedAt: string | null;
  readonly rows: readonly AssociatePriceRow[];
}

export type AssociateCopySkipReason = 'NOT_SELLABLE' | 'ASSOCIATE_PRICE_OUT_OF_SELLER_RANGE';

export interface AssociateCopyResult {
  readonly from: { readonly storeUserId: string; readonly fullName: string };
  readonly to: { readonly storeUserId: string; readonly fullName: string };
  readonly created: ReadonlyArray<{
    readonly variantId: string;
    readonly skuCode: string;
    readonly retailPriceInr: string;
  }>;
  /** Named one by one, with the figure each replaced — never a bare count. */
  readonly overwritten: ReadonlyArray<{
    readonly variantId: string;
    readonly skuCode: string;
    readonly fromInr: string;
    readonly toInr: string;
  }>;
  readonly unchanged: ReadonlyArray<{
    readonly variantId: string;
    readonly skuCode: string;
    readonly retailPriceInr: string;
  }>;
  readonly skipped: ReadonlyArray<{
    readonly variantId: string;
    readonly skuCode: string;
    readonly code: AssociateCopySkipReason;
    readonly message: string;
  }>;
}

/**
 * ASSOC-1 — one associate's performance over a window.
 *
 * The owner's reason for the whole feature: "the reseller will know
 * which associate is performing how much and then he can decide what to
 * do." So this shape carries the DECISION beside the numbers —
 * `ordersPausedAt` is here, not only on the roster, because the act the
 * screen exists to support is switching somebody's order creation off.
 *
 * Every rate is a PERCENTAGE 0–100, or `null` when its denominator is
 * empty. Null rather than 0: "nothing has happened yet" and "nothing
 * worked" are different facts and a screen that prints 0% for the first
 * one is telling the reseller to act on a person who has simply not been
 * given time (RS-9's rule).
 */
export interface AssociateAnalysisRow {
  readonly storeUserId: string;
  readonly fullName: string;
  readonly email: string;
  readonly ordersPausedAt: string | null;

  readonly ordersPlaced: number;
  readonly confirmed: number;
  readonly delivered: number;
  /** Cancelled OR rejected — `orderFate`'s "called off". */
  readonly cancelled: number;
  /** Orders that EVER hit a failed delivery, counted once each. */
  readonly ndr: number;
  readonly rto: number;

  /** Σ retail × qty on delivered orders — what their customers paid. */
  readonly retailSoldInr: string;
  /**
   * Σ (retail − the store's transfer price) × qty over delivered lines
   * where BOTH are snapshotted. A line missing either is left OUT and
   * counted in `marginCoverage` — a missing cost is UNCOVERED, never
   * zero (TRE-6), because zero reads as "we made the whole retail".
   */
  readonly storeMarginInr: string;
  readonly marginCoverage: {
    readonly lines: number;
    readonly linesWithTransferPrice: number;
  };

  readonly confirmationRate: number | null;
  readonly deliveryRate: number | null;
  readonly returnRate: number | null;
  /** The denominators, so the page can state its coverage rather than imply none. */
  readonly decidedCount: number;
  readonly outcomeKnownCount: number;

  /*
    ASSOC-1 — the SAME names the roster uses, from the SAME `priceTally`.
    These two shipped as `pricedVariants` / `unpricedVariants` for a few
    hours: one number, two names, on two screens of one feature. The
    tally was already shared so the figures could not disagree — the
    names have to match for the same reason, because "priced for 40 of
    40" beside "38 of 40" is unresolvable without reading the code, and
    a reader who sees two names assumes two meanings.
  */
  readonly pricedProducts: number;
  readonly unpricedProducts: number;
  readonly outOfRangePrices: number;
}

export interface AssociateAnalysisView {
  /** The window actually used, echoed back as ISO instants. */
  readonly from: string;
  readonly to: string;
  /** What the store may sell at all — the denominator behind every row's price counts. */
  readonly sellableProducts: number;
  /**
   * Orders of this store in the window that NOBODY on the associate
   * roster placed: the reseller's own, a CSV on the seller side, an API
   * key (which carries no person), or somebody whose role has since
   * changed. Its own key rather than folded into a row — attributing
   * them to an associate would be a claim about who sold something —
   * and present so the page's numbers add up to the store's order list
   * instead of quietly falling short of it.
   */
  readonly ordersNotByAnAssociate: number;
  /** Ranked: best-selling first, because the screen exists to support a decision. */
  readonly rows: readonly AssociateAnalysisRow[];
}

/**
 * ASSOC-1 — the RESELLER's side of associates: who they are, what each
 * sells a product at, and whether each may still place orders.
 *
 * Everything here is behind `associates.manage` and scoped to the
 * caller's OWN store, taken from the TOKEN and put in the WHERE clause —
 * never an id in the request (RS-2). A store user who is not a live
 * member of this store is a 404 that says nothing more, so this cannot be
 * used to discover whether an id exists somewhere else.
 *
 * ── THE SELLER'S TERMS ARE CHECKED HERE, NOT AT THE ORDER ────────────
 * `checkAssociatePrice` runs on every write. A price outside the seller's
 * range is refused while the reseller is looking at the screen; the same
 * price refused at order create is refused with a customer on the phone.
 * A range the SELLER later moves is reported rather than auto-adjusted —
 * a price somebody negotiated is not ours to change.
 */
@Injectable()
export class AssociateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prices: AssociatePriceService,
    private readonly gate: ResellerStockGateService,
    private readonly catalog: CatalogReadService,
    private readonly audit: AuditLogService,
  ) {}

  // ── reads ──────────────────────────────────────────────────────────

  async list(storeId: string): Promise<AssociateListView> {
    const [people, tally, invited] = await Promise.all([
      this.roster(storeId),
      this.priceTally(storeId),
      this.pendingInvites(storeId),
    ]);
    return {
      sellableProducts: tally.sellableProducts,
      pendingInvitations: invited,
      associates: people.map((p) => ({
        storeUserId: p.id,
        fullName: p.fullName,
        email: p.emailDisplay,
        ordersPausedAt: p.ordersPausedAt?.toISOString() ?? null,
        lastLoginAt: p.lastLoginAt?.toISOString() ?? null,
        pricedProducts: tally.of(p.id).priced,
        unpricedProducts: tally.of(p.id).unpriced,
        outOfRangePrices: tally.of(p.id).outOfRange,
      })),
    };
  }

  async pricesOf(storeId: string, storeUserId: string): Promise<AssociatePricesView> {
    const member = await this.requireMember(storeId, storeUserId);
    const [sellable, rows] = await Promise.all([
      this.sellableProducts(storeId),
      this.prices.rowsFor(storeUserId),
    ]);
    const rowBy = new Map(rows.map((r) => [r.variantId, r]));
    return {
      storeUserId: member.id,
      fullName: member.fullName,
      email: member.emailDisplay,
      ordersPausedAt: member.ordersPausedAt?.toISOString() ?? null,
      rows: sellable.map((p) => {
        const row = rowBy.get(p.variantId);
        const retail = row?.retailPriceInr.toFixed(2) ?? null;
        return {
          variantId: p.variantId,
          productName: p.productName,
          variantLabel: p.variantLabel,
          skuCode: p.skuCode,
          retailPriceInr: retail,
          minRetailInr: p.range.minRetailInr,
          maxRetailInr: p.range.maxRetailInr,
          suggestedRetailInr: p.suggestedRetailInr,
          outOfRange: retail !== null && !isWithinRange({ retailInr: retail, range: p.range }),
          setAt: row?.updatedAt.toISOString() ?? null,
        };
      }),
    };
  }

  /**
   * ASSOC-1 — who is selling how much, over a window `[from, to)`.
   *
   * ── THE RATES ARE RS-9'S, NOT A SECOND IMPLEMENTATION ──────────────
   * `scorecard()` is the authority on every count and every rate: which
   * orders count as DECIDED, which as an OUTCOME, and that a rate with an
   * empty denominator is null rather than 0%. A delivery rate computed
   * over parcels still with the courier is the exact failure RS-9 exists
   * for, and it is a failure that reads as a fact. So nothing here
   * recomputes it — the denominators come back in the response so the
   * page can say "88%, of the 9 we know about".
   *
   * Even "is this order delivered", for the money pass, is asked of that
   * function (`scorecard([o]).delivered === 1`) rather than mirroring its
   * branch. Mirroring it would be two lines and the two would drift the
   * first time LOST_IN_TRANSIT or a new terminal moved; asking the
   * authority per order is arithmetic over a handful of lines and cannot.
   *
   * ── THE SELLER'S COST IS WITHHELD, STRUCTURALLY ────────────────────
   * Every line is passed `unitCostInr: null` and `loadUnitCosts` is
   * deliberately NOT called (boundary 1 — the seller's cost is the
   * seller's, exactly as `StoreAnalysisService.analysis()` does it). So
   * the scorecard's own `marginInr` is the SELLER's margin and would be
   * ₹0.00 with zero coverage here; it is not in the response. The margin
   * that IS here is the STORE's — retail less the store's own transfer
   * price, which is the reseller's cost and theirs to see.
   *
   * ── PRICED OFF THE ORDER'S SNAPSHOT ────────────────────────────────
   * `resellerRetailUnitInr` / `resellerTransferPriceInr` on the order
   * line (ORD-6 / RS-5), never the live catalogue: a price-list change
   * next week must not restate last month's performance.
   */
  async analysis(
    storeId: string,
    window: { readonly from: Date; readonly to: Date },
  ): Promise<AssociateAnalysisView> {
    const db = this.prisma.client;
    const store = await this.loadStore(storeId);
    const [people, tally] = await Promise.all([this.roster(store.id), this.priceTally(store.id)]);
    const roster = new Set(people.map((p) => p.id));

    /*
      Two columns over the store's whole window first, so the cohort is
      the orders an associate on the roster placed and everything else is
      a COUNT rather than a row. Scoped by the store id from the token in
      the WHERE clause, and by the reseller kind — a channel order of the
      same store is not reseller performance.
    */
    const attribution = await db.order.findMany({
      where: {
        storeId: store.id,
        storeKind: SellerStoreKind.RESELLER,
        createdAt: { gte: window.from, lt: window.to },
      },
      select: { id: true, placedByStoreUserId: true },
    });
    const cohort = attribution.filter(
      (o) => o.placedByStoreUserId !== null && roster.has(o.placedByStoreUserId),
    );
    const placedBy = new Map(cohort.map((o) => [o.id, o.placedByStoreUserId ?? '']));
    const ids = cohort.map((o) => o.id);

    const [facts, ndrIds] = await Promise.all([
      ids.length === 0
        ? Promise.resolve([])
        : loadOrderFacts(db, { id: { in: ids }, storeId: store.id }),
      this.ordersWithFailedDelivery(ids),
    ]);

    const byUser = new Map<string, OrderFact[]>();
    for (const f of facts) {
      const who = placedBy.get(f.id);
      if (who === undefined || who === '') continue;
      byUser.set(who, [...(byUser.get(who) ?? []), f]);
    }

    const rows: AssociateAnalysisRow[] = people.map((p) => {
      const mine = byUser.get(p.id) ?? [];
      const card = scorecard(
        mine.map((f) => ({
          status: f.status,
          everConfirmed: f.everConfirmed,
          lines: f.lines.map((l) => ({
            quantity: l.quantity,
            transferInr: l.transferInr,
            retailInr: l.retailInr,
            // Boundary 1: the SELLER's unit cost is never shown to the
            // store, so it is never even loaded (store-cost-privacy).
            unitCostInr: null,
          })),
        })),
      );
      let margin = ZERO;
      let lines = 0;
      let linesWithTransferPrice = 0;
      for (const f of mine) {
        if (!delivered(f)) continue;
        for (const l of f.lines) {
          lines += 1;
          if (l.retailInr === null || l.transferInr === null) continue;
          linesWithTransferPrice += 1;
          margin = margin.add(l.retailInr.sub(l.transferInr).mul(l.quantity));
        }
      }
      const counts = tally.of(p.id);
      return {
        storeUserId: p.id,
        fullName: p.fullName,
        email: p.emailDisplay,
        ordersPausedAt: p.ordersPausedAt?.toISOString() ?? null,
        ordersPlaced: card.placed,
        confirmed: card.confirmed,
        delivered: card.delivered,
        cancelled: card.calledOff,
        ndr: mine.filter((f) => ndrIds.has(f.id)).length,
        rto: card.returned,
        retailSoldInr: card.retailDeliveredInr,
        storeMarginInr: margin.toFixed(2),
        marginCoverage: { lines, linesWithTransferPrice },
        confirmationRate: pct(card.confirmationRatePct),
        deliveryRate: pct(card.deliveryRatePct),
        returnRate: pct(card.returnRatePct),
        decidedCount: card.decided,
        outcomeKnownCount: card.delivered + card.returned + card.lost,
        pricedProducts: counts.priced,
        unpricedProducts: counts.unpriced,
        outOfRangePrices: counts.outOfRange,
      };
    });
    rows.sort(
      (a, b) =>
        new Prisma.Decimal(b.retailSoldInr).cmp(a.retailSoldInr) ||
        a.fullName.localeCompare(b.fullName),
    );
    return {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      sellableProducts: tally.sellableProducts,
      ordersNotByAnAssociate: attribution.length - cohort.length,
      rows,
    };
  }

  // ── writes ─────────────────────────────────────────────────────────

  async setPrice(
    actor: AuthenticatedStoreUser,
    storeUserId: string,
    variantId: string,
    retailPriceInr: string,
  ): Promise<AssociatePriceRow> {
    const member = await this.requireMember(actor.storeId, storeUserId);
    const sellable = await this.sellableProducts(actor.storeId);
    const product = sellable.find((p) => p.variantId === variantId);
    if (product === undefined) {
      // Refused BY NAME rather than stored: a price on a product the
      // store may not sell is a row that can never decide an order, and
      // the reseller would be left believing somebody could sell it.
      throw new NotFoundException({
        code: 'ASSOCIATE_PRODUCT_NOT_SELLABLE',
        message:
          'Your store cannot sell that product — it is switched off for you, or your seller has set no price for it.',
      });
    }
    const refusal = checkAssociatePrice({ retailInr: retailPriceInr, range: product.range });
    if (refusal !== null) throw new BadRequestException(refusal);

    const { previousInr } = await this.prices.set({
      storeId: actor.storeId,
      storeUserId: member.id,
      variantId,
      retailPriceInr,
      setByStoreUserId: actor.id,
    });
    await this.audit.log({
      actorType: ActorType.STORE,
      actorId: actor.id,
      sellerId: actor.sellerId,
      action: 'store.associate_price.set',
      entityType: 'associate_price',
      // Not a row id: the row is upserted, so the stable identity of this
      // decision is the person and the product, both in metadata.
      entityId: null,
      severity: 'MEDIUM',
      changes: {
        before: previousInr === null ? null : previousInr.toFixed(2),
        after: new Prisma.Decimal(retailPriceInr).toFixed(2),
      },
      metadata: {
        storeId: actor.storeId,
        storeUserId: member.id,
        associateName: member.fullName,
        variantId,
        skuCode: product.skuCode,
      },
    });
    const refreshed = await this.prices.rowsFor(member.id);
    const row = refreshed.find((r) => r.variantId === variantId);
    const retail = row?.retailPriceInr.toFixed(2) ?? new Prisma.Decimal(retailPriceInr).toFixed(2);
    return {
      variantId,
      productName: product.productName,
      variantLabel: product.variantLabel,
      skuCode: product.skuCode,
      retailPriceInr: retail,
      minRetailInr: product.range.minRetailInr,
      maxRetailInr: product.range.maxRetailInr,
      suggestedRetailInr: product.suggestedRetailInr,
      outOfRange: false,
      setAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  /**
   * Copy one associate's whole price list onto another's.
   *
   * The owner asked for this, and the reason is arithmetic: setting fifty
   * prices by hand per person is the thing that stops a store adding its
   * second associate at all.
   *
   * Three rules make it safe to press:
   *   · every line is checked against the SELLER's range exactly as a
   *     hand-set price is, so a copy can no more break the seller's terms
   *     than a typed one can — an out-of-range source line is SKIPPED by
   *     name rather than copied;
   *   · a line for a product the store may no longer sell is skipped too;
   *   · nothing is overwritten SILENTLY — every replaced figure comes
   *     back in `overwritten` with what it was and what it became.
   * One transaction for every write, so a half-copied list — the state
   * nobody could reason about afterwards — is unreachable.
   */
  async copyPrices(
    actor: AuthenticatedStoreUser,
    storeUserId: string,
    fromStoreUserId: string,
  ): Promise<AssociateCopyResult> {
    if (storeUserId === fromStoreUserId) {
      throw new BadRequestException({
        code: 'ASSOCIATE_COPY_SAME_PERSON',
        message: 'Choose a different person to copy prices from.',
      });
    }
    const [target, source] = await Promise.all([
      this.requireMember(actor.storeId, storeUserId),
      this.requireMember(actor.storeId, fromStoreUserId),
    ]);
    const [sellable, sourceRows, targetRows] = await Promise.all([
      this.sellableProducts(actor.storeId),
      this.prices.rowsFor(source.id),
      this.prices.rowsFor(target.id),
    ]);
    const productBy = new Map(sellable.map((p) => [p.variantId, p]));
    const targetBy = new Map(targetRows.map((r) => [r.variantId, r]));

    const created: Array<{ variantId: string; skuCode: string; retailPriceInr: string }> = [];
    const overwritten: Array<{
      variantId: string;
      skuCode: string;
      fromInr: string;
      toInr: string;
    }> = [];
    const unchanged: Array<{ variantId: string; skuCode: string; retailPriceInr: string }> = [];
    const skipped: Array<{
      variantId: string;
      skuCode: string;
      code: AssociateCopySkipReason;
      message: string;
    }> = [];
    const writes: Array<{ variantId: string; retailPriceInr: string }> = [];

    for (const row of sourceRows) {
      const retail = row.retailPriceInr.toFixed(2);
      const product = productBy.get(row.variantId);
      if (product === undefined) {
        skipped.push({
          variantId: row.variantId,
          skuCode: '—',
          code: 'NOT_SELLABLE',
          message: 'Your store can no longer sell that product, so its price was not copied.',
        });
        continue;
      }
      const refusal = checkAssociatePrice({ retailInr: retail, range: product.range });
      if (refusal !== null) {
        skipped.push({
          variantId: product.variantId,
          skuCode: product.skuCode,
          code: 'ASSOCIATE_PRICE_OUT_OF_SELLER_RANGE',
          message: refusal.message,
        });
        continue;
      }
      const existing = targetBy.get(row.variantId);
      if (existing === undefined) {
        created.push({
          variantId: product.variantId,
          skuCode: product.skuCode,
          retailPriceInr: retail,
        });
        writes.push({ variantId: product.variantId, retailPriceInr: retail });
        continue;
      }
      const before = existing.retailPriceInr.toFixed(2);
      if (before === retail) {
        unchanged.push({
          variantId: product.variantId,
          skuCode: product.skuCode,
          retailPriceInr: retail,
        });
        continue;
      }
      overwritten.push({
        variantId: product.variantId,
        skuCode: product.skuCode,
        fromInr: before,
        toInr: retail,
      });
      writes.push({ variantId: product.variantId, retailPriceInr: retail });
    }

    if (writes.length > 0) {
      await this.prisma.client.$transaction(async (tx) => {
        for (const w of writes) {
          await this.prices.set(
            {
              storeId: actor.storeId,
              storeUserId: target.id,
              variantId: w.variantId,
              retailPriceInr: w.retailPriceInr,
              setByStoreUserId: actor.id,
            },
            tx,
          );
        }
      });
    }

    await this.audit.log({
      actorType: ActorType.STORE,
      actorId: actor.id,
      sellerId: actor.sellerId,
      action: 'store.associate_prices.copied',
      entityType: 'store_user',
      entityId: target.id,
      severity: 'MEDIUM',
      metadata: {
        storeId: actor.storeId,
        fromStoreUserId: source.id,
        fromName: source.fullName,
        toName: target.fullName,
        created: created.length,
        overwritten: overwritten.length,
        unchanged: unchanged.length,
        skipped: skipped.length,
      },
    });

    return {
      from: { storeUserId: source.id, fullName: source.fullName },
      to: { storeUserId: target.id, fullName: target.fullName },
      created,
      overwritten,
      unchanged,
      skipped,
    };
  }

  /**
   * Switch one person's order CREATION on or off.
   *
   * RS-1's PAUSED semantics one level down: no new orders, everything
   * already placed carries on, and they keep reading, tracking,
   * cancelling and chasing it. Not a restriction row and not a role
   * change — the person keeps their login and their history.
   *
   * A guarded `updateMany` on (id, this store, live) rather than a read
   * then a write: the read-then-write pair under READ COMMITTED lets a
   * removal land in between and the update then writes to a row the
   * caller no longer has any business touching.
   */
  async setOrdersPaused(
    actor: AuthenticatedStoreUser,
    storeUserId: string,
    paused: boolean,
  ): Promise<{ readonly storeUserId: string; readonly ordersPausedAt: string | null }> {
    const member = await this.requireMember(actor.storeId, storeUserId);
    const at = paused ? new Date() : null;
    const { count } = await this.prisma.client.storeUser.updateMany({
      where: { id: member.id, storeId: actor.storeId, deletedAt: null },
      data: { ordersPausedAt: at },
    });
    if (count === 0) {
      throw new NotFoundException({
        code: 'ASSOCIATE_NOT_FOUND',
        message: 'No such person on this store’s team',
      });
    }
    await this.audit.log({
      actorType: ActorType.STORE,
      actorId: actor.id,
      sellerId: actor.sellerId,
      action: paused ? 'store.associate.orders_paused' : 'store.associate.orders_resumed',
      entityType: 'store_user',
      entityId: member.id,
      severity: 'MEDIUM',
      metadata: {
        storeId: actor.storeId,
        associateName: member.fullName,
        wasPausedAt: member.ordersPausedAt?.toISOString() ?? null,
      },
    });
    return { storeUserId: member.id, ordersPausedAt: at?.toISOString() ?? null };
  }

  // ── internals ──────────────────────────────────────────────────────

  /**
   * Orders of a cohort that EVER reached a failed delivery.
   *
   * Counted per ORDER, not per attempt: it sits beside `delivered`,
   * `cancelled` and `rto`, which are order counts, and a parcel the
   * courier tried three times would otherwise read as three failures by
   * one person. Read from `order_events` rather than the current status
   * because a parcel that failed once and was delivered on the next
   * attempt did still cost somebody a phone call — counted on the status
   * alone it would vanish.
   */
  private async ordersWithFailedDelivery(orderIds: readonly string[]): Promise<Set<string>> {
    const out = new Set<string>();
    if (orderIds.length === 0) return out;
    for (const part of chunks(orderIds)) {
      const rows = await this.prisma.client.orderEvent.findMany({
        where: { orderId: { in: part }, toStatus: OrderStatus.DELIVERY_FAILED },
        select: { orderId: true },
      });
      for (const r of rows) out.add(r.orderId);
    }
    return out;
  }

  /** The people on this store's `associate` role, live ones only. */
  /**
   * Live invitations onto the associate role: unused, not revoked, not
   * expired. An EXPIRED one is deliberately left out — it is not waiting
   * on anybody, and a list that keeps growing with dead rows is a list
   * people stop reading. Revoking or resending is the Team screen's, so
   * this is a statement that somebody is expected, not a second console.
   */
  private async pendingInvites(storeId: string): Promise<AssociateInviteSummary[]> {
    const rows = await this.prisma.client.storeUserInvitation.findMany({
      where: {
        storeId,
        usedAt: null,
        deletedAt: null,
        expiresAt: { gt: new Date() },
        roles: { some: { role: { key: ASSOCIATE_ROLE_KEY, deletedAt: null } } },
      },
      orderBy: [{ createdAt: 'desc' }],
      select: { id: true, fullName: true, email: true, createdAt: true, expiresAt: true },
    });
    return rows.map((r) => ({
      invitationId: r.id,
      fullName: r.fullName,
      email: r.email,
      invitedAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
    }));
  }

  private roster(storeId: string): Promise<
    Array<{
      id: string;
      fullName: string;
      emailDisplay: string;
      ordersPausedAt: Date | null;
      lastLoginAt: Date | null;
    }>
  > {
    return this.prisma.client.storeUser.findMany({
      where: {
        storeId,
        deletedAt: null,
        roles: { some: { role: { key: ASSOCIATE_ROLE_KEY, deletedAt: null } } },
      },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        fullName: true,
        emailDisplay: true,
        ordersPausedAt: true,
        lastLoginAt: true,
      },
    });
  }

  /**
   * How many products each person is priced for, and how many of their
   * prices the SELLER's range has since left behind.
   *
   * ONE computation, read by the roster AND by the analysis screen. Two
   * copies is how the two pages come to disagree about whether somebody
   * is priced for everything — and "you are priced for 40 of 40" on one
   * screen beside "38 of 40" on the other is the kind of difference
   * nobody can resolve without reading the code.
   */
  private async priceTally(storeId: string): Promise<{
    readonly sellableProducts: number;
    readonly of: (storeUserId: string) => {
      readonly priced: number;
      readonly unpriced: number;
      readonly outOfRange: number;
    };
  }> {
    const [sellable, priceRows] = await Promise.all([
      this.sellableProducts(storeId),
      this.prices.rowsForStore(storeId),
    ]);
    const rangeBy = new Map(sellable.map((p) => [p.variantId, p.range]));
    const byUser = new Map<string, { priced: number; outOfRange: number }>();
    for (const row of priceRows) {
      const range = rangeBy.get(row.variantId);
      // A price for something the store may no longer sell counts
      // towards NEITHER figure: it is not a product this person can
      // sell, so calling it "priced" would overstate their coverage and
      // calling it "out of range" would ask them to fix a row that
      // decides nothing.
      if (range === undefined) continue;
      const tally = byUser.get(row.storeUserId) ?? { priced: 0, outOfRange: 0 };
      tally.priced += 1;
      if (!isWithinRange({ retailInr: row.retailPriceInr.toFixed(2), range }))
        tally.outOfRange += 1;
      byUser.set(row.storeUserId, tally);
    }
    return {
      sellableProducts: sellable.length,
      of: (storeUserId) => {
        const t = byUser.get(storeUserId) ?? { priced: 0, outOfRange: 0 };
        return {
          priced: t.priced,
          unpriced: Math.max(0, sellable.length - t.priced),
          outOfRange: t.outOfRange,
        };
      },
    };
  }

  /** The caller's own reseller store, or a 404. */
  private async loadStore(storeId: string): Promise<{ id: string; sellerId: string }> {
    const store = await this.prisma.client.sellerStore.findFirst({
      where: { id: storeId, kind: SellerStoreKind.RESELLER, deletedAt: null },
      select: { id: true, sellerId: true },
    });
    if (store === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such store' });
    }
    return store;
  }

  /**
   * A LIVE member of THIS store, or a 404 that says nothing more.
   *
   * Deliberately NOT narrowed to people holding the associate role.
   * Somebody may hold it beside another (RBAC-1b — roles union), and a
   * role change must not make the prices already set for them
   * unreachable; the ROSTER is the associate list, this is "a person at
   * my store". The store id is the token's, in the WHERE clause.
   */
  private async requireMember(
    storeId: string,
    storeUserId: string,
  ): Promise<{
    id: string;
    fullName: string;
    emailDisplay: string;
    ordersPausedAt: Date | null;
  }> {
    const member = await this.prisma.client.storeUser.findFirst({
      where: { id: storeUserId, storeId, deletedAt: null },
      select: { id: true, fullName: true, emailDisplay: true, ordersPausedAt: true },
    });
    if (member === null) {
      throw new NotFoundException({
        code: 'ASSOCIATE_NOT_FOUND',
        message: 'No such person on this store’s team',
      });
    }
    return member;
  }

  /**
   * What the store may sell, with the seller's retail bounds on each.
   *
   * Through `ResellerStockGateService.offersFor` — RS-5's dependency-free
   * primitive — rather than reading the store's rows and the seller's
   * default list here and resolving "override ?? default" again. That
   * rule is decided PER ROW (RS-3) and a second implementation of it is
   * how the pricing screen comes to show a range the order gate does not
   * enforce. Sellable means exactly what the store's own catalogue means
   * by it: the variant is still the seller's and active, the store has it
   * switched on, and there is an effective price for it.
   */
  private async sellableProducts(storeId: string): Promise<readonly SellableProduct[]> {
    const store = await this.loadStore(storeId);
    const enabled = await this.prisma.client.resellerStoreVariant.findMany({
      where: { storeId: store.id, enabled: true },
      select: { variantId: true },
    });
    const ids = enabled.map((r) => r.variantId);
    if (ids.length === 0) return [];
    const [offers, resellable] = await Promise.all([
      this.gate.offersFor({ id: store.id, sellerId: store.sellerId }, ids),
      this.catalog.listResellableVariants(store.sellerId, ids),
    ]);
    const out: SellableProduct[] = [];
    for (const v of resellable.variants) {
      const offer = offers.get(v.variantId);
      if (offer === undefined || !offer.enabled || !offer.resellable || offer.price === null) {
        continue;
      }
      out.push({
        variantId: v.variantId,
        productName: v.productName,
        variantLabel: v.variantLabel,
        skuCode: v.skuCode,
        range: {
          minRetailInr: offer.price.minRetailInr?.toFixed(2) ?? null,
          maxRetailInr: offer.price.maxRetailInr?.toFixed(2) ?? null,
        },
        suggestedRetailInr: offer.price.suggestedRetailInr?.toFixed(2) ?? null,
      });
    }
    out.sort(
      (a, b) => a.productName.localeCompare(b.productName) || a.skuCode.localeCompare(b.skuCode),
    );
    return out;
  }
}
