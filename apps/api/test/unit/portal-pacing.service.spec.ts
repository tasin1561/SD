import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PortalPacingService } from '../../src/modules/courier-portal/services/portal-pacing.service';
import { PORTAL_TIMEZONE } from '../../src/modules/courier-portal/queue/portal.queue';

/**
 * Pacing, and the canary's clock.
 *
 * Both are about the portal being legible as a legitimate integration
 * rather than fast. There is no throughput pressure — roughly thirty
 * items a day — so every second of delay costs nothing we care about.
 */

const svc = new PortalPacingService();

/** Hour on a clock in `tz`, read rather than computed from an offset. */
function hourIn(when: Date, tz: string): number {
  const h = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(when),
  );
  return h === 24 ? 0 : h;
}

describe('PortalPacingService', () => {
  it('knows Indian business hours from an IST clock, not from UTC', () => {
    // 06:00 UTC is 11:30 IST — inside their day. Anyone reasoning in UTC
    // would call this pre-dawn and pace as though nobody were working.
    const midMorningIst = new Date('2026-08-06T06:00:00Z');
    expect(hourIn(midMorningIst, 'Asia/Kolkata')).toBe(11);
    expect(svc.isBusinessHours(midMorningIst)).toBe(true);
  });

  it('treats the Indian night as out of hours', () => {
    // 20:00 UTC is 01:30 IST.
    const nightIst = new Date('2026-08-06T20:00:00Z');
    expect(hourIn(nightIst, 'Asia/Kolkata')).toBe(1);
    expect(svc.isBusinessHours(nightIst)).toBe(false);
  });

  it('paces 20–90s inside business hours', () => {
    const t = new Date('2026-08-06T06:00:00Z');
    for (let i = 0; i < 50; i += 1) {
      const ms = svc.nextDelayMs(t);
      expect(ms).toBeGreaterThanOrEqual(20_000);
      expect(ms).toBeLessThanOrEqual(90_000);
    }
  });

  it('slows down outside business hours — nobody is waiting', () => {
    const t = new Date('2026-08-06T20:00:00Z');
    for (let i = 0; i < 50; i += 1) {
      expect(svc.nextDelayMs(t)).toBeGreaterThanOrEqual(90_000);
    }
  });

  it('is RANDOMISED, not a fixed interval', () => {
    // A request every exactly-45-seconds is a more obvious signature than
    // one every 20-to-90. Not evasion — a burst of identical timings is
    // indistinguishable from an attack even when it is not one.
    const t = new Date('2026-08-06T06:00:00Z');
    const seen = new Set(Array.from({ length: 40 }, () => svc.nextDelayMs(t)));
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe('the canary runs at 03:00 on a DHAKA clock', () => {
  it('is configured for Asia/Dhaka', () => {
    expect(PORTAL_TIMEZONE).toBe('Asia/Dhaka');
  });

  it('03:00 Dhaka is 21:00 UTC the previous day — not 03:00 UTC', () => {
    // The same trap as the NDR runner. Without `tz`, `0 3 * * *` fires at
    // 03:00 UTC = 09:00 Dhaka (UTC+6) — the start of the working day, when
    // a canary raising and resolving tickets competes with real operators.
    const resolved = new Date('2026-08-05T21:00:00Z');
    expect(hourIn(resolved, PORTAL_TIMEZONE)).toBe(3);

    const utcFiring = new Date('2026-08-06T03:00:00Z');
    expect(hourIn(utcFiring, PORTAL_TIMEZONE)).toBe(9);
  });

  it('the queue passes the timezone to the canary schedule', () => {
    // Read from the source: a missing `tz` on one of two repeatables is
    // invisible without standing up Redis.
    const src = readFileSync(
      join(__dirname, '../../src/modules/courier-portal/queue/portal.queue.ts'),
      'utf8',
    );
    const canaryBlock = src.slice(src.indexOf('JOB_PORTAL_CANARY,'), src.indexOf('this.worker'));
    expect(canaryBlock).toContain('tz: PORTAL_TIMEZONE');
  });

  it('concurrency is 1 — two browsers would race on one storageState file', () => {
    const src = readFileSync(
      join(__dirname, '../../src/modules/courier-portal/queue/portal.queue.ts'),
      'utf8',
    );
    expect(src).toContain('concurrency: 1');
  });
});
