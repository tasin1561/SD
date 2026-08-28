import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `_max: { id: true }` is a query Postgres refuses.
 *
 * Our ids are uuidv7, and there is no `max(uuid)` aggregate — the
 * database answers 42883 and the request 500s. Prisma's types allow it
 * happily, so typecheck passes; every unit test mocks Prisma, so a mock
 * agrees with it too. It reaches production green.
 *
 * This has now happened TWICE: once in the admin wallet overview, and
 * again two days later in the treasury overview, written by the same
 * hand that had just fixed the first one. Twice is a pattern, and a
 * pattern deserves a gate rather than a resolution to be careful.
 *
 * The alternative that works: ids are monotonic, so `orderBy: { id:
 * 'desc' }, take: 1` finds the newest row, and a maintained balance
 * column answers "the latest running balance" without a scan at all.
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('no aggregate over a uuid column', () => {
  it('nothing asks Postgres for max() or min() of an id', () => {
    const offenders: string[] = [];
    for (const file of walk(join(__dirname, '../../src'))) {
      const src = readFileSync(file, 'utf8');
      // Strip line comments first: the fix for the last occurrence
      // EXPLAINS the broken form, and a guard that trips on its own
      // explanation is a guard people delete.
      const code = src
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n');
      if (/_(?:max|min):\s*\{\s*id:\s*true/.test(code)) {
        offenders.push(file.replace(/.*\/src\//, 'src/'));
      }
    }
    expect(offenders).toEqual([]);
  });
});
