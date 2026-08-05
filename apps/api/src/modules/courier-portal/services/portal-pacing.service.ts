import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';

/** Indian business hours, in IST. The portal's own working day. */
const BUSINESS_START_IST = 9;
const BUSINESS_END_IST = 20;

const IN_HOURS_MIN_MS = 20_000;
const IN_HOURS_MAX_MS = 90_000;
/** Outside their working day there is nobody to be responsive for. */
const OUT_OF_HOURS_MIN_MS = 90_000;
const OUT_OF_HOURS_MAX_MS = 300_000;

/**
 * How long to wait between portal actions.
 *
 * ── WHY DELIBERATE SLOWNESS IS CORRECT HERE ──────────────────────────
 * The queue is roughly thirty items a day. There is no throughput
 * pressure at all, so every second spent pacing costs nothing we care
 * about — and buys the one thing that matters: traffic that looks like a
 * person working through a list rather than a script.
 *
 * This is NOT evasion. We do not spoof a user agent, patch a
 * fingerprint, or touch a captcha. The point is that a burst of forty
 * identical requests in ninety seconds is indistinguishable from an
 * attack even when it is not one, and being mistaken for one costs the
 * account. Pacing is how a legitimate integration stays legible as
 * legitimate.
 *
 * ── SERIAL, NOT CONCURRENT ───────────────────────────────────────────
 * One job at a time, enforced by the worker rather than by a limit: two
 * browsers sharing one `storageState` file race on write, and the losing
 * write silently produces a session that logs in again next run. That
 * would show up as unexplained re-authentication, which is exactly the
 * kind of symptom nobody traces back to concurrency.
 */
@Injectable()
export class PortalPacingService {
  /** IST hour of `when` — read from a clock, never from an offset. */
  private istHour(when: Date): number {
    const h = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      hour12: false,
    }).format(when);
    const n = Number(h);
    return n === 24 ? 0 : n;
  }

  isBusinessHours(when = new Date()): boolean {
    const h = this.istHour(when);
    return h >= BUSINESS_START_IST && h < BUSINESS_END_IST;
  }

  /**
   * The next gap. Randomised, because a fixed interval is a signature —
   * a request every exactly-45-seconds is more obviously automated than
   * one every 20-to-90.
   */
  nextDelayMs(when = new Date()): number {
    const [min, max] = this.isBusinessHours(when)
      ? [IN_HOURS_MIN_MS, IN_HOURS_MAX_MS]
      : [OUT_OF_HOURS_MIN_MS, OUT_OF_HOURS_MAX_MS];
    // randomInt over Math.random: not for unpredictability against an
    // adversary, but because Math.random is banned in this codebase's
    // scripts and one source of randomness is easier to reason about.
    return randomInt(min, max + 1);
  }

  /** Sleep for the next gap. */
  async pace(when = new Date()): Promise<number> {
    const ms = this.nextDelayMs(when);
    await new Promise((resolve) => setTimeout(resolve, ms));
    return ms;
  }
}
