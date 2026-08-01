/**
 * The no-flash theme init script.
 *
 * ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────
 * It must NOT carry `'use client'`. A root layout is a SERVER
 * component, and every export of a client module reaches a server
 * component as a client *reference* rather than its value — so
 * `dangerouslySetInnerHTML={{ __html: themeInitScript }}` would inject
 * an object, not JavaScript. Keeping the string here and the button in
 * `theme-toggle.tsx` is what makes both usable from their own side of
 * the boundary.
 *
 * ── HOW TO USE IT ────────────────────────────────────────────────────
 * Inline it in the root layout's `<head>` WITH THE CSP NONCE, which
 * middleware forwards on the request as `x-nonce`:
 *
 *   const nonce = (await headers()).get('x-nonce') ?? undefined;
 *   <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
 *
 * Next stamps its OWN scripts automatically; a hand-written inline
 * script is on you. Omitting the nonce fails SILENTLY — the browser
 * simply refuses to run it and the only symptom is a theme flash. That
 * is exactly how `apps/track` shipped a blocked theme script, and why
 * `e2e-shared/csp.spec.ts` asserts zero CSP violations.
 */

/** localStorage key holding the pinned theme. Shared with ThemeToggle. */
export const THEME_STORAGE_KEY = 'sd-theme';

/**
 * Runs before hydration. Only a PINNED choice is applied — with no
 * stored value the attribute stays unset and the CSS default (dark)
 * wins, which is the locked decision for the consoles.
 */
export const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.setAttribute('data-theme', stored);
    }
  } catch (_) {}
})();
`;
