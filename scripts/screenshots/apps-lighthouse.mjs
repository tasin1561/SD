#!/usr/bin/env node
/**
 * Lighthouse mobile for a product app's routes — the restyle's before/after
 * gate ("the after must not be lower"). Mobile form factor, simulated Slow
 * 4G + 4× CPU (Lighthouse defaults), THREE runs per route, median reported
 * (a single run swings several points). Against a local server only; it
 * does not start one. Reports are written to --out (gitignored).
 *
 *   node scripts/screenshots/apps-lighthouse.mjs --base http://localhost:3004 \
 *     --out screenshots/apps-restyle/track/lighthouse-before \
 *     --routes "/,/12345671397690,/NOT-A-REAL-AWB-0000" [--runs 3]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);
const { base: BASE, out: OUT } = args;
const ROUTES = (args.routes ?? '/').split(',');
const RUNS = Number(args.runs ?? 3);
if (!BASE || !OUT) throw new Error('--base and --out are required');
if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE)) throw new Error('local server only');
mkdirSync(OUT, { recursive: true });

const require = createRequire(import.meta.url);
const chrome = require('@playwright/test').chromium.executablePath();
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const summary = [];
for (const route of ROUTES) {
  const name = route === '/' ? 'root' : route.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  const runs = [];
  for (let i = 0, tries = 0; i < RUNS; i += 1) {
    const path = join(resolve(OUT), `${name}-${i + 1}`);
    try {
      execFileSync(
        'npx',
        [
          '--yes',
          'lighthouse@12',
          `${BASE}${route}`,
          '--quiet',
          '--chrome-flags=--headless=new --no-sandbox',
          '--form-factor=mobile',
          '--screenEmulation.mobile',
          '--throttling-method=simulate',
          '--only-categories=performance,accessibility,best-practices,seo',
          '--output=json',
          '--output=html',
          `--output-path=${path}`,
        ],
        // chrome-launcher detects WSL and names its profile dir with a
        // Windows path RELATIVE TO THE CWD ("C:\\Users\\…\\lighthouse.N"),
        // whatever TEMP says — so run it from the OS tmp dir.
        { env: { ...process.env, CHROME_PATH: chrome }, cwd: tmpdir(), stdio: 'ignore' },
      );
    } catch {
      // Lighthouse exits non-zero on some audits; the report is still written.
    }
    const r = JSON.parse(readFileSync(`${path}.report.json`, 'utf8'));
    // A run Lighthouse itself could not measure (e.g. NO_NAVSTART) is a
    // tool failure, not a score of 0: run it again, at most twice.
    if (r.runtimeError !== undefined && tries < 2) {
      tries += 1;
      i -= 1;
      continue;
    }
    const c = r.categories;
    const a = r.audits;
    runs.push({
      perf: Math.round(c.performance.score * 100),
      a11y: Math.round(c.accessibility.score * 100),
      bp: Math.round(c['best-practices'].score * 100),
      seo: Math.round(c.seo.score * 100),
      lcp: a['largest-contentful-paint'].numericValue,
      fcp: a['first-contentful-paint'].numericValue,
      cls: a['cumulative-layout-shift'].numericValue,
      tbt: a['total-blocking-time'].numericValue,
    });
  }
  const m = (k) => median(runs.map((x) => x[k]));
  const row = {
    route,
    perf: m('perf'),
    a11y: m('a11y'),
    bp: m('bp'),
    seo: m('seo'),
    lcpMs: Math.round(m('lcp')),
    fcpMs: Math.round(m('fcp')),
    cls: Number(m('cls').toFixed(3)),
    tbtMs: Math.round(m('tbt')),
    perfRuns: runs.map((x) => x.perf),
  };
  summary.push(row);
  console.log(
    `${route}  perf ${row.perf} (${row.perfRuns.join('/')})  a11y ${row.a11y}  bp ${row.bp}  seo ${row.seo}  LCP ${row.lcpMs}ms  FCP ${row.fcpMs}ms  CLS ${row.cls}  TBT ${row.tbtMs}ms`,
  );
}
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
