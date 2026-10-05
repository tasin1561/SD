/**
 * A credential's field NAME is safe to say. Its VALUE never is.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * CUR-1 says plaintext is never logged, never serialized to a response
 * and never cached beyond five minutes. Nothing in the estate
 * deliberately puts a credential into a message — and on 29 September
 * 2026 one did anyway, for six nights, into three durable places at
 * once.
 *
 * `PortalSessionService` interpolated the `portalCompany` credential
 * field into a Playwright locator (`page.getByText(company)`), and a
 * locator timeout QUOTES the text it was waiting for. The owner had
 * typed their new Delhivery portal password into `portalCompany`
 * instead of `portalPassword`, so every nightly failure wrote the
 * plaintext password into the error message — which became nine
 * `audit_logs` rows (append-only, MUST NOT #3, so they cannot be
 * erased), three `system_issues.detail` rows and the text on the
 * `/cost-sync` page. The misconfiguration was the owner's. The leak was
 * ours, and it forced a credential rotation.
 *
 * ── WHAT THIS IS, AND WHAT IT IS NOT ─────────────────────────────────
 * This is the BACKSTOP, not the fix. The fix is that an error names the
 * FIELD and never carries the value — `credential-redaction` exists
 * because "no call site interpolates a secret" is not a property anybody
 * can establish by reading, and the next person to write
 * `getByText(company)` will not know this ever happened.
 *
 * It follows `scripts/tutorials/lib/elevenlabs-keys.mjs`, which refers
 * to a key by its POSITION and runs every outgoing message through a
 * `redact()` that should never fire.
 *
 * ── BIASED TOWARDS OVER-REDACTION, DELIBERATELY ──────────────────────
 * Matching is case-INSENSITIVE and the length floor is low, so a short
 * or oddly-cased value can mangle a message that merely happens to
 * contain it. That is the cheap direction: a mangled sentence costs
 * somebody a minute, and a leaked credential costs a rotation and
 * leaves permanent rows behind. The floor exists only because a one- or
 * two-character value matches everything, and a value that short is
 * itself the problem to report.
 *
 * Pure. No logging, no I/O, no Nest — a redactor that could throw would
 * be reached from inside a catch block.
 */

/**
 * Below this, a value is noise rather than a secret: a two-character
 * string appears in every message and redacting it would destroy the
 * diagnosis without protecting anything.
 */
export const REDACTION_MIN_VALUE_LENGTH = 3;

/** Replaces every credential value in a message with its field name. */
export type CredentialRedactor = (text: string) => string;

/** Escapes a value for use inside a RegExp — a password may hold anything. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A redactor for one decrypted credential map.
 *
 * Longest values first, so a value that CONTAINS another is replaced
 * whole rather than left as a recognisable fragment around a
 * placeholder.
 */
export function makeCredentialRedactor(
  credentials: Readonly<Record<string, string | undefined>>,
): CredentialRedactor {
  const secrets = Object.entries(credentials)
    .flatMap(([field, value]) =>
      typeof value === 'string' && value.trim().length >= REDACTION_MIN_VALUE_LENGTH
        ? [{ field, value: value.trim() }]
        : [],
    )
    .sort((a, b) => b.value.length - a.value.length);

  if (secrets.length === 0) return (text) => text;

  return (text) => {
    let out = text;
    for (const { field, value } of secrets) {
      out = out.replace(new RegExp(escapeForRegExp(value), 'gi'), `«${field} redacted»`);
    }
    return out;
  };
}

/**
 * Scrub a thrown error's message and stack IN PLACE and hand it back.
 *
 * Mutation rather than wrapping, and that is load-bearing: callers test
 * `err instanceof PortalChallengeError` to decide whether to freeze the
 * queue or treat the failure as retryable, so a wrapper would turn a
 * challenge into an ordinary error and the portal would keep knocking.
 * `Error.prototype.message` and `.stack` are writable, the class
 * survives, and so does the original stack frame.
 *
 * The STACK matters as much as the message: V8 renders it as
 * `Error: <message>\n    at …`, so redacting only the message leaves
 * the value in whatever logs the stack.
 */
export function redactCredentialsInError(err: unknown, redact: CredentialRedactor): unknown {
  if (!(err instanceof Error)) {
    // A thrown string or object. Stringified here rather than at each
    // catch site, so the value cannot escape through a `String(err)`
    // somebody writes later.
    return new Error(redact(typeof err === 'string' ? err : String(err)));
  }
  try {
    err.message = redact(err.message);
    if (typeof err.stack === 'string') err.stack = redact(err.stack);
  } catch {
    // A frozen error, or an exotic subclass with a getter-only message.
    // The original must still reach the caller: a redaction that could
    // swallow the failure it is scrubbing would be worse than the leak.
  }
  return err;
}

/**
 * Does this read like a company name, or like something typed into the
 * wrong field?
 *
 * Says a CLASS, never a value. It exists because the leak this file was
 * written for was a password in `portalCompany`, and nothing looked at
 * the value's SHAPE — so night one presented as a selector timeout and
 * cost six days before anybody read the field.
 *
 * Two signals, and the second is the one that earns its keep:
 *
 *   1. Company names on Delhivery ONE are letters, digits, spaces and a
 *      little punctuation. Anything else — `@`, `#`, `!`, `%` — is a
 *      password's alphabet, not a company's.
 *   2. A company name is several WORDS, or one word of letters. A single
 *      space-free run that mixes letters and digits is the shape of a
 *      password, and it is the shape the real incident had
 *      (`Tr0ub4dor&3-horse` passes signal 1 outright).
 *
 * Signal 2 misreads a genuinely one-word alphanumeric company — "3M",
 * "Shop24" — as password-shaped, and that is accepted deliberately:
 * this is only ever consulted about a value that has ALREADY failed to
 * match anything the dropdown offered, so the worst case is one
 * over-eager sentence beside a list of the real names. The inverse
 * error costs six days.
 */
export function looksLikeCompanyName(value: string): boolean {
  const v = value.trim();
  if (v === '') return false;
  if (!/^[A-Za-z0-9 .,&'()\-/]+$/.test(v)) return false;
  if (!/[A-Za-z]/.test(v)) return false;
  const words = v.split(/\s+/);
  if (words.length > 1) return true;
  // One word: letters (and a little punctuation) only.
  return !/\d/.test(v);
}
