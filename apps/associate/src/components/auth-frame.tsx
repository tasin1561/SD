import type { ReactElement, ReactNode } from 'react';
import { SignInCard, SignInFrame } from '@skydrop/ui/app/sign-in';
import { ThemeSwitch } from '@skydrop/ui/app/theme-switch';

/**
 * Every signed-out screen of the associate portal — sign in, reset a
 * password, accept an invitation — on the ONE shared sign-in frame: the
 * corridor map after first paint, the Skydrop mark and "sales portal",
 * and one card with the page's own content.
 *
 * The THEME SWITCH is mounted here, and that is the half that goes
 * missing (FE-7, 2026-09-20): `AppShell` carries one, but that is the
 * AUTHENTICATED chrome, so without this mount no signed-out page would
 * have a toggle at all — and the sign-in screen is exactly where
 * somebody has neither a stored choice nor a way to make one. Nothing
 * fails when it is absent, which is why it stayed absent estate-wide for
 * months; every unauthenticated route funnels through this frame, so one
 * mount covers all of them and a new auth page inherits it.
 */
export function AuthFrame({
  title,
  subtitle,
  children,
  footer,
}: {
  readonly title: string;
  readonly subtitle?: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}): ReactElement {
  return (
    <SignInFrame portal="sales portal" themeControl={<ThemeSwitch />}>
      <SignInCard title={title} note={subtitle} footer={footer}>
        {children}
      </SignInCard>
    </SignInFrame>
  );
}
