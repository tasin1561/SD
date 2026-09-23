#!/usr/bin/env node
/**
 * The brand token DRIFT GATE (apps restyle, decision 1).
 *
 * `packages/ui/src/brand/scales.css` and `theme.css` are copies of
 * apps/marketing's `src/app/scales.css` and `src/app/theme.css`, so the
 * five apps read one palette while apps/marketing stays untouched. A copy is
 * only safe while it is identical: this fails the build on ANY difference,
 * byte for byte, and names the first differing line. Fix it by copying
 * marketing's file over the package's (marketing is the source), never the
 * other way round.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const pairs = [
  ['apps/marketing/src/app/scales.css', 'packages/ui/src/brand/scales.css'],
  ['apps/marketing/src/app/theme.css', 'packages/ui/src/brand/theme.css'],
];
let failed = false;
for (const [source, copy] of pairs) {
  const a = readFileSync(join(repo, source), 'utf8');
  const b = readFileSync(join(repo, copy), 'utf8');
  if (a === b) {
    console.log(`brand tokens: ${copy} matches ${source}`);
    continue;
  }
  failed = true;
  const la = a.split('\n');
  const lb = b.split('\n');
  const n = la.findIndex((line, i) => line !== lb[i]);
  const at = n === -1 ? Math.min(la.length, lb.length) : n;
  console.error(`brand tokens DRIFTED: ${copy} differs from ${source} at line ${at + 1}`);
  console.error(`  marketing: ${la[at] ?? '(end of file)'}`);
  console.error(`  package:   ${lb[at] ?? '(end of file)'}`);
  console.error(`  Fix: cp ${source} ${copy}`);
}
process.exit(failed ? 1 : 0);
