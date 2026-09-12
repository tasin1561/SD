import { describe, expect, it } from 'vitest';
import { istDateLabel, istDay, istDayRange } from '../lib/ist-day';

/**
 * The P&L's days are Indian days. Cut at UTC midnight, a charge posted at
 * 02:00 IST on the 1st was reported in the previous month.
 */
describe('IST business days', () => {
  it('a month runs from midnight IST on the 1st UP TO (not including) midnight IST on the 1st of the next', () => {
    expect(istDayRange('2026-09-01', '2026-09-30')).toEqual({
      from: '2026-08-31T18:30:00.000Z',
      to: '2026-09-30T18:30:00.000Z',
    });
  });

  it('a charge at 02:00 IST on the 1st falls INSIDE that month', () => {
    const at = new Date('2026-09-01T02:00:00+05:30').toISOString();
    const { from, to } = istDayRange('2026-09-01', '2026-09-30');
    expect(at >= from && at < to).toBe(true);
  });

  it('the last instant of the closing day is inside, and the next midnight is not', () => {
    // 23:59:59.999 IST — and anything after it that the database can
    // hold before midnight — is inside; midnight belongs to the next day.
    const { from, to } = istDayRange('2026-09-01', '2026-09-30');
    const last = new Date('2026-09-30T23:59:59.999+05:30').toISOString();
    const midnight = new Date('2026-10-01T00:00:00.000+05:30').toISOString();
    expect(last >= from && last < to).toBe(true);
    expect(midnight < to).toBe(false);
  });

  it('two adjacent ranges TILE: the first ends exactly where the second starts', () => {
    expect(istDayRange('2026-09-01', '2026-09-15').to).toBe(
      istDayRange('2026-09-16', '2026-09-30').from,
    );
  });

  it('names the IST date, not the UTC one', () => {
    // 20:00 UTC on the 10th is 01:30 on the 11th in India.
    expect(istDay(new Date('2026-09-10T20:00:00Z'))).toBe('2026-09-11');
    expect(istDay(new Date('2026-09-10T18:29:59Z'))).toBe('2026-09-10');
  });

  it('dates a drill-down row by the IST day it fell on, whatever the browser zone', () => {
    // 20:00 UTC on the 10th: the 10th in London, the 11th in India.
    expect(istDateLabel('2026-09-10T20:00:00.000Z')).toBe(
      new Date('2026-09-11T12:00:00.000Z').toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
      }),
    );
    expect(istDateLabel('2026-09-10T20:00:00.000Z')).toMatch(/^11\/0?9\/2026$/);
  });
});
