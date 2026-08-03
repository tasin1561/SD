'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactElement } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { AuthConsoleHeader } from '@/components/auth-console/console-shell';
import { TiltPanel } from '@/lib/tilt';
import { ApiError } from '@skydrop/api-client';

const labelClass = 'block text-text-muted text-xs mb-1';
const fieldClass =
  'w-full px-3 py-1.5 rounded-[5px] bg-bg border border-border text-text-bright text-sm focus:border-accent focus:outline-none transition-colors';

interface AccessTokenResponse {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly expiresAt: string;
}

/**
 * Refusals that end the road. Anything not listed stays inline, because
 * the difference that matters is whether trying again could work.
 */
const TERMINAL_CODES: ReadonlySet<string> = new Set([
  'INVITATION_ALREADY_USED',
  'INVITATION_EXPIRED',
  'INVITATION_NOT_FOUND',
  'INVALID_INVITATION',
  'INVITATION_REVOKED',
]);

/** What each one means to the person holding the dead link. */
function terminalCopy(code: string): { title: string; body: string } {
  switch (code) {
    case 'INVITATION_ALREADY_USED':
      return {
        title: 'This invitation has already been used',
        body: 'An account was set up with this link. If that was you, sign in — and if you have forgotten the password, the sign-in page can email you a reset.',
      };
    case 'INVITATION_EXPIRED':
      return {
        title: 'This invitation has expired',
        body: 'Invitation links are short-lived on purpose. Ask whoever invited you to send a new one — it takes them a moment.',
      };
    case 'INVITATION_REVOKED':
      return {
        title: 'This invitation was withdrawn',
        body: 'Someone cancelled it before it was used. If that seems wrong, speak to whoever invited you.',
      };
    default:
      return {
        title: 'This invitation link is not valid',
        body: 'It may have been mistyped, or truncated by a mail client. Open the link from your invitation email again, or ask for a fresh one.',
      };
  }
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
  /**
   * A refusal the form can never recover from.
   *
   * Kept apart from `error` on purpose. An inline note is right for
   * "passwords do not match" — you fix it and carry on. It is wrong for
   * a spent or expired invitation: the link is dead, no amount of
   * retyping helps, and a small red line beside a still-enabled button
   * invites exactly that. These get a dialog that says what happened and
   * where to go instead.
   */
  const [dead, setDead] = useState<{ code: string; message: string } | null>(null);

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
      const code =
        err instanceof ApiError && err.body !== null && typeof err.body === 'object'
          ? String((err.body as { code?: unknown }).code ?? '')
          : '';
      const raw =
        err instanceof ApiError && err.body !== null && typeof err.body === 'object'
          ? String((err.body as { message?: unknown }).message ?? '')
          : '';
      if (TERMINAL_CODES.has(code)) {
        setDead({ code, message: raw || fmtError(err) });
      } else {
        setError(fmtError(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (dead !== null) {
    const copy = terminalCopy(dead.code);
    return (
      <>
        <AuthConsoleHeader label="operations console" />
        {/* Replaces the form rather than covering it. The link is spent;
            leaving a live password field behind a dismissible overlay
            just invites another attempt at something that cannot work. */}
        <div
          role="alertdialog"
          aria-labelledby="dead-title"
          aria-describedby="dead-body"
          className="boot-rise boot-rise-2 ticks relative overflow-hidden rounded-xl border bg-surface p-6 sm:p-7"
          style={{ borderColor: 'var(--color-critical-ring)' }}
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="telemetry text-critical">link not usable</span>
            <span className="telemetry text-text-muted">{dead.code.toLowerCase()}</span>
          </div>
          <h1 id="dead-title" className="text-text-bright mb-2 text-lg font-semibold">
            {copy.title}
          </h1>
          <p id="dead-body" className="text-text-muted mb-5 text-sm">
            {copy.body}
          </p>
          {/* The server's own words, kept verbatim underneath ours (FE-2)
              — the prose above is our reading of the code, and if the two
              ever disagree the server is right. */}
          <p className="text-text-faint mb-6 text-xs">
            Server said: [{dead.code}] {dead.message}
          </p>
          <a
            href="/login"
            className="block w-full rounded-[5px] bg-accent px-3 py-1.5 text-center text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
          >
            Go to sign in
          </a>
          <a
            href="/auth/forgot-password"
            className="text-text-muted hover:text-text-bright mt-3 block text-center text-xs transition-colors"
          >
            forgot your password?
          </a>
        </div>
      </>
    );
  }

  return (
    <>
      <AuthConsoleHeader label="operations console" />
      <TiltPanel max={3} className="boot-rise boot-rise-2">
        <div className="relative overflow-hidden rounded-xl border border-border bg-surface ticks p-6 sm:p-7">
          <div className="mb-3 flex items-center justify-between">
            <span className="telemetry" style={{ color: 'var(--sky)' }}>
              new account
            </span>
            <span className="telemetry text-text-muted">by invitation</span>
          </div>
          <h1 className="text-text-bright text-lg font-semibold mb-1">Set up your staff account</h1>
          <p className="text-text-muted text-sm mb-6">
            Choose a password of at least 12 characters. You will be signed in straight after.
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
          <div aria-hidden className="glow-follow" />
        </div>
      </TiltPanel>
    </>
  );
}
