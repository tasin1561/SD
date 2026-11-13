import {
  buildRows,
  emptyBucket,
  addBuckets,
} from '../../src/modules/assistant/services/assistant-billing.service';
import {
  daysOfMonth,
  lastMonths,
  monthStart,
  nextMonthStart,
  dhakaDate,
} from '../../src/modules/assistant/assistant-panel-time';
import { Prisma } from '@skydrop/db';

describe('assistant panel: Dhaka calendar', () => {
  it('a month starts at 18:00 UTC the evening before', () => {
    expect(monthStart('2026-11').toISOString()).toBe('2026-10-31T18:00:00.000Z');
    expect(nextMonthStart('2026-11').toISOString()).toBe('2026-11-30T18:00:00.000Z');
  });
  it('23:30 UTC on the 30th is already December 1st in Dhaka', () => {
    expect(dhakaDate(new Date('2026-11-30T23:30:00Z'))).toEqual({ y: 2026, m: 12, d: 1 });
  });
  it('lists months newest first across a year boundary', () => {
    expect(lastMonths(new Date('2026-02-10T00:00:00Z'), 4)).toEqual([
      '2026-02',
      '2026-01',
      '2025-12',
      '2025-11',
    ]);
  });
  it('knows February', () => {
    expect(daysOfMonth('2028-02')).toHaveLength(29);
    expect(daysOfMonth('2026-02')).toHaveLength(28);
  });
});

describe('assistant panel: billing rows', () => {
  const raw = (period: string, audience: string, cost: string, req = 1) => ({
    period,
    audience,
    requests: req,
    input_tokens: 100,
    output_tokens: 50,
    cache_read_tokens: 10,
    cache_write_tokens: 5,
    cost_usd: new Prisma.Decimal(cost),
  });

  it('fills every period, splits by portal, sums to the total, monitor is zero', () => {
    const rows = buildRows(
      ['2026-11-02', '2026-11-01'],
      [raw('2026-11-01', 'STAFF', '0.10000000'), raw('2026-11-01', 'SELLER', '0.25000001', 3)],
    );
    const d1 = rows[1]!;
    expect(d1.total.requests).toBe(4);
    expect(d1.total.costUsd).toBe('0.35000001');
    expect(d1.assistant.portals.seller.costUsd).toBe('0.25000001');
    expect(d1.monitor).toEqual(emptyBucket());
    expect(rows[0]!.total).toEqual(emptyBucket());
  });

  it('adds buckets without losing precision', () => {
    const a = { ...emptyBucket(), costUsd: '0.1' };
    expect(addBuckets(a, { ...emptyBucket(), costUsd: '0.2' }).costUsd).toBe('0.30000000');
  });
});
