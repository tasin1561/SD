/**
 * TS-side tokens — the SAME values declared in tokens.css, re-exported
 * as TS so non-CSS contexts (e.g., dynamic chart colors, theme-aware
 * canvas/SVG rendering) can reference them consistently.
 *
 * IMPORTANT: tokens.css is the canonical declaration; this file
 * MIRRORS it. When updating colors, edit BOTH. (A code-gen step is
 * possible later; not worth the build complexity for Phase 1A.)
 *
 * Apps that style via Tailwind v4 / inline style read CSS variables
 * directly via `var(--color-bg)`; this module is the escape hatch
 * for non-CSS consumers.
 */

export const SPACING = {
  s0: 0,
  s0_5: 2,
  s1: 4,
  s2: 8,
  s3: 12,
  s4: 16,
  s5: 20,
  s6: 24,
  s8: 32,
  s10: 40,
  s12: 48,
  s16: 64,
} as const;

export const RADII = {
  r1: 3,
  r2: 5,
  r3: 7,
  pill: 9999,
} as const;

export const TYPE_SCALE = {
  xs: 11,
  sm: 13,
  base: 14,
  md: 15,
  lg: 17,
  xl: 22,
  '2xl': 28,
} as const;

export const FONT_WEIGHTS = {
  regular: 400,
  medium: 500,
  semibold: 600,
} as const;

export const FONT_FAMILIES = {
  sans: "'Geist', ui-sans-serif, system-ui, sans-serif",
  mono: "'Geist Mono', ui-monospace, 'SF Mono', monospace",
} as const;

/** Status kind hexes mirrored from tokens.css — dark theme only. The
 *  light-theme variants live in the CSS override; non-CSS consumers
 *  that need light values should derive from theme context. Phase 1A
 *  only uses these in dark-default contexts (charts on the dashboard,
 *  the status legend); when light-theme charts land, mirror the
 *  light values here too. */
export const STATUS_HEX_DARK = {
  draft: { bg: 'rgba(138, 147, 168, 0.12)', fg: '#aab2c4' },
  pending: { bg: 'rgba(245, 178, 71, 0.12)', fg: '#f5b247' },
  confirmed: { bg: 'rgba(96, 165, 250, 0.12)', fg: '#60a5fa' },
  'in-transit': { bg: 'rgba(167, 139, 250, 0.12)', fg: '#a78bfa' },
  delivered: { bg: 'rgba(74, 222, 128, 0.12)', fg: '#4ade80' },
  rto: { bg: 'rgba(251, 146, 60, 0.12)', fg: '#fb923c' },
  failed: { bg: 'rgba(248, 113, 113, 0.12)', fg: '#f87171' },
  cancelled: { bg: 'rgba(100, 116, 139, 0.12)', fg: '#94a3b8' },
} as const;
