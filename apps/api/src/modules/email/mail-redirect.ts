import type { SendEmailInput } from './email-provider';

/** Carries the real recipient through a forward, where a subject is lost. */
export const ORIGINAL_TO_HEADER = 'X-Skydrop-Original-To';

/**
 * Diverting staging mail to one inbox.
 *
 * Staging exists to test the real system, and mail is part of it — but a
 * test order carries a real-looking customer address, and there is no
 * version of "oops" that unsends it. `MAIL_REDIRECT_TO` moves every
 * message to one inbox so the notifications can be READ without any of
 * them being able to arrive anywhere else. A redirect rather than an
 * allow-list on purpose: an allow-list silently drops whatever nobody
 * thought to list, which is exactly the set worth looking at.
 *
 * ── WHY THIS IS A FUNCTION THE ROUTER CALLS, NOT A THING EACH PROVIDER
 *    DOES ────────────────────────────────────────────────────────────
 * It lived inside `ResendService` while Resend was the only provider,
 * which was fine right up until there were two. A per-provider redirect
 * is one provider away from being forgotten, and the symptom of
 * forgetting is a staging box mailing real customers — the exact thing
 * the setting exists to make impossible. So the ROUTER applies it once,
 * above every adapter, and a provider cannot opt out by omission. Same
 * shape as CUR-12: what must happen identically lives outside the
 * adapters.
 */
export function applyMailRedirect(input: SendEmailInput, redirectTo: string): SendEmailInput {
  // A message already addressed to the redirect inbox is left alone —
  // otherwise the founder's own notifications arrive with a pointless
  // "[→ founder@…]" stapled to every subject line.
  if (redirectTo === '' || redirectTo === input.to) return input;

  return {
    ...input,
    to: redirectTo,
    // The real recipient goes in the subject because that is what you
    // read in a list of forty test emails, and in a header because that
    // is what survives being forwarded.
    subject: `[→ ${input.to}] ${input.subject}`,
    headers: { ...(input.headers ?? {}), [ORIGINAL_TO_HEADER]: input.to },
  };
}
