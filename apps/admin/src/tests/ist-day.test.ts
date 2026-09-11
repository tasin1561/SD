import { describe, expect, it } from 'vitest';
import { istDay, istDayRange } from '../lib/ist-day';

/**
 * The P&L's days are Indian days. Cut at UTC midnight, a charge posted at
 * 02:00 IST on the 1st was reported in the previous month.
 */
describe('IST business days', () => {
  it('a month runs from midnight IST on the 1st to the last instant of the 30th', () => {
    expect(istDayRange('2026-09-01', '2026-09-30')).toEqual({
      from: '2026-08-31T18:30:00.000Z',
      to: '2026-09-30T18:29:59.999Z',
    });
  });

  it('a charge at 02:00 IST on the 1st falls INSIDE that month', () => {
    const at = new Date('2026-09-01T02:00:00+05:30').toISOString();
    const { from, to } = istDayRange('2026-09-01', '2026-09-30');
    expect(at >= from && at <= to).toBe(true);
  });

  it('names the IST date, not the UTC one', () => {
    // 20:00 UTC on the 10th is 01:30 on the 11th in India.
    expect(istDay(new Date('2026-09-10T20:00:00Z'))).toBe('2026-09-11');
    expect(istDay(new Date('2026-09-10T18:29:59Z'))).toBe('2026-09-10');
  });
});
