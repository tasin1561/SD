import { Suspense, type ReactElement } from 'react';
import { getT } from '@/i18n/server';
import { AuthFrame } from '@/components/auth-frame';
import { AcceptForm } from './_components/accept-form';

/** Join a store's team from the emailed invitation. */
export default async function AcceptInvitationPage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <AuthFrame section="enrolment" note="invite-only" title={t('auth.accept.title')}>
      <Suspense fallback={null}>
        <AcceptForm />
      </Suspense>
    </AuthFrame>
  );
}
