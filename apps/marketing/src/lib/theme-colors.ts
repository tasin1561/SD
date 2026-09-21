/**
 * The two page grounds, as TypeScript — for `<meta name="theme-color">`
 * and the `viewport.themeColor` export, which cannot read a CSS variable.
 *
 * These MUST equal `--page` in theme.css; `scripts/check-theme.mjs`
 * fails the build when they drift, which is what lets FE-6's
 * "no inline hex" rule hold while a hex still has to be written here.
 */
export const PAGE_BG = {
  light: '#f8f9ff',
  dark: '#090d16',
} as const;

export type ThemeName = keyof typeof PAGE_BG;
