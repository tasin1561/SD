import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The support-session cookie name, held across a package boundary.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────
 * `packages/auth` cannot import from `apps/api`, so the cookie name is
 * written down twice: `IMPERSONATION_COOKIE` in `server/identity.ts`
 * forwards it to `/me`, and `impersonation-cookie.ts` in the API mints
 * and reads it. `identity.ts` already said "`ssr-impersonation-cookie
 * .test.ts` holds the two together" — and that file did not exist. The
 * claim in the comment was the only thing holding them.
 *
 * ── WHAT BREAKS WITHOUT IT ───────────────────────────────────────────
 * Rename the cookie in the API and this package keeps forwarding the old
 * name. `impersonationCookieValue` arrives empty at `/me`, the SSR gate
 * gets a 401 and redirects — so the FIRST PAGE of every support session
 * lands on `/login`, for everybody, while the API is working perfectly.
 * Nothing in any suite fails: the two constants are strings in files
 * that never meet.
 *
 * Read off DISK rather than imported, because importing it is the thing
 * that is impossible. Same technique as `staff-role-presets.spec.ts`
 * against its migration and `impersonation-deny-list.spec.ts` against
 * the controllers: a test may compare two things a module may not.
 */
const API_COOKIE_FILE = join(
  __dirname,
  '../../../../apps/api/src/common/impersonation/impersonation-cookie.ts',
);
const IDENTITY_FILE = join(__dirname, '../server/identity.ts');

/** `export const IMPERSONATION_COOKIE = '…';` → the value. */
function cookieNameIn(file: string): string {
  const src = readFileSync(file, 'utf8');
  const m = /IMPERSONATION_COOKIE\s*=\s*'([^']+)'/.exec(src);
  if (m?.[1] === undefined) {
    throw new Error(
      `No IMPERSONATION_COOKIE found in ${file}. If it was renamed or moved, point this ` +
        'test at the new shape — do not delete it, or the two sides are unheld again.',
    );
  }
  return m[1];
}

describe('the support-session cookie name is the same on both sides', () => {
  it('@skydrop/auth forwards exactly the cookie the API sets', () => {
    expect(cookieNameIn(IDENTITY_FILE)).toBe(cookieNameIn(API_COOKIE_FILE));
  });

  it('is a __Host- cookie, which is what makes the handoff necessary', () => {
    // Said here because the prefix is not cosmetic: `__Host-` binds the
    // cookie to the origin that set it, which is the entire reason the
    // console cannot simply hand the seller app a cookie and why a
    // one-minute handoff token exists at all. Losing the prefix would
    // make a whole mechanism look redundant.
    expect(cookieNameIn(API_COOKIE_FILE)).toMatch(/^__Host-/);
  });
});
