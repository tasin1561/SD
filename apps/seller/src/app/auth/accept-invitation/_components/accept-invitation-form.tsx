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
 * Seller invitation acceptance form. Mirrors LoginForm's pattern
 * (one-shot ApiClient instantiated locally because the auth-provider
 * mounts only under (authed)), but posts to /seller/auth/register/invite
 * instead of /login. On 201 the API sets __Host-sellerRefresh via
 * Set-Cookie (passed through the Next.js proxy); we hard-nav to
 * /dashboard so the (authed) layout SSR resolves identity cleanly.
 *
 * FE-2: any server rejection surfaces the [CODE] message verbatim.
 */
interface FormState {
  readonly companyName: string;
  readonly contactPersonName: string;
  readonly phone: string;
  readonly whatsapp: string;
  readonly password: string;
  readonly confirmPassword: string;
}

/**
 * What the meter shows is exactly what `handleSubmit` already checks
 * (at least 10 characters; the two entries match) — display only, the
 * rules themselves are unchanged and the server's verdict still wins
 * (FE-2).
 */
const passwordCriteriaOf = (t: Translate<MessageKey>): readonly PasswordCriterion[] => [
  { id: 'length', label: t('authAccept.atLeast10Characters'), test: (v) => v.length >= 10 },
];

const INITIAL: FormState = {
  companyName: '',
  contactPersonName: '',
  phone: '',
  whatsapp: '',
  password: '',
  confirmPassword: '',
};

export function AcceptInvitationForm({ token }: { readonly token: string }): ReactElement {
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
    if (form.password.length < 10) {
      setError(t('authAccept.passwordMustBeAt'));
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError(t('authAccept.passwordsDoNotMatch'));
      return;
    }
    setSubmitting(true);

    const body = {
      token,
      companyName: form.companyName.trim(),
      contactPersonName: form.contactPersonName.trim(),
      phone: form.phone.trim(),
      ...(form.whatsapp.trim() ? { whatsapp: form.whatsapp.trim() } : {}),
      password: form.password,
    };

    try {
      const store = new AccessTokenStore();
      const client = new ApiClient({
        identityKind: 'seller',
        tokenStore: store,
      });
      await client.request('/api/auth/seller/register/invite', {
        method: 'POST',
        body,
      });
      // Hard nav — SSR re-runs (authed) layout, hydrates identity
      // via cookie→/me, mounts AuthProvider.
      window.location.assign('/dashboard');
    } catch (err) {
      setError(verdict(err, t, t('authAccept.registrationFailed')));
      setSubmitting(false);
    }
  }

  const confirmCriteria: readonly PasswordCriterion[] = [
    {
      id: 'match',
      label: t('authAccept.matchesThePassword'),
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
        id="company"
        type="text"
        label={t('authAccept.companyName')}
        required
        minLength={2}
        maxLength={120}
        placeholder={t('authAccept.acmeTradingCo')}
        value={form.companyName}
        onChange={(e) => set('companyName', e.target.value)}
        disabled={submitting}
      />
      <TextField
        id="contact"
        type="text"
        label={t('authAccept.contactPerson')}
        required
        minLength={2}
        maxLength={120}
        // Not "your" — this is the company's contact person, who is
        // often not the person filling in the form (an owner sets the
        // account up and names whoever answers the phone).
        placeholder={t('authAccept.contactPersonSFull')}
        value={form.contactPersonName}
        onChange={(e) => set('contactPersonName', e.target.value)}
        disabled={submitting}
      />
      <TextField
        id="phone"
        type="tel"
        label={t('authAccept.phoneE164')}
        required
        placeholder="+8801712345678"
        value={form.phone}
        onChange={(e) => set('phone', e.target.value)}
        disabled={submitting}
      />
      <TextField
        id="whatsapp"
        type="tel"
        label={
          <>
            {richMessage(t('authAccept.whatsapp'), {
              span: <span className="text-text-faint">(optional)</span>,
            })}
          </>
        }
        placeholder="+8801712345678"
        value={form.whatsapp}
        onChange={(e) => set('whatsapp', e.target.value)}
        disabled={submitting}
      />
      <PasswordField
        id="password"
        label={
          <>
            {richMessage(t('authAccept.password'), {
              span: <span className="text-text-faint">{t('authAccept.min10Characters')}</span>,
            })}
          </>
        }
        autoComplete="new-password"
        required
        minLength={10}
        maxLength={256}
        value={form.password}
        onChange={(e) => set('password', e.target.value)}
        disabled={submitting}
        showStrength
        criteria={passwordCriteriaOf(t)}
      />
      <PasswordField
        id="confirm-password"
        toggleLabel={t('authAccept.showConfirmPassword')}
        label={t('authAccept.confirmPassword')}
        autoComplete="new-password"
        required
        minLength={10}
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
        {submitting ? t('authAccept.creatingAccount') : t('authAccept.createAccount')}
      </Button>
    </form>
  );
}
