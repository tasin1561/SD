/**
 * Delhivery stamps a scan with no timezone at all — their own documented
 * payload reads `"StatusDateTime": "2019-01-09T17:10:42.767"`.
 *
 * A date-time with no offset is LOCAL time per the ECMAScript spec, and
 * our servers run UTC, so `new Date(...)` on that string silently reads
 * an IST wall-clock as UTC and lands the scan 5h30m in the future. It is
 * a quiet error: nothing throws, the timeline just shows times that
 * never happened, and a parcel delivered this afternoon claims to arrive
 * this evening.
 *
 * It also made the two ingest paths disagree about the same scan — the
 * tracking POLLER already corrected this, the webhook parser did not, so
 * the same event carried two different times depending on how it
 * reached us. TRK-3 orders every read on `eventAt`, so that decides what
 * the customer sees.
 *
 * An already-zoned string is returned untouched: if they ever start
 * sending an offset, this must not add a second one.
 */
export function toIsoWithIst(raw: string): string {
  const s = raw.trim();
  if (s === '') return s;
  if (/[zZ]$/.test(s) || /T.*[+-]\d{2}:?\d{2}$/.test(s)) return s;
  return `${s}+05:30`;
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/**
 * A courier's IST wall-clock as an ISO instant, or null when it cannot be
 * read — NEVER a guess, and never `now()` (TRK-3: `eventAt` is when the
 * scan happened).
 *
 * `toIsoWithIst` only appends an offset and leaves the reading to
 * `new Date`, which is fine for Delhivery's `2019-01-09T17:10:42.767` and
 * wrong for Shiprocket. Their push's `current_timestamp` is DAY-first with
 * spaces — `13 09 2026 14:52:06`, 810 of 811 production pushes on
 * 13 Sep 2026 — and V8 reads a spaced numeric date MONTH-first. So
 * `11 09 2026` became 9 November (the 13 Shiprocket events stored before
 * this fix carry November/December dates), and from the 13th of the month
 * the same string became an Invalid Date that Prisma refused, failing the
 * job and dropping the scan.
 *
 * Accepted, each parsed field by field and checked against the calendar
 * (31 Sep is refused, not rolled into October):
 *   - year first:  `2026-09-13 14:02:00`, `2026-09-13T14:02:00.123`
 *                  (their scan `date`, and one push in 811)
 *   - day first:   `13 09 2026 14:02:00`, `13-09-2026 14:02`, `13/09/2026 14:02`
 *   - month named: `13-Sep-2026 14:02`, `13 Sept 2026 14:02:00`
 * An already-zoned ISO string is returned as-is when it parses. A date
 * with no time is refused: it is not an instant a scan happened at.
 */
export function parseIstTimestamp(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/\s+/g, ' ');
  if (s === '') return null;

  if (/^\d{4}-\d{2}-\d{2}T.*([zZ]|[+-]\d{2}:?\d{2})$/.test(s)) {
    return Number.isNaN(Date.parse(s)) ? null : s;
  }

  let year: number;
  let month: number;
  let day: number;
  let time: string | undefined;

  const yearFirst = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](.+)$/.exec(s);
  const dayFirst = /^(\d{1,2})[ ./-](\d{1,2})[ ./-](\d{4})[ T,]+(.+)$/.exec(s);
  const named = /^(\d{1,2})[ -]([A-Za-z]{3,9})[ ,-]+(\d{4})[ T,]+(.+)$/.exec(s);
  if (yearFirst !== null) {
    year = Number(yearFirst[1]);
    month = Number(yearFirst[2]);
    day = Number(yearFirst[3]);
    time = yearFirst[4];
  } else if (dayFirst !== null) {
    day = Number(dayFirst[1]);
    month = Number(dayFirst[2]);
    year = Number(dayFirst[3]);
    time = dayFirst[4];
  } else if (named !== null) {
    const m = MONTHS[(named[2] ?? '').slice(0, 3).toLowerCase()];
    if (m === undefined) return null;
    day = Number(named[1]);
    month = m;
    year = Number(named[3]);
    time = named[4];
  } else {
    return null;
  }

  const t = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/.exec((time ?? '').trim());
  if (t === null) return null;
  const hour = Number(t[1]);
  const minute = Number(t[2]);
  const second = t[3] === undefined ? 0 : Number(t[3]);
  const millis = t[4] === undefined ? null : t[4].padEnd(3, '0');
  if (hour > 23 || minute > 59 || second > 59) return null;

  // Round-trip through the calendar: a day the month does not have fails.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 ||
    month > 12 ||
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  const frac = millis === null ? '' : `.${millis}`;
  return (
    `${pad(year, 4)}-${pad(month)}-${pad(day)}T` +
    `${pad(hour)}:${pad(minute)}:${pad(second)}${frac}+05:30`
  );
}
