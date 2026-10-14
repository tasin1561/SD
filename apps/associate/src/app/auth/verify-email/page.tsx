import { Suspense, type ReactElement } from 'react';
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
export default function VerifyEmailPage(): ReactElement {
  return (
    <AuthFrame title="Confirm your email">
      <Suspense fallback={null}>
        <VerifyPanel />
      </Suspense>
    </AuthFrame>
  );
}
