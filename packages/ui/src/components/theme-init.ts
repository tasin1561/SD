/**
 * The no-flash theme init script, and the cookie the server renders from.
 *
 * ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────
 * It must NOT carry `'use client'`. A root layout is a SERVER
 * component, and every export of a client module reaches a server
 * component as a client *reference* rather than its value — so
 * `dangerouslySetInnerHTML={{ __html: themeInitScript }}` would inject
 * an object, not JavaScript, and `pinnedTheme(...)` would not be
 * callable. Keeping the string and the helpers here and the button in
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
 *
 * ── WHY THE SERVER ALSO RENDERS THE THEME (2026-09-13) ────────────────
 * The script stamps `data-theme` on <html> before hydration, which React
 * does not know about. That holds until React re-renders the root: on a
 * hydration mismatch React 19 throws the server HTML away, regenerates
 * the tree on the client, and resets the <html> singleton's attributes
 * to its SERVER props — so a light pin vanished and the console went
 * dark "after some time" (on the next page with a mismatch). The fix is
 * to make the server's props carry the pin: the choice is also stored in
 * the `sd-theme` cookie, and the root layouts render
 * `data-theme={pinnedTheme(cookie)}`. The script migrates an existing
 * localStorage choice into the cookie, so nobody has to click again.
 */

/** localStorage key holding the pinned theme. Shared with ThemeToggle. */
export const THEME_STORAGE_KEY = 'sd-theme';

/**
 * The cookie the root layouts read to server-render `data-theme`. The
 * same name as the storage key on purpose — it is the same choice.
 */
export const THEME_COOKIE_NAME = THEME_STORAGE_KEY;

export type PinnedTheme = 'dark' | 'light';

/**
 * Not HttpOnly — the client writes it, and a theme is not sensitive.
 * Lax, a year, the whole origin. `Secure` is added only on https (see
 * `themeCookieString`): a browser drops a Secure cookie set over plain
 * http on anything but localhost, which would make dev silently forget.
 */
const THEME_COOKIE_ATTRIBUTES = `; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;

/** A cookie or attribute value narrowed to a pin, or undefined for "no pin". */
export function pinnedTheme(value: string | null | undefined): PinnedTheme | undefined {
  return value === 'dark' || value === 'light' ? value : undefined;
}

/** The `document.cookie` assignment for a pin. */
export function themeCookieString(theme: PinnedTheme, secure: boolean): string {
  return `${THEME_COOKIE_NAME}=${theme}${THEME_COOKIE_ATTRIBUTES}${secure ? '; Secure' : ''}`;
}

/** Writes the pin to the cookie. Browser-only; never throws. */
export function writeThemeCookie(theme: PinnedTheme): void {
  try {
    document.cookie = themeCookieString(theme, window.location.protocol === 'https:');
  } catch {
    // Cookies disabled. The theme still applies; the server just cannot
    // render it, and the init script covers the reload.
  }
}

/**
 * Runs before hydration. Only a PINNED choice is applied — with no
 * stored value the attribute stays unset and the CSS default (dark)
 * wins, which is the locked decision for the consoles.
 *
 * It also brings the cookie into line with the stored choice: that is
 * the migration for everybody who picked a theme before the cookie
 * existed, and the repair for a cookie that was cleared on its own.
 * localStorage is the truth here because ThemeToggle writes both.
 */
export const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.setAttribute('data-theme', stored);
      var current = null;
      var parts = document.cookie.split(';');
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i].replace(/^\\s+/, '');
        if (part.indexOf('${THEME_COOKIE_NAME}=') === 0) {
          current = part.slice(${THEME_COOKIE_NAME.length + 1});
        }
      }
      if (current !== stored) {
        document.cookie = '${THEME_COOKIE_NAME}=' + stored + '${THEME_COOKIE_ATTRIBUTES}' +
          (location.protocol === 'https:' ? '; Secure' : '');
      }
    }
  } catch (_) {}
})();
`;
