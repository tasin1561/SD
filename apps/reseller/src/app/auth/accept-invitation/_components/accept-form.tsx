'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { AccessTokenStore, ApiClient } from '@skydrop/api-client';
import { Button, DescriptionList, FormField, Input, Skeleton } from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';

interface Preview {
  readonly email: string;
  readonly fullName: string;
  readonly storeName: string;
  readonly roleName: string;
  readonly expiresAt: string;
}

/**
 * Accept an invitation: say what it is for FIRST (the store, the role,
 * the email), then ask for a password. The preview is a POST so the token
 * never sits in an access log; a bad token gets one generic answer.
 */
export function AcceptForm(): ReactElement {
  const token = useSearchParams().get('token') ?? '';
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token === '') return;
    const client = new ApiClient({ identityKind: 'store', tokenStore: new AccessTokenStore() });
    client
      .request<Preview>('/api/auth/store/invitations/preview', {
        method: 'POST',
        body: { token },
        suppressRefresh: true,
      })
      .then((p) => {
        setPreview(p);
        setFullName(p.fullName);
      })
      .catch((err: unknown) => setLoadError(serverVerdict(err)));
  }, [token]);

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const client = new ApiClient({ identityKind: 'store', tokenStore: new AccessTokenStore() });
      await client.request('/api/auth/store/invitations/accept', {
        method: 'POST',
        body: { token, password, fullName: fullName.trim() },
        suppressRefresh: true,
      });
      // The API set the session cookie; the authed layout picks it up.
      window.location.assign('/dashboard');
    } catch (err) {
      setError(serverVerdict(err));
      setSubmitting(false);
    }
  }

  if (token === '') return <p className="text-sm">This link is missing its token.</p>;
  if (loadError !== null) {
    return (
      <p role="alert" className="text-critical text-sm">
        {loadError}
      </p>
    );
  }
  if (preview === null) return <Skeleton className="h-24 w-full" />;

  return (
    <form onSubmit={submit} className="space-y-4">
      <DescriptionList
        columns={1}
        items={[
          { label: 'Store', value: preview.storeName },
          { label: 'Your role', value: preview.roleName },
          { label: 'Email', value: preview.email },
        ]}
      />
      <FormField label="Your name" htmlFor="fullName" required>
        <Input
          id="fullName"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </FormField>
      <FormField
        label="Choose a password"
        htmlFor="password"
        hint="At least 10 characters."
        required
      >
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
      <Button type="submit" variant="primary" size="md" disabled={submitting} className="w-full">
        {submitting ? 'Setting up…' : 'Join the store'}
      </Button>
    </form>
  );
}
