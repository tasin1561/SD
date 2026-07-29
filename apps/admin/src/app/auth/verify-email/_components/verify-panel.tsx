'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { AccessTokenStore, ApiClient, ApiError } from '@skydrop/api-client';

/**
 * Confirms a staff email-verification token.
 *
 * Verifying on mount rather than behind a button: the user already
 * expressed intent by clicking the link in their mailbox, and a second
 * click adds nothing. The token is single-use, so the guard below
 * matters — React strict mode double-invokes effects in development,
 * and firing twice would spend the token and then show the user the
 * failure from its own second attempt.
 *
 * FE-2: the server's verdict is shown verbatim.
 */
export function VerifyEmailPanel({ token }: { readonly token: string }): ReactElement {
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [error, setError] = useState<string | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    void (async () => {
      try {
        const client = new ApiClient({
          identityKind: 'staff',
          tokenStore: new AccessTokenStore(),
        });
        await client.request('/api/auth/staff/email-verification/confirm', {
          method: 'POST',
          body: { token },
        });
        setState('done');
      } catch (err) {
        if (err instanceof ApiError) {
          const b = err.body as { code?: unknown; message?: unknown } | null;
          const code = typeof b?.code === 'string' ? b.code : null;
          const msg = typeof b?.message === 'string' ? b.message : err.message;
          setError(code !== null ? `[${code}] ${msg}` : msg);
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Could not verify the email address.');
        }
        setState('failed');
      }
    })();
  }, [token]);

  if (state === 'working') {
    return <p className="text-text-muted text-xs">Verifying…</p>;
  }

  if (state === 'done') {
    return (
      <div className="space-y-3">
        <div className="rounded-[5px] bg-[var(--color-accent-tint)] border border-[var(--color-accent-ring)] px-3 py-2.5 text-xs text-text-bright">
          Email verified. Nothing else to do here.
        </div>
        <a
          href="/dashboard"
          className="block text-center w-full px-3 py-1.5 rounded-[5px] bg-accent text-accent-fg text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          Go to the console
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-2.5 py-1.5 rounded-[5px]">
        {error}
      </div>
      <p className="text-text-muted text-xs">
        Verification links are single-use and expire. If this one was already used or has aged out,
        sign in and request a new one.
      </p>
      <a
        href="/login"
        className="block text-center w-full px-3 py-1.5 rounded-[5px] border border-border text-text-body text-sm hover:border-border-strong transition-colors"
      >
        Sign in
      </a>
    </div>
  );
}
