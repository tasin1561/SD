/**
 * Calendar maths for the AI billing page. Months and days are Asia/Dhaka
 * (UTC+6, no daylight saving, ever), and the page says so. Everything here
 * is plain arithmetic on a fixed offset so the same boundaries are used by
 * the SQL bounds, the empty-row filling and the tests.
 */
export const BILLING_TIMEZONE = 'Asia/Dhaka';
const OFFSET_MS = 6 * 60 * 60 * 1000;

export interface DhakaDate {
  readonly y: number;
  readonly m: number; // 1-12
  readonly d: number;
}

export function dhakaDate(at: Date): DhakaDate {
  const s = new Date(at.getTime() + OFFSET_MS);
  return { y: s.getUTCFullYear(), m: s.getUTCMonth() + 1, d: s.getUTCDate() };
}

const pad = (n: number): string => String(n).padStart(2, '0');

export const monthKey = (y: number, m: number): string => `${y}-${pad(m)}`;
export const dayKey = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`;

export const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const DAY_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** The instant a Dhaka month begins. */
export function monthStart(key: string): Date {
  const m = MONTH_RE.exec(key);
  if (m === null) throw new RangeError(`bad month ${key}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1) - OFFSET_MS);
}

/** The instant the NEXT Dhaka month begins (exclusive upper bound). */
export function nextMonthStart(key: string): Date {
  const m = MONTH_RE.exec(key);
  if (m === null) throw new RangeError(`bad month ${key}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 1) - OFFSET_MS);
}

/** The instant a Dhaka day begins. */
export function dayStart(key: string): Date {
  const m = DAY_RE.exec(key);
  if (m === null) throw new RangeError(`bad day ${key}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - OFFSET_MS);
}

/** `count` month keys ending at the month of `now`, newest first. */
export function lastMonths(now: Date, count: number): string[] {
  const { y, m } = dhakaDate(now);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = y * 12 + (m - 1) - i;
    out.push(monthKey(Math.floor(idx / 12), (idx % 12) + 1));
  }
  return out;
}

/** Every day key of a month, oldest first. */
export function daysOfMonth(key: string): string[] {
  const m = MONTH_RE.exec(key);
  if (m === null) throw new RangeError(`bad month ${key}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const n = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => dayKey(y, mo, i + 1));
}

/** Every day key from `from` to `to` inclusive (Dhaka days), capped. */
export function daysBetween(from: string, to: string, cap = 366): string[] {
  const out: string[] = [];
  let t = dayStart(from).getTime();
  const end = dayStart(to).getTime();
  while (t <= end && out.length < cap) {
    const dd = dhakaDate(new Date(t));
    out.push(dayKey(dd.y, dd.m, dd.d));
    t += 24 * 60 * 60 * 1000;
  }
  return out;
}
