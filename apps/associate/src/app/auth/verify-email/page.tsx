import { Suspense, type ReactElement } from 'react';
import { getT } from '@/i18n/server';
import { AuthFrame } from '@/components/auth-frame';
import { VerifyPanel } from './_components/verify-panel';

/**
 * Confirm an email address from the emailed link.
 *
 * Missing until 2026-10-14, and invisibly so: the API built every store
 * user's `verify_url` against the reseller console, so nobody was ever
 * sent here. `store.email_verification.email` is CREDENTIAL, which by
 * construction has no in-app copy (NOTIF-9) — so a sales person had one
 * channel, and it pointed at a console where their session could not
 * follow them.
 */
export default async function VerifyEmailPage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <AuthFrame title={t('auth.verify.title')}>
      <Suspense fallback={null}>
        <VerifyPanel />
      </Suspense>
    </AuthFrame>
  );
}
