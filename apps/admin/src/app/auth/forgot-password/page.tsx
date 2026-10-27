import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { SignInCard } from '@skydrop/ui/app/sign-in';
import { ForgotPasswordForm } from './_components/forgot-form';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('authForgotPasswordPage.resetYourPasswordSkydropAdmin') };
}

/**
 * Step 1 of the staff password reset.
 *
 * The API and step 2 both existed; there was nowhere to begin. The login
 * page told staff to "contact your admin", which for the SUPER_ADMIN
 * reading it means contact yourself.
 */
export default async function ForgotPasswordPage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <SignInCard
      title={t('authForgotPasswordPage.forgotYourPassword')}
      note={t('authForgotPasswordPage.weWillEmailYouA')}
    >
      <ForgotPasswordForm />
    </SignInCard>
  );
}
