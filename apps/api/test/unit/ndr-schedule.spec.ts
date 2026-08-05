import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NDR_TIMEZONE } from '../../src/modules/courier-ndr-runner/queue/ndr.queue';

/**
 * The nightly runner fires at 21:35 in DHAKA, not in UTC.
 *
 * ── THE BUG THIS EXISTS TO CATCH ─────────────────────────────────────
 * The droplet runs UTC and no other queue in this codebase passes `tz`.
 * Drop it here and `35 21 * * *` fires at 21:35 UTC = 03:35 Dhaka — five
 * and a half hours BEFORE Delhivery's 21:00 IST cutoff, when the day's
 * dispatches have not closed and NDR parcels are not back in facility.
 * Every submission would be rejected as out-of-window, the UPL results
 * would come back uniformly negative, and the symptom would read as
 * "Delhivery is ignoring our re-attempts".
 *
 * Nothing crashes. No other test fails. The cron STRING is correct — it
 * is the frame of reference that is wrong — so a test asserting the
 * pattern passes under exactly this bug. Hence: resolve the schedule to
 * an INSTANT, and check what a clock in Dhaka reads at that instant.
 *
 * ── WHY THE RESOLUTION IS HAND-ROLLED ────────────────────────────────
 * BullMQ's own scheduler (cron-parser) is not resolvable from apps/api —
 * it is a transitive dependency, and adding it as a direct one to write
 * a test is not a dependency decision to make quietly. For a daily
 * `M H * * *` pattern the semantics are small enough to state directly:
 * the next instant whose local clock in the target zone reads H:M. That
 * is precisely what a `tz`-scheduled daily cron means.
 */

/** What `courier.ndr_runner_cron` and the reconcile cron are seeded to. */
const RUNNER = { hour: 21, minute: 35 };
const RECONCILE = { hour: 12, minute: 0 };

/** A fixed reference point — `Date.now()` would make this non-repeatable. */
const FROM = new Date('2026-08-05T00:00:00Z');

function clockIn(when: Date, tz: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(when);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '-1');
  // Intl renders midnight as "24" in some locales/zones; normalise.
  const hour = get('hour');
  return { hour: hour === 24 ? 0 : hour, minute: get('minute') };
}

/**
 * The next instant at or after `from` at which the clock in `tz` reads
 * `hour:minute`. Minute-by-minute so the search makes no assumption
 * about the zone's offset — Dhaka is currently UTC+6 with no DST, and
 * hard-coding that would be the same class of mistake as assuming UTC.
 */
function nextDailyRun(hour: number, minute: number, tz: string, from: Date): Date {
  const start = new Date(Math.ceil(from.getTime() / 60_000) * 60_000);
  for (let i = 0; i < 48 * 60; i += 1) {
    const candidate = new Date(start.getTime() + i * 60_000);
    const c = clockIn(candidate, tz);
    if (c.hour === hour && c.minute === minute) return candidate;
  }
  throw new Error(`no ${hour}:${minute} found within 48h in ${tz}`);
}

describe('NDR schedules resolve in Asia/Dhaka', () => {
  it('is configured for Asia/Dhaka', () => {
    expect(NDR_TIMEZONE).toBe('Asia/Dhaka');
  });

  it('the nightly runner resolves to an instant that is 21:35 ON A DHAKA CLOCK', () => {
    const next = nextDailyRun(RUNNER.hour, RUNNER.minute, NDR_TIMEZONE, FROM);
    expect(clockIn(next, NDR_TIMEZONE)).toEqual({ hour: 21, minute: 35 });
  });

  it('and that instant is 15:35 UTC — NOT 21:35 UTC, which is the whole point', () => {
    const next = nextDailyRun(RUNNER.hour, RUNNER.minute, NDR_TIMEZONE, FROM);
    expect(next.getUTCHours()).toBe(15);
    expect(next.getUTCMinutes()).toBe(35);
  });

  it('21:35 UTC would be 03:35 in Dhaka — the failure being prevented, made concrete', () => {
    // What production would do if someone deleted `tz` from the queue.
    const utcFiring = new Date('2026-08-05T21:35:00Z');
    expect(clockIn(utcFiring, NDR_TIMEZONE)).toEqual({ hour: 3, minute: 35 });
  });

  it('and 03:35 Dhaka is before the 21:00 IST cutoff, so every submission would be rejected', () => {
    // The consequence, not just the arithmetic: Delhivery only accepts
    // NDR actions after 21:00 IST.
    const utcFiring = new Date('2026-08-05T21:35:00Z');
    const ist = clockIn(utcFiring, 'Asia/Kolkata');
    expect(ist.hour).toBeLessThan(21);
  });

  it('reconciliation resolves to midday on a Dhaka clock', () => {
    const next = nextDailyRun(RECONCILE.hour, RECONCILE.minute, NDR_TIMEZONE, FROM);
    expect(clockIn(next, NDR_TIMEZONE)).toEqual({ hour: 12, minute: 0 });
  });

  it('the queue passes the timezone to EVERY repeatable job', () => {
    // Three schedules is three chances to forget one, and a missing `tz`
    // on job two of three is invisible without standing up Redis.
    const src = readFileSync(
      join(__dirname, '../../src/modules/courier-ndr-runner/queue/ndr.queue.ts'),
      'utf8',
    );
    const repeats = src.match(/repeat:\s*\{[^}]*\}/g) ?? [];
    expect(repeats.length).toBe(3);
    for (const r of repeats) expect(r).toContain('tz: NDR_TIMEZONE');
  });
});
