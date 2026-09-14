'use client';

import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent, type ReactElement } from 'react';
import { AccessTokenStore, ApiClient } from '@skydrop/api-client';
import { Button, FormField, Input } from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';

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
      <p className="text-sm">
        This link is missing its token. Ask for a new one from the sign-in page.
      </p>
    );
  }
  if (state === 'done') {
    return (
      <p className="text-sm" role="status">
        Your password is set, and every signed-in session was ended.{' '}
        <a href="/login" className="text-accent hover:text-accent-hover">
          Sign in
        </a>
        .
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <FormField label="New password" htmlFor="password" required>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
        disabled={state === 'saving'}
        className="w-full"
      >
        {state === 'saving' ? 'Saving…' : 'Set password'}
      </Button>
    </form>
  );
}
