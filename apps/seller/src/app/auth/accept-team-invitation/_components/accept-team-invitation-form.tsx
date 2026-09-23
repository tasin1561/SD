'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { AccessTokenStore, ApiClient } from '@skydrop/api-client';
import { TextField } from '@skydrop/ui/app/text-field';
import { PasswordField, type PasswordCriterion } from '@skydrop/ui/app/password-field';
import { Button } from '@skydrop/ui/app/button';
import { serverVerdict } from '@/lib/server-verdict';

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
const PASSWORD_CRITERIA: readonly PasswordCriterion[] = [
  { id: 'length', label: 'At least 12 characters', test: (v) => v.length >= 12 },
];

const INITIAL: FormState = {
  fullName: '',
  password: '',
  confirmPassword: '',
};

export function AcceptTeamInvitationForm({ token }: { readonly token: string }): ReactElement {
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
      setError('Password must be at least 12 characters.');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
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
      setError(serverVerdict(err, 'Accept failed.'));
      setSubmitting(false);
    }
  }

  const confirmCriteria: readonly PasswordCriterion[] = [
    { id: 'match', label: 'Matches the password', test: (v) => v !== '' && v === form.password },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <TextField
        id="full-name"
        type="text"
        label="Full name"
        required
        minLength={1}
        maxLength={120}
        placeholder="Your full name"
        value={form.fullName}
        onChange={(e) => set('fullName', e.target.value)}
        disabled={submitting}
      />
      <PasswordField
        id="password"
        label={
          <>
            Password <span className="text-text-faint">(min 12 characters)</span>
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
        criteria={PASSWORD_CRITERIA}
      />
      <PasswordField
        id="confirm-password"
        toggleLabel="Show confirm password"
        label="Confirm password"
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
        {submitting ? 'Joining…' : 'Accept invitation'}
      </Button>
    </form>
  );
}
