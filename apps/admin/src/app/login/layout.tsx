import type { ReactNode, ReactElement } from 'react';
import { SignInFrame } from '@skydrop/ui/app/sign-in';
import { ThemeSwitch } from '@skydrop/ui/app/theme-switch';

/**
 * Login layout — bare, no AuthProvider. If a SSR-authenticated user
 * lands here, the login page itself redirects them onward; we don't
 * gate access. The (authed) layout is the gate.
 *
 * The skin is the ONE shared SignInFrame (apps restyle), shared with /auth/*.
 */
export default function LoginLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <SignInFrame portal="operations console" themeControl={<ThemeSwitch />}>
      {children}
    </SignInFrame>
  );
}
