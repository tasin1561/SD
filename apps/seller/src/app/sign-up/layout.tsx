import type { ReactNode, ReactElement } from 'react';
import { SignInFrame } from '@skydrop/ui/app/sign-in';
import { ThemeSwitch } from '@skydrop/ui/app/theme-switch';

/** Asking how to get an account is the same front door as signing in. */
export default function SignUpLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <SignInFrame portal="client portal" themeControl={<ThemeSwitch />}>
      {children}
    </SignInFrame>
  );
}
