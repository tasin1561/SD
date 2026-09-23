import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { SignInCard } from '@skydrop/ui/app/sign-in';
import { ForgotPasswordForm } from './_components/forgot-form';

export const metadata: Metadata = { title: 'Reset your password · Skydrop Admin' };

/**
 * Step 1 of the staff password reset.
 *
 * The API and step 2 both existed; there was nowhere to begin. The login
 * page told staff to "contact your admin", which for the SUPER_ADMIN
 * reading it means contact yourself.
 */
export default function ForgotPasswordPage(): ReactElement {
  return (
    <SignInCard
      title="Forgot your password?"
      note="We will email you a link to set a new one. It expires in 30 minutes."
    >
      <ForgotPasswordForm />
    </SignInCard>
  );
}
