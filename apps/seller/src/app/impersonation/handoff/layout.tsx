import type { ReactNode, ReactElement } from 'react';
import { SignInFrame } from '@skydrop/ui/app/sign-in';
import { ThemeSwitch } from '@skydrop/ui/app/theme-switch';

/**
 * The support-session arrival screen, in the shared unauthenticated
 * frame.
 *
 * It CANNOT live under `(authed)`: that layout resolves an identity from
 * the `__Host-sellerRefresh` cookie and redirects to /login without one,
 * and a staff member arriving here has no seller login at all — that is
 * the entire premise. The handoff token in the URL fragment is the only
 * credential, and it is spent for a session cookie by the page inside.
 */
export default function ImpersonationHandoffLayout({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <SignInFrame portal="seller portal" themeControl={<ThemeSwitch />}>
      {children}
    </SignInFrame>
  );
}
