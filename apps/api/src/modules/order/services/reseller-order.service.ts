import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  OrderSource,
  OrderStatus,
  PaymentMode,
  Prisma,
  ResellerStoreStatus,
  SellerStatus,
  SellerStoreKind,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import { ResellerStockGateService } from '../../reseller-order-gate/services/reseller-stock-gate.service';
import { ResellerOrderMoneyService } from '../../reseller-order-money/services/reseller-order-money.service';
import {
  ResellerStoreTermsService,
  type StoreTermsSnapshot,
} from '../../reseller-store-terms/services/reseller-store-terms.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import type { CreateOrderDto } from '../dto/create-order.dto';
import type { CreateStoreOrderDto } from '../dto/create-store-order.dto';
import type { ResellerLineTerms, ResellerOrderTerms } from '../reseller-order-snapshot';
import type { EventActor } from './order-event-writer.service';
import { OrderService, type OrderView } from './order.service';

/** The master switch (SET-1, seeded FALSE) — see the migration and the doc. */
export const RESELLER_ORDERS_ENABLED_KEY = 'reseller.orders_enabled';

/** WHO is placing a store order: a person on the portal, or the store's API key. */
export type StoreOrderActor =
  | { readonly kind: 'STORE_USER'; readonly storeId: string; readonly storeUserId: string }
  | { readonly kind: 'STORE_API_KEY'; readonly storeId: string; readonly apiKeyId: string };

export interface StoreOrderCreateOptions {
  /** MANUAL (portal), BULK_UPLOAD (CSV) or API (a key). */
  readonly source: OrderSource;
  readonly bulkUploadId?: string;
}

const D = Prisma.Decimal;

function inr(d: Prisma.Decimal): string {
  return `₹${d.toFixed(2)}`;
}

/** The order-level terms an order snapshots, from the version in force. */
export function termsFromSnapshot(s: StoreTermsSnapshot): ResellerOrderTerms {
  return {
    termsVersionId: s.termsVersionId,
    deliveryFeeStorePercent: s.storePercents.deliveryFeeStorePercent,
    returnFeeStorePercent: s.storePercents.returnFeeStorePercent,
    customerReturnFeeStorePercent: s.storePercents.customerReturnFeeStorePercent,
    codFeeStorePercent: s.storePercents.codFeeStorePercent,
    codTaxStorePercent: s.storePercents.codTaxStorePercent,
    instantPayFeeStorePercent: s.storePercents.instantPayFeeStorePercent,
    storeCreditTrigger: s.storeCredit.trigger,
    storeCreditDays: s.storeCredit.days,
    sellerCreditTrigger: s.sellerCredit.trigger,
    sellerCreditDays: s.sellerCredit.days,
  };
}

/**
 * RS-5 — a RESELLER STORE placing an order: portal, CSV row or API key
 * all come through `create`, and it is the ONLY caller of
 * `OrderService.create`'s `reseller` option.
 *
 * ── THE REFUSALS, IN THIS ORDER, BEFORE ANYTHING IS WRITTEN ──────────
 *   1. the store is a live RESELLER store, ACTIVE (PAUSED blocks new
 *      orders — RS-1), under an APPROVED seller;
 *   2. `reseller.orders_enabled` is on for the seller (SET-1, FAILS
 *      CLOSED — it guards money that is not wired yet);
 *   3. the store's terms are ready (`orderReadiness`: published, the
 *      version in force accepted, not flagged — RS-4);
 *   4. every line's product is ENABLED for the store, still resellable,
 *      with an effective transfer price (RS-3);
 *   5. every line's retail sits inside the seller's [min, max] where set;
 *   6. PREPAID needs the store's wallet to cover the transfer price and
 *      its delivery share (phase 3c): `STORE_BALANCE_INSUFFICIENT`, checked
 *      inside the create transaction under the seller's WALLET lock;
 *   7. no line asks for more than the store is SHOWN (RS-3's visible
 *      quantity, hidden share and set-asides included). ORD-10 is
 *      AMENDED for this one check — a store must never order stock it was
 *      hidden from, or the hidden share would mean nothing — but it is
 *      still NOT a reservation and NOT a real-availability refusal: a
 *      SHARED line's stock is checked properly only at confirmation.
 *
 * Then `OrderService.create` runs the seller-side checks it runs for every
 * order (restrictions, credit, address) and writes the order with the
 * snapshot; inside its transaction `lockAndReadTerms` locks the store
 * row FOR SHARE, re-checks ACTIVE and reads the terms from the same
 * snapshot — the half of RS-1's close race a pre-check cannot close.
 */
@Injectable()
export class ResellerOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
    private readonly settings: SettingsResolverService,
    private readonly terms: ResellerStoreTermsService,
    private readonly gate: ResellerStockGateService,
    private readonly catalog: CatalogReadService,
    // RS-6 phase 3c — the prepaid store-balance check.
    private readonly money: ResellerOrderMoneyService,
  ) {}

  async create(
    actor: StoreOrderActor,
    input: CreateStoreOrderDto,
    ctx: ClientContext,
    opts: StoreOrderCreateOptions = { source: OrderSource.MANUAL },
  ): Promise<OrderView> {
    // ── 1. The store takes orders ────────────────────────────────────
    const store = await this.prisma.client.sellerStore.findFirst({
      where: { id: actor.storeId, kind: SellerStoreKind.RESELLER, deletedAt: null },
      select: {
        id: true,
        sellerId: true,
        name: true,
        displayName: true,
        status: true,
        seller: { select: { status: true, deletedAt: true } },
      },
    });
    if (store === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such store' });
    }
    assertStoreTakesOrders(
      store.status,
      store.seller.status === SellerStatus.APPROVED && store.seller.deletedAt === null,
    );

    // ── 2. The master switch ─────────────────────────────────────────
    await this.assertOrdersEnabled(store.sellerId);

    // ── 3. The terms are ready ───────────────────────────────────────
    const readiness = await this.terms.orderReadiness(store.id);
    if (!readiness.ready) {
      throw new ConflictException({
        code: 'RESELLER_TERMS_NOT_READY',
        message: readiness.message ?? 'The store cannot order until its terms are in order.',
        details: { reasons: readiness.reasons },
      });
    }

    // ── 4. Every line is offered to this store, at a price ───────────
    const variantIds = input.items.map((i) => i.variantId);
    const [offers, names] = await Promise.all([
      this.gate.offersFor({ id: store.id, sellerId: store.sellerId }, variantIds),
      this.catalog.getVariantsByIds([...new Set(variantIds)]),
    ]);
    const label = (variantId: string): string => {
      const v = names.get(variantId);
      return v !== undefined && v.sellerId === store.sellerId ? v.skuCode : 'This product';
    };
    for (const item of input.items) {
      const offer = offers.get(item.variantId);
      if (offer === undefined || !offer.enabled || !offer.resellable || offer.price === null) {
        throw new ConflictException({
          code: 'RESELLER_VARIANT_NOT_OFFERED',
          message: `${label(item.variantId)} is not in this store’s catalogue. Pick from the products the seller has turned on for you.`,
          details: { variantId: item.variantId },
        });
      }
    }

    // ── 5. Retail inside the seller's range ──────────────────────────
    const lines: ResellerLineTerms[] = input.items.map((item) => {
      const offer = offers.get(item.variantId);
      const price = offer?.price;
      if (offer === undefined || price === undefined || price === null) {
        // Unreachable after step 4; narrows the type without a `!`.
        throw new ConflictException({
          code: 'RESELLER_VARIANT_NOT_OFFERED',
          message: `${label(item.variantId)} is not in this store’s catalogue.`,
        });
      }
      /*
        THE SELLING PRICE, AND WHERE IT COMES FROM WHEN THE CALLER STATES NONE
        (owner, 2026-09-19 — asked for the CSV; decided HERE so the
        portal, the CSV worker and the API key cannot drift).

        Stated ⇒ used. Not stated ⇒ the seller's own SUGGESTED RETAIL for
        this product in this store's catalogue — a figure the seller set,
        for this store, which is why it is a fallback rather than a guess.
        Neither ⇒ refused BY NAME. It is never derived from the COD
        amount: that is one total covering every line, the delivery fee
        and any advance, so splitting it back out would invent a price
        nobody agreed and then snapshot it (ORD-6) as if they had.

        `RESELLER_RETAIL_REQUIRED` is the same code and the same shape
        `ResellerOrderRetermService` uses when a line is ADDED to an
        existing order with nothing to price it by.
      */
      const retail =
        item.retailUnitPriceInr === undefined
          ? price.suggestedRetailInr
          : new D(item.retailUnitPriceInr);
      if (retail === null) {
        throw new BadRequestException({
          code: 'RESELLER_RETAIL_REQUIRED',
          message:
            `Say what ${label(item.variantId)} is being sold to the customer for — the seller has ` +
            'suggested no retail price for it.',
          details: { variantId: item.variantId },
        });
      }
      const tooLow = price.minRetailInr !== null && retail.lt(price.minRetailInr);
      const tooHigh = price.maxRetailInr !== null && retail.gt(price.maxRetailInr);
      if (tooLow || tooHigh) {
        const range =
          price.minRetailInr !== null && price.maxRetailInr !== null
            ? `between ${inr(price.minRetailInr)} and ${inr(price.maxRetailInr)}`
            : price.minRetailInr !== null
              ? `at ${inr(price.minRetailInr)} or more`
              : `at ${inr(price.maxRetailInr ?? new D(0))} or less`;
        throw new BadRequestException({
          code: 'RETAIL_OUT_OF_RANGE',
          message: `${label(item.variantId)} must be sold ${range}; ${inr(retail)} is outside it.`,
          details: {
            variantId: item.variantId,
            minRetailInr: price.minRetailInr?.toFixed(2) ?? null,
            maxRetailInr: price.maxRetailInr?.toFixed(2) ?? null,
          },
        });
      }
      return {
        transferPriceInr: price.transferPriceInr,
        retailUnitInr: retail,
        minRetailInr: price.minRetailInr,
        maxRetailInr: price.maxRetailInr,
        stockMode: offer.stockMode,
      };
    });

    // ── 6. Prepaid: the store's wallet must pay for it (decision 11) ──
    // Checked INSIDE the create transaction (`lockAndReadTerms` below),
    // under the seller's WALLET lock, so no top-up, withdrawal or sibling
    // order can move the store between the check and the order's commit.
    const transferTotal = lines.reduce(
      (t, l, i) => t.add(l.transferPriceInr.mul(input.items[i]?.quantity ?? 0)),
      new D(0),
    );

    // ── 7. No more than the store is shown ───────────────────────────
    const wanted = new Map<string, number>();
    for (const item of input.items) {
      wanted.set(item.variantId, (wanted.get(item.variantId) ?? 0) + item.quantity);
    }
    for (const [variantId, qty] of wanted) {
      const visible = offers.get(variantId)?.visibleQty ?? 0;
      if (qty > visible) {
        throw new ConflictException({
          code: 'RESELLER_QTY_EXCEEDS_VISIBLE',
          message:
            visible === 0
              ? `${label(variantId)} is not available to this store right now.`
              : `Only ${visible} of ${label(variantId)} ${visible === 1 ? 'is' : 'are'} available to this store; this order asks for ${qty}.`,
          details: { variantId, available: visible, requested: qty },
        });
      }
    }

    // ── The order, through the ONE order writer ──────────────────────
    const eventActor: EventActor =
      actor.kind === 'STORE_USER'
        ? { type: ActorType.STORE, id: actor.storeUserId }
        : { type: ActorType.API, id: actor.apiKeyId };
    const storeId = store.id;
    return this.orders.create(store.sellerId, toCreateOrderDto(input, lines), eventActor, ctx, {
      source: opts.source,
      initialStatus: OrderStatus.PENDING_CONFIRMATION,
      ...(opts.bulkUploadId === undefined ? {} : { bulkUploadId: opts.bulkUploadId }),
      reseller: {
        storeId,
        storeName: store.displayName ?? store.name,
        lines,
        lockAndReadTerms: async (tx) => {
          const terms = await this.lockAndReadTerms(tx, storeId);
          if (input.paymentMode === PaymentMode.PREPAID) {
            // STORE_BALANCE_INSUFFICIENT — the transfer price and the store's
            // delivery share, plus its other accepted-but-unconfirmed prepaid
            // orders, within the store's negative limit.
            await this.money.assertPrepaidCovered(tx, {
              storeId,
              sellerId: store.sellerId,
              transferTotal,
              deliveryFeeStorePercent: new D(terms.deliveryFeeStorePercent),
            });
          }
          return terms;
        },
      },
    });
  }

  /**
   * INSIDE the create transaction, first thing. Locks the store row FOR
   * SHARE — concurrent orders do not block each other, but a close or a
   * pause (an UPDATE of the row) waits for this order to commit and then
   * counts it, or this order waits for the close and then sees CLOSED —
   * re-checks ACTIVE, and reads the terms in force from the same snapshot.
   */
  private async lockAndReadTerms(
    tx: Prisma.TransactionClient,
    storeId: string,
  ): Promise<ResellerOrderTerms> {
    const rows = await tx.$queryRaw<Array<{ status: string | null }>>(
      Prisma.sql`SELECT "status"::text AS "status" FROM "seller_stores"
                 WHERE "id" = ${storeId}::uuid AND "kind" = 'reseller' AND "deleted_at" IS NULL
                 FOR SHARE`,
    );
    const status = rows[0]?.status ?? null;
    if (status !== 'active') {
      assertStoreTakesOrders(
        status === 'paused'
          ? ResellerStoreStatus.PAUSED
          : status === 'closed'
            ? ResellerStoreStatus.CLOSED
            : null,
        true,
      );
    }
    const readiness = await this.terms.orderReadiness(storeId, tx);
    const current = await this.terms.currentTerms(storeId, tx);
    if (
      !readiness.ready ||
      current === null ||
      current.termsVersionId !== readiness.termsVersionId
    ) {
      throw new ConflictException({
        code: 'RESELLER_TERMS_NOT_READY',
        message: readiness.message ?? 'The store’s terms changed while the order was being placed.',
        details: { reasons: readiness.reasons },
      });
    }
    return termsFromSnapshot(current);
  }

  /** SET-1, FAILS CLOSED: an unreadable switch is an off switch — it guards money. */
  private async assertOrdersEnabled(sellerId: string): Promise<void> {
    let enabled = false;
    try {
      const resolved = await this.settings.resolve(sellerId, RESELLER_ORDERS_ENABLED_KEY);
      enabled = resolved.value === true;
    } catch {
      enabled = false;
    }
    if (!enabled) {
      throw new ConflictException({
        code: 'RESELLER_ORDERS_DISABLED',
        message:
          'Reseller store orders are not switched on for this seller yet. Skydrop turns them on once store payments are live.',
      });
    }
  }
}

/** Refuse a store that is not ACTIVE under an approved seller, naming why. */
export function assertStoreTakesOrders(
  status: ResellerStoreStatus | null,
  sellerApproved: boolean,
): void {
  if (status === ResellerStoreStatus.ACTIVE && sellerApproved) return;
  if (status === ResellerStoreStatus.PAUSED) {
    throw new ConflictException({
      code: 'RESELLER_STORE_PAUSED',
      message:
        'This store is paused. Orders already placed carry on; new ones wait until the seller resumes it.',
    });
  }
  throw new ConflictException({
    code: 'RESELLER_STORE_NOT_ACTIVE',
    message: 'This store is not taking orders.',
  });
}

/** The seller-shaped order a store's input becomes. Retail IS the unit price. */
export function toCreateOrderDto(
  input: CreateStoreOrderDto,
  lines: readonly ResellerLineTerms[],
): CreateOrderDto {
  const { items, notes, ...rest } = input;
  const dto = {
    ...rest,
    // `unitPriceInr` carries the RETAIL on a reseller order, and it is
    // read from the RESOLVED line rather than from the request: the
    // caller may have stated no price, in which case the resolved one is
    // the seller's suggested retail (2026-09-19). Taking it from the
    // request here would write NULL alongside a snapshot that says
    // otherwise, and every reader that shows a unit price would disagree
    // with the money.
    items: items.map((i, idx) => ({
      variantId: i.variantId,
      quantity: i.quantity,
      unitPriceInr: Number((lines[idx]?.retailUnitInr ?? new D(0)).toFixed(2)),
    })),
    ...(notes === undefined ? {} : { sellerNotes: notes }),
  } as CreateOrderDto;
  // A COD order with no amount stated collects the retail total, plus the
  // customer's delivery fee, less any discount and advance — what a CSV
  // row or an API caller that leaves it out means.
  if (dto.paymentMode === PaymentMode.COD && dto.codAmountInr === undefined) {
    const retail = lines.reduce(
      (sum, l, i) => sum.add(l.retailUnitInr.mul(items[i]?.quantity ?? 0)),
      new D(0),
    );
    const collect = retail
      .add(new D(dto.deliveryFeeInr ?? 0))
      .sub(new D(dto.discountInr ?? 0))
      .sub(new D(dto.advanceAmountInr ?? 0));
    dto.codAmountInr = Number(collect.toFixed(2));
  }
  return dto;
}
