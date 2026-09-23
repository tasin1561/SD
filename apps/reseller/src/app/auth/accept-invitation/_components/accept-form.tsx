'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { User, UserCheck } from 'lucide-react';
import { AccessTokenStore, ApiClient } from '@skydrop/api-client';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { PasswordField, type PasswordCriterion } from '@skydrop/ui/app/password-field';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { TextField } from '@skydrop/ui/app/text-field';
import { serverVerdict } from '@/lib/server-verdict';
import { AuthNotice } from '../../../login/_components/rd-auth-notice';

interface Preview {
  readonly email: string;
  readonly fullName: string;
  readonly storeName: string;
  readonly roleName: string;
  readonly expiresAt: string;
}

/**
 * DISPLAY ONLY: the rule the field's hint already states ("At least 10
 * characters."), ticking off as it is typed. Nothing here refuses a
 * submit; the server's verdict still decides (FE-2).
 */
const PASSWORD_CRITERIA: readonly PasswordCriterion[] = [
  { id: 'length', label: 'At least 10 characters', test: (v) => v.length >= 10 },
];

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

  if (token === '') return <AuthNotice tone="neutral">This link is missing its token.</AuthNotice>;
  if (loadError !== null) {
    return (
      <AuthNotice tone="critical" role="alert">
        {loadError}
      </AuthNotice>
    );
  }
  if (preview === null) {
    return (
      <div className="rd-auth-skel" role="status" aria-label="Loading the invitation">
        <Skeleton height={88} rounded="md" />
        <Skeleton height={48} rounded="md" />
        <Skeleton height={48} rounded="md" />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rd-auth-form">
      <dl className="rd-auth-facts">
        <dt>Store</dt>
        <dd>{preview.storeName}</dd>
        <dt>Your role</dt>
        <dd>{preview.roleName}</dd>
        <dt>Email</dt>
        <dd>{preview.email}</dd>
      </dl>
      <TextField
        id="fullName"
        label="Your name"
        icon={<User size={15} />}
        required
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
      />
      <PasswordField
        id="password"
        label="Choose a password"
        hint="At least 10 characters."
        autoComplete="new-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        showStrength
        criteria={PASSWORD_CRITERIA}
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
        icon={<UserCheck size={15} />}
        labels={{ idle: 'Join the store', busy: 'Setting up…', error: 'Try again' }}
        state={submitting ? 'busy' : error !== null ? 'error' : 'idle'}
        disabled={submitting}
      />
    </form>
  );
}
