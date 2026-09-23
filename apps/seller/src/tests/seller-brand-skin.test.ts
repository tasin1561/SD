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

  it('nothing in the shared package pulls the retired palette in behind an app s back', () => {
    // Kept from seller-theme-scope.test.ts: an `@import` from INSIDE a
    // shared sheet reaches every consumer while each app's own globals
    // still read clean. Now covers the brand sheets as well.
    // tokens.css and corridor.css were DELETED in Phase 7 (nothing imported
    // them any more); the brand sheets are what remains to guard.
    const shared = ['brand/scales.css', 'brand/theme.css', 'brand/app.css', 'brand/legacy.css'];
    for (const file of shared) {
      const css = readFileSync(join(REPO, 'packages', 'ui', 'src', file), 'utf8');
      // An IMPORT is what would leak it; a comment naming it is history.
      expect(css, file).not.toMatch(/@import[^;]*seller-theme\.css/);
    }
  });
});

/**
 * The sign-in screen moved with the app. REPLACES the two checks
 * seller-theme-scope.test.ts ran on apps/seller's own login `console.css`
 * (deleted — seller now renders the shared SignInFrame, which reads the
 * brand theme). The guarantees carry over to the sheet the login screen
 * now actually paints with:
 *   - the dark canvas is #090d16 (the value the old check pinned);
 *   - the theme declares its LIGHT palette twice — the OS default and the
 *     toggle — and the two copies must be identical, or the login page
 *     changes colour when somebody touches the switch.
 */
describe('the sign-in screen paints with the brand theme', () => {
  const THEME_CSS = join(REPO, 'packages', 'ui', 'src', 'brand', 'theme.css');

  function block(css: string, opener: string): string[] {
    const start = css.indexOf(opener);
    expect(start, `${opener} not found`).toBeGreaterThan(-1);
    const body = css.slice(css.indexOf('{', start + opener.length - 1) + 1);
    let depth = 1;
    let end = 0;
    for (let i = 0; i < body.length && depth > 0; i += 1) {
      if (body[i] === '{') depth += 1;
      if (body[i] === '}') depth -= 1;
      end = i;
    }
    return body
      .slice(0, end)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('--'));
  }

  it('carries the #090d16 dark canvas', () => {
    const css = readFileSync(THEME_CSS, 'utf8');
    expect(block(css, ':root {')).toContain('--surface: #090d16;');
  });

  it('declares the two LIGHT copies identically', () => {
    const css = readFileSync(THEME_CSS, 'utf8');
    const media = block(css, ':root:not([data-theme]) {');
    const pinned = block(css, ":root[data-theme='light'] {");
    expect(media.length).toBeGreaterThan(20);
    expect(media).toEqual(pinned);
    expect(pinned).toContain('--surface: #f8f9ff;');
  });
});
