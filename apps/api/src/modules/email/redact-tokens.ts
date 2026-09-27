/**
 * Strip live single-use credentials out of the copy of an email we KEEP.
 *
 * A password-reset / email-verification / invitation link is
 * `…?token=<plaintext>`, and the plaintext is deliberately stored
 * nowhere else: the token tables hold only its SHA-256, and the reset
 * ones expire in 30 minutes. `notification_logs` then persisted the
 * fully rendered body — so the one copy of the live secret that outlives
 * the token sat in a table with no expiry, and an invitation's link is
 * good for days.
 *
 * Nothing returns those columns today (the only reader filters to
 * IN_APP and scopes to the caller), so this is blast radius rather than
 * an open door: a database dump, a backup, or the first admin
 * notification-log viewer somebody builds. Which is exactly why the
 * redaction belongs on the WRITE — a reader added later inherits it.
 *
 * Applied to the STORED copy only. The message the recipient receives is
 * rendered and handed to the provider before this runs, so their link
 * still works.
 *
 * A blanket `token=` rewrite rather than a per-template allow-list: a
 * template added next year gets it for free, and there is no legitimate
 * reason to keep a live `token=` value in the ledger for any of them.
 */

export const REDACTED_TOKEN = '[redacted]';

/**
 * The query-parameter shape only. The value runs to the first character
 * that cannot be inside one — `&` (next parameter), a quote or angle
 * bracket (the HTML around an href), whitespace (the text body), or `)`
 * / `]` (a parenthesised or markdown-wrapped URL). Anchored on `token=`
 * preceded by `?`, `&` or `;` so a sentence containing the word is left
 * alone.
 *
 * The negative lookahead is what makes this IDEMPOTENT, and it is
 * derived from the placeholder rather than written out, because the two
 * cannot be allowed to disagree: `[redacted]` ends in `]`, which the
 * value class excludes, so a second pass would otherwise match
 * `[redacted` and append another bracket — `token=[redacted]]`, and
 * again on every run after that. (Caught by the idempotence test, which
 * is why it is there.)
 */
const TOKEN_IN_URL = new RegExp(
  `([?&;]token=)(?!${REDACTED_TOKEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})[^&"'\\s<>)\\]]+`,
  'gi',
);

/** Rewrite every `…?token=<secret>` to `…?token=[redacted]`. */
export function redactTokens(text: string): string {
  return text.replace(TOKEN_IN_URL, `$1${REDACTED_TOKEN}`);
}

/** The same, tolerating the nullable columns. */
export function redactTokensOrNull(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  return redactTokens(text);
}

/**
 * And the same over the template variables, which are persisted beside
 * the body and hold the link in its own right (`reset_url`,
 * `verify_url`, `invite_url`). Redacting the body alone would leave the
 * live secret in the same row — a fix that does not fix.
 *
 * Values are scalars by the `EmailVariables` type, so one shallow pass
 * is the whole surface.
 */
export function redactTokensInVariables<T extends Record<string, unknown>>(variables: T): T {
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(variables)) {
    if (typeof value === 'string') {
      const redacted = redactTokens(value);
      if (redacted !== value) changed = true;
      out[key] = redacted;
    } else {
      out[key] = value;
    }
  }
  return changed ? (out as T) : variables;
}
