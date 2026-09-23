#!/usr/bin/env node
/**
 * Contrast, COMPUTED — never eyeballed (FE-6), for the apps' brand skin.
 *
 * Resolves the real tokens out of the CSS the apps load (brand/scales.css,
 * brand/theme.css — dark copy 1 and light copy 1 — and brand/app.css),
 * following `var()` chains, `color-mix(in oklab, …)` and translucent
 * `rgba()` tints composited over the surface they sit on, then checks every
 * text/surface and chip pairing the app primitives use, in BOTH themes.
 *
 *   text, chips, figures ........ 4.5 : 1   (WCAG 1.4.3 AA)
 *   control borders, focus ring . 3   : 1   (WCAG 1.4.11)
 *
 * The WCAG 2.x formula is the one marketing's swatch page uses
 * (apps/marketing/src/app/dev/swatches/palette.ts), lifted, not imported —
 * apps/marketing stays untouched. Exit 1 on any failure.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const brand = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'brand');
const read = (f) => readFileSync(join(brand, f), 'utf8');

/** Declarations of the first rule whose selector (trimmed) equals `selector`. */
function block(css, selector, nth = 0) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]+;/g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  let seen = 0;
  while ((m = re.exec(clean))) {
    if (m[1].trim() === selector) {
      if (seen === nth) return decls(m[2]);
      seen += 1;
    }
  }
  throw new Error(`no block for ${selector}`);
}
function decls(body) {
  const out = {};
  for (const part of body.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k.startsWith('--'))
      out[k] = part
        .slice(i + 1)
        .trim()
        .replace(/\s+/g, ' ');
  }
  return out;
}

// ── colour maths ─────────────────────────────────────────────────────────
const hex2rgb = (h) => {
  const s = h.replace('#', '');
  const f = s.length === 3 ? [...s].map((c) => c + c).join('') : s;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255);
};
const rgb2hex = (c) =>
  '#' +
  c
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const delin = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const luminance = (hex) => {
  const [r, g, b] = hex2rgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
function toOklab(hex) {
  const [r, g, b] = hex2rgb(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromOklab([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return rgb2hex(
    [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map(delin),
  );
}

// ── token resolution ─────────────────────────────────────────────────────
function makeResolver(vars) {
  const resolve = (value, depth = 0) => {
    if (depth > 30) throw new Error(`cycle resolving ${value}`);
    const v = value.trim();
    const ref = /^var\((--[a-z0-9-]+)(?:,\s*(.+))?\)$/.exec(v);
    if (ref) {
      const next = vars[ref[1]] ?? ref[2];
      if (next === undefined) throw new Error(`undefined ${ref[1]}`);
      return resolve(next, depth + 1);
    }
    const mix = /^color-mix\(in oklab, (.+) (\d+)%, (.+) (\d+)%\)$/.exec(v);
    if (mix) {
      const a = toOklab(resolve(mix[1], depth + 1).hex);
      const b = toOklab(resolve(mix[3], depth + 1).hex);
      const t = Number(mix[4]) / 100;
      return { hex: fromOklab(a.map((x, i) => x * (1 - t) + b[i] * t)), alpha: 1 };
    }
    const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(v);
    if (rgba) {
      return {
        hex: rgb2hex([rgba[1], rgba[2], rgba[3]].map((n) => Number(n) / 255)),
        alpha: Number(rgba[4]),
      };
    }
    if (/^#[0-9a-f]{3,6}$/i.test(v)) return { hex: v.toLowerCase(), alpha: 1 };
    throw new Error(`cannot resolve "${v}"`);
  };
  return resolve;
}

/** A translucent colour composited over an opaque one. */
function over(top, bottom) {
  if (top.alpha >= 1) return top.hex;
  const a = hex2rgb(top.hex);
  const b = hex2rgb(bottom);
  return rgb2hex(a.map((c, i) => c * top.alpha + b[i] * (1 - top.alpha)));
}

// ── the checks ───────────────────────────────────────────────────────────
const scales = block(read('scales.css'), ':root');
const theme = read('theme.css');
const app = block(read('app.css'), ':root');
const THEMES = {
  dark: block(theme, ':root'),
  light: block(theme, ":root[data-theme='light']"),
};

const HUES = ['blue', 'saffron', 'green', 'teal', 'violet', 'magenta', 'red'];
const KINDS = [
  'draft',
  'pending',
  'confirmed',
  'in-transit',
  'delivered',
  'rto',
  'failed',
  'cancelled',
  'held',
];
const TEXT = 4.5;
const UI = 3;

const pairs = [
  // [label, foreground, background, minimum]
  ...['--fg-strong', '--fg-body', '--fg-muted', '--fg-faint'].flatMap((fg) =>
    ['--page', '--surface-2', '--surface-3'].map((bg) => [`${fg} on ${bg}`, fg, bg, TEXT]),
  ),
  ['--sky (link) on --page', '--sky', '--page', TEXT],
  ['--sky (link) on --surface-2', '--sky', '--surface-2', TEXT],
  ['--accent-fg on --accent-fill', '--accent-fg', '--accent-fill', TEXT],
  ['--accent-fg on --accent-fill-hover', '--accent-fg', '--accent-fill-hover', TEXT],
  ['--money-credit on --surface-2', '--money-credit', '--surface-2', TEXT],
  ['--money-debit on --surface-2', '--money-debit', '--surface-2', TEXT],
  ['--border-control on --surface-input', '--border-control', '--surface-input', UI],
  ['--focus-ring on --page', '--focus-ring', '--page', UI],
  ['--focus-ring on --surface-2', '--focus-ring', '--surface-2', UI],
  ...HUES.flatMap((h) => [
    [`--${h}-text on --page`, `--${h}-text`, '--page', TEXT],
    [`--${h}-text on --surface-2`, `--${h}-text`, '--surface-2', TEXT],
    [`--${h}-on-fill on --${h}-fill`, `--${h}-on-fill`, `--${h}-fill`, TEXT],
    [`--${h}-on-tint on --${h}-tint`, `--${h}-on-tint`, `--${h}-tint`, TEXT],
  ]),
  ...KINDS.map((k) => [`chip ${k}: fg on bg`, `--st-${k}-fg`, `--st-${k}-bg`, TEXT]),
];

let failures = 0;
for (const [name, vars] of Object.entries(THEMES)) {
  const all = { ...scales, ...vars, ...app };
  const resolve = makeResolver(all);
  const page = resolve('var(--page)').hex;
  const rows = [];
  for (const [label, fg, bg, min] of pairs) {
    const back = over(resolve(`var(${bg})`), page);
    const fore = over(resolve(`var(${fg})`), back);
    const r = contrast(fore, back);
    const ok = r >= min;
    if (!ok) failures += 1;
    rows.push(
      `${ok ? '  ok ' : ' FAIL'} ${r.toFixed(2).padStart(5)} ≥ ${min}  ${label}  (${fore} on ${back})`,
    );
  }
  console.log(`\n${name.toUpperCase()} theme`);
  console.log(rows.join('\n'));
}
console.log(`\n${failures === 0 ? 'All pairs pass.' : `${failures} pair(s) below the floor.`}`);
process.exit(failures === 0 ? 0 : 1);
