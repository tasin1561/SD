/**
 * Single-flight refresh coordinator. The dashboard can fire many
 * concurrent requests; if the access token has expired, ALL of them
 * 401 in quick succession. Without coordination each would
 * independently call /refresh, and the API's reuse-detection
 * family-burn (RefreshTokenService.rotate handling of revoked tokens)
 * would fire on the second concurrent rotate against an already-
 * rotated cookie — logging the user out + writing a HIGH audit
 * `security.refresh_replay_detected` on a LEGITIMATE session.
 *
 * This module guarantees: AT MOST ONE in-flight /refresh at a time.
 * Concurrent callers receive the SAME promise; when it settles every
 * waiter is unblocked with the same outcome. The next /refresh fires
 * lazily on the next 401 after settlement.
 *
 * Why explicit single-flight instead of relying on browser request
 * coalescing: fetch() does NOT coalesce — every fetch call is its
 * own network request. The coordination MUST live in app code.
 *
 * Crash semantics:
 *   - refresh succeeds → state cleared, returns ok
 *   - refresh fails (401, network) → state cleared, returns fail
 *   - refresh throws (programmer error) → state cleared, rethrows
 * In all three the next 401 starts a fresh refresh.
 */

export type RefreshOutcome = 'OK' | 'FAILED';

export interface RefreshFn {
  (): Promise<RefreshOutcome>;
}

export class SingleFlightRefresh {
  private inFlight: Promise<RefreshOutcome> | null = null;

  constructor(private readonly refresh: RefreshFn) {}

  /**
   * Call once per 401. Returns the SAME promise to concurrent callers
   * — exactly one underlying refresh fires. The promise settles when
   * the refresh resolves; the next call after settlement starts a
   * fresh refresh.
   *
   * NOT declared `async`: an `async` wrapper would create a NEW
   * promise per call (even when forwarding `this.inFlight`), so
   * concurrent callers would receive distinct promises that happen
   * to resolve to the same value. We need IDENTICAL promise instances
   * so a consumer that awaits one is awaiting the same underlying
   * settlement as another — and so `expect(a).toBe(b)` is observable
   * (a useful diagnostic).
   */
  run(): Promise<RefreshOutcome> {
    if (this.inFlight) return this.inFlight;
    const work = this.refresh().finally(() => {
      // Clear so the next 401 starts a fresh refresh. `finally` fires
      // on success, rejection, and the resolved-failure outcome
      // alike.
      this.inFlight = null;
    });
    this.inFlight = work;
    return work;
  }

  /** Test/observability — true when a refresh is currently in-flight. */
  isInFlight(): boolean {
    return this.inFlight !== null;
  }
}
