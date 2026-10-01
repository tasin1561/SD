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

/**
 * `const NAME = '…';` — the one declaration, wherever it lives.
 *
 * `\\s*` after the `=` rather than a space, because Prettier wraps a
 * declaration whose line would pass 100 characters onto the next line
 * and the whole check then reports the constant as DECLARED ZERO
 * TIMES — which reads as a rename and is a line length. N7's reason is
 * a sentence an operator would write and it wrapped on the first run.
 */
function declared(source, name) {
  const found = source.match(new RegExp(`const ${name} =\\s*'([^']*)';`, 'g')) ?? [];
  assert.equal(
    found.length,
    1,
    `${name} is declared ${found.length} time(s); it is meant to be declared exactly once per file.`,
  );
  const value = new RegExp(`const ${name} =\\s*'([^']*)';`).exec(source);
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

  it('N7 types the reconcile reason its seeding finds', async () => {
    const [flows, seed] = await Promise.all([read('flows.mjs'), read('seed-demo-data.mjs')]);
    assert.equal(
      declared(flows, 'N7_RECONCILE_REASON'),
      declared(seed, 'N7_RECONCILE_REASON'),
      'The reason N7 types is not the one its seeding looks for, so every take leaves its ' +
        'reconciliation on the book \u2014 and the next take types a statement figure the book ' +
        'already agrees with, filming a correction with nothing to correct.',
    );
  });

  it('O2 works the seller its seeding makes, and corrects the phone to a different number', async () => {
    const [flows, seed] = await Promise.all([read('flows.mjs'), read('seed-demo-data.mjs')]);
    assert.equal(
      declared(flows, 'O2_SELLER_NAME'),
      declared(seed, 'O2_SELLER_NAME'),
      'The seller O2 searches the list for is not the one its seeding creates, so the take opens ' +
        'on an empty list and the whole video has nobody to manage.',
    );
    assert.equal(
      declared(flows, 'O2_PHONE_CORRECTED'),
      declared(seed, 'O2_PHONE_CORRECTED'),
      'The number the identity correction types is not the one the seeding checks against what ' +
        'it puts back, so the two can become the same and the API answers IDENTITY_NO_CHANGES.',
    );
  });

  it('O1 invites the lead its seeding resets', async () => {
    const [flows, seed] = await Promise.all([read('flows.mjs'), read('seed-demo-data.mjs')]);
    assert.equal(
      declared(flows, 'O1_LEAD_EMAIL'),
      declared(seed, 'O1_LEAD_EMAIL'),
      'The lead O1 reaches for on the sellers page is not the one its seeding wrote, so the ' +
        'pending-invitation scene looks for a row that was never issued.',
    );
  });
});
