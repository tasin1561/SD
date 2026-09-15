import { Prisma } from '@skydrop/db';
import {
  DEFAULT_FRAUD_THRESHOLDS,
  evaluateFraud,
  maskPhone,
  maxInAnyHour,
  type StoreFraudMetrics,
} from '../../src/modules/reseller-reports/services/reseller-fraud-rules';

const t = DEFAULT_FRAUD_THRESHOLDS;

function metrics(over: Partial<StoreFraudMetrics> = {}): StoreFraudMetrics {
  return {
    storeId: 's1',
    storeName: 'Store One',
    sellerId: 'x1',
    sellerName: 'Seller',
    placed: 20,
    calledOff: 0,
    delivered: 20,
    returned: 0,
    dispatched: 20,
    ndrOrders: 0,
    maxOrdersInAnHour: 1,
    markupLines: [],
    sharedPhones: [],
    ...over,
  };
}

describe('reseller fraud rules (RS-9)', () => {
  it('a clean store raises nothing', () => {
    expect(evaluateFraud([metrics()], t)).toEqual([]);
  });

  it('a rate below the minimum order count is never judged', () => {
    expect(evaluateFraud([metrics({ placed: 3, calledOff: 3 })], t)).toEqual([]);
  });

  it('crossing a threshold is MEDIUM, twice it is HIGH, and the reason names the numbers', () => {
    const [medium] = evaluateFraud([metrics({ placed: 20, calledOff: 9 })], t);
    expect(medium).toMatchObject({ rule: 'CANCEL_RATE', severity: 'MEDIUM', value: '45.0%' });
    expect(medium?.reason).toContain('9 of 20');
    const [high] = evaluateFraud([metrics({ maxOrdersInAnHour: 60 })], t);
    expect(high).toMatchObject({ rule: 'RAPID_ORDERS', severity: 'HIGH' });
  });

  it('return and failed-delivery rates use their own denominators', () => {
    const flags = evaluateFraud(
      [metrics({ delivered: 10, returned: 10, dispatched: 20, ndrOrders: 12 })],
      t,
    );
    expect(flags.map((f) => f.rule).sort()).toEqual(['NDR_RATE', 'RETURN_RATE']);
  });

  it('retail markup names the worst line; a shared customer names masked numbers only', () => {
    const flags = evaluateFraud(
      [
        metrics({
          markupLines: [
            {
              orderNumber: 'SD-1',
              skuCode: 'SKU-A',
              retailInr: new Prisma.Decimal(500),
              suggestedInr: new Prisma.Decimal(100),
            },
          ],
          sharedPhones: [{ masked: maskPhone('+919876543210'), stores: 3 }],
        }),
      ],
      t,
    );
    const markup = flags.find((f) => f.rule === 'RETAIL_MARKUP');
    expect(markup?.severity).toBe('HIGH'); // +400% ≥ twice the 100% threshold
    expect(markup?.reason).toContain('SKU-A');
    const shared = flags.find((f) => f.rule === 'SHARED_CUSTOMER');
    expect(shared?.reason).toContain('••••3210');
    expect(shared?.reason).not.toContain('9876543210');
  });

  it('maxInAnyHour is a sliding hour', () => {
    const at = (m: number): Date => new Date(Date.UTC(2026, 8, 1, 10, m));
    expect(maxInAnyHour([])).toBe(0);
    expect(maxInAnyHour([at(0), at(30), at(59), at(61), at(100)])).toBe(3);
  });
});
