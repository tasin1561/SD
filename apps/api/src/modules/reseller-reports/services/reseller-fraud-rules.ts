import type { Prisma } from '@skydrop/db';

/**
 * Fraud SIGNALS on reseller stores (RS-9), with no database in it.
 *
 * A flag is a threshold CROSSED, with its reason in words — never a
 * verdict. The same pure function builds the list staff read and the
 * sweep that raises system issues, so what is listed and what is raised
 * cannot disagree. Every threshold is a global setting (`reseller.fraud_*`).
 *
 * Severity: MEDIUM when a threshold is crossed, HIGH at twice it (a rate
 * is capped at 100%, so a threshold above 50% can only ever be MEDIUM).
 */

export type FraudRule =
  | 'CANCEL_RATE'
  | 'RETURN_RATE'
  | 'NDR_RATE'
  | 'RAPID_ORDERS'
  | 'RETAIL_MARKUP'
  | 'SHARED_CUSTOMER';

export interface FraudThresholds {
  readonly windowDays: number;
  readonly minOrders: number;
  readonly cancelRatePct: number;
  readonly returnRatePct: number;
  readonly ndrRatePct: number;
  readonly ordersPerHour: number;
  readonly retailMarkupPct: number;
  readonly sharedPhoneStores: number;
}

export const DEFAULT_FRAUD_THRESHOLDS: FraudThresholds = {
  windowDays: 30,
  minOrders: 10,
  cancelRatePct: 40,
  returnRatePct: 40,
  ndrRatePct: 50,
  ordersPerHour: 30,
  retailMarkupPct: 100,
  sharedPhoneStores: 3,
};

export interface MarkupLine {
  readonly orderNumber: string;
  readonly skuCode: string;
  readonly retailInr: Prisma.Decimal;
  readonly suggestedInr: Prisma.Decimal;
}

export interface StoreFraudMetrics {
  readonly storeId: string;
  readonly storeName: string;
  readonly sellerId: string;
  readonly sellerName: string;
  readonly placed: number;
  readonly calledOff: number;
  readonly delivered: number;
  readonly returned: number;
  /** Orders that reached a courier (dispatched ever, or delivered / returned). */
  readonly dispatched: number;
  /** Dispatched orders with at least one failed delivery attempt. */
  readonly ndrOrders: number;
  readonly maxOrdersInAnHour: number;
  readonly markupLines: readonly MarkupLine[];
  /** Customer phones this store shares with other reseller stores: masked, and how many stores. */
  readonly sharedPhones: ReadonlyArray<{ readonly masked: string; readonly stores: number }>;
}

export interface FraudFlag {
  readonly rule: FraudRule;
  readonly storeId: string;
  readonly storeName: string;
  readonly sellerId: string;
  readonly sellerName: string;
  readonly severity: 'MEDIUM' | 'HIGH';
  readonly value: string;
  readonly threshold: string;
  readonly reason: string;
}

/** The last four digits only — a flag names a pattern, never a person. */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  return `••••${digits.slice(-4)}`;
}

/** The most timestamps inside any one hour (a sliding window, inclusive of the start). */
export function maxInAnyHour(times: readonly Date[]): number {
  const t = times.map((d) => d.getTime()).sort((a, b) => a - b);
  let best = 0;
  let lo = 0;
  for (let hi = 0; hi < t.length; hi++) {
    while ((t[hi] ?? 0) - (t[lo] ?? 0) >= 60 * 60 * 1000) lo += 1;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}

function pct(n: number, d: number): number {
  return d === 0 ? 0 : (n / d) * 100;
}

function severity(value: number, threshold: number): 'MEDIUM' | 'HIGH' {
  return value >= threshold * 2 ? 'HIGH' : 'MEDIUM';
}

export function evaluateFraud(
  metrics: readonly StoreFraudMetrics[],
  t: FraudThresholds,
): FraudFlag[] {
  const out: FraudFlag[] = [];
  for (const m of metrics) {
    const base = {
      storeId: m.storeId,
      storeName: m.storeName,
      sellerId: m.sellerId,
      sellerName: m.sellerName,
    };
    const within = `in the last ${t.windowDays} days`;

    if (m.placed >= t.minOrders) {
      const rate = pct(m.calledOff, m.placed);
      if (rate >= t.cancelRatePct) {
        out.push({
          ...base,
          rule: 'CANCEL_RATE',
          severity: severity(rate, t.cancelRatePct),
          value: `${rate.toFixed(1)}%`,
          threshold: `${t.cancelRatePct}%`,
          reason: `${m.calledOff} of ${m.placed} orders placed ${within} were cancelled or rejected (${rate.toFixed(1)}%, threshold ${t.cancelRatePct}%).`,
        });
      }
    }
    const outcomes = m.delivered + m.returned;
    if (outcomes >= t.minOrders) {
      const rate = pct(m.returned, outcomes);
      if (rate >= t.returnRatePct) {
        out.push({
          ...base,
          rule: 'RETURN_RATE',
          severity: severity(rate, t.returnRatePct),
          value: `${rate.toFixed(1)}%`,
          threshold: `${t.returnRatePct}%`,
          reason: `${m.returned} of ${outcomes} parcels with a known outcome came back (${rate.toFixed(1)}%, threshold ${t.returnRatePct}%).`,
        });
      }
    }
    if (m.dispatched >= t.minOrders) {
      const rate = pct(m.ndrOrders, m.dispatched);
      if (rate >= t.ndrRatePct) {
        out.push({
          ...base,
          rule: 'NDR_RATE',
          severity: severity(rate, t.ndrRatePct),
          value: `${rate.toFixed(1)}%`,
          threshold: `${t.ndrRatePct}%`,
          reason: `${m.ndrOrders} of ${m.dispatched} dispatched parcels had a failed delivery attempt (${rate.toFixed(1)}%, threshold ${t.ndrRatePct}%).`,
        });
      }
    }
    if (m.maxOrdersInAnHour >= t.ordersPerHour) {
      out.push({
        ...base,
        rule: 'RAPID_ORDERS',
        severity: severity(m.maxOrdersInAnHour, t.ordersPerHour),
        value: String(m.maxOrdersInAnHour),
        threshold: String(t.ordersPerHour),
        reason: `${m.maxOrdersInAnHour} orders were placed inside one hour ${within} (threshold ${t.ordersPerHour}).`,
      });
    }
    if (m.markupLines.length > 0) {
      const worst = m.markupLines.reduce((a, b) =>
        b.retailInr.div(b.suggestedInr).gt(a.retailInr.div(a.suggestedInr)) ? b : a,
      );
      const worstPct = worst.retailInr.div(worst.suggestedInr).sub(1).mul(100);
      out.push({
        ...base,
        rule: 'RETAIL_MARKUP',
        severity: worstPct.gte(t.retailMarkupPct * 2) ? 'HIGH' : 'MEDIUM',
        value: `${m.markupLines.length} line${m.markupLines.length === 1 ? '' : 's'}`,
        threshold: `${t.retailMarkupPct}% above suggested`,
        reason:
          `${m.markupLines.length} order line(s) sold more than ${t.retailMarkupPct}% above the suggested retail ${within}; ` +
          `the highest was ${worst.skuCode} on ${worst.orderNumber} at ₹${worst.retailInr.toFixed(2)} against ₹${worst.suggestedInr.toFixed(2)} suggested (+${worstPct.toFixed(0)}%).`,
      });
    }
    const shared = m.sharedPhones.filter((p) => p.stores >= t.sharedPhoneStores);
    if (shared.length > 0) {
      const most = Math.max(...shared.map((p) => p.stores));
      out.push({
        ...base,
        rule: 'SHARED_CUSTOMER',
        severity: severity(most, t.sharedPhoneStores),
        value: `${shared.length} customer${shared.length === 1 ? '' : 's'}`,
        threshold: `${t.sharedPhoneStores} stores`,
        reason:
          `${shared.length} customer phone number(s) on this store’s orders also ordered from other reseller stores ${within} — ` +
          shared
            .slice(0, 5)
            .map((p) => `${p.masked} (${p.stores} stores)`)
            .join(', ') +
          '.',
      });
    }
  }
  return out.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === 'HIGH' ? -1 : 1) ||
      a.storeName.localeCompare(b.storeName) ||
      a.rule.localeCompare(b.rule),
  );
}
