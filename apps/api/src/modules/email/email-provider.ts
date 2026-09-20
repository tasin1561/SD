/**
 * The email PROVIDER boundary.
 *
 * Two providers send Skydrop's mail — Resend and Amazon SES — and
 * `EmailProviderRouter` is the ONE place that decides which. This is
 * CUR-12 applied to email: a courier is reached through a dispatcher,
 * never by a branch at the call site, and everything that must happen
 * identically for every provider (the staging redirect, the pacing, the
 * failover rule, the ledger row) stays OUTSIDE the adapters, written
 * once. Add a third provider by implementing this interface and giving
 * the router a rule for it; do not add a branch upstream.
 */

export interface SendEmailInput {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo: string;
  headers?: Record<string, string>;
}

export interface SendEmailResult {
  ok: true;
  providerMessageId: string | null;
}

/**
 * WHY A FAILURE HAS A KIND, AND WHY IT IS THE ADAPTER THAT SAYS SO
 * ─────────────────────────────────────────────────────────────────
 * This is CUR-13's rule, transplanted: classify on whether the provider
 * FORMED AN OPINION ABOUT THE MESSAGE, never on which words the opinion
 * used. Only the adapter knows its own vocabulary, so only the adapter
 * can answer — the same reason `serviceable` is decided inside each
 * courier adapter rather than by the saga above it.
 *
 * The two answers lead to opposite acts, and getting them backwards is
 * expensive in a way that stays invisible for months:
 *
 *   MESSAGE   — "we will not carry THIS message": a rejected or
 *               suppressed address, a body the provider refuses. The
 *               other provider will reach the SAME verdict, because the
 *               message is what is wrong. Failing over here sends the
 *               identical bad address to the reserve provider, doubling
 *               the bounce and damaging BOTH reputations at once — and
 *               the reserve is what carries password resets.
 *
 *   TRANSPORT — nothing was decided about the message at all: a 429, a
 *               5xx, a timeout, a paused or suspended account, a key
 *               that no longer works. The message is fine; this pipe is
 *               not. The other provider is exactly the right answer.
 */
export type EmailFailureKind = 'MESSAGE' | 'TRANSPORT';

export interface SendEmailFailure {
  ok: false;
  code: string;
  message: string;
  /**
   * ABSENT MEANS `MESSAGE`, deliberately — the conservative default.
   * An unclassified failure is treated as an opinion and does NOT fail
   * over. The two mistakes are not symmetric: not using the reserve
   * costs one undelivered email that BullMQ will retry anyway, while
   * failing over on a bad address quietly poisons the provider held
   * back for credential mail. Same inversion CUR-13 landed on after a
   * permanent refusal was read as a wobble and re-asked forever.
   */
  kind?: EmailFailureKind;
}

export type SendEmailOutcome = SendEmailResult | SendEmailFailure;

export interface EmailProvider {
  /**
   * Written verbatim to `notification_logs.provider`. Without it a
   * `provider_message_id` belongs to nobody, and correlating a bounce
   * back to the message that caused it is guesswork.
   */
  readonly name: string;

  /**
   * This provider's own documented requests-per-second ceiling. The
   * router paces to it; the worker sizes its queue limiter from the
   * fastest LIVE one. A single shared constant would mean enabling the
   * fast provider silently removes the slow one's protection.
   */
  readonly maxPerSecond: number;

  /**
   * True when this provider holds real credentials and a send would
   * actually leave the building.
   *
   * CUR-15 is the reason this exists: a stub must never answer for a
   * live provider. Resend with an empty key logs `[DEV] Would send
   * email` and returns ok — right in dev and CI, catastrophic as a
   * failover target for a LIVE SES, because the message comes back
   * "sent" with a provider id nobody issued and the recipient never
   * hears from us.
   */
  isLive(): boolean;

  send(input: SendEmailInput): Promise<SendEmailOutcome>;
}

/** The kind a failure is treated as when its adapter did not say. */
export function failureKind(failure: SendEmailFailure): EmailFailureKind {
  return failure.kind ?? 'MESSAGE';
}
