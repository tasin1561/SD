'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { AccessTokenStore, ApiClient, ApiError } from '@skydrop/api-client';
import { TextField } from '@skydrop/ui/app/text-field';
import { Button } from '@skydrop/ui/app/button';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Email-only form that calls /auth/seller/password-reset/request.
 * The API always returns 200 with a generic message regardless of
 * whether the email exists (anti-enumeration) — we surface the same
 * generic "if we recognize it, an email is on its way" copy here so
 * the UI doesn't leak account existence either.
 *
 * Rate limit at the API is 3/hour per email; if a 429 comes back we
 * surface it.
 */
export function PasswordResetRequestForm(): ReactElement {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const client = new ApiClient({
        identityKind: 'seller',
        tokenStore: new AccessTokenStore(),
      });
      await client.request('/api/auth/seller/password-reset/request', {
        method: 'POST',
        body: { email: email.trim() },
      });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Too many requests. Try again in an hour.');
      } else setError(serverVerdict(err, 'Could not request a reset.'));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-[var(--radius-2)] bg-[var(--color-accent-tint)] border border-[var(--color-accent-ring)] px-3 py-2.5 text-xs text-text-bright">
        If <span className="font-mono">{email}</span> matches a seller account, a reset link is on
        its way. The link expires in 30 minutes.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <TextField
        id="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={submitting}
      />
      {error && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-2.5 py-1.5 rounded-[var(--radius-2)]">
          {error}
        </div>
      )}
      <Button type="submit" fullWidth loading={submitting}>
        {submitting ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  );
}
