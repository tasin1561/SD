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
 * On success: the API sets __Host-staffRefresh via Set-Cookie (passed
 * through the Next.js proxy). We hard-navigate to /dashboard, which
 * runs the (authed) layout SSR → cookie→/me → mounts AuthProvider
 * with the identity. The in-memory access token from the login
 * response is intentionally NOT carried across the navigation — the
 * authed layout's first authenticated request will trigger a
 * silent-refresh that mints a fresh access token. This keeps the
 * mental model uniform: ALL authed pages get their access token
 * via a refresh.
 *
 * (Alternative: persist the access token in sessionStorage, hand it
 * to the AuthProvider on mount. We DON'T do that — FE-1 forbids
 * persistence; the silent-refresh roundtrip is a few hundred ms and
 * the symmetry is worth more than the savings.)
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
      const client = new ApiClient({ identityKind: 'staff', tokenStore: store });
      await client.login({ email: email.trim(), password });
      // Hard nav — SSR re-runs (authed) layout, hydrates identity
      // via cookie→/me, mounts AuthProvider.
      window.location.assign('/dashboard');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Invalid email or password.');
      } else if (err instanceof ApiError && err.status === 429) {
        setError('Too many attempts. Try again in a few minutes.');
      } else {
        setError('Sign-in failed. Please try again.');
      }
      setSubmitting(false);
    }
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
          className="w-full px-3 py-1.5 rounded-[5px] bg-bg border border-border text-text-bright text-sm focus:border-accent focus:outline-none transition-colors"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-text-muted text-xs mb-1">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          className="w-full px-3 py-1.5 rounded-[5px] bg-bg border border-border text-text-bright text-sm focus:border-accent focus:outline-none transition-colors"
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
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
