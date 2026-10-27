'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { AccessTokenStore, ApiClient } from '@skydrop/api-client';
import { TextField } from '@skydrop/ui/app/text-field';
import { PasswordField, type PasswordCriterion } from '@skydrop/ui/app/password-field';
import { Button } from '@skydrop/ui/app/button';
import { verdict } from '@/i18n/verdict';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

/**
 * Team-invitation acceptance form. Posts to
 * /auth/seller/accept-team-invitation. On 200 the API sets the
 * __Host-sellerRefresh cookie via Set-Cookie passed through the
 * Next.js proxy; we then hard-nav to /dashboard.
 *
 * FE-2: server rejection surfaces [CODE] message verbatim.
 */
interface FormState {
  readonly fullName: string;
  readonly password: string;
  readonly confirmPassword: string;
}

/**
 * What the meter shows is exactly what `handleSubmit` already checks
 * (at least 12 characters; the two entries match) — display only, the
 * rules themselves are unchanged and the server's verdict still wins
 * (FE-2).
 */
const passwordCriteriaOf = (t: Translate<MessageKey>): readonly PasswordCriterion[] => [
  { id: 'length', label: t('authAcceptTeam.atLeast12Characters'), test: (v) => v.length >= 12 },
];

const INITIAL: FormState = {
  fullName: '',
  password: '',
  confirmPassword: '',
};

export function AcceptTeamInvitationForm({ token }: { readonly token: string }): ReactElement {
  const t = useT();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (form.password.length < 12) {
      setError(t('authAcceptTeam.passwordMustBeAt'));
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError(t('authAcceptTeam.passwordsDoNotMatch'));
      return;
    }
    setSubmitting(true);

    const body = {
      token,
      fullName: form.fullName.trim(),
      password: form.password,
    };

    try {
      const store = new AccessTokenStore();
      const client = new ApiClient({
        identityKind: 'seller',
        tokenStore: store,
      });
      await client.request('/api/auth/seller/accept-team-invitation', {
        method: 'POST',
        body,
      });
      window.location.assign('/dashboard');
    } catch (err) {
      setError(verdict(err, t, t('authAcceptTeam.acceptFailed')));
      setSubmitting(false);
    }
  }

  const confirmCriteria: readonly PasswordCriterion[] = [
    {
      id: 'match',
      label: t('authAcceptTeam.matchesThePassword'),
      test: (v) => v !== '' && v === form.password,
    },
  ];

  return (
    <form
      // A refusal belongs to the value that earned it: any edit retires
      // it, so a stale error cannot sit under a field that already fixed it.
      onInput={() => setError(null)}
      onSubmit={handleSubmit}
      className="space-y-3"
    >
      <TextField
        id="full-name"
        type="text"
        label={t('authAcceptTeam.fullName')}
        required
        minLength={1}
        maxLength={120}
        placeholder={t('authAcceptTeam.yourFullName')}
        value={form.fullName}
        onChange={(e) => set('fullName', e.target.value)}
        disabled={submitting}
      />
      <PasswordField
        id="password"
        label={
          <>
            {richMessage(t('authAcceptTeam.password'), {
              span: <span className="text-text-faint">{t('authAcceptTeam.min12Characters')}</span>,
            })}
          </>
        }
        autoComplete="new-password"
        required
        minLength={12}
        maxLength={256}
        value={form.password}
        onChange={(e) => set('password', e.target.value)}
        disabled={submitting}
        showStrength
        criteria={passwordCriteriaOf(t)}
      />
      <PasswordField
        id="confirm-password"
        toggleLabel={t('authAcceptTeam.showConfirmPassword')}
        label={t('authAcceptTeam.confirmPassword')}
        autoComplete="new-password"
        required
        minLength={12}
        maxLength={256}
        value={form.confirmPassword}
        onChange={(e) => set('confirmPassword', e.target.value)}
        disabled={submitting}
        showStrength={false}
        criteria={confirmCriteria}
      />
      {error && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-2.5 py-1.5 rounded-[var(--radius-2)]">
          {error}
        </div>
      )}
      <Button type="submit" fullWidth loading={submitting}>
        {submitting ? t('authAcceptTeam.joining') : t('authAcceptTeam.acceptInvitation')}
      </Button>
    </form>
  );
}
