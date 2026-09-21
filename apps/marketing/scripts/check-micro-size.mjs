#!/usr/bin/env node
/**
 * Size budget for the micro-interaction library (spec §12):
 *   each pattern's index.tsx, transpiled, gzipped   ≤ 3 072 B
 *   each pattern's .css, gzipped                    ≤ 2 048 B
 *   the library total (all patterns + hooks)        ≤ 25 600 B gz
 * Prints the per-pattern table the Phase 2 report asks for. Runs in
 * postbuild beside check-theme and check-bundle.
 */
import ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = new URL('..', import.meta.url).pathname;
const DIR = join(ROOT, 'src/components/micro');
const gz = (s) => gzipSync(Buffer.from(s), { level: 9 }).length;
const transpile = (file) =>
  ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      removeComments: true,
    },
  }).outputText;

const rows = [];
const failures = [];
let total = 0;
for (const name of readdirSync(DIR).sort()) {
  const dir = join(DIR, name);
  if (!statSync(dir).isDirectory()) continue;
  const js = gz(transpile(join(dir, 'index.tsx')));
  const cssFile = readdirSync(dir).find((f) => f.endsWith('.css'));
  const css = cssFile ? gz(readFileSync(join(dir, cssFile), 'utf8')) : 0;
  total += js + css;
  const ok = js <= 3072 && css <= 2048;
  if (!ok) failures.push(`${name}: js ${js} B / 3072, css ${css} B / 2048`);
  rows.push(
    `${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(24)} js ${String(js).padStart(5)} B   css ${String(css).padStart(5)} B`,
  );
}
for (const f of ['motion.ts', 'use-async-state.ts', 'micro.css']) {
  const p = join(DIR, f);
  const size = f.endsWith('.css') ? gz(readFileSync(p, 'utf8')) : gz(transpile(p));
  total += size;
  rows.push(`info ${f.padEnd(24)}    ${String(size).padStart(5)} B`);
}
rows.push(
  `${total <= 40960 ? 'OK  ' : 'FAIL'} ${'library total'.padEnd(24)}    ${String(total).padStart(5)} B / 40960`,
);
if (total > 40960) failures.push(`library total ${total} B > 40960`);
console.log('check:micro\n' + rows.join('\n'));
if (failures.length) {
  console.error('\ncheck:micro FAILED:\n  ' + failures.join('\n  '));
  process.exit(1);
}
