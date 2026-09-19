/**
 * The PRECISION LOGISTICS palette reaches apps/seller and NOTHING else.
 *
 * `packages/ui/src/seller-theme.css` redefines the very variables
 * `tokens.css` declares — `--color-surface`, the status chips, the type
 * scale — and that is the whole mechanism: it loads after tokens.css
 * and wins on the cascade. The safety is that apps/admin never loads
 * it, so not one of those declarations can reach an admin page.
 *
 * "Never loads it" is a property of one line in one stylesheet, which
 * is exactly the kind of thing a later refactor moves into a shared
 * import without noticing. Both halves are asserted here rather than
 * just the one that would be nice to have:
 *
 *   - apps/seller DOES import it, AFTER tokens.css. Reversed, tokens
 *     would win and the app would silently keep the old palette while
 *     every other sign said it had moved.
 *   - apps/admin does NOT — and neither does anything else that admin
 *     loads.
 *
 * Read off the FILES rather than off a rendered page: the import order
 * is resolved at build time, so this is the earliest point the mistake
 * is visible, and seeing it in behaviour would need a browser.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..', '..', '..');
const SELLER_GLOBALS = join(REPO, 'apps', 'seller', 'src', 'app', 'globals.css');
const ADMIN_GLOBALS = join(REPO, 'apps', 'admin', 'src', 'app', 'globals.css');
const THEME = 'seller-theme.css';
const TOKENS = 'tokens.css';

describe('the seller palette is scoped to apps/seller', () => {
  it('apps/seller loads it AFTER the shared tokens', () => {
    const css = readFileSync(SELLER_GLOBALS, 'utf8');
    const tokensAt = css.indexOf(`@import '@skydrop/ui/${TOKENS}'`);
    const themeAt = css.indexOf(`@import '@skydrop/ui/${THEME}'`);

    expect(tokensAt).toBeGreaterThan(-1);
    expect(themeAt).toBeGreaterThan(-1);
    // Later wins at equal specificity. The other order is not a
    // different look — it is the OLD look, with nothing to say so.
    expect(themeAt).toBeGreaterThan(tokensAt);
  });

  it('apps/admin does not load it at all', () => {
    const css = readFileSync(ADMIN_GLOBALS, 'utf8');
    expect(css).not.toContain(THEME);
    // …and still loads the shared tokens, which is what it renders in.
    expect(css).toContain(`@import '@skydrop/ui/${TOKENS}'`);
  });

  it('nothing in the shared package pulls it in behind admin s back', () => {
    // A `@import` of the seller theme from INSIDE tokens.css or
    // corridor.css would reach every consumer, and the check above
    // would still pass — apps/admin's own file would not mention it.
    for (const file of [TOKENS, 'corridor.css']) {
      const css = readFileSync(join(REPO, 'packages', 'ui', 'src', file), 'utf8');
      expect(css).not.toContain(THEME);
    }
  });
});

describe('the seller login screen moved with the app', () => {
  /**
   * FE-6: a theme change touches the console.css copies too, or the
   * login page stays on the old palette while the app behind it moves
   * — which reads as a broken deploy rather than as a design.
   *
   * apps/admin's copy is deliberately NOT changed and keeps the cyan;
   * the two files diverged on purpose and the seller one says so.
   */
  const CONSOLE = join(REPO, 'apps', 'seller', 'src', 'components', 'auth-console', 'console.css');

  it('carries the new dark canvas rather than the old one', () => {
    const css = readFileSync(CONSOLE, 'utf8');
    expect(css).toContain('--color-bg: #090d16');
    expect(css).not.toContain('--color-bg: #060b16');
  });

  it('declares the two LIGHT copies identically', () => {
    // The media-query copy (OS preference) and the `[data-theme]` copy
    // (the toggle) must agree, or the theme changes when you touch the
    // toggle. Compared as DECLARATIONS — only the nesting indent
    // legitimately differs.
    const css = readFileSync(CONSOLE, 'utf8');
    const blocks = [...css.matchAll(/\.mc-login \{([^}]*)\}/g)].map((m) => m[1] ?? '');
    // Three blocks: dark, the media-query light, the pinned light.
    expect(blocks).toHaveLength(3);

    const declarations = (block: string): string[] =>
      block
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('--'));

    const [, mediaLight, pinnedLight] = blocks;
    expect(declarations(mediaLight ?? '')).toEqual(declarations(pinnedLight ?? ''));
    // And they are the LIGHT ones, not two copies of the dark block.
    expect(declarations(pinnedLight ?? '')).toContain('--color-bg: #f8f9ff;');
  });
});
