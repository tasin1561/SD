/**
 * SECTION S — the three strings `sections/associate.mjs` types and
 * `seed-demo-data.mjs` has to know about.
 *
 *   node --test "scripts/tutorials/test/*.test.mjs"
 *
 * The same shape, and the same reason, as `tutorial-labels.test.mjs`:
 * a flow cannot import the seed (it opens a Prisma client at module
 * load and a flow runs inside a browser session that has no business
 * holding one), so a handful of literals are written down twice on
 * purpose. That is fine while they agree and SILENT when they stop —
 * and every one of these three is a string whose drift costs a take
 * rather than failing anything:
 *
 *   · the take CUSTOMER's phone. `/store/orders` refuses a second
 *     order for somebody who still has one unpacked, so a take that
 *     successfully places its order leaves exactly the row that stops
 *     the next one. It presents as a dead "Place order" button.
 *   · the take TICKET's subject. Both the seeded ticket and the one
 *     S7 raises are store-raised issues opened by the same person on
 *     one of their own orders, so the type and the actor say nothing:
 *     the SUBJECT is the only thing that tells them apart, and the
 *     seed sweeps by "not this one".
 *   · the customer S7 raises the issue AGAINST. It is read off the
 *     option text, so a seeded customer who stops having an order is
 *     a picker with nothing to select.
 *
 * It reads the SOURCE rather than importing either file, for the same
 * reason the seed cannot be imported, and because what is checked is a
 * declaration rather than a behaviour.
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

/** `key: '…'` inside the named object literal. */
function field(source, object, key) {
  const block = new RegExp(`const ${object} = \\{([\\s\\S]*?)\\n\\};`).exec(source);
  assert.ok(block !== null, `${object} is not declared as an object literal.`);
  const found = new RegExp(`\\b${key}:\\s*'([^']*)'`).exec(block[1]);
  assert.ok(found !== null, `${object}.${key} is not a simple single-quoted literal.`);
  return found[1];
}

describe('section S — what a flow types and the seed has to know', () => {
  it('S3 places its order for a customer the seed sweeps', async () => {
    const [section, seed] = await Promise.all([
      read('sections/associate.mjs'),
      read('seed-demo-data.mjs'),
    ]);
    const phone = field(section, 'ORDER', 'phone');
    // `includes`, not a RegExp: an E.164 number starts with a `+`,
    // which is a quantifier — `new RegExp("'+9198…")` asks for one or
    // more quote characters and then matches nothing, so the check
    // fails on a phone that IS in the list. Found on the first run.
    assert.ok(
      seed.includes(`'${phone}',`),
      `assoc-place-an-order types ${phone} and \`LONG_TAKE_ARTEFACTS.takeCustomerPhones\` does ` +
        'not carry it, so the order it places survives the next seed and the take after this ' +
        'one is refused by the duplicate guard at the confirm dialog, with no navigation and ' +
        'no error on screen.',
    );
  });

  it('S7 raises an issue the seed can tell from the seeded one', async () => {
    const [section, seed] = await Promise.all([
      read('sections/associate.mjs'),
      read('seed-demo-data.mjs'),
    ]);
    const raised = field(section, 'ISSUE', 'subject');
    const seeded = field(seed, 'LONG_ASSOCIATE_TICKET', 'subject');
    assert.notEqual(
      raised,
      seeded,
      'The issue S7 raises carries the SEEDED ticket’s subject. `clearAssociateTakeArtefacts` ' +
        'sweeps every associate-raised ticket EXCEPT that subject, so these being equal means ' +
        'the take’s ticket is never removed and the seeded conversation the video opens on is ' +
        'a second identical row.',
    );
  });

  it('S7 raises it against a customer who has an order in this world', async () => {
    const [section, seed] = await Promise.all([
      read('sections/associate.mjs'),
      read('seed-demo-data.mjs'),
    ]);
    const customer = field(section, 'ISSUE', 'onCustomer');
    assert.ok(
      seed.includes(`name: '${customer}'`),
      `S7 picks its order by the customer name "${customer}", read off the option text — and ` +
        'no seeded order is for them. The picker then has nothing to select and the step ' +
        'throws, which is the loud half; the quiet half is a rename leaving it matching some ' +
        'other row.',
    );
  });
});
