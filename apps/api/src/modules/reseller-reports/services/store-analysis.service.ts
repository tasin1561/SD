import { Injectable } from '@nestjs/common';
import {
  OrderStatus,
  PaymentMode,
  Prisma,
  ResellerCreditTrigger,
  SellerStoreKind,
  StoreExpenseCategory,
  StoreWalletEntryDirection,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  StoreWalletService,
  type StoreWalletSummary,
} from '../../reseller-store-wallet/services/store-wallet.service';
import { orderFate } from '../../treasury/services/pnl.service';
import { chunks, loadOrderFacts, type OrderFact } from './reseller-order-facts';
import { ratePct, scorecard, type Scorecard } from './reseller-scorecard';
import { expenseInstant } from './store-pnl-lines';

const ZERO = new Prisma.Decimal(0);
const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 330 * 60_000;
/** How far back the cash-flow forecast looks for orders still to be credited. */
const FORECAST_LOOKBACK_DAYS = 180;

/** The store's own rates — never the seller's margin (a store never sees the seller's cost). */
export type StoreOrderRates = Omit<
  Scorecard,
  'marginInr' | 'marginCoverage' | 'transferDeliveredInr' | 'retailDeliveredInr' | 'unitsDelivered'
>;

export interface StoreProductProfit {
  readonly variantId: string;
  readonly skuCode: string;
  readonly productName: string;
  readonly unitsDelivered: number;
  readonly unitsReturned: number;
  readonly returnRatePct: string | null;
  readonly retailInr: string;
  readonly transferInr: string;
  /** Retail − transfer on delivered units: the store's gross margin, before its fee shares. */
  readonly grossMarginInr: string;
}

export interface StorePincodeReturns {
  readonly postalCode: string;
  readonly delivered: number;
  readonly returned: number;
  readonly returnRatePct: string | null;
}

export interface StoreRoas {
  readonly adSpendInr: string;
  readonly deliveredOrders: number;
  readonly deliveredRetailInr: string;
  readonly deliveredMarginInr: string;
  /** Retail delivered ÷ ad spend. Null with no ad spend. */
  readonly roas: string | null;
  /** Margin delivered ÷ ad spend. */
  readonly marginRoas: string | null;
}

export interface StoreAnalysis {
  readonly from: string;
  readonly to: string;
  readonly rates: StoreOrderRates;
  readonly products: readonly StoreProductProfit[];
  readonly pincodes: readonly StorePincodeReturns[];
  readonly roas: StoreRoas;
}

export type CashFlowBucket =
  | 'DATED'
  | 'AFTER_CONFIRMATION'
  | 'ON_DELIVERY'
  | 'AFTER_DELIVERY'
  | 'ON_PAYOUT';

export interface CashFlowRow {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly trigger: ResellerCreditTrigger | null;
  readonly days: number | null;
  /** When the credit is due, when that is already known (IST date). */
  readonly expectedOn: string | null;
  readonly bucket: CashFlowBucket;
  readonly overdue: boolean;
  /** Retail − transfer, before the store's fee shares and COD tax share. */
  readonly expectedInr: string;
}

export interface StoreCashFlow {
  readonly asOf: string;
  readonly rows: readonly CashFlowRow[];
  /** Dated credits by the IST week they fall in (Monday). */
  readonly weeks: ReadonlyArray<{
    readonly weekStart: string;
    readonly amountInr: string;
    readonly count: number;
  }>;
  /** Credits whose date is not known yet, by what they wait on. */
  readonly waiting: ReadonlyArray<{
    readonly bucket: CashFlowBucket;
    readonly label: string;
    readonly amountInr: string;
    readonly count: number;
  }>;
  readonly totalInr: string;
}

export interface StorePosition {
  readonly balanceInr: string;
  /** What the store is owed (its positive balance). */
  readonly owedToStoreInr: string;
  /** What the store owes its seller (its negative balance). */
  readonly owedByStoreInr: string;
  readonly withdrawableInr: string | null;
  readonly pendingWithdrawals: StoreWalletSummary['pendingWithdrawals'];
  readonly pendingTopups: StoreWalletSummary['pendingTopups'];
  readonly negativeLimit: StoreWalletSummary['negativeLimit'];
  readonly walletManagedBy: StoreWalletSummary['walletManagedBy'];
}

const WAITING_LABELS: Record<Exclude<CashFlowBucket, 'DATED'>, string> = {
  AFTER_CONFIRMATION: 'Waiting for the order to be confirmed',
  ON_DELIVERY: 'Credited when the parcel is delivered',
  AFTER_DELIVERY: 'A set number of days after delivery',
  ON_PAYOUT: 'After the courier pays for the parcel',
};

function istDate(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The Monday (IST) of the week `d` falls in. */
export function istWeekStart(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const back = (ist.getUTCDay() + 6) % 7;
  return new Date(ist.getTime() - back * DAY_MS).toISOString().slice(0, 10);
}

/**
 * When a store's credit on an order falls due, from the order's OWN
 * snapshot of the terms (RS-5) and the dates the order has reached so far.
 * F2-exhaustive over the trigger, so a new one fails to compile until its
 * date is decided.
 */
export function creditDue(
  f: Pick<OrderFact, 'storeCreditTrigger' | 'storeCreditDays' | 'confirmedAt' | 'deliveredAt'>,
): { bucket: CashFlowBucket; at: Date | null } {
  const days = f.storeCreditDays ?? 0;
  const t = f.storeCreditTrigger;
  if (t === null) return { bucket: 'ON_PAYOUT', at: null };
  switch (t) {
    case ResellerCreditTrigger.AFTER_CONFIRMATION:
      return f.confirmedAt === null
        ? { bucket: 'AFTER_CONFIRMATION', at: null }
        : { bucket: 'DATED', at: new Date(f.confirmedAt.getTime() + days * DAY_MS) };
    case ResellerCreditTrigger.INSTANT:
      return f.deliveredAt === null
        ? { bucket: 'ON_DELIVERY', at: null }
        : { bucket: 'DATED', at: f.deliveredAt };
    case ResellerCreditTrigger.AFTER_DELIVERY:
      return f.deliveredAt === null
        ? { bucket: 'AFTER_DELIVERY', at: null }
        : { bucket: 'DATED', at: new Date(f.deliveredAt.getTime() + days * DAY_MS) };
    case ResellerCreditTrigger.ON_PAYOUT:
      return { bucket: 'ON_PAYOUT', at: null };
    default: {
      const never: never = t;
      return never;
    }
  }
}

/**
 * A reseller store's own analysis (RS-9): profit per product, returns by
 * pincode, its confirmation and cancel rates, return on ad spend, a
 * cash-flow forecast, and where its wallet stands.
 *
 * Every query is scoped by the store id the caller passes — the TOKEN's,
 * from the controller. Nothing here reads the seller's cost or another
 * store's orders.
 */
@Injectable()
export class StoreAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: StoreWalletService,
  ) {}

  async position(storeId: string): Promise<StorePosition> {
    const s = await this.wallet.summary({ storeId });
    const balance = new Prisma.Decimal(s.balanceInr);
    return {
      balanceInr: s.balanceInr,
      owedToStoreInr: (balance.gt(0) ? balance : ZERO).toFixed(2),
      owedByStoreInr: (balance.lt(0) ? balance.negated() : ZERO).toFixed(2),
      withdrawableInr: s.withdrawableInr,
      pendingWithdrawals: s.pendingWithdrawals,
      pendingTopups: s.pendingTopups,
      negativeLimit: s.negativeLimit,
      walletManagedBy: s.walletManagedBy,
    };
  }

  async analysis(storeId: string, window: { from: Date; to: Date }): Promise<StoreAnalysis> {
    const db = this.prisma.client;
    const cohort = await loadOrderFacts(db, {
      storeId,
      storeKind: SellerStoreKind.RESELLER,
      createdAt: { gte: window.from, lt: window.to },
    });
    const card = scorecard(
      cohort.map((f) => ({
        status: f.status,
        everConfirmed: f.everConfirmed,
        lines: f.lines.map((l) => ({
          quantity: l.quantity,
          transferInr: l.transferInr,
          retailInr: l.retailInr,
          unitCostInr: null,
        })),
      })),
    );
    const rates: StoreOrderRates = {
      placed: card.placed,
      confirmed: card.confirmed,
      decided: card.decided,
      confirmationRatePct: card.confirmationRatePct,
      calledOff: card.calledOff,
      cancelRatePct: card.cancelRatePct,
      delivered: card.delivered,
      returned: card.returned,
      lost: card.lost,
      deliveryRatePct: card.deliveryRatePct,
      returnRatePct: card.returnRatePct,
      open: card.open,
    };

    // ── Profit per product (delivered units; returned units beside them) ──
    const products = new Map<
      string,
      {
        skuCode: string;
        productName: string;
        delivered: number;
        returned: number;
        retail: Prisma.Decimal;
        transfer: Prisma.Decimal;
      }
    >();
    for (const f of cohort) {
      const fate = orderFate(f.status);
      const delivered = f.status === OrderStatus.DELIVERED;
      if (!delivered && fate !== 'returned') continue;
      for (const l of f.lines) {
        const p = products.get(l.variantId) ?? {
          skuCode: l.skuCode,
          productName: l.productName,
          delivered: 0,
          returned: 0,
          retail: ZERO,
          transfer: ZERO,
        };
        if (delivered) {
          p.delivered += l.quantity;
          p.retail = p.retail.add((l.retailInr ?? ZERO).mul(l.quantity));
          p.transfer = p.transfer.add((l.transferInr ?? ZERO).mul(l.quantity));
        } else {
          p.returned += l.quantity;
        }
        products.set(l.variantId, p);
      }
    }

    // ── Returns by pincode ──
    const pins = new Map<string, { delivered: number; returned: number }>();
    for (const f of cohort) {
      const fate = orderFate(f.status);
      if (f.status !== OrderStatus.DELIVERED && fate !== 'returned') continue;
      const p = pins.get(f.postalCode) ?? { delivered: 0, returned: 0 };
      if (f.status === OrderStatus.DELIVERED) p.delivered += 1;
      else p.returned += 1;
      pins.set(f.postalCode, p);
    }

    return {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      rates,
      products: [...products]
        .map(([variantId, p]) => ({
          variantId,
          skuCode: p.skuCode,
          productName: p.productName,
          unitsDelivered: p.delivered,
          unitsReturned: p.returned,
          returnRatePct: ratePct(p.returned, p.delivered + p.returned),
          retailInr: p.retail.toFixed(2),
          transferInr: p.transfer.toFixed(2),
          grossMarginInr: p.retail.sub(p.transfer).toFixed(2),
        }))
        .sort((a, b) => new Prisma.Decimal(b.grossMarginInr).cmp(a.grossMarginInr)),
      pincodes: [...pins]
        .map(([postalCode, p]) => ({
          postalCode,
          delivered: p.delivered,
          returned: p.returned,
          returnRatePct: ratePct(p.returned, p.delivered + p.returned),
        }))
        .sort(
          (a, b) =>
            b.returned - a.returned ||
            b.delivered + b.returned - (a.delivered + a.returned) ||
            a.postalCode.localeCompare(b.postalCode),
        )
        .slice(0, 50),
      roas: await this.roas(storeId, window),
    };
  }

  /** Delivered retail in the window ÷ ad spend dated in it. */
  private async roas(storeId: string, window: { from: Date; to: Date }): Promise<StoreRoas> {
    const db = this.prisma.client;
    const lo = new Date(window.from.getTime() - 2 * DAY_MS);
    const hi = new Date(window.to.getTime() + 2 * DAY_MS);
    const [ads, delivered] = await Promise.all([
      db.storeExpense.findMany({
        where: {
          storeId,
          category: StoreExpenseCategory.AD_SPEND,
          deletedAt: null,
          expenseDate: { gte: lo, lt: hi },
        },
        select: { amountInr: true, expenseDate: true },
      }),
      loadOrderFacts(db, {
        storeId,
        storeKind: SellerStoreKind.RESELLER,
        status: OrderStatus.DELIVERED,
        events: {
          some: {
            toStatus: OrderStatus.DELIVERED,
            createdAt: { gte: window.from, lt: window.to },
          },
        },
      }),
    ]);
    const spend = ads
      .filter((a) => {
        const at = expenseInstant(a.expenseDate);
        return at >= window.from && at < window.to;
      })
      .reduce((t, a) => t.add(a.amountInr), ZERO);
    // Dated by the FIRST delivery, exactly as the scorecard dates it.
    const inWindow = delivered.filter(
      (f) => f.deliveredAt !== null && f.deliveredAt >= window.from && f.deliveredAt < window.to,
    );
    const retail = inWindow.reduce((t, f) => t.add(f.retailInr), ZERO);
    const margin = inWindow.reduce((t, f) => t.add(f.retailInr.sub(f.transferInr)), ZERO);
    return {
      adSpendInr: spend.toFixed(2),
      deliveredOrders: inWindow.length,
      deliveredRetailInr: retail.toFixed(2),
      deliveredMarginInr: margin.toFixed(2),
      roas: spend.isZero() ? null : retail.div(spend).toFixed(2),
      marginRoas: spend.isZero() ? null : margin.div(spend).toFixed(2),
    };
  }

  /**
   * What the store expects to be credited, and when. From its COD orders
   * still in flight (or delivered) that no ORDER_CREDIT has reached yet —
   * a credit that was posted and taken back counts as not posted. The
   * amount is the order's retail − transfer as placed; the fee shares and
   * COD tax share come off when the credit is written, and are not
   * guessed here.
   */
  async cashFlow(storeId: string, now: Date = new Date()): Promise<StoreCashFlow> {
    const db = this.prisma.client;
    const facts = (
      await loadOrderFacts(db, {
        storeId,
        storeKind: SellerStoreKind.RESELLER,
        paymentMode: PaymentMode.COD,
        createdAt: { gte: new Date(now.getTime() - FORECAST_LOOKBACK_DAYS * DAY_MS) },
      })
    ).filter((f) => {
      const fate = orderFate(f.status);
      return fate === 'open' || f.status === OrderStatus.DELIVERED;
    });
    const credited = new Map<string, number>();
    for (const part of chunks(facts.map((f) => f.id))) {
      const counts = await db.storeWalletEntry.groupBy({
        by: ['linkedOrderId', 'direction'],
        where: {
          storeId,
          linkedOrderId: { in: part },
          direction: {
            in: [
              StoreWalletEntryDirection.ORDER_CREDIT,
              StoreWalletEntryDirection.ORDER_CREDIT_REVERSAL,
            ],
          },
        },
        _count: { _all: true },
      });
      for (const c of counts) {
        if (c.linkedOrderId === null) continue;
        const sign = c.direction === StoreWalletEntryDirection.ORDER_CREDIT ? 1 : -1;
        credited.set(c.linkedOrderId, (credited.get(c.linkedOrderId) ?? 0) + sign * c._count._all);
      }
    }

    const today = istDate(now);
    const rows: CashFlowRow[] = facts
      .filter((f) => (credited.get(f.id) ?? 0) <= 0)
      .map((f) => {
        const due = creditDue(f);
        const expectedOn = due.at === null ? null : istDate(due.at);
        return {
          orderId: f.id,
          orderNumber: f.orderNumber,
          status: f.status,
          trigger: f.storeCreditTrigger,
          days: f.storeCreditDays,
          expectedOn,
          bucket: due.bucket,
          overdue: expectedOn !== null && expectedOn < today,
          expectedInr: f.retailInr.sub(f.transferInr).toFixed(2),
        };
      })
      .sort(
        (a, b) =>
          (a.expectedOn ?? '9999').localeCompare(b.expectedOn ?? '9999') ||
          a.orderNumber.localeCompare(b.orderNumber),
      );

    const weeks = new Map<string, { amount: Prisma.Decimal; count: number }>();
    const waiting = new Map<
      Exclude<CashFlowBucket, 'DATED'>,
      { amount: Prisma.Decimal; count: number }
    >();
    for (const r of rows) {
      if (r.bucket === 'DATED' && r.expectedOn !== null) {
        const key = istWeekStart(new Date(`${r.expectedOn}T00:00:00.000+05:30`));
        const w = weeks.get(key) ?? { amount: ZERO, count: 0 };
        weeks.set(key, { amount: w.amount.add(r.expectedInr), count: w.count + 1 });
      } else if (r.bucket !== 'DATED') {
        const w = waiting.get(r.bucket) ?? { amount: ZERO, count: 0 };
        waiting.set(r.bucket, { amount: w.amount.add(r.expectedInr), count: w.count + 1 });
      }
    }
    return {
      asOf: now.toISOString(),
      rows,
      weeks: [...weeks]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([weekStart, w]) => ({ weekStart, amountInr: w.amount.toFixed(2), count: w.count })),
      waiting: [...waiting].map(([bucket, w]) => ({
        bucket,
        label: WAITING_LABELS[bucket],
        amountInr: w.amount.toFixed(2),
        count: w.count,
      })),
      totalInr: rows.reduce((t, r) => t.add(r.expectedInr), ZERO).toFixed(2),
    };
  }
}
