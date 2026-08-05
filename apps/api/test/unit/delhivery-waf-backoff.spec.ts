import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  wafAwareBackoff,
  wafRetryAfterMs,
} from '../../src/modules/courier-delhivery/util/waf-backoff';

/**
 * Two rails that only matter the first time something goes wrong live.
 *
 * Both were written after the pre-go-live review found that the WAF
 * signal was produced and never consumed. A rate-limit handler that has
 * never fired is indistinguishable from one that does not work, so the
 * test has to assert the PROPERTY (we come back after the window has
 * closed), not the mechanism (some number was returned).
 */

const SERVICES_DIR = join(__dirname, '../../src/modules/courier-delhivery/services');

describe('WAF-aware backoff', () => {
  // The real seeded value of courier.awb_job_retry_backoff_ms.
  const SCHEDULE = [1_000, 5_000, 15_000];
  const WAF_WINDOW_MS = 30_000;

  function wafError(): Error {
    const e = new Error(
      'Delhivery POST /api/cmu/create.json → 403 (WAF rate block); back off ~30s',
    );
    e.name = 'DelhiveryWafBlockError';
    (e as Error & { status?: number; retryAfterSeconds?: number }).status = 403;
    (e as Error & { status?: number; retryAfterSeconds?: number }).retryAfterSeconds = 30;
    return e;
  }

  it('waits out the WAF window on EVERY attempt — the property that was missing', () => {
    // This is the whole point. Under the old strategy the three delays
    // were 1s / 5s / 15s, so all three retries landed while the WAF was
    // still blocking, each one extending the block against our entire
    // egress IP. Asserting "> the window" rather than "=== 35000" keeps
    // the test about the behaviour rather than about the margin.
    const backoff = wafAwareBackoff(SCHEDULE);
    for (const attempt of [1, 2, 3]) {
      expect(backoff(attempt, 'custom', wafError())).toBeGreaterThan(WAF_WINDOW_MS);
    }
  });

  it('the OLD strategy would have failed this — cumulative retries fit inside the block', () => {
    // Pins why the fix exists: 1+5+15 = 21s of retrying, entirely inside
    // a 30s block. If someone reverts to the attempt-only strategy, the
    // test above fails and this comment explains what they lost.
    expect(SCHEDULE.reduce((a, b) => a + b, 0)).toBeLessThan(WAF_WINDOW_MS);
  });

  it('leaves an ordinary failure on its configured schedule', () => {
    const backoff = wafAwareBackoff(SCHEDULE);
    const boom = new Error('connection reset');
    expect(backoff(1, 'custom', boom)).toBe(1_000);
    expect(backoff(2, 'custom', boom)).toBe(5_000);
    expect(backoff(3, 'custom', boom)).toBe(15_000);
  });

  it('clamps past the end of the schedule instead of returning undefined', () => {
    const backoff = wafAwareBackoff(SCHEDULE);
    expect(backoff(9, 'custom', new Error('boom'))).toBe(15_000);
  });

  it('handles a missing error object — BullMQ may call the strategy without one', () => {
    expect(wafAwareBackoff(SCHEDULE)(1)).toBe(1_000);
  });

  it('recognises a WAF block that lost its prototype crossing Redis', () => {
    // BullMQ serialises a failure through Redis, which does not preserve
    // the Error subclass. Matching on the 403 + retryAfterSeconds SHAPE
    // as well as the name is what survives that round trip.
    expect(wafRetryAfterMs({ status: 403, retryAfterSeconds: 30 })).toBeGreaterThan(WAF_WINDOW_MS);
  });

  it('does NOT treat an ordinary 403 as a WAF block', () => {
    // A 403 with no retry hint is something else — an auth or permission
    // problem — and must not buy itself a 35-second nap.
    expect(wafRetryAfterMs({ status: 403 })).toBeNull();
    expect(wafRetryAfterMs(new Error('nope'))).toBeNull();
    expect(wafRetryAfterMs(null)).toBeNull();
    expect(wafRetryAfterMs(undefined)).toBeNull();
  });
});

describe('every Delhivery write passes the write guard (structural)', () => {
  /**
   * The guard is only as good as its coverage, and coverage is a thing a
   * new service silently opts out of by not calling it. Nothing failed
   * when `assertWritable` was absent — the call just went to Delhivery.
   *
   * So this reads the sources the way `worker-role.spec.ts` does. It is
   * a blunt instrument (a service could call the guard for the wrong
   * operation and still pass) but it catches the failure that actually
   * happens: someone adds a POST and does not think about the guard at
   * all.
   *
   * NOTE the deliberate inclusion of a GET: the bulk-waybill fetch spends
   * the account's real AWB allocation, so it is a write in every sense
   * that matters even though the verb says otherwise. Reasoning from the
   * HTTP method alone would have left it unguarded.
   */
  const files = readdirSync(SERVICES_DIR).filter((f) => f.endsWith('.service.ts'));

  it('finds the service files it claims to check', () => {
    // Guards against a rename turning this suite into a no-op that passes.
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    const src = readFileSync(join(SERVICES_DIR, file), 'utf8');
    const mutates = /method:\s*'(POST|PUT|PATCH|DELETE)'/.test(src);
    if (!mutates) continue;

    it(`${file} calls assertWritable before its mutating request`, () => {
      expect(src).toContain('assertWritable');
      // The guard must come BEFORE the call it protects, or it is
      // auditing a write that already happened.
      expect(src.indexOf('assertWritable')).toBeLessThan(src.indexOf('this.http.request'));
    });
  }

  it('the waybill pool is guarded even though its call is a GET', () => {
    const src = readFileSync(join(SERVICES_DIR, 'delhivery-waybill-pool.service.ts'), 'utf8');
    expect(src).toContain("assertWritable('waybill.fetch'");
  });
});
