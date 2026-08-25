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
