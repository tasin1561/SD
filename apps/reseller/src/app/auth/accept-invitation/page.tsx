import { Suspense, type ReactElement } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { AcceptForm } from './_components/accept-form';

/** Join a store's team from the emailed invitation. */
export default function AcceptInvitationPage(): ReactElement {
  return (
    <AuthFrame title="Join your store on Skydrop">
      <Suspense fallback={null}>
        <AcceptForm />
      </Suspense>
    </AuthFrame>
  );
}
