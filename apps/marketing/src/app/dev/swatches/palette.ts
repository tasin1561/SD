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
    meaning: 'E-commerce sellers · Returns group (replaces coral; plum from 800)',
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

/** The corridor gradient — Bangladesh's green to India's saffron. ONE declaration ships. */
export const CORRIDOR = {
  /** `--corridor-gradient`: decorative only, never carries text. */
  decorative: `linear-gradient(90deg, ${HUES[2]?.scale[500]}, ${HUES[1]?.scale[400]} 60%, ${HUES[1]?.scale[500]})`,
  /** The same three stops interpolated in OKLCH — rendered once beside it for the owner to compare. */
  decorativeOklch: `linear-gradient(90deg in oklch, ${HUES[2]?.scale[500]}, ${HUES[1]?.scale[400]} 60%, ${HUES[1]?.scale[500]})`,
  /** `--corridor-gradient-strong`: 700-level stops for a band that carries WHITE text. */
  strong: `linear-gradient(90deg, ${HUES[2]?.scale[700]}, ${HUES[1]?.scale[700]})`,
} as const;

/** The stops, for the contrast table below the bars. */
export const CORRIDOR_STOPS = {
  decorative: [
    [HUES[2]?.scale[500] ?? '#000000', 0],
    [HUES[1]?.scale[400] ?? '#000000', 0.6],
    [HUES[1]?.scale[500] ?? '#000000', 1],
  ] as [string, number][],
  strong: [
    [HUES[2]?.scale[700] ?? '#000000', 0],
    [HUES[1]?.scale[700] ?? '#000000', 1],
  ] as [string, number][],
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/** Sample an sRGB linear-gradient at `n` evenly spaced points. */
export function sampleGradient(stops: [string, number][], n = 21): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let j = 0;
    while (j < stops.length - 2 && t > (stops[j + 1]?.[1] ?? 1)) j++;
    const a = stops[j];
    const b = stops[j + 1];
    if (!a || !b) continue;
    const u = Math.min(1, Math.max(0, (t - a[1]) / (b[1] - a[1] || 1)));
    const ra = hexToRgb(a[0]);
    const rb = hexToRgb(b[0]);
    out.push(
      rgbToHex([
        ra[0] + (rb[0] - ra[0]) * u,
        ra[1] + (rb[1] - ra[1]) * u,
        ra[2] + (rb[2] - ra[2]) * u,
      ]),
    );
  }
  return out;
}

/** Worst-case contrast of `fg` anywhere along the gradient, and where. */
export function gradientMin(stops: [string, number][], fg: string): { ratio: number; at: string } {
  let ratio = Infinity;
  let at = '';
  for (const hex of sampleGradient(stops)) {
    const r = contrast(fg, hex);
    if (r < ratio) {
      ratio = r;
      at = hex;
    }
  }
  return { ratio, at };
}
