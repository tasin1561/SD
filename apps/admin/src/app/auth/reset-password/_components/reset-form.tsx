'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { AccessTokenStore, ApiClient } from '@skydrop/api-client';
import { Button, ButtonLink } from '@skydrop/ui/app/button';
import { PasswordField, type PasswordCriterion } from '@skydrop/ui/app/password-field';
import { serverVerdict } from '@/lib/server-verdict';

/** Display only — the submit handler enforces the length. */
const PASSWORD_CRITERIA: readonly PasswordCriterion[] = [
  { id: 'length', label: 'At least 10 characters', test: (v) => v.length >= 10 },
];

/**
 * Confirms a staff password reset — posts {token, newPassword} to
 * /auth/staff/password-reset/confirm.
 *
 * The API revokes every refresh token on the account in the same
 * transaction as the new hash, so any session anywhere dies and the
 * user signs in fresh. That is the correct behaviour for a reset: the
 * common reason to reset is that someone else may have had the old one.
 *
 * FE-2: a server rejection ([INVALID_TOKEN], [TOKEN_EXPIRED], …) is
 * surfaced verbatim rather than reworded — the server's verdict is the
 * only authority on why a token was refused.
 */
export function ResetPasswordForm({ token }: { readonly token: string }): ReactElement {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (pw.length < 10) {
      setError('Password must be at least 10 characters.');
      return;
    }
    if (pw !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const client = new ApiClient({
        identityKind: 'staff',
        tokenStore: new AccessTokenStore(),
      });
      await client.request('/api/auth/staff/password-reset/confirm', {
        method: 'POST',
        body: { token, newPassword: pw },
      });
      setDone(true);
    } catch (err) {
      setError(serverVerdict(err, 'Could not set the new password.'));
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-3">
        <div className="rounded-[var(--radius-2)] bg-[var(--color-accent-tint)] border border-[var(--color-accent-ring)] px-3 py-2.5 text-xs text-text-bright">
          Password updated. Every existing session was signed out — sign in with the new password to
          continue.
        </div>
        <ButtonLink href="/login" variant="primary" fullWidth>
          Sign in
        </ButtonLink>
      </div>
    );
  }

  const confirmCriteria: readonly PasswordCriterion[] = [
    { id: 'match', label: 'Matches the password', test: (v) => v !== '' && v === pw },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <PasswordField
        id="pw"
        label="New password"
        autoComplete="new-password"
        required
        minLength={10}
        maxLength={256}
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        disabled={submitting}
        criteria={PASSWORD_CRITERIA}
      />
      <PasswordField
        id="confirm"
        toggleLabel="Show confirm password"
        label="Confirm password"
        autoComplete="new-password"
        required
        minLength={10}
        maxLength={256}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        disabled={submitting}
        showStrength={false}
        criteria={confirmCriteria}
      />
      {error !== null && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-2.5 py-1.5 rounded-[var(--radius-2)]">
          {error}
        </div>
      )}
      <Button type="submit" fullWidth loading={submitting}>
        {submitting ? 'Saving…' : 'Save new password'}
      </Button>
    </form>
  );
}
