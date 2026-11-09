import { isSolustationError, type SolustationFailure } from '../types/solustation.types';

/**
 * The immediate second attempt, from the brief: "retry once after 2 s
 * with the same `reference_id` (free, idempotent)".
 */
export const IMMEDIATE_RETRY_DELAY_MS = 2_000;

/**
 * The longest `Retry-After` worth honouring INLINE.
 *
 * A 429 asking for three seconds is worth waiting for. One asking for
 * ninety is not: there is a person on the other side of this call, and
 * the 60-second sweep already exists precisely so a long wait happens
 * somewhere nobody is watching. Beyond this bound the call gives up
 * immediately and the check lands `unavailable` with the sweep to
 * follow — which is strictly better than holding a request open.
 */
export const MAX_INLINE_RETRY_AFTER_MS = 5_000;

/** Failures where a second attempt can plausibly differ. */
const TRANSIENT: ReadonlySet<SolustationFailure> = new Set<SolustationFailure>([
  'TIMEOUT',
  'NETWORK',
  'SERVER',
  'RATE_LIMITED',
]);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export interface RetryOnceOptions {
  /** Injected in tests so 2 real seconds are not spent per case. */
  readonly wait?: (ms: number) => Promise<void>;
  /** Called just before the second attempt, for logging. */
  readonly onRetry?: (delayMs: number, failure: SolustationFailure) => void;
}

/**
 * Run `attempt`; on a TRANSIENT Solustation failure, run it exactly once
 * more.
 *
 * ── WHY RETRYING IS SAFE AND FREE HERE ───────────────────────────────
 * Every retryable call this wraps carries the same `reference_id`, and
 * Solustation bills a unit per reference per month and returns the
 * STORED answer for a repeat. So the second attempt costs nothing and
 * cannot produce a second, divergent judgement. That is the property
 * that makes a blind retry correct rather than merely convenient.
 *
 * ── AND WHY IT IS *ONCE* ─────────────────────────────────────────────
 * One retry turns a dropped packet into a result. A loop turns a service
 * having a bad minute into a thread pool holding requests open while an
 * operator waits, and the 60-second sweep is the right home for anything
 * that needs more patience than that. `BAD_REQUEST` and `AUTH` are
 * deliberately excluded: re-sending a malformed body gets the same 422,
 * and hammering a rejected key is how an account gets locked out.
 *
 * The caller still handles failure. Exhausting the retry re-throws the
 * SECOND error, and every caller is required to treat a throw as
 * `confirm_with_customer` — never as approval.
 */
export async function retryOnceOnTransient<T>(
  attempt: () => Promise<T>,
  opts: RetryOnceOptions = {},
): Promise<T> {
  const wait = opts.wait ?? sleep;
  try {
    return await attempt();
  } catch (first) {
    if (!isSolustationError(first) || !TRANSIENT.has(first.classification)) throw first;

    const delay = retryDelayMs(first.classification, first.retryAfterSeconds);
    // `null` means "not worth waiting for inline" — see
    // MAX_INLINE_RETRY_AFTER_MS. The original error stands.
    if (delay === null) throw first;

    opts.onRetry?.(delay, first.classification);
    await wait(delay);
    return await attempt();
  }
}

/** Null when the wait is too long to hold a request open for. */
function retryDelayMs(
  failure: SolustationFailure,
  retryAfterSeconds: number | undefined,
): number | null {
  // A 429 states its own terms and they are not ours to shorten.
  if (failure === 'RATE_LIMITED') {
    if (retryAfterSeconds === undefined) return IMMEDIATE_RETRY_DELAY_MS;
    const asked = retryAfterSeconds * 1_000;
    return asked > MAX_INLINE_RETRY_AFTER_MS ? null : Math.max(asked, 0);
  }
  return IMMEDIATE_RETRY_DELAY_MS;
}
