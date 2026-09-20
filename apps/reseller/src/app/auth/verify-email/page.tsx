import { Suspense, type ReactElement } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { VerifyPanel } from './_components/verify-panel';

/** Confirm an email address from the emailed link. */
export default function VerifyEmailPage(): ReactElement {
  return (
    <AuthFrame section="verification" note="confirming" title="Confirm your email">
      <Suspense fallback={null}>
        <VerifyPanel />
      </Suspense>
    </AuthFrame>
  );
}
