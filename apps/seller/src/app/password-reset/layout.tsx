import type { ReactNode, ReactElement } from 'react';
import { SignInFrame } from '@skydrop/ui/app/sign-in';
import { ThemeSwitch } from '@skydrop/ui/app/theme-switch';

/** Asking for a reset link is the same front door as signing in. */
export default function PasswordResetLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <SignInFrame portal="seller portal" themeControl={<ThemeSwitch />}>
      {children}
    </SignInFrame>
  );
}
