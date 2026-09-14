'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { AccessTokenStore, ApiClient, ApiError } from '@skydrop/api-client';
import { Button, FormField, Input } from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * The login form. The page has no AuthProvider (that mounts under the
 * authed group), so a one-shot ApiClient does the call. On success the
 * API sets `__Host-storeRefresh` through the proxy and we hard-navigate:
 * the authed layout re-resolves identity from the cookie, and the first
 * authenticated request mints the in-memory access token (FE-1 / FE-4).
 * The access token from this response is deliberately not carried over.
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
      const client = new ApiClient({ identityKind: 'store', tokenStore: new AccessTokenStore() });
      await client.login({ email: email.trim(), password });
      window.location.assign('/dashboard');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Invalid email or password.');
      } else if (err instanceof ApiError && err.status === 429) {
        setError('Too many attempts. Try again in a few minutes.');
      } else {
        // A closed or not-yet-approved store says so in the server's own
        // words (FE-2).
        setError(serverVerdict(err, 'Sign-in failed. Please try again.'));
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <FormField label="Email" htmlFor="email" required>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
        />
      </FormField>
      <FormField label="Password" htmlFor="password" required>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
        />
      </FormField>
      {error !== null ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="md" disabled={submitting} className="w-full">
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
