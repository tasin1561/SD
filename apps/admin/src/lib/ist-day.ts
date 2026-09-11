/**
 * Business days are INDIAN days.
 *
 * The courier charges in IST, the warehouse works in IST, and a P&L for
 * "1–30 September" means midnight to midnight in India. Cutting days at
 * UTC midnight instead shifted every period by five and a half hours: a
 * charge Delhivery posted at 02:00 IST on the 1st was reported in the
 * previous month. India has no daylight saving, so a fixed offset is
 * exact rather than an approximation.
 */
const IST_OFFSET_MINUTES = 330;
const IST_OFFSET = '+05:30';

/** The IST calendar date (YYYY-MM-DD) that `d` falls on. */
export function istDay(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/**
 * The exact instants a from/to pair of IST dates covers, inclusive of the
 * whole closing day — a window ending "today" that stopped at midnight
 * would silently omit today's trading.
 */
export function istDayRange(from: string, to: string): { from: string; to: string } {
  return {
    from: new Date(`${from}T00:00:00.000${IST_OFFSET}`).toISOString(),
    to: new Date(`${to}T23:59:59.999${IST_OFFSET}`).toISOString(),
  };
}
