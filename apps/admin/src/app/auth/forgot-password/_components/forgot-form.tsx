'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { AccessTokenStore, ApiClient } from '@skydrop/api-client';
import { Button, ButtonLink } from '@skydrop/ui/app/button';
import { TextField } from '@skydrop/ui/app/text-field';
import { serverVerdict } from '@/lib/server-verdict';

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
      setError(serverVerdict(err, 'Could not send the reset email.'));
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-3">
        <div className="rounded-[var(--radius-2)] border border-[var(--color-accent-ring)] bg-[var(--color-accent-tint)] px-3 py-2.5 text-xs text-text-bright">
          If that address belongs to a staff account, a reset link is on its way. It expires in 30
          minutes.
        </div>
        <p className="text-text-muted text-xs">
          Nothing arrived? Check spam, then try again — the link is only sent to the address on the
          account.
        </p>
        <ButtonLink href="/login" variant="primary" fullWidth>
          Back to sign in
        </ButtonLink>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <TextField
        id="email"
        type="email"
        label="Email"
        required
        autoComplete="email"
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={submitting}
        placeholder="you@skydrop.online"
      />

      {error !== null && (
        <div
          role="alert"
          className="text-critical rounded-[var(--radius-2)] border px-3 py-2 text-xs"
          style={{
            background: 'var(--color-critical-tint)',
            borderColor: 'var(--color-critical-ring)',
          }}
        >
          {error}
        </div>
      )}

      <Button type="submit" fullWidth loading={submitting}>
        {submitting ? 'Sending…' : 'Send reset link'}
      </Button>

      <a
        href="/login"
        className="text-text-muted hover:text-text-bright block pt-1 text-center text-xs transition-colors"
      >
        Back to sign in
      </a>
    </form>
  );
}
