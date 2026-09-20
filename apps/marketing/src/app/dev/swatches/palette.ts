/**
 * Phase 0 swatch data — the PROPOSED hue system, with contrast COMPUTED.
 *
 * Dev route only (`page.dev.tsx`, never exported). The hex values live here
 * because this page is the tool that decides what goes into `theme.css`;
 * once approved they move there as `--{hue}-{step}` tokens and this file
 * imports nothing but names. FE-6's "no hex in components" is about the
 * shipped site, and this is not part of it.
 */

export type Step = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;
export const STEPS: readonly Step[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

export interface HueScale {
  id: string;
  name: string;
  /** What this hue MEANS on the page — every hue is assigned one. */
  meaning: string;
  /** Text-on-light-page step and text-on-dark-page step, per the plan. */
  light: Step;
  dark: Step;
  scale: Record<Step, string>;
}

/** The two page grounds from theme.css (dark `--page`, light `--page`). */
export const PAGE = { light: '#f8f9ff', dark: '#090d16' } as const;

export const HUES: readonly HueScale[] = [
  {
    id: 'blue',
    name: 'Blue',
    meaning: 'Brand · primary action · Team group',
    light: 600,
    dark: 400,
    scale: {
      50: '#eff6ff',
      100: '#dbeafe',
      200: '#bfdbfe',
      300: '#93c5fd',
      400: '#7bafea',
      500: '#3b82f6',
      600: '#2563eb',
      700: '#1d4ed8',
      800: '#1e40af',
      900: '#1e3a8a',
      950: '#172554',
    },
  },
  {
    id: 'saffron',
    name: 'Saffron',
    meaning: 'Send to India · Orders group · warning (with icon)',
    light: 600,
    dark: 400,
    scale: {
      50: '#fffbeb',
      100: '#fef3c7',
      200: '#fde68a',
      300: '#fcd34d',
      400: '#fbbf24',
      500: '#f59e0b',
      600: '#d97706',
      700: '#b45309',
      800: '#92400e',
      900: '#78350f',
      950: '#451a03',
    },
  },
  {
    id: 'green',
    name: 'Green',
    meaning: 'Send to Bangladesh · delivered · Money group',
    light: 600,
    dark: 400,
    scale: {
      50: '#ecfdf5',
      100: '#d1fae5',
      200: '#a7f3d0',
      300: '#6ee7b7',
      400: '#34d399',
      500: '#10b981',
      600: '#059669',
      700: '#047857',
      800: '#065f46',
      900: '#064e3b',
      950: '#022c22',
    },
  },
  {
    id: 'teal',
    name: 'Teal',
    meaning: 'Import · Stock-in group',
    light: 600,
    dark: 400,
    scale: {
      50: '#f0fdfa',
      100: '#ccfbf1',
      200: '#99f6e4',
      300: '#5eead4',
      400: '#2dd4bf',
      500: '#14b8a6',
      600: '#0d9488',
      700: '#0f766e',
      800: '#115e59',
      900: '#134e4a',
      950: '#042f2e',
    },
  },
  {
    id: 'violet',
    name: 'Violet',
    meaning: 'Export · Catalogue group · the store side of Reseller stores',
    light: 600,
    dark: 400,
    scale: {
      50: '#f5f3ff',
      100: '#ede9fe',
      200: '#ddd6fe',
      300: '#c4b5fd',
      400: '#a78bfa',
      500: '#8b5cf6',
      600: '#7c3aed',
      700: '#6d28d9',
      800: '#5b21b6',
      900: '#4c1d95',
      950: '#2e1065',
    },
  },
  {
    id: 'magenta',
    name: 'Magenta',
    meaning: 'E-commerce sellers · Returns group (replaces coral)',
    light: 600,
    dark: 400,
    scale: {
      50: '#fdf2f8',
      100: '#fce7f3',
      200: '#fbcfe8',
      300: '#f9a8d4',
      400: '#f472b6',
      500: '#ec4899',
      600: '#db2777',
      700: '#be185d',
      800: '#9d174d',
      900: '#831843',
      950: '#500724',
    },
  },
  {
    id: 'red',
    name: 'Red',
    meaning: 'Danger only (with icon) — never a section hue',
    light: 700,
    dark: 400,
    scale: {
      50: '#fef2f2',
      100: '#fee2e2',
      200: '#fecaca',
      300: '#fca5a5',
      400: '#f87171',
      500: '#ef4444',
      600: '#dc2626',
      700: '#ba1a1a',
      800: '#991b1b',
      900: '#7f1d1d',
      950: '#450a0a',
    },
  },
  {
    id: 'slate',
    name: 'Slate',
    meaning: 'Neutrals — blue-biased grey, never pure grey',
    light: 600,
    dark: 400,
    scale: {
      50: '#f8fafc',
      100: '#f1f5f9',
      200: '#e2e8f0',
      300: '#cbd5e1',
      400: '#94a3b8',
      500: '#64748b',
      600: '#475569',
      700: '#334155',
      800: '#1e293b',
      900: '#0f172a',
      950: '#020617',
    },
  },
];

// ── WCAG 2.x contrast, computed rather than eyeballed (the FE-6 rule) ──

function channel(hex2: string): number {
  const c = parseInt(hex2, 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  return (
    0.2126 * channel(h.slice(0, 2)) +
    0.7152 * channel(h.slice(2, 4)) +
    0.0722 * channel(h.slice(4, 6))
  );
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function ratio(a: string, b: string): string {
  return contrast(a, b).toFixed(1);
}

/** AA for normal text is 4.5; 3.0 is the large-text / UI-component floor. */
export function grade(r: number): 'AA' | 'AA-large' | 'fail' {
  if (r >= 4.5) return 'AA';
  if (r >= 3) return 'AA-large';
  return 'fail';
}

/** The corridor gradient — Bangladesh's green to India's saffron. */
export const CORRIDOR = {
  /** Wins where `in oklch` is supported (Chrome 111+, Safari 16.2+, Firefox 113+). */
  oklch: `linear-gradient(90deg in oklch, ${HUES[2]?.scale[500]}, ${HUES[1]?.scale[500]})`,
  /** sRGB fallback with an explicit warm mid-stop so it never dips through olive. */
  srgbFallback: `linear-gradient(90deg, ${HUES[2]?.scale[500]}, ${HUES[1]?.scale[400]} 60%, ${HUES[1]?.scale[500]})`,
  /** What NOT to ship — shown only so the difference is visible. */
  srgbNaive: `linear-gradient(90deg, ${HUES[2]?.scale[500]}, ${HUES[1]?.scale[500]})`,
} as const;
