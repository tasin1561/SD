'use client';

import { useSearchParams } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import { MailCheck } from 'lucide-react';
import { AccessTokenStore, ApiClient } from '@skydrop/api-client';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { serverVerdict } from '@/lib/server-verdict';
import { AuthNotice } from '../../../login/_components/rd-auth-notice';

/**
 * Confirming is a BUTTON, not an effect on load: mail scanners open links
 * to inspect them, and a GET that spends a token would be spent by one.
 */
export function VerifyPanel(): ReactElement {
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
      setError(serverVerdict(err));
      setState('idle');
    }
  }

  if (token === '') {
    return <AuthNotice tone="neutral">This link is missing its token.</AuthNotice>;
  }
  if (state === 'done') {
    return (
      <AuthNotice tone="good" role="status">
        Your email is confirmed. <a href="/dashboard">Go to your store</a>.
      </AuthNotice>
    );
  }
  return (
    <div className="rd-auth-form">
      <p className="rd-auth-text">Confirm that this email address is yours.</p>
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
        labels={{ idle: 'Confirm my email', busy: 'Confirming…', error: 'Not confirmed' }}
        state={state === 'working' ? 'busy' : error !== null ? 'error' : 'idle'}
        disabled={state === 'working'}
        onClick={() => void confirm()}
      />
    </div>
  );
}
