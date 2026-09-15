/**
 * Business days are INDIAN days (the admin P&L's `ist-day.ts`, for the
 * seller app's reseller reports). India has no daylight saving, so a
 * fixed +05:30 is exact. Windows are HALF-OPEN: `to` is midnight IST at
 * the start of the day AFTER the last one, so adjacent windows tile.
 */
const IST_OFFSET_MINUTES = 330;
const IST_OFFSET = '+05:30';
const DAY_MS = 24 * 60 * 60 * 1000;

export function istDay(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

export function istDayRange(from: string, to: string): { from: string; to: string } {
  return {
    from: new Date(`${from}T00:00:00.000${IST_OFFSET}`).toISOString(),
    to: new Date(new Date(`${to}T00:00:00.000${IST_OFFSET}`).getTime() + DAY_MS).toISOString(),
  };
}

export function lastDays(days: number, now: Date = new Date()): { from: string; to: string } {
  return { from: istDay(new Date(now.getTime() - (days - 1) * DAY_MS)), to: istDay(now) };
}

export function istDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
