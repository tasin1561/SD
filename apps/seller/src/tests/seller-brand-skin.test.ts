/**
 * apps/seller wears the BRAND skin, in the right order, and the retired
 * seller palette is gone from it.
 *
 * REPLACES seller-theme-scope.test.ts (apps restyle, Phase 3, 2026-09-23).
 * That spec pinned the PRECISION LOGISTICS palette (`seller-theme.css`,
 * loaded after tokens.css). The restyle retires it: every console now
 * wears the marketing brand through `@skydrop/ui/brand/*`.
 *
 * The order is the load-bearing part, exactly as before:
 *   scales (raw steps) → theme (the four-block semantic theme, which reads
 *   the scales) → app (the app layer and the LEGACY ALIAS LAYER, which
 *   reads the theme) → legacy (the old component utilities, only while
 *   screens still render the legacy components) → Tailwind.
 * Reversed, a later sheet reads a variable that is not declared yet and
 * the page silently renders in fallbacks.
 *
 * Read off the FILE: import order is resolved at build time, so this is
 * the earliest point the mistake is visible.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..', '..', '..');
const SELLER_GLOBALS = join(REPO, 'apps', 'seller', 'src', 'app', 'globals.css');
const ADMIN_GLOBALS = join(REPO, 'apps', 'admin', 'src', 'app', 'globals.css');

const ORDER = [
  "@import '@skydrop/ui/brand/scales.css'",
  "@import '@skydrop/ui/brand/theme.css'",
  "@import '@skydrop/ui/brand/app.css'",
  "@import '@skydrop/ui/brand/legacy.css'",
  "@import 'tailwindcss'",
];

describe('apps/seller wears the brand skin', () => {
  it('imports the brand sheets in order, before Tailwind', () => {
    const css = readFileSync(SELLER_GLOBALS, 'utf8');
    const at = ORDER.map((line) => css.indexOf(line));
    for (const [i, pos] of at.entries()) {
      expect(pos, `${ORDER[i] ?? ''} is missing`).toBeGreaterThan(-1);
    }
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('no longer loads the retired seller palette or the old tokens', () => {
    const css = readFileSync(SELLER_GLOBALS, 'utf8');
    expect(css).not.toContain("@import '@skydrop/ui/seller-theme.css'");
    expect(css).not.toContain("@import '@skydrop/ui/tokens.css'");
  });

  it('apps/admin never loaded the seller palette (unchanged guarantee)', () => {
    const css = readFileSync(ADMIN_GLOBALS, 'utf8');
    expect(css).not.toContain('seller-theme.css');
  });
});
