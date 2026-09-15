import { Injectable } from '@nestjs/common';
import {
  OrderStatus,
  Prisma,
  ResellerStoreStatus,
  SellerStoreKind,
  WalletEntryDirection,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import { StockReadService } from '../../inventory-stock/services/stock-read.service';
import { isSellerWalletCredit } from '../../seller-wallet/services/wallet.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { storeWalletBalance } from '../../treasury/services/store-wallet-balances';
import { orderFate } from '../../treasury/services/pnl.service';
import { chunks, loadOrderFacts, loadUnitCosts } from './reseller-order-facts';
import { scorecard, type Scorecard } from './reseller-scorecard';

const ZERO = new Prisma.Decimal(0);
const DAY_MS = 24 * 60 * 60 * 1000;

export interface AutoPauseRuleView {
  readonly storeId: string;
  readonly enabled: boolean;
  readonly returnRatePercent: string;
  readonly minDecidedOrders: number;
  readonly windowDays: number;
  readonly lastEvaluatedAt: string | null;
  readonly lastPausedAt: string | null;
}

export interface StoreScoreRow {
  readonly storeId: string;
  readonly name: string;
  readonly displayName: string | null;
  readonly status: ResellerStoreStatus | null;
  /** The store wallet's balance now — a seller sees it, never the store's expenses or P&L. */
  readonly balanceInr: string;
  readonly scorecard: Scorecard;
  /** Credits − debits on the SELLER's wallet from this cohort's orders (the ledger, by direction). */
  readonly sellerNetInr: string;
  /** The seller's cost of the delivered units whose cost is known. */
  readonly costOfGoodsInr: string;
  /** sellerNet − cost of goods (where known). */
  readonly profitInr: string;
  readonly autoPause: AutoPauseRuleView | null;
}

export interface SellerScorecards {
  readonly from: string;
  readonly to: string;
  readonly stores: readonly StoreScoreRow[];
  readonly ranking: ReadonlyArray<{
    readonly rank: number;
    readonly storeId: string;
    readonly name: string;
    readonly profitInr: string;
    readonly costCoverage: Scorecard['marginCoverage'];
  }>;
}

export interface TransferRevenueRow {
  /** The seller wallet entry — the stable id. */
  readonly id: string;
  readonly orderNumber: string;
  readonly direction: WalletEntryDirection;
  readonly at: string;
  /** Signed: a credit adds, a debit takes away. */
  readonly amountInr: string;
}

export interface TransferRevenueStore {
  readonly storeId: string;
  readonly name: string;
  readonly creditsInr: string;
  readonly debitsInr: string;
  readonly netInr: string;
  readonly rows: readonly TransferRevenueRow[];
}

export interface TransferRevenueReport {
  readonly from: string;
  readonly to: string;
  readonly stores: readonly TransferRevenueStore[];
  readonly totals: {
    readonly creditsInr: string;
    readonly debitsInr: string;
    readonly netInr: string;
  };
  /** Snapshot figure beside it: transfer value of this seller's reseller orders DELIVERED in the window. */
  readonly deliveredTransfer: ReadonlyArray<{
    readonly storeId: string;
    readonly name: string;
    readonly orders: number;
    readonly transferInr: string;
  }>;
}

export interface StockForecastRow {
  readonly variantId: string;
  readonly skuCode: string;
  readonly label: string | null;
  readonly onHand: number;
  readonly available: number;
  readonly unitsSold: number;
  readonly dailyRate: string;
  /** Null when it has not sold in the window — it is not running out. */
  readonly daysOfStock: string | null;
  readonly reorder: boolean;
}

export interface StockForecast {
  readonly asOf: string;
  readonly windowDays: number;
  readonly reorderDays: number;
  readonly rows: readonly StockForecastRow[];
}

function storeName(s: { name: string; displayName: string | null }): string {
  return s.displayName ?? s.name;
}

/**
 * The SELLER's view of their reseller stores (RS-8 / RS-9): each store's
 * scorecard and balance, stores ranked by the profit they made the
 * seller, the transfer revenue each brought in (from the seller's own
 * wallet ledger, by direction), and how long the stock they sell lasts.
 *
 * Never a store's expenses, P&L or customers: those are the store's.
 * Every query carries the seller id from the TOKEN.
 */
@Injectable()
export class SellerResellerAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockReadService,
    private readonly catalog: CatalogReadService,
    private readonly settings: SettingsResolverService,
  ) {}

  private stores(
    sellerId: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      displayName: string | null;
      status: ResellerStoreStatus | null;
    }>
  > {
    return this.prisma.client.sellerStore.findMany({
      where: { sellerId, kind: SellerStoreKind.RESELLER, deletedAt: null },
      select: { id: true, name: true, displayName: true, status: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Signed net of the seller's wallet entries per order, read by direction. */
  private async sellerNetByOrder(
    sellerId: string,
    orderIds: readonly string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    const out = new Map<string, Prisma.Decimal>();
    for (const part of chunks(orderIds)) {
      const rows = await this.prisma.client.sellerWalletEntry.groupBy({
        by: ['linkedOrderId', 'direction'],
        where: { sellerId, linkedOrderId: { in: part } },
        _sum: { amount: true },
      });
      for (const r of rows) {
        if (r.linkedOrderId === null) continue;
        const amount = r._sum.amount ?? ZERO;
        const signed = isSellerWalletCredit(r.direction) ? amount : amount.negated();
        out.set(r.linkedOrderId, (out.get(r.linkedOrderId) ?? ZERO).add(signed));
      }
    }
    return out;
  }

  async scorecards(sellerId: string, window: { from: Date; to: Date }): Promise<SellerScorecards> {
    const db = this.prisma.client;
    const [stores, facts] = await Promise.all([
      this.stores(sellerId),
      loadOrderFacts(db, {
        sellerId,
        storeKind: SellerStoreKind.RESELLER,
        createdAt: { gte: window.from, lt: window.to },
      }),
    ]);
    const costOf = await loadUnitCosts(
      db,
      sellerId,
      facts.flatMap((f) => f.lines),
    );
    const net = await this.sellerNetByOrder(
      sellerId,
      facts.map((f) => f.id),
    );
    const rules = await db.resellerStoreAutoPause.findMany({
      where: { storeId: { in: stores.map((s) => s.id) } },
    });
    const ruleBy = new Map(rules.map((r) => [r.storeId, r]));

    const rows: StoreScoreRow[] = [];
    for (const s of stores) {
      const mine = facts.filter((f) => f.storeId === s.id);
      const card = scorecard(
        mine.map((f) => ({
          status: f.status,
          everConfirmed: f.everConfirmed,
          lines: f.lines.map((l) => ({
            quantity: l.quantity,
            transferInr: l.transferInr,
            retailInr: l.retailInr,
            unitCostInr: costOf(l),
          })),
        })),
      );
      let cogs = ZERO;
      for (const f of mine) {
        if (f.status !== OrderStatus.DELIVERED) continue;
        for (const l of f.lines) {
          const c = costOf(l);
          if (c !== null) cogs = cogs.add(c.mul(l.quantity));
        }
      }
      const sellerNet = mine.reduce((t, f) => t.add(net.get(f.id) ?? ZERO), ZERO);
      const rule = ruleBy.get(s.id);
      rows.push({
        storeId: s.id,
        name: storeName(s),
        displayName: s.displayName,
        status: s.status,
        balanceInr: (await storeWalletBalance(db, s.id)).toFixed(2),
        scorecard: card,
        sellerNetInr: sellerNet.toFixed(2),
        costOfGoodsInr: cogs.toFixed(2),
        profitInr: sellerNet.sub(cogs).toFixed(2),
        autoPause:
          rule === undefined
            ? null
            : {
                storeId: rule.storeId,
                enabled: rule.enabled,
                returnRatePercent: rule.returnRatePercent.toFixed(2),
                minDecidedOrders: rule.minDecidedOrders,
                windowDays: rule.windowDays,
                lastEvaluatedAt: rule.lastEvaluatedAt?.toISOString() ?? null,
                lastPausedAt: rule.lastPausedAt?.toISOString() ?? null,
              },
      });
    }
    const ranking = [...rows]
      .sort(
        (a, b) => new Prisma.Decimal(b.profitInr).cmp(a.profitInr) || a.name.localeCompare(b.name),
      )
      .map((r, i) => ({
        rank: i + 1,
        storeId: r.storeId,
        name: r.name,
        profitInr: r.profitInr,
        costCoverage: r.scorecard.marginCoverage,
      }));
    return { from: window.from.toISOString(), to: window.to.toISOString(), stores: rows, ranking };
  }

  /**
   * What each store brought in on the SELLER's wallet in the window:
   * every seller wallet entry naming one of the store's orders, dated by
   * when it was written, signed by its direction (the one credit set the
   * wallet signs with). Each store's net is the sum of its rows, and two
   * adjacent windows add up to the window over both.
   */
  async transferRevenue(
    sellerId: string,
    window: { from: Date; to: Date },
  ): Promise<TransferRevenueReport> {
    const db = this.prisma.client;
    const [stores, entries] = await Promise.all([
      this.stores(sellerId),
      db.sellerWalletEntry.findMany({
        where: {
          sellerId,
          createdAt: { gte: window.from, lt: window.to },
          linkedOrderId: { not: null },
        },
        select: { id: true, direction: true, amount: true, linkedOrderId: true, createdAt: true },
        orderBy: { id: 'asc' },
      }),
    ]);
    const orderIds = [
      ...new Set(entries.map((e) => e.linkedOrderId).filter((x): x is string => x !== null)),
    ];
    const orders = new Map<string, { orderNumber: string; storeId: string }>();
    for (const part of chunks(orderIds)) {
      const rows = await db.order.findMany({
        where: { id: { in: part }, sellerId, storeKind: SellerStoreKind.RESELLER },
        select: { id: true, orderNumber: true, storeId: true },
      });
      for (const r of rows) orders.set(r.id, { orderNumber: r.orderNumber, storeId: r.storeId });
    }
    const byStore = new Map<string, TransferRevenueRow[]>();
    for (const e of entries) {
      const o = e.linkedOrderId === null ? undefined : orders.get(e.linkedOrderId);
      if (o === undefined) continue; // a channel order: not a store's revenue
      const signed = isSellerWalletCredit(e.direction) ? e.amount : e.amount.negated();
      const list = byStore.get(o.storeId) ?? [];
      list.push({
        id: e.id,
        orderNumber: o.orderNumber,
        direction: e.direction,
        at: e.createdAt.toISOString(),
        amountInr: signed.toFixed(2),
      });
      byStore.set(o.storeId, list);
    }
    let credits = ZERO;
    let debits = ZERO;
    const out: TransferRevenueStore[] = stores.map((s) => {
      const rows = byStore.get(s.id) ?? [];
      const c = rows
        .filter((r) => !r.amountInr.startsWith('-'))
        .reduce((t, r) => t.add(r.amountInr), ZERO);
      const d = rows
        .filter((r) => r.amountInr.startsWith('-'))
        .reduce((t, r) => t.add(new Prisma.Decimal(r.amountInr).negated()), ZERO);
      credits = credits.add(c);
      debits = debits.add(d);
      return {
        storeId: s.id,
        name: storeName(s),
        creditsInr: c.toFixed(2),
        debitsInr: d.toFixed(2),
        netInr: c.sub(d).toFixed(2),
        rows,
      };
    });

    const delivered = await loadOrderFacts(db, {
      sellerId,
      storeKind: SellerStoreKind.RESELLER,
      status: OrderStatus.DELIVERED,
      events: {
        some: { toStatus: OrderStatus.DELIVERED, createdAt: { gte: window.from, lt: window.to } },
      },
    });
    return {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      stores: out,
      totals: {
        creditsInr: credits.toFixed(2),
        debitsInr: debits.toFixed(2),
        netInr: credits.sub(debits).toFixed(2),
      },
      deliveredTransfer: stores.map((s) => {
        const mine = delivered.filter(
          (f) =>
            f.storeId === s.id &&
            f.deliveredAt !== null &&
            f.deliveredAt >= window.from &&
            f.deliveredAt < window.to,
        );
        return {
          storeId: s.id,
          name: storeName(s),
          orders: mine.length,
          transferInr: mine.reduce((t, f) => t.add(f.transferInr), ZERO).toFixed(2),
        };
      }),
    };
  }

  private async intSetting(sellerId: string, key: string, fallback: number): Promise<number> {
    try {
      const r = await this.settings.resolve(sellerId, key);
      return typeof r.value === 'number' && Number.isFinite(r.value) && r.value > 0
        ? r.value
        : fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * How long the stock the seller's reseller stores sell will last, at the
   * rate it sold over the last N days (every confirmed order of the
   * variant — a channel order eats the same stock), against what is
   * sellable now (INV-3, through `StockReadService`).
   */
  async stockForecast(sellerId: string, now: Date = new Date()): Promise<StockForecast> {
    const db = this.prisma.client;
    const [windowDays, reorderDays] = await Promise.all([
      this.intSetting(sellerId, 'reseller.stock_forecast_window_days', 30),
      this.intSetting(sellerId, 'reseller.stock_reorder_days', 14),
    ]);
    const live = await db.sellerStore.findMany({
      where: {
        sellerId,
        kind: SellerStoreKind.RESELLER,
        deletedAt: null,
        status: {
          in: [
            ResellerStoreStatus.ACTIVE,
            ResellerStoreStatus.PAUSED,
            ResellerStoreStatus.PENDING_SELLER_APPROVAL,
          ],
        },
      },
      select: { id: true },
    });
    const enabled =
      live.length === 0
        ? []
        : await db.resellerStoreVariant.findMany({
            where: { storeId: { in: live.map((s) => s.id) }, enabled: true },
            select: { variantId: true },
          });
    const variantIds = [...new Set(enabled.map((v) => v.variantId))];
    if (variantIds.length === 0) {
      return { asOf: now.toISOString(), windowDays, reorderDays, rows: [] };
    }
    const since = new Date(now.getTime() - windowDays * DAY_MS);
    const confirmed = (
      await db.order.findMany({
        where: { sellerId, confirmedAt: { gte: since } },
        select: { id: true, status: true },
      })
    ).filter((o) => orderFate(o.status) !== 'called_off');
    const sold = new Map<string, number>();
    for (const part of chunks(confirmed.map((o) => o.id))) {
      const items = await db.orderItem.findMany({
        where: { orderId: { in: part }, variantId: { in: variantIds } },
        select: { variantId: true, quantity: true },
      });
      for (const i of items) sold.set(i.variantId, (sold.get(i.variantId) ?? 0) + i.quantity);
    }
    const [stock, variants] = await Promise.all([
      this.stock.getSellableStockLive(sellerId, variantIds),
      this.catalog.getVariantsByIds([...variantIds]),
    ]);
    const rows: StockForecastRow[] = variantIds.map((id) => {
      const s = stock.get(id) ?? { onHand: 0, available: 0 };
      const units = sold.get(id) ?? 0;
      const rate = units / windowDays;
      const days = rate === 0 ? null : s.available / rate;
      const v = variants.get(id);
      return {
        variantId: id,
        skuCode: v?.skuCode ?? id,
        label: v?.variantLabel ?? null,
        onHand: s.onHand,
        available: s.available,
        unitsSold: units,
        dailyRate: rate.toFixed(2),
        daysOfStock: days === null ? null : days.toFixed(1),
        reorder: days !== null && days < reorderDays,
      };
    });
    rows.sort(
      (a, b) =>
        (a.daysOfStock === null ? Infinity : Number(a.daysOfStock)) -
          (b.daysOfStock === null ? Infinity : Number(b.daysOfStock)) ||
        a.skuCode.localeCompare(b.skuCode),
    );
    return { asOf: now.toISOString(), windowDays, reorderDays, rows };
  }
}
