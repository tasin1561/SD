'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { Mail } from 'lucide-react';
import { AccessTokenStore, ApiClient, ApiError } from '@skydrop/api-client';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { PasswordField } from '@skydrop/ui/app/password-field';
import { TextField } from '@skydrop/ui/app/text-field';
import { serverVerdict } from '@/lib/server-verdict';
import { AuthNotice } from './auth-notice';

/**
 * The login form. The page has no AuthProvider (that mounts under the
 * authed group), so a one-shot ApiClient does the call. On success the
 * API sets `__Host-storeRefresh` through the proxy and we hard-navigate:
 * the authed layout re-resolves identity from the cookie, and the first
 * authenticated request mints the in-memory access token (FE-1 / FE-4).
 * The access token from this response is deliberately not carried over.
 *
 * The submit button keeps the accessible name "Sign in" while the
 * request runs — the rolling label is visual, and the login spec finds
 * the button by that name.
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
      window.location.assign('/orders');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Invalid email or password.');
      } else if (err instanceof ApiError && err.status === 429) {
        setError('Too many attempts. Try again in a few minutes.');
      } else if (err instanceof ApiError && err.status >= 500) {
        /*
          A 5xx is NOT a verdict, so there is nothing to surface verbatim:
          the server never formed an opinion about these credentials. Left
          to `serverVerdict` it reads "API 500: " — technically the
          error's own words and useless to the person holding the phone,
          who needs to know it is us and not them. FE-2 is untouched: this
          pre-empts no guardrail, because no guardrail answered.
        */
        setError('We could not reach Skydrop just now. Your login is fine — try again shortly.');
      } else {
        // A closed or paused store says so in the server's own words (FE-2).
        setError(serverVerdict(err, 'Sign-in failed. Please try again.'));
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="as-auth-form" noValidate>
      <TextField
        id="email"
        type="email"
        label="Email"
        icon={<Mail size={15} />}
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={submitting}
      />
      <PasswordField
        id="password"
        label="Password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={submitting}
      />
      {error !== null ? (
        <AuthNotice tone="critical" role="alert">
          {error}
        </AuthNotice>
      ) : null}
      <AsyncButton
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        labels={{ idle: 'Sign in', busy: 'Signing in…', error: 'Try again' }}
        state={submitting ? 'busy' : error !== null ? 'error' : 'idle'}
        disabled={submitting}
      />
    </form>
  );
}
