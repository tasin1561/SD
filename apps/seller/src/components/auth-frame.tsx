'use client';

import type { ReactElement, ReactNode } from 'react';
import { SignInFrame } from '@skydrop/ui/app/sign-in';
import { useT } from '@/i18n/client';
import { PrefsControl } from './prefs-control';

/**
 * The shared frame of every signed-out route (login, sign-up, password reset,
 * /auth/*, the impersonation handoff). A CLIENT component so the translated
 * portal label works from server layouts. The language + theme controls are
 * mounted here once, so a new signed-out route inherits them (FE-7).
 */
export function SellerSignInFrame({
  children,
  wide,
}: {
  readonly children: ReactNode;
  readonly wide?: boolean;
}): ReactElement {
  const t = useT();
  return (
    <SignInFrame portal={t('auth.portal')} themeControl={<PrefsControl />} wide={wide === true}>
      {children}
    </SignInFrame>
  );
}
