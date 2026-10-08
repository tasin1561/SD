import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
  A SERVER REFUSAL BELONGS TO THE VALUE THAT EARNED IT.

  Found by the owner, on production, accepting a real invitation — and no
  test would have caught it, because a test never types twice. The form
  cleared `error` inside submit and nowhere else, so after one refusal the
  message sat under the field for as long as it took to fix the field:
  a 12-character password displayed with a green "At least 10 characters"
  tick, above "[BAD_REQUEST] password must be at least 10 characters", with
  the button reading "Try again". Every part of that is the app telling
  somebody they are wrong about a value they have already corrected, and
  the natural conclusion is that the server is broken. (It was not: an
  8-character attempt had been sent moments earlier.)

  The fix is `onInput` on the FORM rather than a clear in each field's
  `onChange`, for one reason — `input` bubbles. A per-field clear is
  correct the day it is written and silently incomplete the day somebody
  adds the next field, which is exactly how this class of bug returns.

  This sweep reads the real sources: every auth form in every app that can
  show a server refusal must retire it on edit.
*/
const REPO = join(__dirname, '../../../..');

function authForms(): string[] {
  const out = execSync(
    "grep -rln 'setError(' apps/*/src/app/auth apps/*/src/app/login apps/*/src/app/password-reset 2>/dev/null || true",
    { cwd: REPO, encoding: 'utf8' },
  );
  return out.split('\n').filter((f) => f.trim() !== '');
}

describe('auth forms retire a server refusal when the value changes', () => {
  it('found the forms at all — an empty sweep passes everything', () => {
    // The tripwire this file needs most: if the grep ever stops matching,
    // every assertion below becomes vacuously true and the gate is gone.
    const forms = authForms();
    expect(forms.length).toBeGreaterThanOrEqual(12);
    expect(forms.some((f) => f.includes('apps/associate/'))).toBe(true);
    expect(forms.some((f) => f.includes('apps/seller/'))).toBe(true);
  });

  it('every form that can show a refusal also clears it on edit', () => {
    const offenders: string[] = [];
    for (const file of authForms()) {
      const src = readFileSync(join(REPO, file), 'utf8');
      // A panel with no <form> has nothing to type into — a verify-email
      // screen acts on a token in the URL and has no field to correct.
      if (!/<form[\s>]/.test(src)) continue;
      if (!/onInput=\{\(\)\s*=>\s*setError\(null\)\}/.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('clears on the FORM, not per field — so a new field inherits it', () => {
    // `input` bubbles; `change` handlers do not cover fields added later.
    // If this ever moves onto individual inputs, this test is the argument
    // for why it should move back.
    for (const file of authForms()) {
      const src = readFileSync(join(REPO, file), 'utf8');
      if (!/<form[\s>]/.test(src)) continue;
      const formTag = /<form[\s\S]*?>/.exec(src)?.[0] ?? '';
      expect(formTag, `${file}: the clear is not on the <form> tag`).toMatch(/onInput=/);
    }
  });
});
