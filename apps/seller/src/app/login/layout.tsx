import type { ReactNode, ReactElement } from 'react';
import { SellerSignInFrame } from '@/components/auth-frame';

/**
 * The sign-in screen's frame — the ONE shared SignInFrame (apps restyle):
 * backdrop map, the Skydrop mark and "client portal", and the theme switch
 * (every unauthenticated route funnels through one of these layouts, so a
 * signed-out visitor can always change the theme). The page renders its
 * SignInCard inside.
 */
export default function LoginLayout({ children }: { children: ReactNode }): ReactElement {
  return <SellerSignInFrame>{children}</SellerSignInFrame>;
}
