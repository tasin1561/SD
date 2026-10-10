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

/**
 * `const NAME = ['…', '…'];` — the same question of a LIST.
 *
 * Prettier breaks an array that passes 100 characters onto its own
 * lines, so this matches across newlines rather than demanding the one
 * long form the file happens to have today.
 */
function declaredList(source, name) {
  const found = new RegExp(`const ${name} =\\s*\\[([^\\]]*)\\];`).exec(source);
  assert.ok(found !== null, `${name} is not declared as an array literal.`);
  return [...found[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
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

  /*
    THE SLUG, not a label — a different shape of the same failure.
    `record.mjs` pins a flow's step ids against the narration, so those
    two cannot drift apart silently. Nothing pins the SEED's slug guard:
    rename it on its own and `manualPlacementWorldFor` returns at its
    first line, the worklist is empty, and every step of the take still
    finds a page. A green run over nothing.

    It is checked against the flow KEY and the narration SLUG rather
    than against another constant, because those two are what the
    machinery actually dispatches on.
  */
  it('L4 seeds the world for the slug it is filmed under', async () => {
    const [flows, seed, narration] = await Promise.all([
      read('flows.mjs'),
      read('seed-demo-data.mjs'),
      read('narration.mjs'),
    ]);
    const slug = declared(seed, 'L4_SLUG');
    assert.equal(
      declared(flows, 'L4_SLUG'),
      slug,
      'L4_SLUG differs between the flow and the seed.',
    );
    assert.ok(
      flows.includes(`'${slug}': {`),
      `There is no flow keyed '${slug}', so the seeding builds a world no take ever opens.`,
    );
    assert.ok(
      narration.includes(`slug: '${slug}',`),
      `There is no narration for '${slug}', so record.mjs will refuse to open the browser.`,
    );
  });

  it('M4 seeds the world for the slug it is filmed under', async () => {
    const [flows, seed, narration] = await Promise.all([
      read('flows.mjs'),
      read('seed-demo-data.mjs'),
      read('narration.mjs'),
    ]);
    const slug = declared(seed, 'M4_SLUG');
    assert.equal(
      declared(flows, 'M4_SLUG'),
      slug,
      'M4_SLUG differs between the flow and the seeding.',
    );
    assert.ok(
      flows.includes(`'${slug}': {`),
      `There is no flow keyed '${slug}', so the seeding builds a world no take ever opens.`,
    );
    assert.ok(
      narration.includes(`slug: '${slug}',`),
      `There is no narration for '${slug}', so record.mjs will refuse to open the browser.`,
    );
  });

  it('M4 names the carrier its seeding does, on a docket that is not one of ours', async () => {
    const [flows, seed] = await Promise.all([read('flows.mjs'), read('seed-demo-data.mjs')]);
    assert.equal(
      declared(flows, 'M4_CARRIER'),
      declared(seed, 'M4_CARRIER'),
      'The carrier M4 types is not the one its seeding writes to the fixture, so the narration ' +
        'names one company and the record names another.',
    );
    /*
      THE WAYBILL ITSELF IS DELIBERATELY NOT A CONSTANT — `awb_number` is
      UNIQUE (CUR-9), so a fixed one can be typed exactly once in the
      life of a database and the second take meets AWB_ALREADY_IN_USE.
      What IS pinned is its SHAPE: three digits plus eight is Bluedart's
      eleven, not the fourteen the simulator issues, because a number
      that looks like ours reads as the integration having booked it
      after all.
    */
    const prefix = declared(seed, 'M4_AWB_PREFIX');
    assert.ok(
      /^[0-9]{3}$/.test(prefix),
      `M4's waybill prefix is "${prefix}"; with the eight clock digits beside it that has to ` +
        "come to Bluedart's eleven.",
    );
    assert.ok(
      !flows.includes('M4_AWB ='),
      'M4 declares a fixed waybill again. It cannot: `shipments.awb_number` is UNIQUE, so the ' +
        'second take would be refused with AWB_ALREADY_IN_USE part-way through the dialog.',
    );
  });

  it('O5 acts on the people and the broadcast its seeding knows about', async () => {
    const [flows, seed] = await Promise.all([read('flows.mjs'), read('seed-demo-data.mjs')]);
    for (const name of ['O5_STAFF_EMAIL', 'O5_INVITE_EMAIL', 'O5_BROADCAST_TITLE']) {
      assert.equal(
        declared(flows, name),
        declared(seed, name),
        `${name} differs between the flow and the seeding. Each of these is a row the seeding ` +
          'finds by exactly these words, so a rename leaves the take acting on one thing and the ' +
          'tidying-up looking for another.',
      );
    }
  });

  it('O4 types back the value its seeding resets to', async () => {
    const [flows, seed] = await Promise.all([read('flows.mjs'), read('seed-demo-data.mjs')]);
    const typed = declared(flows, 'O4_THRESHOLD_VALUE');
    const reset = /const O4_SETTING_VALUE =\s*(\d+);/.exec(seed);
    assert.ok(reset !== null, 'O4_SETTING_VALUE is not a plain number literal in the seed.');
    assert.equal(
      typed,
      reset[1],
      'The value O4 types back on camera is not the one its seeding resets to, so the take ends ' +
        'on a system setting nobody meant to leave there — and the next run quietly corrects it.',
    );
  });

  it('O3 links the courier accounts its seeding creates', async () => {
    const [flows, seed] = await Promise.all([read('flows.mjs'), read('seed-demo-data.mjs')]);
    const labels = declaredList(seed, 'O3_ACCOUNT_LABELS');
    for (const name of ['O3_FIRST_ACCOUNT', 'O3_SECOND_ACCOUNT']) {
      const picked = declared(flows, name);
      assert.ok(
        labels.includes(picked),
        `${name} is "${picked}", which O3's seeding does not create — the Add-link dropdown is ` +
          'selected by LABEL, so a rename leaves the flow choosing an option that is not there.',
      );
    }
  });

  it('R7 opens the parcel its seeding drives out for delivery', async () => {
    const [flows, seed] = await Promise.all([read('flows.mjs'), read('seed-demo-data.mjs')]);
    const searched = declared(flows, 'STORE_DELIVERY_CUSTOMER_PHONE');
    // The seed declares it inside STORE_REQUEST_ORDERS.delivery, so this
    // reads the object's own `phone` rather than a standalone constant.
    const block = /delivery: \{[\s\S]*?\n  \},/.exec(seed);
    assert.ok(block !== null, 'STORE_REQUEST_ORDERS.delivery is not where this expects it.');
    const phone = /phone:\s*'([^']*)'/.exec(block[0]);
    assert.ok(phone !== null, 'STORE_REQUEST_ORDERS.delivery has no single-quoted `phone`.');
    assert.equal(
      searched,
      phone[1],
      'R7 searches the orders list for a number its seeding does not place an order for, so ' +
        'the prologue opens whatever the list happens to show first — which, on a store with ' +
        'six orders, is a parcel that is not out for delivery and has no asks on it at all.',
    );
  });

  it('R10 reads back the dispute its seeding settles', async () => {
    const [flows, seed] = await Promise.all([read('flows.mjs'), read('seed-demo-data.mjs')]);
    const read_ = declared(flows, 'STORE_SETTLED_DISPUTE_SUBJECT');
    const block = /const STORE_SETTLED_DISPUTE = \{[\s\S]*?\n\};/.exec(seed);
    assert.ok(block !== null, 'STORE_SETTLED_DISPUTE is not declared as a plain object.');
    const subject = /subject:\s*'([^']*)'/.exec(block[0]);
    assert.ok(subject !== null, 'STORE_SETTLED_DISPUTE has no single-quoted `subject`.');
    assert.equal(
      read_,
      subject[1],
      'R10 reaches for a settled thread by a subject its seeding never wrote, so its last two ' +
        'scenes dwell past an empty page — and a tolerant step films that silently.',
    );
  });

  it('R18 creates the key and webhook its seeding clears', async () => {
    const [flows, seed] = await Promise.all([read('flows.mjs'), read('seed-demo-data.mjs')]);
    for (const [flowName, seedName] of [
      ['R18_KEY_NAME', 'R18_KEY_NAME'],
      ['R18_WEBHOOK_URL', 'R18_WEBHOOK_URL'],
    ]) {
      assert.equal(
        declared(flows, flowName),
        declared(seed, seedName),
        `${flowName} differs between the flow and the seed. The flow TYPES it on camera and ` +
          'the seed clears what the last take left, so a rename leaves the key table growing ' +
          'a row per run and the webhook refused on a duplicate URL.',
      );
    }
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

  /*
    R19–R21's four, and every one of them is a PROPERTY of an object
    rather than a bare `const`, so `declared` cannot read them: the
    people live in `LONG_STORE_PEOPLE` and the customer in
    `STORE_REPORT_ORDERS`. A small reader per shape is cheaper than
    flattening either declaration, both of which are documented where
    they are for reasons of their own.
  */
  function property(source, object, key) {
    const block = new RegExp(`const ${object} = \\{([\\s\\S]*?)\\n\\};`).exec(source);
    assert.ok(block !== null, `${object} is not an object literal.`);
    const found = new RegExp(`\\b${key}: '([^']*)'`).exec(block[1]);
    assert.ok(found !== null, `${object}.${key} is not a single-quoted literal.`);
    return found[1];
  }

  it('R19–R21 name the people their seeding makes', async () => {
    const [flows, seed] = await Promise.all([read('flows.mjs'), read('seed-demo-data.mjs')]);
    assert.equal(
      declared(flows, 'ASSOC_RAVI'),
      property(seed, 'LONG_STORE_PEOPLE', 'fullName'),
      'R19 finds its roster row by name and R20 opens that person\u2019s price list from it. A ' +
        'rename in the seeding leaves both reaching for a row nobody made \u2014 and R20 cannot ' +
        'even start, because its prologue clicks Set prices inside that row.',
    );
    assert.ok(
      seed.includes(`fullName: '${declared(flows, 'ASSOC_PRIYA')}'`),
      'R19 dwells on PRIYA\u2019s out-of-range chip and R20 copies prices FROM her, so a rename ' +
        'in the seeding takes away the only row either scene is about.',
    );
  });

  it('R19 invites the person its seeding clears', async () => {
    const [flows, seed] = await Promise.all([read('flows.mjs'), read('seed-demo-data.mjs')]);
    const typed = /const ASSOC_INVITEE = \{[^}]*email: '([^']*)'/.exec(flows);
    const cleared = /cameraInvitee: \{[^}]*email: '([^']*)'/.exec(seed);
    assert.ok(typed !== null, 'ASSOC_INVITEE.email is not a single-quoted literal.');
    assert.ok(cleared !== null, 'LONG_STORE_PEOPLE.cameraInvitee.email is not a literal.');
    assert.equal(
      typed[1],
      cleared[1],
      'R19 invites somebody ON CAMERA, and a second pending invitation to one address is ' +
        'refused as INVITATION_ALREADY_PENDING. If the flow and `clearCameraInvitation` stop ' +
        'naming the same person, the first take succeeds and every later one is refused inside ' +
        'a dialog, which reads as a dead Send button.',
    );
  });

  it('R3 places an order for the customer its seeding removes', async () => {
    const [flows, seed] = await Promise.all([read('flows.mjs'), read('seed-demo-data.mjs')]);
    const typed = /const STORE_ORDER = \{[\s\S]*?phone: '([^']*)'/.exec(flows);
    assert.ok(typed !== null, 'STORE_ORDER.phone is not a single-quoted literal.');
    /*
      To `\n  ],`, not to the first `]`: the list's own comment carries
      a grep in it (`\+91[0-9]{10}`), and a non-greedy match stops dead
      on that bracket — reporting a phone that IS in the list as
      missing, which is the most confusing way for this check to fail.
    */
    const list = /takeCustomerPhones: \[([\s\S]*?)\n  \],/.exec(seed);
    assert.ok(list !== null, 'takeCustomerPhones is not an array literal.');
    /*
      COMMENTS STRIPPED FIRST. The list is mostly prose, and that prose
      contains apostrophes ("the store's own order"), so pairing quotes
      across it matches the text BETWEEN two comments and never the
      phone numbers — reporting every entry as absent. Same lesson as
      the seller RBAC spec that asserted on a docblock: a regex cannot
      tell a rule from a sentence about one.
    */
    const cleared = [...list[1].replace(/\/\/[^\n]*/g, '').matchAll(/'([^']*)'/g)].map((m) => m[1]);
    assert.ok(
      cleared.includes(typed[1]),
      `R3 types ${typed[1]} on camera and it is not in takeCustomerPhones, so the order it ` +
        'places survives into the next run and the duplicate guard refuses the re-take at the ' +
        'confirm dialog with no navigation \u2014 which cost a take to diagnose once already.',
    );
  });

  it('R5 searches for an order its seeding actually places', async () => {
    const [flows, seed] = await Promise.all([read('flows.mjs'), read('seed-demo-data.mjs')]);
    assert.ok(
      seed.includes(`phone: '${declared(flows, 'STORE_SEEDED_CUSTOMER_PHONE')}'`),
      'R5 searches a phone number that no seeded order carries, so the scene is a search ' +
        'returning nothing under a line saying any one of four handles finds the order. ' +
        'Nothing in a --check would say so: typing into a box always passes.',
    );
  });
});
