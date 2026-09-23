import type { ReactNode, ReactElement } from 'react';
import { SignInFrame } from '@skydrop/ui/app/sign-in';
import { ThemeSwitch } from '@skydrop/ui/app/theme-switch';

/**
 * The sign-in screen's frame — the ONE shared SignInFrame (apps restyle):
 * backdrop map, the Skydrop mark and "seller portal", and the theme switch
 * (every unauthenticated route funnels through one of these layouts, so a
 * signed-out visitor can always change the theme). The page renders its
 * SignInCard inside.
 */
export default function LoginLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <SignInFrame portal="seller portal" themeControl={<ThemeSwitch />}>
      {children}
    </SignInFrame>
  );
}
