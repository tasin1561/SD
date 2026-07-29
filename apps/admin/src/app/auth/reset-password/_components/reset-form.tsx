'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { AccessTokenStore, ApiClient, ApiError } from '@skydrop/api-client';

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
  const [showPw, setShowPw] = useState(false);

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
      if (err instanceof ApiError) {
        const b = err.body as { code?: unknown; message?: unknown } | null;
        const code = typeof b?.code === 'string' ? b.code : null;
        const msg = typeof b?.message === 'string' ? b.message : err.message;
        setError(code ? `[${code}] ${msg}` : msg);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Could not set the new password.');
      }
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-3">
        <div className="rounded-[5px] bg-[var(--color-accent-tint)] border border-[var(--color-accent-ring)] px-3 py-2.5 text-xs text-text-bright">
          Password updated. Every existing session was signed out — sign in with the new password to
          continue.
        </div>
        <a
          href="/login"
          className="block text-center w-full mt-2 px-3 py-1.5 rounded-[5px] bg-accent text-accent-fg text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          Sign in
        </a>
      </div>
    );
  }

  const fieldClass =
    'w-full px-3 py-1.5 rounded-[5px] bg-bg border border-border text-text-bright text-sm focus:border-accent focus:outline-none transition-colors disabled:opacity-50';
  const labelClass = 'block text-text-muted text-xs mb-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="pw" className={labelClass}>
          New password
        </label>
        <div className="relative">
          <input
            id="pw"
            type={showPw ? 'text' : 'password'}
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={256}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            disabled={submitting}
            className={`${fieldClass} pr-9`}
          />
          <button
            type="button"
            onClick={() => setShowPw((s) => !s)}
            tabIndex={-1}
            aria-label={showPw ? 'Hide password' : 'Show password'}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-body transition-colors p-1 rounded-[3px]"
          >
            {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>
      <div>
        <label htmlFor="confirm" className={labelClass}>
          Confirm password
        </label>
        <input
          id="confirm"
          type={showPw ? 'text' : 'password'}
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={256}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={submitting}
          className={fieldClass}
        />
      </div>
      {error !== null && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-2.5 py-1.5 rounded-[5px]">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="w-full mt-2 px-3 py-1.5 rounded-[5px] bg-accent text-accent-fg text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
      >
        {submitting ? 'Saving…' : 'Save new password'}
      </button>
    </form>
  );
}
