/**
 * No-flash theme init. Runs synchronously in <head> BEFORE React
 * hydrates so the correct theme is applied on the very first paint.
 * Priority: localStorage → LIGHT.
 *
 * The operating system is no longer consulted (owner, 2026-10-26): the
 * site opens light for everybody, and the toggle is the only thing that
 * changes it. `data-theme` is therefore ALWAYS stamped, which is what
 * makes the dark `:root` default unreachable without touching a
 * stylesheet — `check-theme.mjs` requires those blocks to exist and
 * compares them against each other, so deleting one to prove a point
 * would cost a gate that catches real theme drift.
 *
 * It also rewrites the two `theme-color` metas for a PINNED theme:
 * Next's `viewport.themeColor` emits one meta per `prefers-color-scheme`
 * media, which follows the OS — right for the unpinned visitor, wrong
 * for somebody who pinned the other theme, whose browser chrome would
 * otherwise disagree with the page. The hex pair is inlined by the
 * layout from `theme-colors.ts` so this script stays a literal string.
 */
export function themeInitScript(pageBg: { light: string; dark: string }): string {
  return `
(function () {
  try {
    var stored = localStorage.getItem('sd-theme');
    var theme = stored === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    // The browser chrome has to agree with the page. Next emits one
    // theme-color meta per prefers-color-scheme media, which followed
    // the OS — now that nothing does, both are rewritten to the theme
    // actually on screen.
    var bg = theme === 'dark' ? '${pageBg.dark}' : '${pageBg.light}';
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', bg);
  } catch (_) {}
})();
`;
}
