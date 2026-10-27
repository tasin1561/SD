import { Suspense, type ReactElement } from 'react';
import { getT } from '@/i18n/server';
import { AuthFrame } from '@/components/auth-frame';
import { AcceptForm } from './_components/accept-form';

/** Join your store from the emailed invitation. */
export default async function AcceptInvitationPage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <AuthFrame title={t('auth.accept.title')}>
      <Suspense fallback={null}>
        <AcceptForm />
      </Suspense>
    </AuthFrame>
  );
}
