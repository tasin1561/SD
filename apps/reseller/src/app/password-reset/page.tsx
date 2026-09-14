'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { AccessTokenStore, ApiClient } from '@skydrop/api-client';
import { Button, FormField, Input } from '@skydrop/ui/components';
import { AuthFrame } from '@/components/auth-frame';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Ask for a reset link. The API answers the same whether or not the email
 * has a login, so this page says the same thing either way.
 */
export default function PasswordResetRequestPage(): ReactElement {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setState('sending');
    setError(null);
    try {
      const client = new ApiClient({ identityKind: 'store', tokenStore: new AccessTokenStore() });
      await client.request('/api/auth/store/password-reset/request', {
        method: 'POST',
        body: { email: email.trim() },
        suppressRefresh: true,
      });
      setState('sent');
    } catch (err) {
      setError(serverVerdict(err));
      setState('idle');
    }
  }

  return (
    <AuthFrame
      title="Reset your password"
      subtitle="We will email you a link that works for 30 minutes."
      footer={
        <a href="/login" className="text-accent hover:text-accent-hover">
          Back to sign in
        </a>
      }
    >
      {state === 'sent' ? (
        <p className="text-sm" role="status">
          If that email has a store login, a reset link is on its way. Check your inbox.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <FormField label="Email" htmlFor="email" required>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>
          {error !== null ? (
            <p role="alert" className="text-critical text-sm">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={state === 'sending'}
            className="w-full"
          >
            {state === 'sending' ? 'Sending…' : 'Send the link'}
          </Button>
        </form>
      )}
    </AuthFrame>
  );
}
