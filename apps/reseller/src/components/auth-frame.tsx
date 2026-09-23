import type { ReactElement, ReactNode } from 'react';
import { SignInCard, SignInFrame } from '@skydrop/ui/app/sign-in';
import { ThemeSwitch } from '@skydrop/ui/app/theme-switch';

/**
 * Every signed-out screen of the store portal — sign in, reset a password,
 * accept an invitation, verify an email — on the ONE shared sign-in frame
 * (apps restyle, Phase 4): the corridor map after first paint, the Skydrop
 * mark and "store portal", the theme switch (so a signed-out visitor can
 * always change it), and one card with the page's own content unchanged.
 *
 * `section`, `note` and `alert` fed the old console's panel band ("access
 * · invite-only") and are accepted so no page changes; the brand frame has
 * no such band. A refusal (`alert`) still reads as one from its title and
 * text, which the pages already write.
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
  readonly section?: string;
  readonly note?: string;
  readonly alert?: boolean;
}): ReactElement {
  return (
    <SignInFrame portal="store portal" themeControl={<ThemeSwitch />}>
      <SignInCard title={title} note={subtitle} footer={footer}>
        {children}
      </SignInCard>
    </SignInFrame>
  );
}
