/**
 * Strings a FLOW types and a SEED clears, kept in step.
 *
 *   node --test "scripts/tutorials/test/*.test.mjs"
 *
 * `flows.mjs` must not import `seed-demo-data.mjs` — the seed opens a
 * Prisma client at module load and a flow runs inside a browser session
 * that has no business holding one — so a handful of literals are
 * written down twice on purpose. That is fine while they agree and
 * silent when they stop: M1 types a label into a form, its seeding
 * deletes rows carrying that label, and a rename on one side leaves the
 * other clearing nothing. Two takes later the list has three identical
 * accounts on it and the only thing that noticed was nobody.
 *
 * It reads the SOURCE rather than importing either file, for the same
 * reason the seed cannot be imported, and because what is being checked
 * is a declaration and not a behaviour.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TUTORIALS = path.resolve(DIR, '..');

async function read(file) {
  return fs.readFile(path.join(TUTORIALS, file), 'utf8');
}

/** `const NAME = '…';` — the one declaration, wherever it lives. */
function declared(source, name) {
  const found = source.match(new RegExp(`const ${name} = '([^']*)';`, 'g')) ?? [];
  assert.equal(
    found.length,
    1,
    `${name} is declared ${found.length} time(s); it is meant to be declared exactly once per file.`,
  );
  const value = new RegExp(`const ${name} = '([^']*)';`).exec(source);
  assert.ok(value !== null, `${name} is not a simple single-quoted literal.`);
  return value[1];
}

describe('a label one file types and another file clears', () => {
  it('M1 adds the courier account its seeding removes', async () => {
    const [flows, seed] = await Promise.all([read('flows.mjs'), read('seed-demo-data.mjs')]);
    assert.equal(
      declared(flows, 'M1_ACCOUNT_LABEL'),
      declared(seed, 'M1_ACCOUNT_LABEL'),
      'The courier account M1 adds is not the one its seeding deletes, so every take leaves ' +
        'another row on a page whose whole subject is knowing which account is which.',
    );
  });
});
