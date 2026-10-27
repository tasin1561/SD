'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { User, UserCheck } from 'lucide-react';
import { AccessTokenStore, ApiClient } from '@skydrop/api-client';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { PasswordField, type PasswordCriterion } from '@skydrop/ui/app/password-field';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { TextField } from '@skydrop/ui/app/text-field';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';
import { useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
import { AuthNotice } from '../../../login/_components/rd-auth-notice';

interface Preview {
  readonly email: string;
  readonly fullName: string;
  readonly storeName: string;
  /**
   * Every role the invitation offers, already joined by the server
   * (`offered.map(r => r.name).join(', ')`) — an invitation may offer
   * more than one, so the label is plural.
   */
  readonly roleName: string;
  readonly expiresAt: string;
}

/**
 * DISPLAY ONLY: the rule the field's hint already states ("At least 10
 * characters."), ticking off as it is typed. Nothing here refuses a
 * submit; the server's verdict still decides (FE-2).
 */
const passwordCriteria = (t: Translate<MessageKey>): readonly PasswordCriterion[] => [
  { id: 'length', label: t('auth.accept.criteria'), test: (v) => v.length >= 10 },
];

/**
 * Accept an invitation: say what it is for FIRST (the store, the role,
 * the email), then ask for a password. The preview is a POST so the token
 * never sits in an access log; a bad token gets one generic answer.
 */
export function AcceptForm(): ReactElement {
  const t = useT();
  // The preview is fetched once per token; a language switch must not re-fetch it
  // (and overwrite a name already typed), so the effect reads the translator from a ref.
  const tRef = useRef(t);
  tRef.current = t;
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
      .catch((err: unknown) => setLoadError(verdict(err, tRef.current)));
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
      setError(verdict(err, t));
      setSubmitting(false);
    }
  }

  if (token === '') return <AuthNotice tone="neutral">{t('auth.accept.missingToken')}</AuthNotice>;
  if (loadError !== null) {
    return (
      <AuthNotice tone="critical" role="alert">
        {loadError}
      </AuthNotice>
    );
  }
  if (preview === null) {
    return (
      <div className="rd-auth-skel" role="status" aria-label={t('auth.accept.loading')}>
        <Skeleton height={88} rounded="md" />
        <Skeleton height={48} rounded="md" />
        <Skeleton height={48} rounded="md" />
      </div>
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
      <dl className="rd-auth-facts">
        <dt>{t('auth.accept.store')}</dt>
        <dd>{preview.storeName}</dd>
        <dt>{t('auth.accept.roles')}</dt>
        <dd>{preview.roleName}</dd>
        <dt>{t('auth.accept.email')}</dt>
        <dd>{preview.email}</dd>
      </dl>
      <TextField
        id="fullName"
        label={t('auth.accept.name')}
        icon={<User size={15} />}
        required
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
      />
      <PasswordField
        id="password"
        label={t('auth.accept.password')}
        hint={t('auth.accept.passwordHint')}
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
        icon={<UserCheck size={15} />}
        labels={{
          idle: t('auth.accept.join'),
          busy: t('auth.accept.busy'),
          error: t('auth.accept.tryAgain'),
        }}
        state={submitting ? 'busy' : error !== null ? 'error' : 'idle'}
        disabled={submitting}
      />
    </form>
  );
}
