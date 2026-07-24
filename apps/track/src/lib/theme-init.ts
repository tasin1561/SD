/**
 * No-flash theme init — runs in <head> before hydration.
 * localStorage choice → data-theme; otherwise prefers-color-scheme
 * resolves via CSS.
 */
export const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('sd-theme');
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.setAttribute('data-theme', stored);
    }
  } catch (_) {}
})();
`;
