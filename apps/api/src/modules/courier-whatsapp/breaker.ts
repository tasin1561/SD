/**
 * The WhatsApp reader's circuit breaker. Pure state machine; the state
 * itself lives in Redis (`WhatsappBreakerStore`) so the portal worker
 * and the API's pages read the same one.
 *
 *  - Hard trips (a login page, a CAPTCHA, HTTP 429/5xx) open it at once.
 *  - Soft failures (a timeout, a crashed tab) open it on the 5th in a row.
 *  - Open lasts 15 min, doubling each time it re-opens, up to 2 h.
 *  - After that, ONE probe read is allowed (half-open): success closes
 *    it, failure re-opens it for the next, longer period.
 *  - A login is never retried in a loop: the only sign-in is the one
 *    the probe may trigger after a pause.
 */
export const BREAKER_BASE_MS = 15 * 60 * 1000;
export const BREAKER_MAX_MS = 2 * 60 * 60 * 1000;
export const BREAKER_SOFT_LIMIT = 5;

export type BreakerReason = 'LOGGED_OUT' | 'CAPTCHA' | 'RATE_LIMITED' | 'SERVER_ERROR' | 'FAILURES';

export interface BreakerState {
  readonly status: 'closed' | 'open';
  /** Consecutive soft failures while closed. */
  readonly failures: number;
  /** How many times in a row it has re-opened (drives the doubling). */
  readonly openCount: number;
  readonly openUntil: number | null;
  readonly reason: BreakerReason | null;
}

export const CLOSED: BreakerState = {
  status: 'closed',
  failures: 0,
  openCount: 0,
  openUntil: null,
  reason: null,
};

export function openFor(openCount: number): number {
  return Math.min(BREAKER_MAX_MS, BREAKER_BASE_MS * 2 ** openCount);
}

function open(state: BreakerState, now: number, reason: BreakerReason): BreakerState {
  return {
    status: 'open',
    failures: 0,
    openCount: state.openCount + 1,
    openUntil: now + openFor(state.openCount),
    reason,
  };
}

export type BreakerGate = 'run' | 'probe' | 'wait';

/** May a read start? `probe` = the one half-open read after the pause. */
export function gate(state: BreakerState, now: number): BreakerGate {
  if (state.status === 'closed') return 'run';
  return state.openUntil !== null && now < state.openUntil ? 'wait' : 'probe';
}

export function onSuccess(): BreakerState {
  return CLOSED;
}

/** `hard` = a login page, CAPTCHA, 429 or 5xx. */
export function onFailure(
  state: BreakerState,
  now: number,
  reason: BreakerReason,
  hard: boolean,
): BreakerState {
  // Reads already in flight when it opened report in afterwards: ignore them.
  if (state.status === 'open' && state.openUntil !== null && now < state.openUntil) return state;
  // A failed probe (open, past its time) re-opens, longer.
  if (state.status === 'open') return open(state, now, reason);
  if (hard) return open(state, now, reason);
  const failures = state.failures + 1;
  if (failures >= BREAKER_SOFT_LIMIT) return open(state, now, 'FAILURES');
  return { ...state, failures };
}
