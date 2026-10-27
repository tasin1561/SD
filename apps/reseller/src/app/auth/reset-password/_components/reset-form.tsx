'use client';

import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent, type ReactElement } from 'react';
import { KeyRound } from 'lucide-react';
import { AccessTokenStore, ApiClient } from '@skydrop/api-client';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { PasswordField, type PasswordCriterion } from '@skydrop/ui/app/password-field';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';
import { richMessage, useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
import { AuthNotice } from '../../../login/_components/rd-auth-notice';

/**
 * DISPLAY ONLY: the rule the page already states ("At least 10
 * characters.") shown ticking off as it is typed. Nothing here refuses a
 * submit — the server's own verdict is what counts, shown verbatim
 * (FE-2), exactly as before.
 */
const passwordCriteria = (t: Translate<MessageKey>): readonly PasswordCriterion[] => [
  { id: 'length', label: t('auth.reset.criteria'), test: (v) => v.length >= 10 },
];

export function ResetForm(): ReactElement {
  const t = useT();
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
          link: <a href="/login">{t('auth.reset.signInLink')}</a>,
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
      className="rd-auth-form"
    >
      <PasswordField
        id="password"
        label={t('auth.reset.password')}
        autoComplete="new-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        showStrength
        criteria={passwordCriteria(t)}
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
          idle: t('auth.reset.submit'),
          busy: t('auth.reset.saving'),
          error: t('auth.reset.notSaved'),
        }}
        state={state === 'saving' ? 'busy' : error !== null ? 'error' : 'idle'}
        disabled={state === 'saving'}
      />
    </form>
  );
}
