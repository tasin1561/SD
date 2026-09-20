/**
 * The auth console exists THREE times, and two different rules govern it.
 *
 * `apps/admin`, `apps/seller` and `apps/reseller` each carry their own
 * copy of the sign-in console: the corridor renderer, its map geometry,
 * the tilt helper and the stylesheet. The port to apps/reseller
 * (2026-09-20) made it three, and nothing asserted any of it — the
 * copies were compared by hand in the session that created them, which
 * is not a gate.
 *
 * ── WHY THIS IS NOT ONE SHARED COMPONENT (YET) ───────────────────────
 * It should be, and extracting it into `@skydrop/ui` is the right
 * answer. This spec is the stopgap until then, and it is deliberately
 * cheap: a hash comparison that fails loudly the first time somebody
 * edits one copy and not the others. Delete it in the commit that does
 * the extraction.
 *
 * ── THE TWO RULES, AND WHY THEY DIFFER ───────────────────────────────
 * The renderer, the geometry and the tilt helper are pure mechanism —
 * they draw the same corridor whatever palette surrounds them, so all
 * three copies must be byte-identical. A change to one is a change to
 * all three.
 *
 * `console.css` is NOT mechanism, it is a PALETTE, and it must follow
 * the app behind the login form:
 *
 *   - apps/admin and apps/reseller both render on `@skydrop/ui`'s
 *     tokens.css alone, so their consoles must MATCH.
 *   - apps/seller additionally loads `seller-theme.css` (the PRECISION
 *     LOGISTICS palette, guarded by `seller-theme-scope.test.ts`), so
 *     its console DELIBERATELY DIVERGED on 2026-09-19.
 *
 * Both halves are asserted, and the second half is the one that earns
 * its keep: without it, the obvious "tidy up — make all three the same"
 * refactor passes a test suite while silently dragging apps/seller's
 * sign-in screen back to a palette its own app stopped using. The
 * failure would read as a broken deploy (login on one palette, the app
 * behind it on another) rather than as a refactor.
 *
 * Read off the FILES, not off a rendered page: these are resolved at
 * build time, so this is the earliest point the mistake is visible, and
 * seeing it in behaviour would need three browsers and two themes.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..', '..', '..');
const APPS = ['admin', 'seller', 'reseller'] as const;

/** Files whose three copies must be byte-identical — pure mechanism. */
const SHARED_MECHANISM = [
  'src/components/auth-console/corridor-console.tsx',
  'src/components/auth-console/map-geometry.ts',
  'src/lib/tilt.tsx',
] as const;

const CONSOLE_CSS = 'src/components/auth-console/console.css';

function digest(app: string, relative: string): string {
  const path = join(REPO, 'apps', app, relative);
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('the auth console is copied, so the copies are pinned', () => {
  it.each(SHARED_MECHANISM)('%s is byte-identical in all three apps', (relative) => {
    const [admin, seller, reseller] = APPS.map((app) => digest(app, relative));

    // Named individually rather than as a set, so a failure says WHICH
    // app drifted instead of only that one did.
    expect(seller, `apps/seller's ${relative} has drifted from apps/admin's`).toBe(admin);
    expect(reseller, `apps/reseller's ${relative} has drifted from apps/admin's`).toBe(admin);
  });

  it('console.css matches between apps/admin and apps/reseller', () => {
    // Both render on tokens.css alone. A sign-in screen has to match the
    // app behind it, and these two apps share a palette.
    expect(
      digest('reseller', CONSOLE_CSS),
      "apps/reseller's auth console palette has drifted from apps/admin's — " +
        'both render on @skydrop/ui tokens.css alone and must match',
    ).toBe(digest('admin', CONSOLE_CSS));
  });

  it('console.css DIFFERS between apps/seller and apps/admin', () => {
    // The load-bearing half. apps/seller moved to PRECISION LOGISTICS;
    // re-syncing this copy would put its login screen on a palette its
    // own app no longer uses, and would look like a broken deploy.
    expect(
      digest('seller', CONSOLE_CSS),
      "apps/seller's auth console was re-synced with apps/admin's. It must NOT be: " +
        'apps/seller renders on the PRECISION LOGISTICS palette and its sign-in ' +
        'screen has to match the app behind it.',
    ).not.toBe(digest('admin', CONSOLE_CSS));
  });
});
