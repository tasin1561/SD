import { OrderStatus, Prisma } from '@skydrop/db';
import {
  ratePct,
  scorecard,
  type ScoreOrder,
} from '../../src/modules/reseller-reports/services/reseller-scorecard';

const d = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);

function order(
  status: OrderStatus,
  everConfirmed: boolean,
  lines: ScoreOrder['lines'] = [
    { quantity: 1, transferInr: d(100), retailInr: d(150), unitCostInr: d(60) },
  ],
): ScoreOrder {
  return { status, everConfirmed, lines };
}

describe('reseller scorecard (RS-9)', () => {
  it('a rate with no denominator is null, never 0%', () => {
    expect(ratePct(0, 0)).toBeNull();
    expect(ratePct(1, 4)).toBe('25.0');
    const empty = scorecard([]);
    expect(empty.confirmationRatePct).toBeNull();
    expect(empty.cancelRatePct).toBeNull();
    expect(empty.returnRatePct).toBeNull();
  });

  it('confirmation counts only DECIDED orders; one still waiting on the call is in neither side', () => {
    const c = scorecard([
      order(OrderStatus.DELIVERED, true),
      order(OrderStatus.CANCELLED, false), // called off before confirmation: decided, not confirmed
      order(OrderStatus.PENDING_CONFIRMATION, false), // undecided
      order(OrderStatus.CANCELLED_BY_ADMIN, true), // confirmed, then called off
    ]);
    expect(c.placed).toBe(4);
    expect(c.decided).toBe(3);
    expect(c.confirmed).toBe(2);
    expect(c.confirmationRatePct).toBe('66.7');
    expect(c.calledOff).toBe(2);
    expect(c.cancelRatePct).toBe('50.0');
    expect(c.open).toBe(1);
  });

  it('delivery and return rates divide by outcomes only — a parcel still moving is in none', () => {
    const c = scorecard([
      order(OrderStatus.DELIVERED, true),
      order(OrderStatus.DELIVERED, true),
      order(OrderStatus.RTO_RECEIVED, true),
      order(OrderStatus.LOST_IN_TRANSIT, true),
      order(OrderStatus.IN_TRANSIT, true),
    ]);
    expect(c.delivered).toBe(2);
    expect(c.returned).toBe(1);
    expect(c.lost).toBe(1);
    expect(c.deliveryRatePct).toBe('50.0');
    expect(c.returnRatePct).toBe('25.0');
  });

  it('margin is (transfer − cost) × qty on delivered lines with a KNOWN cost, and says how many', () => {
    const c = scorecard([
      order(OrderStatus.DELIVERED, true, [
        { quantity: 2, transferInr: d(100), retailInr: d(150), unitCostInr: d(60) },
        { quantity: 1, transferInr: d(80), retailInr: d(120), unitCostInr: null },
      ]),
      order(OrderStatus.RTO_RECEIVED, true), // not delivered: no margin
    ]);
    expect(c.marginInr).toBe('80.00');
    expect(c.marginCoverage).toEqual({ linesWithCost: 1, lines: 2 });
    expect(c.unitsDelivered).toBe(3);
    expect(c.transferDeliveredInr).toBe('280.00');
    expect(c.retailDeliveredInr).toBe('420.00');
  });
});
