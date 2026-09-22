#!/usr/bin/env node
/**
 * The performance budgets, as a GATE in `postbuild`.
 *
 * Next reports first-load GZIPPED sizes but only in a human table; this
 * reads the build manifests, gzips the files itself and fails the build
 * on a breach — so the budget is something CI enforces, not something a
 * reviewer remembers to read off a log.
 *
 *   first-load JS per page (`/`, `/request-invite`)   ≤ 170 000 B gz
 *   three.js / R3F                                    never in first load; lazy total ≤ 220 000 B gz
 *   platform + reseller islands (`__SD_ISLAND_PLATFORM__`)  not in first load; ≤ 60 000 B gz
 *   each vignette (`__SD_VIGNETTE__=`)                ≤ 5 000 B gz
 *   out/index.html                                     ≤ 88 000 B gz (owner-accepted 2026-09-22; inline SVG is for above-the-fold art only)
 *   inlined critical CSS                               ≤ 15 000 B gz (scripts/critical-css.mjs)
 *   inline <svg> across out/**.html                    ≤ 700 000 B raw, each ≤ 25 000 B
 *   the sans woff2                                     ≤ 35 000 B
 *   above-the-fold transfer (poster 1440 avif + index.html gz + first-load JS + CSS) ≤ 350 000 B
 *
 * `@next/bundle-analyzer` (ANALYZE=1) is for humans; this is the gate.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const NEXT = join(ROOT, '.next');
const OUT = join(ROOT, 'out');
const gz = (buf) => gzipSync(buf, { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const failures = [];
const rows = [];
const check = (label, actual, limit) => {
  const ok = actual <= limit;
  rows.push(
    `${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(58)} ${kb(actual).padStart(10)}  / ${kb(limit)}`,
  );
  if (!ok) failures.push(label);
};

const app = JSON.parse(readFileSync(join(NEXT, 'app-build-manifest.json'), 'utf8'));
const build = JSON.parse(readFileSync(join(NEXT, 'build-manifest.json'), 'utf8'));
// Polyfills are `nomodule` — fetched only by browsers without ES modules —
// so, like Next's own "First Load JS" figure, they are not counted.
const shared = new Set(build.rootMainFiles ?? []);

const firstLoad = new Set();
for (const page of ['/page', '/request-invite/page']) {
  const files = app.pages[page];
  if (!files) {
    failures.push(`no manifest entry for ${page}`);
    continue;
  }
  let total = 0;
  for (const f of new Set([...files, ...shared])) {
    if (!f.endsWith('.js')) continue;
    firstLoad.add(f);
    total += gz(readFileSync(join(NEXT, f)));
  }
  check(`first-load JS ${page.replace('/page', '') || '/'}`, total, 170_000);
}

// Classify every chunk by content signature.
const chunkDir = join(NEXT, 'static/chunks');
const walk = (dir, acc = []) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.js')) acc.push(p);
  }
  return acc;
};
let threeTotal = 0;
let islandTotal = 0;
for (const p of walk(chunkDir)) {
  const src = readFileSync(p, 'utf8');
  const rel = p.slice(NEXT.length + 1);
  const inFirst = firstLoad.has(rel);
  const isThree = /WebGLRenderer|three\.module|REVISION\s*=\s*['"]1\d\d['"]/.test(src);
  const isIsland = src.includes('__SD_ISLAND_PLATFORM__');
  const vig = src.match(/__SD_VIGNETTE__\s*=\s*['"]([a-zA-Z-]+)['"]/);
  const size = gz(src);
  if (isThree) {
    threeTotal += size;
    if (inFirst) failures.push(`three.js chunk ${rel} is in first load`);
  }
  if (isIsland) {
    islandTotal += size;
    if (inFirst) failures.push(`platform/reseller island ${rel} is in first load`);
  }
  if (vig) check(`vignette ${vig[1]}`, size, 5_000);
}
check('three.js + R3F lazy chunks (total)', threeTotal, 220_000);
check('platform + reseller islands (total)', islandTotal, 60_000);

// HTML weight + inline SVG.
const indexHtml = readFileSync(join(OUT, 'index.html'));
// 88 000 — ACCEPTED by the owner on 2026-09-22 as the ceiling (was 75 000; PHASE-8-MUST-FIX item 6). Phase 6's
// FAQ + contact + final CTA added ~16 KB gz: each server section lands twice
// (DOM + the RSC flight payload, 31.5 KB gz on its own) plus the FAQ JSON-LD.
check('out/index.html (gz)', gz(indexHtml), 88_000);
const criticalCss =
  /<style data-critical>([\s\S]*?)<\/style>/.exec(indexHtml.toString())?.[1] ?? '';
check('inlined critical CSS in index.html (gz)', gz(criticalCss), 15_000);
{
  // The deferred stylesheet(s) the home page loads after first paint.
  let deferred = 0;
  for (const m of indexHtml
    .toString()
    .matchAll(/rel="preload" as="style" (?:fetchpriority="low" )?href="([^"]+\.css)"/g))
    deferred += gz(readFileSync(join(OUT, m[1])));
  check('deferred stylesheet(s) for / (gz)', deferred, 45_000);
}
let svgTotal = 0;
let svgMax = 0;
for (const p of walk(OUT)
  .filter(() => false)
  .concat(
    readdirSync(OUT)
      .filter((n) => n.endsWith('.html'))
      .map((n) => join(OUT, n)),
  )) {
  const html = readFileSync(p, 'utf8');
  for (const m of html.matchAll(/<svg[\s\S]*?<\/svg>/g)) {
    svgTotal += m[0].length;
    svgMax = Math.max(svgMax, m[0].length);
  }
}
check('inline <svg> across pages (raw total)', svgTotal, 700_000);
check('largest single inline <svg> (raw)', svgMax, 25_000);

// Fonts.
const fontsDir = join(ROOT, 'src/app/fonts');
for (const n of readdirSync(fontsDir).filter(
  (n) => n.endsWith('.woff2') && !n.startsWith('jetbrains'),
)) {
  check(`font ${n}`, statSync(join(fontsDir, n)).size, 35_000);
}

// Above-the-fold transfer.
const cssFiles = walk(join(NEXT, 'static')).length ? [] : [];
let cssTotal = 0;
const cssDir = join(NEXT, 'static/css');
if (existsSync(cssDir))
  for (const n of readdirSync(cssDir))
    if (n.endsWith('.css')) cssTotal += gz(readFileSync(join(cssDir, n)));
void cssFiles;
let firstLoadTotal = 0;
for (const f of firstLoad) firstLoadTotal += gz(readFileSync(join(NEXT, f)));
const poster = join(OUT, 'hero/poster-dark-out-1440.avif');
const posterSize = existsSync(poster) ? statSync(poster).size : 0;
check(
  'above-the-fold transfer (poster + index.html gz + JS + CSS)',
  posterSize + gz(indexHtml) + firstLoadTotal + cssTotal,
  350_000,
);
if (existsSync(poster)) check('hero poster 1440 avif', posterSize, 60_000);
const sprite = join(OUT, 'art/sprite.svg');
if (existsSync(sprite))
  rows.push(`info public/art/sprite.svg (gz) ${kb(gz(readFileSync(sprite)))}`);

console.log('check:bundle\n' + rows.join('\n'));
if (failures.length) {
  console.error('\ncheck:bundle FAILED:\n  ' + failures.join('\n  '));
  process.exit(1);
}
