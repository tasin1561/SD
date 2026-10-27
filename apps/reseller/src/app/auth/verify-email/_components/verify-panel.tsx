'use client';

import { useSearchParams } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import { MailCheck } from 'lucide-react';
import { AccessTokenStore, ApiClient } from '@skydrop/api-client';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { richMessage, useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
import { AuthNotice } from '../../../login/_components/rd-auth-notice';

/**
 * Confirming is a BUTTON, not an effect on load: mail scanners open links
 * to inspect them, and a GET that spends a token would be spent by one.
 */
export function VerifyPanel(): ReactElement {
  const t = useT();
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'idle' | 'working' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function confirm(): Promise<void> {
    setState('working');
    setError(null);
    try {
      const client = new ApiClient({ identityKind: 'store', tokenStore: new AccessTokenStore() });
      await client.request('/api/auth/store/email-verification/confirm', {
        method: 'POST',
        body: { token },
        suppressRefresh: true,
      });
      setState('done');
    } catch (err) {
      setError(verdict(err, t));
      setState('idle');
    }
  }

  if (token === '') {
    return <AuthNotice tone="neutral">{t('auth.verify.missingToken')}</AuthNotice>;
  }
  if (state === 'done') {
    return (
      <AuthNotice tone="good" role="status">
        {richMessage(t('auth.verify.done'), {
          link: <a href="/dashboard">{t('auth.verify.goToStore')}</a>,
        })}
      </AuthNotice>
    );
  }
  return (
    <div className="rd-auth-form">
      <p className="rd-auth-text">{t('auth.verify.prompt')}</p>
      {error !== null ? (
        <AuthNotice tone="critical" role="alert">
          {error}
        </AuthNotice>
      ) : null}
      <AsyncButton
        variant="primary"
        size="lg"
        fullWidth
        icon={<MailCheck size={15} />}
        labels={{
          idle: t('auth.verify.confirm'),
          busy: t('auth.verify.confirming'),
          error: t('auth.verify.notConfirmed'),
        }}
        state={state === 'working' ? 'busy' : error !== null ? 'error' : 'idle'}
        disabled={state === 'working'}
        onClick={() => void confirm()}
      />
    </div>
  );
}
