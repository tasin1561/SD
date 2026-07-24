'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import {
  AccessTokenStore,
  ApiClient,
  ApiError,
} from '@skydrop/api-client';

/**
 * Login form. The login page isn't wrapped in an AuthProvider (the
 * provider mounts under the (authed) route group only), so we
 * instantiate a one-shot ApiClient locally to perform the login call.
 *
 * On success: the API sets __Host-sellerRefresh via Set-Cookie (passed
 * through the Next.js proxy). We hard-navigate to /dashboard, which
 * runs the (authed) layout SSR → cookie→/me → mounts AuthProvider
 * with the identity. The in-memory access token from the login
 * response is intentionally NOT carried across the navigation — the
 * authed layout's first authenticated request will trigger a
 * silent-refresh that mints a fresh access token. This keeps the
 * mental model uniform: ALL authed pages get their access token
 * via a refresh (FE-1 / FE-4).
 *
 * Identical shape to apps/admin's login form; the only difference is
 * `identityKind: 'seller'` — the FE-5 identity-parameterization in
 * practice.
 */
export function LoginForm(): ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const store = new AccessTokenStore();
      const client = new ApiClient({ identityKind: 'seller', tokenStore: store });
      await client.login({ email: email.trim(), password });
      // Hard nav — SSR re-runs (authed) layout, hydrates identity
      // via cookie→/me, mounts AuthProvider.
      window.location.assign('/dashboard');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Invalid email or password.');
      } else if (err instanceof ApiError && err.status === 403) {
        // Seller-specific: SUSPENDED/PENDING/REJECTED accounts get a
        // 403 from /me. Surface the server's intent verbatim (FE-2).
        setError(err.message || 'Account not active. Contact support.');
      } else if (err instanceof ApiError && err.status === 429) {
        setError('Too many attempts. Try again in a few minutes.');
      } else {
        setError('Sign-in failed. Please try again.');
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="telemetry block text-text-muted mb-2">
          email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          className="w-full h-12 px-4 rounded-xl bg-bg border border-border text-text-bright text-sm focus:border-accent focus:outline-none transition-colors disabled:opacity-50"
        />
      </div>
      <div>
        <label htmlFor="password" className="telemetry block text-text-muted mb-2">
          password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          className="w-full h-12 px-4 rounded-xl bg-bg border border-border text-text-bright text-sm focus:border-accent focus:outline-none transition-colors disabled:opacity-50"
        />
      </div>
      {error && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2.5 rounded-xl">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="w-full h-12 mt-2 rounded-xl bg-accent text-accent-fg text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
