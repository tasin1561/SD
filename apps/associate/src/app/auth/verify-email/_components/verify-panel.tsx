'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import { MailCheck } from 'lucide-react';
import { AccessTokenStore, ApiClient } from '@skydrop/api-client';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { richMessage, useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
import { AuthNotice } from '../../../login/_components/auth-notice';

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
    return <AuthNotice tone="neutral">{t('common.missingToken')}</AuthNotice>;
  }
  if (state === 'done') {
    return (
      <AuthNotice tone="good" role="status">
        {/*
          An associate lands on their ORDERS — there is no dashboard in
          this console. `next/link` rather than a bare <a>, which
          `@next/next/no-html-link-for-pages` refuses for a route this
          app actually serves: a plain anchor costs a full document load
          and throws away the client router.
        */}
        {richMessage(t('auth.verify.done'), {
          link: <Link href="/orders">{t('auth.verify.goOrders')}</Link>,
        })}
      </AuthNotice>
    );
  }
  return (
    <div className="as-auth-form">
      <p className="as-auth-text">{t('auth.verify.prompt')}</p>
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
          busy: t('auth.verify.busy'),
          error: t('auth.verify.notConfirmed'),
        }}
        state={state === 'working' ? 'busy' : error !== null ? 'error' : 'idle'}
        disabled={state === 'working'}
        onClick={() => void confirm()}
      />
    </div>
  );
}
