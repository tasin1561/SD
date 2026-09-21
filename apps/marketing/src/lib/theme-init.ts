/**
 * No-flash theme init. Runs synchronously in <head> BEFORE React
 * hydrates so the correct theme is applied on the very first paint.
 * Priority: localStorage → prefers-color-scheme → dark default.
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
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.setAttribute('data-theme', stored);
      var bg = stored === 'dark' ? '${pageBg.dark}' : '${pageBg.light}';
      var metas = document.querySelectorAll('meta[name="theme-color"]');
      for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', bg);
      return;
    }
    // No explicit choice — leave data-theme unset; the CSS
    // prefers-color-scheme media query resolves it.
  } catch (_) {}
})();
`;
}
