import type { ReactNode, ReactElement } from 'react';
import { SignInFrame } from '@skydrop/ui/app/sign-in';
import { ThemeSwitch } from '@skydrop/ui/app/theme-switch';

/**
 * Every /auth page (accept an invitation, set or reset a password, verify
 * an email) in the shared SignInFrame. Wide, because the account-setup
 * forms carry more fields than the sign-in card.
 */
export default function SellerAuthLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <SignInFrame portal="seller portal" themeControl={<ThemeSwitch />} wide>
      {children}
    </SignInFrame>
  );
}
