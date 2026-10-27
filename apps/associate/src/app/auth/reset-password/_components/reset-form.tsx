'use client';

import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent, type ReactElement } from 'react';
import { KeyRound } from 'lucide-react';
import { AccessTokenStore, ApiClient } from '@skydrop/api-client';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { PasswordField, type PasswordCriterion } from '@skydrop/ui/app/password-field';
import { richMessage, useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
import { AuthNotice } from '../../../login/_components/auth-notice';

/**
 * DISPLAY ONLY: the rule the page already states ("At least 10
 * characters.") shown ticking off as it is typed. Nothing here refuses a
 * submit — the server's own verdict is what counts, shown verbatim
 * (FE-2).
 */

export function ResetForm(): ReactElement {
  const t = useT();
  const criteria: readonly PasswordCriterion[] = [
    { id: 'length', label: t('auth.password.min10'), test: (v) => v.length >= 10 },
  ];
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
      setError(verdict(err, t));
      setState('idle');
    }
  }

  if (token === '') {
    return <AuthNotice tone="neutral">{t('auth.reset.missingToken')}</AuthNotice>;
  }
  if (state === 'done') {
    return (
      <AuthNotice tone="good" role="status">
        {richMessage(t('auth.reset.done'), {
          signIn: <a href="/login">{t('auth.reset.signInLink')}</a>,
        })}
      </AuthNotice>
    );
  }
  return (
    <form
      // A refusal belongs to the value that earned it: any edit retires
      // it, so a stale error cannot sit under a field that already fixed it.
      onInput={() => setError(null)}
      onSubmit={submit}
      className="as-auth-form"
    >
      <PasswordField
        id="password"
        label={t('auth.reset.newPassword')}
        autoComplete="new-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        showStrength
        criteria={criteria}
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
        labels={{
          idle: t('auth.reset.set'),
          busy: t('common.saving'),
          error: t('common.notSaved'),
        }}
        state={state === 'saving' ? 'busy' : error !== null ? 'error' : 'idle'}
        disabled={state === 'saving'}
      />
    </form>
  );
}
