import { Suspense, type ReactElement } from 'react';
import { getT } from '@/i18n/server';
import { AuthFrame } from '@/components/auth-frame';
import { ResetForm } from './_components/reset-form';

/** Set a new password from the emailed link. */
export default async function ResetPasswordPage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <AuthFrame
      section="recovery"
      note="step 2 of 2"
      title={t('auth.reset.title')}
      subtitle={t('auth.reset.subtitle')}
    >
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
    </AuthFrame>
  );
}
