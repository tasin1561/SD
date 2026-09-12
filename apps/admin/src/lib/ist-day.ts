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
const DAY_MS = 24 * 60 * 60 * 1000;

/** The IST calendar date (YYYY-MM-DD) that `d` falls on. */
export function istDay(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/**
 * The window a from/to pair of IST dates covers, HALF-OPEN: `from` is
 * midnight IST at the start of the first day, `to` is midnight IST at the
 * start of the day AFTER the last one, and the API counts `[from, to)`.
 *
 * Not "23:59:59.999 on the last day": the database keeps microseconds,
 * so a charge stamped 23:59:59.9995 fell in no report at all — after one
 * day's window closed and before the next one opened. Half-open windows
 * tile, so two adjacent months add up to the two months together.
 */
export function istDayRange(from: string, to: string): { from: string; to: string } {
  return {
    from: new Date(`${from}T00:00:00.000${IST_OFFSET}`).toISOString(),
    to: new Date(new Date(`${to}T00:00:00.000${IST_OFFSET}`).getTime() + DAY_MS).toISOString(),
  };
}

/**
 * An instant as the INDIAN date it fell on ("12/9/2026"), whatever zone
 * the browser is in. A drill-down row dated in the reader's own zone put
 * a charge from 02:00 IST on the 1st under the previous day for anybody
 * reading from London — in a report whose whole window is IST days.
 */
export function istDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
}
