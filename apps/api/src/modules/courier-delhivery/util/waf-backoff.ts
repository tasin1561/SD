/**
 * Making the WAF-block signal actually do something.
 *
 * `DelhiveryHttpService` recognises HTTP 403 as the AWS WAF rate block
 * (Delhivery answers 403, never 429) and tags the error with
 * `retryAfterSeconds: 30`, because the docs say the WAF needs roughly
 * that long to re-evaluate. **Nothing read that field.** The AWB worker's
 * backoff strategy took only `attemptsMade` and returned the configured
 * per-attempt array — `[1000, 5000, 15000]` ms.
 *
 * So a WAF block played out like this:
 *
 * ```
 *   t=0s     attempt 1 → 403, WAF now blocking our egress IP
 *   t=1s     attempt 2 → 403   (still inside the 30s window)
 *   t=6s     attempt 3 → 403   (still inside the 30s window)
 *   t=21s    attempts exhausted → job dead
 * ```
 *
 * Every retry landed inside the block window, so all three were spent
 * before the WAF would have let anything through — and each one re-hit
 * the WAF, which extends the block. The block is **per egress IP**, not
 * per endpoint, so those retries also take down live customer tracking
 * traffic from the same droplet. The job then dies, and for AWB
 * generation a dead job means zero AWBs on the manifest (CUR-2), which
 * routes real orders to PENDING_MANUAL_PLACEMENT for a reason that was
 * purely self-inflicted.
 *
 * This is the shape of a handler that has never run: it was written,
 * reviewed, and is inert. The signal existed; nothing consumed it.
 */

/** The `name` DelhiveryHttpService stamps on a WAF rate block. */
export const WAF_BLOCK_ERROR_NAME = 'DelhiveryWafBlockError';

/**
 * Margin added on top of Delhivery's stated re-evaluation window.
 *
 * Retrying at exactly the boundary races it, and losing that race costs
 * another full block rather than one wasted request. Five seconds is
 * cheap insurance on a path that is already waiting half a minute.
 */
const WAF_MARGIN_MS = 5_000;

/**
 * How long to wait for a WAF block to clear, or `null` if this error is
 * not one.
 *
 * Matches on the stamped name first and the `403` + `retryAfterSeconds`
 * shape second, so an error that survives a structured-clone boundary
 * (BullMQ serialises failures through Redis, which does not preserve the
 * prototype) is still recognised.
 */
export function wafRetryAfterMs(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { name?: unknown; status?: unknown; retryAfterSeconds?: unknown };

  const named = e.name === WAF_BLOCK_ERROR_NAME;
  const shaped = e.status === 403 && typeof e.retryAfterSeconds === 'number';
  if (!named && !shaped) return null;

  // Trust the server-supplied hint when present; fall back to the
  // documented 30s when only the name survived.
  const seconds = typeof e.retryAfterSeconds === 'number' ? e.retryAfterSeconds : 30;
  return Math.max(0, seconds) * 1_000 + WAF_MARGIN_MS;
}

/**
 * A BullMQ `backoffStrategy` that honours a WAF block.
 *
 * BullMQ hands the strategy `(attemptsMade, type, err, job)` — the error
 * was always available and was simply discarded. Ordinary failures keep
 * the existing per-attempt schedule; a WAF block waits out the window
 * instead of burning the remaining attempts against a closed door.
 *
 * @param perAttemptMs the configured escalating delays, clamped at the last.
 */
export function wafAwareBackoff(
  perAttemptMs: readonly number[],
): (attemptsMade: number, type?: string, err?: Error) => number {
  return (attemptsMade: number, _type?: string, err?: Error): number => {
    const wafMs = wafRetryAfterMs(err);
    if (wafMs !== null) {
      // Never come back SOONER than the ordinary schedule would have.
      const idx = Math.min(Math.max(attemptsMade - 1, 0), perAttemptMs.length - 1);
      return Math.max(wafMs, perAttemptMs[idx] ?? 0);
    }
    // attemptsMade is 1-based after the first failure; clamp to the last.
    const idx = Math.min(Math.max(attemptsMade - 1, 0), perAttemptMs.length - 1);
    return perAttemptMs[idx] ?? 1_000;
  };
}
