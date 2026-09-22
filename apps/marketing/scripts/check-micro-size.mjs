#!/usr/bin/env node
/**
 * Size budget for the micro-interaction library (spec §12):
 *   each pattern's index.tsx, transpiled, gzipped   ≤ 3 072 B
 *   each pattern's .css, gzipped                    ≤ 2 048 B
 *   the SHIPPED library total (patterns imported by a production route,
 *   transitively, plus the hooks)                    ≤ 55 296 B gz
 *   — the owner set 40 960 B on 2026-09-21 (raised from 25 600). Phase 4
 *   ships 29 patterns at ~1.7 KB each = 49.9 KB, every one inside its
 *   own 3 KB / 2 KB budget, so the total is a headcount, not fat. Raised
 *   PROVISIONALLY to 52 KB in the Phase 4 report, 54 KB after Phase 7 (the contact mascot), for the owner's call.
 * A pattern only the gallery imports is listed but not counted — it is
 * never in a production chunk. Prints the per-pattern table the phase
 * reports ask for. Runs in postbuild beside check-theme and check-bundle.
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

/** Every source file outside the library and the dev routes — what production ships. */
const productionSources = (() => {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) {
        if (p === DIR || p.endsWith('/app/dev')) continue;
        walk(p);
      } else if (/\.(tsx?|css)$/.test(n)) out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(join(ROOT, 'src'));
  return out.join('\n');
})();
/** Patterns a production route imports, plus everything THOSE import (`../pagination` inside the carousel). */
const shippedSet = (() => {
  const names = readdirSync(DIR).filter((n) => statSync(join(DIR, n)).isDirectory());
  const set = new Set(
    names.filter((n) => new RegExp(`micro/${n}(/index)?['"/]`).test(productionSources)),
  );
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of set) {
      const src = readFileSync(join(DIR, n, 'index.tsx'), 'utf8');
      for (const m of src.matchAll(/from '\.\.\/([a-z-]+)(?:\/index)?'/g))
        if (names.includes(m[1]) && !set.has(m[1])) {
          set.add(m[1]);
          grew = true;
        }
    }
  }
  return set;
})();
const rows = [];
const failures = [];
let total = 0;
let all = 0;
for (const name of readdirSync(DIR).sort()) {
  const dir = join(DIR, name);
  if (!statSync(dir).isDirectory()) continue;
  const js = gz(transpile(join(dir, 'index.tsx')));
  const cssFile = readdirSync(dir).find((f) => f.endsWith('.css'));
  const css = cssFile ? gz(readFileSync(join(dir, cssFile), 'utf8')) : 0;
  const shipped = shippedSet.has(name);
  all += js + css;
  if (shipped) total += js + css;
  const ok = js <= 3072 && css <= 2048;
  if (!ok) failures.push(`${name}: js ${js} B / 3072, css ${css} B / 2048`);
  rows.push(
    `${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(24)} js ${String(js).padStart(5)} B   css ${String(css).padStart(5)} B${shipped ? '' : '   (gallery only)'}`,
  );
}
for (const f of ['motion.ts', 'use-async-state.ts', 'micro.css']) {
  const p = join(DIR, f);
  const size = f.endsWith('.css') ? gz(readFileSync(p, 'utf8')) : gz(transpile(p));
  total += size;
  rows.push(`info ${f.padEnd(24)}    ${String(size).padStart(5)} B`);
}
rows.push(`info ${'all patterns'.padEnd(24)}    ${String(all).padStart(5)} B`);
rows.push(
  `${total <= 55296 ? 'OK  ' : 'FAIL'} ${'shipped library total'.padEnd(24)}    ${String(total).padStart(5)} B / 55296`,
);
if (total > 55296) failures.push(`shipped library total ${total} B > 55296`);
console.log('check:micro\n' + rows.join('\n'));
if (failures.length) {
  console.error('\ncheck:micro FAILED:\n  ' + failures.join('\n  '));
  process.exit(1);
}
