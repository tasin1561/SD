'use client';

import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent, type ReactElement } from 'react';
import { KeyRound } from 'lucide-react';
import { AccessTokenStore, ApiClient } from '@skydrop/api-client';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { PasswordField, type PasswordCriterion } from '@skydrop/ui/app/password-field';
import { serverVerdict } from '@/lib/server-verdict';
import { AuthNotice } from '../../../login/_components/rd-auth-notice';

/**
 * DISPLAY ONLY: the rule the page already states ("At least 10
 * characters.") shown ticking off as it is typed. Nothing here refuses a
 * submit — the server's own verdict is what counts, shown verbatim
 * (FE-2), exactly as before.
 */
const PASSWORD_CRITERIA: readonly PasswordCriterion[] = [
  { id: 'length', label: 'At least 10 characters', test: (v) => v.length >= 10 },
];

export function ResetForm(): ReactElement {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setState('saving');
    setError(null);
    try {
      const client = new ApiClient({ identityKind: 'store', tokenStore: new AccessTokenStore() });
      await client.request('/api/auth/store/password-reset/confirm', {
        method: 'POST',
        body: { token, newPassword: password },
        suppressRefresh: true,
      });
      setState('done');
    } catch (err) {
      // The server's own verdict (FE-2): its minimum length, an expired link.
      setError(serverVerdict(err));
      setState('idle');
    }
  }

  if (token === '') {
    return (
      <AuthNotice tone="neutral">
        This link is missing its token. Ask for a new one from the sign-in page.
      </AuthNotice>
    );
  }
  if (state === 'done') {
    return (
      <AuthNotice tone="good" role="status">
        Your password is set, and every signed-in session was ended. <a href="/login">Sign in</a>.
      </AuthNotice>
    );
  }
  return (
    <form onSubmit={submit} className="rd-auth-form">
      <PasswordField
        id="password"
        label="New password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        showStrength
        criteria={PASSWORD_CRITERIA}
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
        icon={<KeyRound size={15} />}
        labels={{ idle: 'Set password', busy: 'Saving…', error: 'Not saved' }}
        state={state === 'saving' ? 'busy' : error !== null ? 'error' : 'idle'}
        disabled={state === 'saving'}
      />
    </form>
  );
}
