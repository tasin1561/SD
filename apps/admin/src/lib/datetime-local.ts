/**
 * `<input type="datetime-local">` values — LOCAL wall clock, no zone.
 *
 * The input reads and writes "YYYY-MM-DDTHH:mm" in the viewer's own
 * timezone, and `new Date(value)` parses that string back as LOCAL time.
 * So a default built with `new Date().toISOString().slice(0, 16)` is UTC
 * wall clock handed to a field that is read as local: in India every
 * such default was recorded 5h30m EARLY, which near midnight is the
 * previous day, and on the 1st the previous month (the store payout form
 * did exactly that). Every datetime-local default goes through here.
 */
export function toDateTimeLocalValue(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** Now, as a datetime-local value. */
export function localNow(): string {
  return toDateTimeLocalValue(new Date());
}
