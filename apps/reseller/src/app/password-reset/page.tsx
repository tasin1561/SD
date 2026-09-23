'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { AccessTokenStore, ApiClient } from '@skydrop/api-client';
import { Mail, Send } from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { TextField } from '@skydrop/ui/app/text-field';
import { AuthFrame } from '@/components/auth-frame';
import { serverVerdict } from '@/lib/server-verdict';
import { AuthNotice } from '../login/_components/rd-auth-notice';

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
      section="recovery"
      note="step 1 of 2"
      title="Reset your password"
      subtitle="We will email you a link that works for 30 minutes."
      footer={<a href="/login">Back to sign in</a>}
    >
      {state === 'sent' ? (
        <AuthNotice tone="good" role="status">
          If that email has a store login, a reset link is on its way. Check your inbox.
        </AuthNotice>
      ) : (
        <form onSubmit={submit} className="rd-auth-form">
          <TextField
            id="email"
            type="email"
            label="Email"
            icon={<Mail size={15} />}
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
            icon={<Send size={15} />}
            labels={{ idle: 'Send the link', busy: 'Sending…', error: 'Not sent' }}
            state={state === 'sending' ? 'busy' : error !== null ? 'error' : 'idle'}
            disabled={state === 'sending'}
          />
        </form>
      )}
    </AuthFrame>
  );
}
