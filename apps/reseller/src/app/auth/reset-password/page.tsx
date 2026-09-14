import { Suspense, type ReactElement } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { ResetForm } from './_components/reset-form';

/** Set a new password from the emailed link. */
export default function ResetPasswordPage(): ReactElement {
  return (
    <AuthFrame title="Set a new password" subtitle="At least 10 characters.">
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
    </AuthFrame>
  );
}
