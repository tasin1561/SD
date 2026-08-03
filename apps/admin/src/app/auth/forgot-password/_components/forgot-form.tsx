'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { AccessTokenStore, ApiClient, ApiError } from '@skydrop/api-client';

/**
 * Step 1 of the staff password reset — asks for the email, posts to
 * /auth/staff/password-reset/request.
 *
 * The whole flow existed on the API and at step 2 (/auth/reset-password);
 * the only missing piece was somewhere to START it. The login page said
 * "forgot password? contact your admin", which for a SUPER_ADMIN means
 * contact yourself, and for anyone else means waiting on somebody with
 * a database console.
 *
 * ── The response is deliberately uninformative ───────────────────────
 * The API answers 200 whether or not the address belongs to an account.
 * This screen must not improve on that: a page that says "no such
 * account" turns the reset form into a way to test which staff emails
 * exist. So the confirmation is phrased about the ACTION ("if that
 * address belongs to an account…") and never about the outcome.
 */
export function ForgotPasswordForm(): ReactElement {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const client = new ApiClient({ identityKind: 'staff', tokenStore: new AccessTokenStore() });
      await client.request('/api/auth/staff/password-reset/request', {
        method: 'POST',
        body: { email: email.trim() },
      });
      setSent(true);
    } catch (err) {
      // FE-2: the server's verdict verbatim. The one it actually returns
      // here is the rate limit — three an hour per address — and telling
      // someone "too many requests" is far more use than a shrug.
      if (err instanceof ApiError) {
        const b = err.body as { code?: unknown; message?: unknown } | null;
        const code = typeof b?.code === 'string' ? b.code : null;
        const msg = typeof b?.message === 'string' ? b.message : err.message;
        setError(code ? `[${code}] ${msg}` : msg);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Could not send the reset email.');
      }
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-3">
        <div className="rounded-[5px] border border-[var(--color-accent-ring)] bg-[var(--color-accent-tint)] px-3 py-2.5 text-xs text-text-bright">
          If that address belongs to a staff account, a reset link is on its way. It expires in 30
          minutes.
        </div>
        <p className="text-text-muted text-xs">
          Nothing arrived? Check spam, then try again — the link is only sent to the address on the
          account.
        </p>
        <a
          href="/login"
          className="mt-2 block w-full rounded-[5px] bg-accent px-3 py-1.5 text-center text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
        >
          Back to sign in
        </a>
      </div>
    );
  }

  const fieldClass =
    'w-full px-3 py-1.5 rounded-[5px] bg-bg border border-border text-text-bright text-sm focus:border-accent focus:outline-none transition-colors disabled:opacity-50';

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="email" className="text-text-muted mb-1 block text-xs">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          className={fieldClass}
          placeholder="you@skydrop.online"
        />
      </div>

      {error !== null && (
        <div
          role="alert"
          className="text-critical rounded-[5px] border px-3 py-2 text-xs"
          style={{
            background: 'var(--color-critical-tint)',
            borderColor: 'var(--color-critical-ring)',
          }}
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-1 w-full rounded-[5px] bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        {submitting ? 'Sending…' : 'Send reset link'}
      </button>

      <a
        href="/login"
        className="text-text-muted hover:text-text-bright block pt-1 text-center text-xs transition-colors"
      >
        Back to sign in
      </a>
    </form>
  );
}
