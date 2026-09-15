import { OrderStatus, Prisma } from '@skydrop/db';
import { orderFate } from '../../treasury/services/pnl.service';

/**
 * A reseller store's SCORECARD (RS-9), with no database in it.
 *
 * Over a COHORT: the orders the store placed in the window. Each rate
 * states its own denominator, so a rate never divides by orders whose
 * outcome is not known yet:
 *
 *  - confirmation: confirmed ÷ decided, where DECIDED is every order that
 *    was ever confirmed plus every one called off before it was; an order
 *    still waiting on the call centre is in neither.
 *  - cancel: called off (cancelled or rejected, `orderFate`) ÷ placed.
 *  - delivery / return: delivered ÷ outcomes and returned ÷ outcomes,
 *    where an OUTCOME is delivered, returned or lost in transit. A parcel
 *    still with the courier is in none of them.
 *
 * Margin is the SELLER's: (transfer price − the seller's unit cost) × qty
 * over delivered lines where the unit cost is known; how many lines that
 * covers is stated beside it, never defaulted (TRE-6's rule).
 *
 * A rate with no denominator is `null` — "no data", never 0%.
 */

const ZERO = new Prisma.Decimal(0);

export interface ScoreLine {
  readonly quantity: number;
  readonly transferInr: Prisma.Decimal | null;
  readonly retailInr: Prisma.Decimal | null;
  readonly unitCostInr: Prisma.Decimal | null;
}

export interface ScoreOrder {
  readonly status: OrderStatus;
  readonly everConfirmed: boolean;
  readonly lines: readonly ScoreLine[];
}

export interface Scorecard {
  readonly placed: number;
  readonly confirmed: number;
  readonly decided: number;
  readonly confirmationRatePct: string | null;
  readonly calledOff: number;
  readonly cancelRatePct: string | null;
  readonly delivered: number;
  readonly returned: number;
  readonly lost: number;
  readonly deliveryRatePct: string | null;
  readonly returnRatePct: string | null;
  /** Orders whose fate is not known yet. */
  readonly open: number;
  readonly unitsDelivered: number;
  /** Σ transfer × qty on delivered orders — what the store owes the seller for them. */
  readonly transferDeliveredInr: string;
  /** Σ retail × qty on delivered orders — what customers paid for them. */
  readonly retailDeliveredInr: string;
  /** Σ (transfer − unit cost) × qty over delivered lines with a known cost. */
  readonly marginInr: string;
  readonly marginCoverage: { readonly linesWithCost: number; readonly lines: number };
}

export function ratePct(n: number, d: number): string | null {
  return d === 0 ? null : ((n / d) * 100).toFixed(1);
}

export function scorecard(orders: readonly ScoreOrder[]): Scorecard {
  let confirmed = 0;
  let decided = 0;
  let calledOff = 0;
  let delivered = 0;
  let returned = 0;
  let lost = 0;
  let open = 0;
  let units = 0;
  let transfer = ZERO;
  let retail = ZERO;
  let margin = ZERO;
  let lines = 0;
  let withCost = 0;
  for (const o of orders) {
    const fate = orderFate(o.status);
    if (o.everConfirmed) confirmed += 1;
    if (o.everConfirmed || fate === 'called_off') decided += 1;
    if (fate === 'called_off') calledOff += 1;
    else if (fate === 'returned') returned += 1;
    else if (fate === 'open') open += 1;
    else if (o.status === OrderStatus.LOST_IN_TRANSIT) lost += 1;
    else {
      delivered += 1;
      for (const l of o.lines) {
        units += l.quantity;
        lines += 1;
        if (l.transferInr !== null) transfer = transfer.add(l.transferInr.mul(l.quantity));
        if (l.retailInr !== null) retail = retail.add(l.retailInr.mul(l.quantity));
        if (l.transferInr !== null && l.unitCostInr !== null) {
          withCost += 1;
          margin = margin.add(l.transferInr.sub(l.unitCostInr).mul(l.quantity));
        }
      }
    }
  }
  const outcomes = delivered + returned + lost;
  return {
    placed: orders.length,
    confirmed,
    decided,
    confirmationRatePct: ratePct(confirmed, decided),
    calledOff,
    cancelRatePct: ratePct(calledOff, orders.length),
    delivered,
    returned,
    lost,
    deliveryRatePct: ratePct(delivered, outcomes),
    returnRatePct: ratePct(returned, outcomes),
    open,
    unitsDelivered: units,
    transferDeliveredInr: transfer.toFixed(2),
    retailDeliveredInr: retail.toFixed(2),
    marginInr: margin.toFixed(2),
    marginCoverage: { linesWithCost: withCost, lines },
  };
}
