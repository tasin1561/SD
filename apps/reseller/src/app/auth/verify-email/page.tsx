import { Suspense, type ReactElement } from 'react';
import { getT } from '@/i18n/server';
import { AuthFrame } from '@/components/auth-frame';
import { VerifyPanel } from './_components/verify-panel';

/** Confirm an email address from the emailed link. */
export default async function VerifyEmailPage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <AuthFrame section="verification" note="confirming" title={t('auth.verify.title')}>
      <Suspense fallback={null}>
        <VerifyPanel />
      </Suspense>
    </AuthFrame>
  );
}
