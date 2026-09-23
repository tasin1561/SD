#!/usr/bin/env node
/**
 * Copy every stylesheet under src/brand and src/app into dist, keeping the
 * tree. `tsc` only emits JavaScript; the brand skin and each app primitive's
 * CSS travel beside the compiled components so a relative `@import` or a
 * component's own `import './x.css'` resolves in dist exactly as in src.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let copied = 0;
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.css')) {
      const out = join(root, 'dist', relative(join(root, 'src'), p));
      mkdirSync(dirname(out), { recursive: true });
      cpSync(p, out);
      copied += 1;
    }
  }
}
walk(join(root, 'src', 'brand'));
walk(join(root, 'src', 'app'));
console.log(`copy-css: ${copied} stylesheet(s) → dist`);
