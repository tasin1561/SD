import type { ReactNode, ReactElement } from 'react';
import { SignInFrame } from '@skydrop/ui/app/sign-in';
import { PrefsControl } from '@/components/prefs-control';
import { getT } from '@/i18n/server';

/**
 * Login layout — bare, no AuthProvider. If a SSR-authenticated user
 * lands here, the login page itself redirects them onward; we don't
 * gate access. The (authed) layout is the gate.
 *
 * The skin is the ONE shared SignInFrame (apps restyle), shared with /auth/*.
 */
export default async function LoginLayout({
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
