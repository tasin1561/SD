'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { AccessTokenStore, ApiClient, ApiError } from '@skydrop/api-client';

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
      } else if (err instanceof ApiError) {
        const b = err.body as { code?: unknown; message?: unknown } | null;
        const code = typeof b?.code === 'string' ? b.code : null;
        const msg = typeof b?.message === 'string' ? b.message : err.message;
        setError(code ? `[${code}] ${msg}` : msg);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Could not request a reset.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-[5px] bg-[var(--color-accent-tint)] border border-[var(--color-accent-ring)] px-3 py-2.5 text-xs text-text-bright">
        If <span className="font-mono">{email}</span> matches a seller
        account, a reset link is on its way. The link expires in 30
        minutes.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="email" className="block text-text-muted text-xs mb-1">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          className="w-full px-3 py-1.5 rounded-[5px] bg-bg border border-border text-text-bright text-sm focus:border-accent focus:outline-none transition-colors disabled:opacity-50"
        />
      </div>
      {error && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-2.5 py-1.5 rounded-[5px]">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="w-full mt-2 px-3 py-1.5 rounded-[5px] bg-accent text-accent-fg text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
      >
        {submitting ? 'Sending…' : 'Send reset link'}
      </button>
    </form>
  );
}
