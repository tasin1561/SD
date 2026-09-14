/**
 * P&L months are INDIAN calendar months (PNL-CF-1).
 *
 * `2026-08` is `[1 Aug 00:00 IST, 1 Sep 00:00 IST)` — half-open, exactly
 * the window /pnl sends for "1 Aug – 31 Aug" (`apps/admin/src/lib/ist-day.ts`).
 * India has no daylight saving, so a fixed +05:30 is exact.
 */
const IST_OFFSET_MS = 330 * 60_000;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** True for `YYYY-MM`. */
export function isMonth(s: string): boolean {
  return MONTH_RE.test(s);
}

function parts(month: string): { y: number; m: number } {
  const match = MONTH_RE.exec(month);
  if (match === null) throw new Error(`Not a month: "${month}"`);
  return { y: Number(match[1]), m: Number(match[2]) };
}

function format(y: number, m: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/** The IST month an instant falls in. */
export function monthOf(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return format(ist.getUTCFullYear(), ist.getUTCMonth() + 1);
}

/** The IST day an instant falls on, `YYYY-MM-DD`. */
export function istDayOf(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** `[1st 00:00 IST, next 1st 00:00 IST)`. */
export function monthWindow(month: string): { from: Date; to: Date } {
  const { y, m } = parts(month);
  return {
    from: new Date(Date.UTC(y, m - 1, 1) - IST_OFFSET_MS),
    to: new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS),
  };
}

export function nextMonth(month: string): string {
  const { y, m } = parts(month);
  return m === 12 ? format(y + 1, 1) : format(y, m + 1);
}

export function prevMonth(month: string): string {
  const { y, m } = parts(month);
  return m === 1 ? format(y - 1, 12) : format(y, m - 1);
}

/** Every month from `first` to `last`, both included; empty when `first` is after `last`. */
export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  for (let m = first; m <= last; m = nextMonth(m)) out.push(m);
  return out;
}

/** "August 2026". */
export function monthName(month: string): string {
  const { y, m } = parts(month);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "28 Aug 2026", the IST date of an ISO instant. */
export function istDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}
