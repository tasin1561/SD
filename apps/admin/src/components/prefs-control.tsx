'use client';

import type { ReactElement } from 'react';
import { LanguageSwitch } from '@skydrop/ui/app/i18n-client';
import { ThemeSwitch } from '@skydrop/ui/app/theme-switch';

/**
 * Language + theme, side by side. ONE component so the signed-out frames and
 * the signed-in shell cannot drift: a mount that goes missing fails silently
 * (FE-7), and the sign-in screen is exactly where somebody needs a way to
 * pick their language before they can read anything else.
 */
export function PrefsControl(): ReactElement {
  return (
    <div className="ad-prefs">
      <LanguageSwitch />
      <ThemeSwitch />
    </div>
  );
}
