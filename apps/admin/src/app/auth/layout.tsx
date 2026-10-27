import type { ReactNode, ReactElement } from 'react';
import { SignInFrame } from '@skydrop/ui/app/sign-in';
import { PrefsControl } from '@/components/prefs-control';
import { getT } from '@/i18n/server';

/**
 * Everything under /auth — reset password, verify email, accept
 * invitation — is reached from an email link by someone who is not
 * signed in. Same shell as /login, for the same reason: it is the
 * product's front door.
 */
export default async function AuthLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <SignInFrame portal={t('shell.portal')} themeControl={<PrefsControl />}>
      {children}
    </SignInFrame>
  );
}
