/**
 * The sign-in screen is moving from three copies to ONE shared component.
 *
 * UPDATED 2026-09-24 (Phase 4): apps/reseller has moved too. Only
 * apps/admin still carries its own console (until Phase 5), so there are no
 * longer two copies to compare: the byte-identical checks are RETIRED and
 * this spec pins that seller and reseller both render the shared frame and
 * carry no copy. When admin moves, it joins the list below.
 *
 * UPDATED 2026-09-23 (apps restyle, Phase 3): apps/seller now renders the
 * shared `SignInFrame` / `SignInCard` from `@skydrop/ui/app/sign-in` and
 * carries no copy of the old auth console. apps/admin and apps/reseller
 * still carry theirs until their own phases, so the copy rules below now
 * cover those TWO, and a third block pins that seller stays on the shared
 * component (an accidental revert to a local copy would pass the old
 * byte-identical checks vacuously, because seller would simply be missing
 * from them). When admin and reseller move, this whole spec becomes the
 * "every console uses the shared frame" check.
 *
 * The history below is kept because it explains the rules that still hold.
 *
 * The auth console existed THREE times, and two different rules governed it.
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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..', '..', '..');

describe('apps/seller uses the ONE shared sign-in frame', () => {
  const LAYOUTS = [
    'src/app/login/layout.tsx',
    'src/app/auth/layout.tsx',
    'src/app/password-reset/layout.tsx',
  ];

  it.each(LAYOUTS)('%s renders SignInFrame from @skydrop/ui/app/sign-in', (relative) => {
    const src = readFileSync(join(REPO, 'apps', 'seller', relative), 'utf8');
    expect(src).toContain("from '@skydrop/ui/app/sign-in'");
    expect(src).toContain('<SignInFrame');
    expect(src).not.toContain('auth-console');
  });

  it('carries no local copy of the old console', () => {
    expect(existsSync(join(REPO, 'apps', 'seller', 'src', 'components', 'auth-console'))).toBe(
      false,
    );
  });
});

describe('apps/reseller uses the ONE shared sign-in frame', () => {
  it('AuthFrame (every signed-out page) renders SignInFrame and SignInCard', () => {
    const src = readFileSync(
      join(REPO, 'apps', 'reseller', 'src', 'components', 'auth-frame.tsx'),
      'utf8',
    );
    expect(src).toContain("from '@skydrop/ui/app/sign-in'");
    expect(src).toContain('<SignInFrame');
    expect(src).toContain('<SignInCard');
    expect(src).not.toContain('auth-console');
  });

  it('carries no local copy of the old console', () => {
    expect(existsSync(join(REPO, 'apps', 'reseller', 'src', 'components', 'auth-console'))).toBe(
      false,
    );
    expect(existsSync(join(REPO, 'apps', 'reseller', 'src', 'lib', 'tilt.tsx'))).toBe(false);
  });
});
