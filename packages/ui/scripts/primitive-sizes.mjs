#!/usr/bin/env node
/**
 * Per-primitive weight for `@skydrop/ui/app/*` — the numbers the gallery
 * review is reported with (README: ≤ 3 KB gzip JS, ≤ 2 KB gzip CSS each).
 *
 * JS: every .ts/.tsx in the primitive's folder, transpiled with the
 * package's own TypeScript (JSX → react-jsx, ESM, no minify — the apps'
 * bundler minifies, so this is a CEILING), then gzipped together. CSS: every
 * .css in the folder, gzipped together. `gallery` is excluded (dev-only).
 *
 * Reports; exits 1 only with --strict when a primitive is over budget.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app');
const JS_BUDGET = 3072;
const CSS_BUDGET = 2048;
const strict = process.argv.includes('--strict');
// Owner-approved exceptions (2026-09-23). Reported, never counted as OVER.
const EXCEPTIONS = {
  shell: 'app chrome, loaded once per app',
  'sign-in-map': 'full-detail coastline, lazy-loaded after first paint',
};

const kb = (n) => `${(n / 1024).toFixed(2)} KB`;
const rows = [];
let over = 0;

for (const name of readdirSync(root).sort()) {
  const dir = join(root, name);
  if (!statSync(dir).isDirectory() || name === 'gallery') continue;
  const files = readdirSync(dir);
  const js = files
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map(
      (f) =>
        ts.transpileModule(readFileSync(join(dir, f), 'utf8'), {
          compilerOptions: {
            jsx: ts.JsxEmit.ReactJSX,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
            removeComments: true,
          },
        }).outputText,
    )
    .join('\n');
  const css = files
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
    .join('\n');
  const jsGz = js ? gzipSync(js, { level: 9 }).length : 0;
  const cssGz = css ? gzipSync(css, { level: 9 }).length : 0;
  const excepted = EXCEPTIONS[name];
  const flag = !excepted && (jsGz > JS_BUDGET || cssGz > CSS_BUDGET);
  if (flag) over += 1;
  rows.push({ name, jsGz, cssGz, flag, excepted });
}

const w = Math.max(...rows.map((r) => r.name.length), 9);
console.log(`${'primitive'.padEnd(w)}   JS gz      CSS gz`);
for (const r of rows) {
  console.log(
    `${r.name.padEnd(w)}   ${kb(r.jsGz).padStart(8)}   ${kb(r.cssGz).padStart(8)}${r.flag ? '   OVER' : ''}${r.excepted ? `   exception: ${r.excepted}` : ''}`,
  );
}
const tj = rows.reduce((a, r) => a + r.jsGz, 0);
const tc = rows.reduce((a, r) => a + r.cssGz, 0);
console.log(`${'total'.padEnd(w)}   ${kb(tj).padStart(8)}   ${kb(tc).padStart(8)}`);
console.log(
  over ? `\n${over} primitive(s) over budget (3 KB JS / 2 KB CSS).` : '\nAll within budget.',
);
process.exit(strict && over ? 1 : 0);
