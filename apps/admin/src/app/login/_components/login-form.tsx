'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { AccessTokenStore, ApiClient, ApiError } from '@skydrop/api-client';

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
  const [showPw, setShowPw] = useState(false);
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
        <div className="relative">
          <input
            id="password"
            type={showPw ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            className="w-full h-12 pl-4 pr-12 rounded-xl bg-bg border border-border text-text-bright text-sm focus:border-accent focus:outline-none transition-colors disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            tabIndex={-1}
            aria-label={showPw ? 'Hide password' : 'Show password'}
            className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-10 h-10 rounded-lg text-text-muted hover:text-text-bright transition-colors"
          >
            {showPw ? (
              <EyeOff size={16} aria-hidden="true" />
            ) : (
              <Eye size={16} aria-hidden="true" />
            )}
          </button>
        </div>
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
