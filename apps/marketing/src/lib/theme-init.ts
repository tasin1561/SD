/**
 * No-flash theme init. Runs synchronously in <head> BEFORE React
 * hydrates so the correct theme is applied on the very first paint.
 * Priority: localStorage → prefers-color-scheme → dark default.
 */
export const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('sd-theme');
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.setAttribute('data-theme', stored);
      return;
    }
    // No explicit choice — leave data-theme unset; the CSS
    // prefers-color-scheme media query resolves it.
  } catch (_) {}
})();
`;
