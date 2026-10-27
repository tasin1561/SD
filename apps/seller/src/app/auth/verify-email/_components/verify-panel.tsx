'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { AccessTokenStore, ApiClient } from '@skydrop/api-client';
import { ButtonLink } from '@skydrop/ui/app/button';
import { verdict } from '@/i18n/verdict';
import { useT } from '@/i18n/client';

/**
 * Confirms a seller email-verification token.
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
  const t = useT();
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [error, setError] = useState<string | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    void (async () => {
      try {
        const client = new ApiClient({
          identityKind: 'seller',
          tokenStore: new AccessTokenStore(),
        });
        await client.request('/api/auth/seller/email-verification/confirm', {
          method: 'POST',
          body: { token },
        });
        setState('done');
      } catch (err) {
        setError(verdict(err, t, t('authVerify.couldNotVerifyThe')));
        setState('failed');
      }
    })();
  }, [token, t]);

  if (state === 'working') {
    return <p className="text-text-muted text-xs">{t('authVerify.verifying')}</p>;
  }

  if (state === 'done') {
    return (
      <div className="space-y-3">
        <div className="rounded-[var(--radius-2)] bg-[var(--color-accent-tint)] border border-[var(--color-accent-ring)] px-3 py-2.5 text-xs text-text-bright">
          {t('authVerify.emailVerifiedNothingElse')}
        </div>
        <ButtonLink href="/dashboard" variant="primary" fullWidth>
          {t('authVerify.goToYourDashboard')}
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-2.5 py-1.5 rounded-[var(--radius-2)]">
        {error}
      </div>
      <p className="text-text-muted text-xs">{t('authVerify.verificationLinksAreSingle')}</p>
      <ButtonLink href="/login" variant="secondary" fullWidth>
        {t('authVerify.signIn')}
      </ButtonLink>
    </div>
  );
}
