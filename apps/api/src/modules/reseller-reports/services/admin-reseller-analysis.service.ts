import { Injectable } from '@nestjs/common';
import {
  Currency,
  DeliveryAttemptOutcome,
  OrderStatus,
  Prisma,
  ResellerStoreStatus,
  SellerStoreKind,
  StoreWalletEntryDirection,
  TicketStatus,
  TicketType,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { InstantPayAdvanceService } from '../../treasury/services/instant-pay-advance.service';
import { storeWalletBalance } from '../../treasury/services/store-wallet-balances';
import { orderFate } from '../../treasury/services/pnl.service';
import { chunks, loadOrderFacts } from './reseller-order-facts';
import {
  DEFAULT_FRAUD_THRESHOLDS,
  evaluateFraud,
  maskPhone,
  maxInAnyHour,
  type FraudFlag,
  type FraudThresholds,
  type MarkupLine,
  type StoreFraudMetrics,
} from './reseller-fraud-rules';

const ZERO = new Prisma.Decimal(0);
const DAY_MS = 24 * 60 * 60 * 1000;
const DISPUTE_LOOKBACK_DAYS = 365;

/** The settings each threshold reads, and its default. */
const THRESHOLD_KEYS: Record<keyof FraudThresholds, string> = {
  windowDays: 'reseller.fraud_window_days',
  minOrders: 'reseller.fraud_min_orders',
  cancelRatePct: 'reseller.fraud_cancel_rate_percent',
  returnRatePct: 'reseller.fraud_return_rate_percent',
  ndrRatePct: 'reseller.fraud_ndr_rate_percent',
  ordersPerHour: 'reseller.fraud_orders_per_hour',
  retailMarkupPct: 'reseller.fraud_retail_markup_percent',
  sharedPhoneStores: 'reseller.fraud_shared_phone_stores',
};

/** A failed delivery attempt — what an NDR is. */
const NDR_OUTCOMES: readonly DeliveryAttemptOutcome[] = [
  DeliveryAttemptOutcome.FAILED,
  DeliveryAttemptOutcome.REFUSED,
];

export interface FraudReport {
  readonly asOf: string;
  readonly windowFrom: string;
  readonly thresholds: FraudThresholds;
  readonly storesChecked: number;
  readonly flags: readonly FraudFlag[];
}

export interface DisputesOverview {
  readonly lookbackDays: number;
  readonly open: number;
  readonly settled: number;
  readonly byStatus: ReadonlyArray<{ readonly status: TicketStatus; readonly count: number }>;
  readonly byType: ReadonlyArray<{ readonly type: TicketType; readonly count: number }>;
  readonly byStore: ReadonlyArray<{
    readonly storeId: string;
    readonly storeName: string;
    readonly sellerName: string;
    readonly open: number;
    readonly total: number;
  }>;
  readonly openTickets: ReadonlyArray<{
    readonly id: string;
    readonly ticketNumber: string;
    readonly ticketType: TicketType;
    readonly status: TicketStatus;
    readonly subject: string;
    readonly orderId: string | null;
    readonly orderNumber: string;
    readonly storeId: string | null;
    readonly storeName: string;
    readonly sellerName: string;
    readonly createdAt: string;
  }>;
}

export interface FloatStoreRow {
  readonly storeId: string;
  readonly storeName: string;
  readonly status: ResellerStoreStatus | null;
  readonly balanceInr: string;
  readonly negativeLimitInr: string;
  /** Net ORDER_CREDIT on orders the courier has not paid for yet — money fronted. */
  readonly creditedBeforePayoutInr: string;
  readonly creditedBeforePayoutOrders: number;
}

export interface FloatSellerRow {
  readonly sellerId: string;
  readonly sellerName: string;
  readonly sellerWalletInr: string;
  readonly storesWalletInr: string;
  /** Seller + stores: what the bank book holds for the group is max(0, this) (TRE-8c). */
  readonly groupInr: string;
  /** WAL-9's Instant Pay advance, on this seller's RESELLER orders only. */
  readonly instantPayAdvanceInr: string;
  readonly instantPayAdvanceOrders: number;
  readonly stores: readonly FloatStoreRow[];
}

export interface ResellerFloat {
  readonly sellers: readonly FloatSellerRow[];
  readonly totals: {
    readonly storesWalletInr: string;
    readonly storesNegativeInr: string;
    readonly creditedBeforePayoutInr: string;
    readonly instantPayAdvanceInr: string;
  };
}

function isSettled(status: TicketStatus): boolean {
  return status === TicketStatus.REJECTED || status.startsWith('RESOLVED');
}

/**
 * Skydrop's view across every seller's reseller stores (RS-9): fraud
 * flags, the disputes on reseller orders, and the float — store balances,
 * money fronted before the courier paid, and Instant Pay advances — per
 * seller and store. Reads only; the one act (pausing a store) goes
 * through `ResellerStoreService`.
 */
@Injectable()
export class AdminResellerAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly instantPay: InstantPayAdvanceService,
  ) {}

  /** The global thresholds; an unreadable or missing one falls back to its default. */
  async thresholds(): Promise<FraudThresholds> {
    const rows = await this.prisma.client.systemSetting.findMany({
      where: { key: { in: Object.values(THRESHOLD_KEYS) } },
      select: { key: true, valueInt: true, valueDecimal: true },
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const read = (field: keyof FraudThresholds): number => {
      const r = byKey.get(THRESHOLD_KEYS[field]);
      const v =
        r?.valueInt ??
        (r?.valueDecimal === null || r?.valueDecimal === undefined ? null : Number(r.valueDecimal));
      return v !== null && Number.isFinite(v) && v > 0 ? v : DEFAULT_FRAUD_THRESHOLDS[field];
    };
    return {
      windowDays: read('windowDays'),
      minOrders: read('minOrders'),
      cancelRatePct: read('cancelRatePct'),
      returnRatePct: read('returnRatePct'),
      ndrRatePct: read('ndrRatePct'),
      ordersPerHour: read('ordersPerHour'),
      retailMarkupPct: read('retailMarkupPct'),
      sharedPhoneStores: read('sharedPhoneStores'),
    };
  }

  async fraud(now: Date = new Date()): Promise<FraudReport> {
    const db = this.prisma.client;
    const t = await this.thresholds();
    const since = new Date(now.getTime() - t.windowDays * DAY_MS);
    const facts = await loadOrderFacts(db, {
      storeKind: SellerStoreKind.RESELLER,
      createdAt: { gte: since, lt: now },
    });
    const storeIds = [...new Set(facts.map((f) => f.storeId))];
    const stores =
      storeIds.length === 0
        ? []
        : await db.sellerStore.findMany({
            where: { id: { in: storeIds } },
            select: {
              id: true,
              name: true,
              displayName: true,
              sellerId: true,
              seller: { select: { companyName: true } },
            },
          });

    // Failed delivery attempts, per order.
    const ndr = new Set<string>();
    for (const part of chunks(facts.filter((f) => f.dispatched).map((f) => f.id))) {
      const links = await db.orderShipment.findMany({
        where: { orderId: { in: part } },
        select: { orderId: true, shipmentId: true },
      });
      const orderOf = new Map(links.map((l) => [l.shipmentId, l.orderId]));
      if (links.length === 0) continue;
      const attempts = await db.deliveryAttempt.findMany({
        where: {
          shipmentId: { in: links.map((l) => l.shipmentId) },
          outcome: { in: [...NDR_OUTCOMES] },
        },
        select: { shipmentId: true },
      });
      for (const a of attempts) {
        const o = orderOf.get(a.shipmentId);
        if (o !== undefined) ndr.add(o);
      }
    }

    // Suggested retail in force per (store, variant): the store's override
    // row when it has one, else the seller's default (RS-3's per-ROW rule).
    const variantIds = [...new Set(facts.flatMap((f) => f.lines.map((l) => l.variantId)))];
    const sellerIds = [...new Set(facts.map((f) => f.sellerId))];
    const [overrides, defaults] = await Promise.all([
      variantIds.length === 0
        ? Promise.resolve([])
        : db.resellerStoreVariant.findMany({
            where: { storeId: { in: storeIds }, variantId: { in: variantIds } },
            select: {
              storeId: true,
              variantId: true,
              transferPriceInr: true,
              suggestedRetailInr: true,
            },
          }),
      variantIds.length === 0
        ? Promise.resolve([])
        : db.resellerPriceListItem.findMany({
            where: { sellerId: { in: sellerIds }, variantId: { in: variantIds } },
            select: { sellerId: true, variantId: true, suggestedRetailInr: true },
          }),
    ]);
    const override = new Map(overrides.map((o) => [`${o.storeId}|${o.variantId}`, o]));
    const dflt = new Map(
      defaults.map((d) => [`${d.sellerId}|${d.variantId}`, d.suggestedRetailInr]),
    );
    const suggested = (
      storeId: string,
      sellerId: string,
      variantId: string,
    ): Prisma.Decimal | null => {
      const o = override.get(`${storeId}|${variantId}`);
      if (o !== undefined && o.transferPriceInr !== null) return o.suggestedRetailInr;
      return dflt.get(`${sellerId}|${variantId}`) ?? null;
    };

    // One customer across many stores.
    const storesByPhone = new Map<string, Set<string>>();
    for (const f of facts) {
      const s = storesByPhone.get(f.phoneE164) ?? new Set<string>();
      s.add(f.storeId);
      storesByPhone.set(f.phoneE164, s);
    }

    const markupFactor = new Prisma.Decimal(1).add(new Prisma.Decimal(t.retailMarkupPct).div(100));
    const metrics: StoreFraudMetrics[] = stores.map((s) => {
      const mine = facts.filter((f) => f.storeId === s.id);
      const markupLines: MarkupLine[] = [];
      for (const f of mine) {
        for (const l of f.lines) {
          const sug = suggested(s.id, f.sellerId, l.variantId);
          if (sug === null || sug.lte(0) || l.retailInr === null) continue;
          if (l.retailInr.gt(sug.mul(markupFactor))) {
            markupLines.push({
              orderNumber: f.orderNumber,
              skuCode: l.skuCode,
              retailInr: l.retailInr,
              suggestedInr: sug,
            });
          }
        }
      }
      const phones = new Set(mine.map((f) => f.phoneE164));
      return {
        storeId: s.id,
        storeName: s.displayName ?? s.name,
        sellerId: s.sellerId,
        sellerName: s.seller.companyName,
        placed: mine.length,
        calledOff: mine.filter((f) => orderFate(f.status) === 'called_off').length,
        delivered: mine.filter((f) => f.status === OrderStatus.DELIVERED).length,
        returned: mine.filter((f) => orderFate(f.status) === 'returned').length,
        dispatched: mine.filter((f) => f.dispatched).length,
        ndrOrders: mine.filter((f) => f.dispatched && ndr.has(f.id)).length,
        maxOrdersInAnHour: maxInAnyHour(mine.map((f) => f.createdAt)),
        markupLines,
        sharedPhones: [...phones]
          .map((p) => ({ masked: maskPhone(p), stores: storesByPhone.get(p)?.size ?? 1 }))
          .filter((p) => p.stores > 1),
      };
    });
    return {
      asOf: now.toISOString(),
      windowFrom: since.toISOString(),
      thresholds: t,
      storesChecked: metrics.length,
      flags: evaluateFraud(metrics, t),
    };
  }

  /** Tickets on reseller orders — RS-7's disputes live in the one ticket queue. */
  async disputes(now: Date = new Date()): Promise<DisputesOverview> {
    const db = this.prisma.client;
    const orders = await db.order.findMany({
      where: {
        storeKind: SellerStoreKind.RESELLER,
        createdAt: { gte: new Date(now.getTime() - DISPUTE_LOOKBACK_DAYS * DAY_MS) },
      },
      select: { id: true, orderNumber: true, storeId: true },
    });
    const orderBy = new Map(orders.map((o) => [o.id, o]));
    const tickets: Array<{
      id: string;
      ticketNumber: string;
      ticketType: TicketType;
      status: TicketStatus;
      subject: string;
      orderId: string | null;
      createdAt: Date;
    }> = [];
    for (const part of chunks(orders.map((o) => o.id))) {
      tickets.push(
        ...(await db.ticket.findMany({
          where: { orderId: { in: part } },
          select: {
            id: true,
            ticketNumber: true,
            ticketType: true,
            status: true,
            subject: true,
            orderId: true,
            createdAt: true,
          },
        })),
      );
    }
    const storeIds = [...new Set(orders.map((o) => o.storeId))];
    const stores =
      storeIds.length === 0
        ? []
        : await db.sellerStore.findMany({
            where: { id: { in: storeIds } },
            select: {
              id: true,
              name: true,
              displayName: true,
              seller: { select: { companyName: true } },
            },
          });
    const storeBy = new Map(stores.map((s) => [s.id, s]));
    const count = <K extends string>(keys: K[]): Array<{ key: K; count: number }> => {
      const m = new Map<K, number>();
      for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
      return [...m].map(([key, n]) => ({ key, count: n })).sort((a, b) => b.count - a.count);
    };
    const perStore = new Map<string, { open: number; total: number }>();
    for (const t of tickets) {
      const o = t.orderId === null ? undefined : orderBy.get(t.orderId);
      if (o === undefined) continue;
      const p = perStore.get(o.storeId) ?? { open: 0, total: 0 };
      p.total += 1;
      if (!isSettled(t.status)) p.open += 1;
      perStore.set(o.storeId, p);
    }
    const open = tickets.filter((t) => !isSettled(t.status));
    return {
      lookbackDays: DISPUTE_LOOKBACK_DAYS,
      open: open.length,
      settled: tickets.length - open.length,
      byStatus: count(tickets.map((t) => t.status)).map((c) => ({ status: c.key, count: c.count })),
      byType: count(tickets.map((t) => t.ticketType)).map((c) => ({ type: c.key, count: c.count })),
      byStore: [...perStore]
        .map(([storeId, p]) => {
          const s = storeBy.get(storeId);
          return {
            storeId,
            storeName: s === undefined ? storeId : (s.displayName ?? s.name),
            sellerName: s?.seller.companyName ?? '',
            open: p.open,
            total: p.total,
          };
        })
        .sort((a, b) => b.open - a.open || b.total - a.total),
      openTickets: open
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 100)
        .map((t) => {
          const o = t.orderId === null ? undefined : orderBy.get(t.orderId);
          const s = o === undefined ? undefined : storeBy.get(o.storeId);
          return {
            id: t.id,
            ticketNumber: t.ticketNumber,
            ticketType: t.ticketType,
            status: t.status,
            subject: t.subject,
            orderId: t.orderId,
            orderNumber: o?.orderNumber ?? '',
            storeId: o?.storeId ?? null,
            storeName: s === undefined ? '' : (s.displayName ?? s.name),
            sellerName: s?.seller.companyName ?? '',
            createdAt: t.createdAt.toISOString(),
          };
        }),
    };
  }

  /** The float per seller and store, from the ledgers — nothing stored. */
  async float(): Promise<ResellerFloat> {
    const db = this.prisma.client;
    const stores = await db.sellerStore.findMany({
      where: { kind: SellerStoreKind.RESELLER },
      select: {
        id: true,
        name: true,
        displayName: true,
        status: true,
        sellerId: true,
        seller: { select: { companyName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const storeIds = stores.map((s) => s.id);
    const [settings, credits] = await Promise.all([
      storeIds.length === 0
        ? Promise.resolve([])
        : db.storeWalletSettings.findMany({
            where: { storeId: { in: storeIds } },
            select: { storeId: true, negativeLimitInr: true },
          }),
      storeIds.length === 0
        ? Promise.resolve([])
        : db.storeWalletEntry.groupBy({
            by: ['storeId', 'linkedOrderId', 'direction'],
            where: {
              storeId: { in: storeIds },
              linkedOrderId: { not: null },
              direction: {
                in: [
                  StoreWalletEntryDirection.ORDER_CREDIT,
                  StoreWalletEntryDirection.ORDER_CREDIT_REVERSAL,
                ],
              },
            },
            _sum: { amount: true },
          }),
    ]);
    const limitBy = new Map(settings.map((s) => [s.storeId, s.negativeLimitInr]));
    const netByOrder = new Map<string, { storeId: string; net: Prisma.Decimal }>();
    for (const c of credits) {
      if (c.linkedOrderId === null) continue;
      const amount = c._sum.amount ?? ZERO;
      const signed =
        c.direction === StoreWalletEntryDirection.ORDER_CREDIT ? amount : amount.negated();
      const prev = netByOrder.get(c.linkedOrderId);
      netByOrder.set(c.linkedOrderId, {
        storeId: c.storeId,
        net: (prev?.net ?? ZERO).add(signed),
      });
    }
    const paid = new Set<string>();
    for (const part of chunks([...netByOrder.keys()])) {
      const lines = await db.courierSettlementLine.findMany({
        where: { orderId: { in: part } },
        select: { orderId: true },
      });
      for (const l of lines) paid.add(l.orderId);
    }
    const fronted = new Map<string, { amount: Prisma.Decimal; orders: number }>();
    for (const [orderId, v] of netByOrder) {
      if (paid.has(orderId) || !v.net.gt(0)) continue;
      const f = fronted.get(v.storeId) ?? { amount: ZERO, orders: 0 };
      fronted.set(v.storeId, { amount: f.amount.add(v.net), orders: f.orders + 1 });
    }

    const bySeller = new Map<string, typeof stores>();
    for (const s of stores) bySeller.set(s.sellerId, [...(bySeller.get(s.sellerId) ?? []), s]);

    let storesTotal = ZERO;
    let storesNegative = ZERO;
    let frontedTotal = ZERO;
    let advanceTotal = ZERO;
    const sellers: FloatSellerRow[] = [];
    for (const [sellerId, mine] of bySeller) {
      const last = await db.sellerWalletEntry.findFirst({
        where: { sellerId, currency: Currency.INR },
        orderBy: { id: 'desc' },
        select: { runningBalanceAfter: true },
      });
      const sellerWallet = last?.runningBalanceAfter ?? ZERO;
      const rows: FloatStoreRow[] = [];
      let storeSum = ZERO;
      for (const s of mine) {
        const balance = await storeWalletBalance(db, s.id);
        storeSum = storeSum.add(balance);
        if (balance.lt(0)) storesNegative = storesNegative.add(balance);
        const f = fronted.get(s.id) ?? { amount: ZERO, orders: 0 };
        frontedTotal = frontedTotal.add(f.amount);
        rows.push({
          storeId: s.id,
          storeName: s.displayName ?? s.name,
          status: s.status,
          balanceInr: balance.toFixed(2),
          negativeLimitInr: (limitBy.get(s.id) ?? ZERO).toFixed(2),
          creditedBeforePayoutInr: f.amount.toFixed(2),
          creditedBeforePayoutOrders: f.orders,
        });
      }
      storesTotal = storesTotal.add(storeSum);
      // WAL-9's list, narrowed to this seller's reseller orders — never a
      // restatement of its predicate.
      const advance = await this.instantPay.report({ sellerId });
      const advanceIds = advance.rows.map((r) => r.orderId);
      const resellerIds = new Set<string>();
      for (const part of chunks(advanceIds)) {
        const rs = await db.order.findMany({
          where: { id: { in: part }, storeKind: SellerStoreKind.RESELLER },
          select: { id: true },
        });
        for (const r of rs) resellerIds.add(r.id);
      }
      const advRows = advance.rows.filter((r) => resellerIds.has(r.orderId));
      const advAmount = advRows.reduce((t, r) => t.add(r.netCreditedInr), ZERO);
      advanceTotal = advanceTotal.add(advAmount);
      sellers.push({
        sellerId,
        sellerName: mine[0]?.seller.companyName ?? sellerId,
        sellerWalletInr: sellerWallet.toFixed(2),
        storesWalletInr: storeSum.toFixed(2),
        groupInr: sellerWallet.add(storeSum).toFixed(2),
        instantPayAdvanceInr: advAmount.toFixed(2),
        instantPayAdvanceOrders: advRows.length,
        stores: rows,
      });
    }
    return {
      sellers: sellers.sort((a, b) => a.sellerName.localeCompare(b.sellerName)),
      totals: {
        storesWalletInr: storesTotal.toFixed(2),
        storesNegativeInr: storesNegative.toFixed(2),
        creditedBeforePayoutInr: frontedTotal.toFixed(2),
        instantPayAdvanceInr: advanceTotal.toFixed(2),
      },
    };
  }
}
