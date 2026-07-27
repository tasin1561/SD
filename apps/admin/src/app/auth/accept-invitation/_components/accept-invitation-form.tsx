'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactElement } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { ApiError } from '@skydrop/api-client';

const labelClass = 'block text-text-muted text-xs mb-1';
const fieldClass =
  'w-full px-3 py-1.5 rounded-[5px] bg-bg border border-border text-text-bright text-sm focus:border-accent focus:outline-none transition-colors';

interface AccessTokenResponse {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly expiresAt: string;
}

export function AcceptInvitationForm({
  initialToken,
}: {
  readonly initialToken: string;
}): ReactElement {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fmtError(e: unknown): string {
    if (e instanceof ApiError) {
      const b = e.body as { code?: unknown; message?: unknown } | null;
      const code = typeof b?.code === 'string' ? b.code : null;
      const msg = typeof b?.message === 'string' ? b.message : e.message;
      return code ? `[${code}] ${msg}` : msg;
    }
    return e instanceof Error ? e.message : 'Failed to accept invitation';
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!initialToken) {
      setError('Invitation token is missing from the URL.');
      return;
    }
    if (password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/staff/accept-invitation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: initialToken, password }),
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          code?: unknown;
          message?: unknown;
        } | null;
        const code = typeof body?.code === 'string' ? body.code : null;
        const msg =
          typeof body?.message === 'string'
            ? body.message
            : `Request failed with status ${res.status}`;
        throw new ApiError(res.status, code ? `[${code}] ${msg}` : msg, body);
      }
      const json = (await res.json()) as AccessTokenResponse;
      void json;
      router.replace('/dashboard');
      router.refresh();
    } catch (err) {
      setError(fmtError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-bg text-text-body p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-text-bright text-2xl font-semibold tracking-tight">Skydrop</div>
          <div className="text-text-faint text-xs mt-1">Admin</div>
        </div>

        <div className="rounded-[7px] border border-border bg-surface p-6">
          <h1 className="text-text-bright text-base font-semibold mb-1">
            Set up your staff account
          </h1>
          <p className="text-text-muted text-xs mb-5">
            Choose a password (min 12 chars). After submit you&apos;ll be signed in.
          </p>

          <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
            <div>
              <label htmlFor="password" className={labelClass}>
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={256}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                  className={`${fieldClass} pr-9`}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  tabIndex={-1}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-body p-1 rounded-[3px]"
                >
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="confirm-password" className={labelClass}>
                Confirm password
              </label>
              <div className="relative">
                <input
                  id="confirm-password"
                  type={showConfirmPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={256}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={submitting}
                  className={`${fieldClass} pr-9`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPw((s) => !s)}
                  tabIndex={-1}
                  aria-label={showConfirmPw ? 'Hide confirm password' : 'Show confirm password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-body p-1 rounded-[3px]"
                >
                  {showConfirmPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full px-3 py-2 rounded-[5px] bg-accent text-accent-fg text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {submitting ? 'Creating account…' : 'Create account + sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
