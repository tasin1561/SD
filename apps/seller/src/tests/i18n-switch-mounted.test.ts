import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
  A mount that goes missing fails silently (FE-7): the sign-in screen is exactly
  where somebody needs a way to pick their language. One shared control, mounted
  in the signed-in shell and in the one signed-out frame every layout uses.
*/
const SRC = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(SRC, p), 'utf8');

describe('the language switch is mounted', () => {
  it('in the signed-in shell, beside the theme switch', () => {
    expect(read('app/(authed)/_components/authed-shell.tsx')).toContain(
      'themeControl={<PrefsControl />}',
    );
    expect(read('components/prefs-control.tsx')).toContain('<LanguageSwitch');
  });
  it('in the signed-out frame, and every signed-out layout uses that frame', () => {
    expect(read('components/auth-frame.tsx')).toContain('<PrefsControl />');
    for (const l of [
      'app/login/layout.tsx',
      'app/sign-up/layout.tsx',
      'app/password-reset/layout.tsx',
      'app/auth/layout.tsx',
      'app/impersonation/handoff/layout.tsx',
    ])
      expect(read(l), l).toContain('SellerSignInFrame');
  });
  it('the root layout renders lang from the cookie and wraps the provider', () => {
    const l = read('app/layout.tsx');
    expect(l).toContain('lang={locale}');
    expect(l).toContain('AppLocaleProvider');
    expect(l).toContain('langInitScript');
  });
});
