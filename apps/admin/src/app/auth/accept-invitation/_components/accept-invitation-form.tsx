'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactElement } from 'react';
import { ApiError } from '@skydrop/api-client';
import { Button, ButtonLink } from '@skydrop/ui/app/button';
import { PasswordField, type PasswordCriterion } from '@skydrop/ui/app/password-field';
import { SignInCard } from '@skydrop/ui/app/sign-in';
import { serverVerdict } from '@/lib/server-verdict';

/** Display only — the submit handler below is what enforces the length. */
const PASSWORD_CRITERIA: readonly PasswordCriterion[] = [
  { id: 'length', label: 'At least 12 characters', test: (v) => v.length >= 12 },
];

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
    return serverVerdict(e, 'Failed to accept invitation');
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
      /* Replaces the form rather than covering it. The link is spent;
         leaving a live password field behind a dismissible overlay just
         invites another attempt at something that cannot work. */
      <div role="alertdialog" aria-labelledby="dead-title" aria-describedby="dead-body">
        <SignInCard
          title={<span id="dead-title">{copy.title}</span>}
          note={<span id="dead-body">{copy.body}</span>}
          footer={<a href="/auth/forgot-password">Forgot your password?</a>}
        >
          {/* The server's own words, kept verbatim underneath ours (FE-2)
              — the prose above is our reading of the code, and if the two
              ever disagree the server is right. */}
          <p className="text-text-faint mb-4 text-xs">
            Server said: [{dead.code}] {dead.message}
          </p>
          <ButtonLink href="/login" variant="primary" fullWidth>
            Go to sign in
          </ButtonLink>
        </SignInCard>
      </div>
    );
  }

  const confirmCriteria: readonly PasswordCriterion[] = [
    { id: 'match', label: 'Matches the password', test: (v) => v !== '' && v === password },
  ];

  return (
    <SignInCard
      title="Set up your staff account"
      note="Choose a password of at least 12 characters. You will be signed in straight after."
    >
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <PasswordField
          id="password"
          label="Password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={256}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
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
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={submitting}
          showStrength={false}
          criteria={confirmCriteria}
        />

        {error && (
          <div
            role="alert"
            className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[var(--radius-2)]"
          >
            {error}
          </div>
        )}

        <Button type="submit" fullWidth loading={submitting}>
          {submitting ? 'Creating account…' : 'Create account + sign in'}
        </Button>
      </form>
    </SignInCard>
  );
}
