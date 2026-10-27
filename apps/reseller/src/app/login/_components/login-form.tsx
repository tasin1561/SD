'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { Mail } from 'lucide-react';
import { AccessTokenStore, ApiClient, ApiError } from '@skydrop/api-client';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { PasswordField } from '@skydrop/ui/app/password-field';
import { TextField } from '@skydrop/ui/app/text-field';
import { useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
import { AuthNotice } from './rd-auth-notice';

/**
 * The login form. The page has no AuthProvider (that mounts under the
 * authed group), so a one-shot ApiClient does the call. On success the
 * API sets `__Host-storeRefresh` through the proxy and we hard-navigate:
 * the authed layout re-resolves identity from the cookie, and the first
 * authenticated request mints the in-memory access token (FE-1 / FE-4).
 * The access token from this response is deliberately not carried over.
 *
 * The submit button keeps the accessible name "Sign in" while the request
 * runs (the rolling label is visual; the login spec finds it by that name).
 */
export function LoginForm(): ReactElement {
  const t = useT();
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
        setError(t('auth.signIn.invalid'));
      } else if (err instanceof ApiError && err.status === 429) {
        setError(t('auth.signIn.tooMany'));
      } else {
        // A closed or not-yet-approved store says so in the server's own
        // words (FE-2).
        setError(verdict(err, t, t('auth.signIn.failed')));
      }
      setSubmitting(false);
    }
  }

  return (
    <form
      // A refusal belongs to the value that earned it: any edit retires
      // it, so a stale error cannot sit under a field that already fixed it.
      onInput={() => setError(null)}
      onSubmit={handleSubmit}
      className="rd-auth-form"
      noValidate
    >
      <TextField
        id="email"
        type="email"
        label={t('auth.signIn.email')}
        icon={<Mail size={15} />}
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={submitting}
      />
      <PasswordField
        id="password"
        label={t('auth.signIn.password')}
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
        labels={{
          idle: t('auth.signIn.button'),
          busy: t('auth.signIn.busy'),
          error: t('auth.signIn.tryAgain'),
        }}
        state={submitting ? 'busy' : error !== null ? 'error' : 'idle'}
        disabled={submitting}
      />
    </form>
  );
}
