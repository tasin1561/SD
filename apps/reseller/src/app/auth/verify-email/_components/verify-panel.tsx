'use client';

import { useSearchParams } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import { AccessTokenStore, ApiClient } from '@skydrop/api-client';
import { Button } from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';

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
    return <p className="text-sm">This link is missing its token.</p>;
  }
  if (state === 'done') {
    return (
      <p className="text-sm" role="status">
        Your email is confirmed.{' '}
        <a href="/dashboard" className="text-accent hover:text-accent-hover">
          Go to your store
        </a>
        .
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm">Confirm that this email address is yours.</p>
      {error !== null ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}
      <Button
        variant="primary"
        size="md"
        onClick={() => void confirm()}
        disabled={state === 'working'}
      >
        {state === 'working' ? 'Confirming…' : 'Confirm my email'}
      </Button>
    </div>
  );
}
