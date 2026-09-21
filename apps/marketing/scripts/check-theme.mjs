#!/usr/bin/env node
/**
 * The four-block invariant, as a GATE rather than a discipline.
 *
 * theme.css declares light TWICE (OS preference + pinned) and dark TWICE.
 * FE-6 records that drift between a pair means the theme changes when
 * you touch the toggle. This checks, declaration for declaration:
 *   1. light-A ≡ light-B and dark-A ≡ dark-B;
 *   2. both themes declare the SAME token names;
 *   3. every hue has every semantic role in every block
 *      (text / fill / fill-hover / on-fill / tint / on-tint / line / glow);
 *   4. `--page` in each theme equals `PAGE_BG` in src/lib/theme-colors.ts;
 *   5. every `var(--x)` a block reads resolves to a token declared in
 *      that block or in scales.css.
 * Runs in `postbuild`, so CI's existing build step enforces it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const theme = readFileSync(join(ROOT, 'src/app/theme.css'), 'utf8');
const scales = readFileSync(join(ROOT, 'src/app/scales.css'), 'utf8');
const colors = readFileSync(join(ROOT, 'src/lib/theme-colors.ts'), 'utf8');

const HUES = ['blue', 'saffron', 'green', 'teal', 'violet', 'magenta', 'red'];
const ROLES = ['text', 'fill', 'fill-hover', 'on-fill', 'tint', 'on-tint', 'line', 'glow'];

/** Extract `--name: value;` pairs from the block that follows `selector`. */
function block(css, selector) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  let i = css.indexOf('{', start) + 1;
  let depth = 1;
  const from = i;
  for (; i < css.length && depth > 0; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
  }
  const body = css.slice(from, i - 1).replace(/\/\*[\s\S]*?\*\//g, '');
  const decls = new Map();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g))
    decls.set(m[1], m[2].trim().replace(/\s+/g, ' '));
  return decls;
}

const darkA = block(theme, '\n:root {');
const lightA = block(theme, ':root:not([data-theme]) {');
const lightB = block(theme, ":root[data-theme='light'] {");
const darkB = block(theme, ":root[data-theme='dark'] {");
const raw = block(scales, ':root {');

const failures = [];
const same = (a, b, label) => {
  for (const [k, v] of a)
    if (b.get(k) !== v)
      failures.push(
        `${label}: ${k} is "${v}" in copy 1 and "${b.get(k) ?? '(missing)'}" in copy 2`,
      );
  for (const k of b.keys()) if (!a.has(k)) failures.push(`${label}: ${k} only in copy 2`);
};
same(lightA, lightB, 'light');
same(darkA, darkB, 'dark');
for (const k of lightA.keys())
  if (!darkA.has(k)) failures.push(`token ${k} declared for light but not dark`);
for (const k of darkA.keys())
  if (!lightA.has(k)) failures.push(`token ${k} declared for dark but not light`);
for (const [label, b] of [
  ['dark', darkA],
  ['light', lightA],
]) {
  for (const h of HUES)
    for (const r of ROLES)
      if (!b.has(`--${h}-${r}`)) failures.push(`${label}: missing semantic token --${h}-${r}`);
  for (const [k, v] of b)
    for (const m of v.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
      if (!b.has(m[1]) && !raw.has(m[1]))
        failures.push(`${label}: ${k} reads ${m[1]}, which nothing declares`);
    }
}
const pageBg = Object.fromEntries(
  [...colors.matchAll(/(light|dark):\s*'(#[0-9a-f]{6})'/g)].map((m) => [m[1], m[2]]),
);
if (lightA.get('--page') !== pageBg.light)
  failures.push(`--page (light) ${lightA.get('--page')} ≠ PAGE_BG.light ${pageBg.light}`);
if (darkA.get('--page') !== pageBg.dark)
  failures.push(`--page (dark) ${darkA.get('--page')} ≠ PAGE_BG.dark ${pageBg.dark}`);
for (const h of HUES)
  for (const s of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950])
    if (!raw.has(`--${h}-${s}`)) failures.push(`scales.css: missing --${h}-${s}`);

if (failures.length) {
  console.error(`check:theme FAILED (${failures.length}):\n  ` + failures.join('\n  '));
  process.exit(1);
}
console.log(
  `check:theme OK — ${darkA.size} tokens × 4 blocks, ${raw.size} raw steps, pairs identical, --page matches theme-colors.ts`,
);
