/**
 * Every text a FLOW clicks still exists in the product it clicks it in.
 *
 *   node --test "scripts/tutorials/test/*.test.mjs"
 *
 * ── WHAT THIS CATCHES, AND WHY NOTHING DID ──────────────────────────
 * A flow drives a real browser by VISIBLE TEXT: `getByRole('link', {
 * name: 'Reseller stores' })`. Rename that link and the flow passes
 * typecheck, lint and every unit test — then fails at FILMING time, half
 * an hour into a run that needs a provisioned stack, as a timeout naming
 * a selector rather than a cause. The worse case is silent: a selector
 * that still matches something ELSE films the wrong screen perfectly,
 * and narration plays over a page it was never written for.
 *
 * The worst case is worse still, and it really happened. `flows.mjs`
 * carried `if (texts.some((t) => /Refunded the seller/.test(t))) throw`
 * — a guard asserting an option is ABSENT, which the flow's own comment
 * says exists because "the option is missing" is a claim a dwell cannot
 * make. CON-2 renamed that option to "Refunded the client", so the
 * regex matched nothing and the guard passed UNCONDITIONALLY. A
 * negative assertion on renamed copy does not fail; it quietly stops
 * testing. This gate is the cheap check that makes all of that loud.
 *
 * ── HOW IT DECIDES ──────────────────────────────────────────────────
 * It builds a corpus of every string the PRODUCT can actually render —
 * string literals and JSX text from the five frontends, `packages/ui`,
 * AND `apps/api` (P&L line labels and permission labels are composed
 * server-side and arrive over the wire, so a frontend-only corpus
 * cannot see them) — then asks whether each selector's literal is in
 * it.
 *
 * `exact: true` is checked EXACTLY, and that distinction is load-
 * bearing. The corpus is searched as a substring for a loose selector,
 * and `'Sellers'` is a substring of `SellersIndex` and of
 * `sellersInDebt` — so a `{ name: 'Sellers', exact: true }` selector
 * that matched NOTHING in the app looked present. Two real breaks hid
 * behind exactly that.
 *
 * ── ITS LIMITS, STATED, BECAUSE A GATE THAT OVERSTATES IS WORSE ─────
 * - REGEX selectors are skipped; they cannot be searched for as
 *   literals. They are COUNTED and the number is printed, so it being
 *   large is visible rather than flattering. Ten of them were stale
 *   after CON-2 and only a hand grep found them.
 * - A label passed to a HELPER is not a `name:` property, so the three
 *   helpers that take visible text are listed explicitly below. Six
 *   real breaks hid in `moneyKpi(page, 'We owe sellers')`-shaped calls.
 *   A NEW label-taking helper must be added to `HELPERS` or its
 *   selectors are unchecked — and the gate will look just as green.
 * - `name:` is read as a Playwright option and cannot be told from a
 *   plain data key, so `ORDER = { name: 'Meera Raghavan' }` arrives here
 *   as a selector. Over-matching is the safe direction — the cost is an
 *   exemption, where under-matching costs a missed rename — but an entry
 *   below that reads like data may be this rather than a real selector.
 * - A string composed at runtime (`${f.label} — store pays (%)`) or
 *   derived from an enum (`statusLabel`) is in no source file and
 *   cannot be found. Those live in EXPECTED_ABSENT with their reason.
 * - It does NOT check the string is in the app this particular flow
 *   drives: `baseUrl` is chosen per video at runtime and resolving it
 *   statically would be a guess. "Is this text anywhere in the product"
 *   is the question that catches a rename, which is the break that
 *   happens.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TUTORIALS = path.resolve(DIR, '..');
const REPO = path.resolve(TUTORIALS, '..', '..');

const FLOW_FILES = [
  'flows.mjs',
  ...fs
    .readdirSync(path.join(TUTORIALS, 'long'))
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => `long/${f}`),
  ...fs
    .readdirSync(path.join(TUTORIALS, 'sections'))
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => `sections/${f}`),
];

/** Everywhere a string a person reads can come from. */
const SOURCES = [
  'apps/admin/src',
  'apps/seller/src',
  'apps/reseller/src',
  'apps/associate/src',
  'apps/track/src',
  'packages/ui/src',
  // Server-composed copy reaches the screen too: a P&L line's label is
  // `l.label` from pnl.service.ts and a permission's label comes from
  // the catalogue. A frontend-only corpus reported both as missing.
  'apps/api/src',
];

/** Helpers whose argument IS a visible-text label. Add a new one here. */
const HELPERS = ['moneyKpi', 'moneyCard', 'pnlLine'];

/**
 * Literals a flow uses that the product cannot render, each with its
 * reason. Neither inclusion nor exemption is the default — a selector
 * is either found in the product or named here, so a rename cannot hide
 * in the gap.
 */
const EXPECTED_ABSENT = new Map([
  // ── Composed at runtime: correct selectors, unfindable as literals ──
  ['Delivery fee — store pays (%)', 'composed: `${f.label} — store pays (%)` in terms-section'],
  ['Return fee — store pays (%)', 'composed: as above'],
  ['Customer return fee — store pays (%)', 'composed: as above'],
  ['COD fee — store pays (%)', 'composed: as above'],
  ['COD tax — store pays (%)', 'composed: as above'],
  ['Instant Pay fee — store pays (%)', 'composed: as above'],
  ['Partially settled', 'derived by statusLabel from PARTIALLY_SETTLED'],
  ['3 selected', 'composed: `${selected.size} selected` in printing-station'],
  // ── Seed and demo data: owned by seed-demo-data.mjs, not by the app.
  // `tutorial-labels.test.mjs` is what keeps these in step with the seed.
  ['Meera Kulkarni', 'seed: a demo store user'],
  ['Kiran Pawar', 'seed: a demo store user'],
  ['Ananya Iyer', 'seed: a demo customer'],
  // Not seed rows at all: the take's OWN customer, typed into the
  // new-order form (long/associate.mjs:69, sections/associate.mjs:89).
  // Only the PHONE is reserved in the seed, so the duplicate-customer
  // guard does not refuse the order. They also reach this list as a
  // FALSE POSITIVE — see `name:` under the matcher's limits.
  ['Meera Raghavan', 'typed into the new-order form; only its phone is seeded'],
  ['Pooja Deshpande', 'typed into the new-order form; only its phone is seeded'],
  ['Vaishnavi Joshi', 'seed: a demo customer'],
  ['Jamdani Cotton Kurti — Autumn', 'seed: a demo product'],
  ['Rajshahi Silk Kurti', 'seed: a demo product'],
  ['Dhaka Boutique', 'seed: a demo store'],
  ['Our stock sheet', 'seed: a demo consignment label'],
  // ── Accessible names COMPOSED from a SKU at render time:
  // aria-label={`Add ${sku}`} in the store order form. Correct
  // selectors; the SKU half is seed data and the verb half is a
  // template, so neither exists as a literal.
  ['Add RSH-JAMDANI-IVORY', 'composed: `Add ${sku}`'],
  ['Add RSH-SCARF-EMERALD', 'composed: `Add ${sku}`'],
  ['Increase Quantity of RSH-SCARF-EMERALD', 'composed: `Increase Quantity of ${sku}`'],
  // ── Seed data: people, SKUs, usernames, pin codes, expense labels.
  ['Lakshmi Raghavan', 'seed: a demo customer'],
  ['Vikram Desai', 'seed: a demo customer'],
  ['Sneha Pillai', 'seed: a demo customer'],
  ['Anil Varma', 'seed: a demo customer'],
  ['asha.pillai', 'seed: a demo call agent username'],
  ['RSH-LIFE-RESTOCKED', 'seed: a demo SKU'],
  ['RSH-KANTHA-BLUE', 'seed: a demo SKU'],
  ['RSH-JAMDANI-IVORY', 'seed: a demo SKU'],
  ['560103', 'seed: PICK_PIN in seed-demo-data.mjs'],
  ['confused this with another order', 'seed: a demo store request note'],
  ['declined over the delivery charge', 'seed: a demo store request note'],
  // ── Written by the flow itself, earlier in the same scene, then found
  // again: the flow types "Diwali reels, week one" into the expense
  // form at flows.mjs:17676 and filters the table for it at 17713.
  ['Diwali reels', 'typed by the flow at flows.mjs:17676'],
  // ── Allocated at runtime: a ticket number the seed does not choose.
  ['TK-2026-000004', 'runtime: ticket_number_seq allocates it (TKT-1)'],
  // ── Text a flow TYPES rather than clicks.
  ['Colour value 1', 'typed into the variant-option builder'],
  ['Colour value 2', 'typed into the variant-option builder'],
  // ── Not copy at all.
  ['Seller approval admin', 'a staff_roles ROW, seeded by migration 20260803210000'],
  // ── Unresolved and worth a look when this video is next filmed. It is
  // in no source file, no seed script and no fixture, so it is presumed
  // to come from live rate-limit data. It carries no renamed word, so
  // CON-2 did not break it — but nothing here proves it still matches.
  ['waybill bulk', 'UNVERIFIED: presumed a live rate-limit bucket name; confirm at next filming'],
]);

/**
 * Comments out, strings intact — with a real scanner, not a regex.
 *
 * The first version of this used `/\/\*[\s\S]*?\*\//g`, and that was a
 * false-confidence machine twice over. Stripping comments at all is
 * REQUIRED: CON-2 deliberately left ~5,000 comments saying "seller",
 * so a raw search matches the comment above a renamed link and the gate
 * reports clean on the very break it exists to find — measured, with
 * `'Reseller stores'` coming back "present" while the link had read
 * "Member stores" for hours. But a LAZY regex is not how to do it: a
 * file with an unbalanced `/*` inside a string or JSX (one in
 * apps/seller has 14 openers and 13 closers) makes the match run from
 * the stray opener to the next closer and swallow live code — it ate a
 * real `title="Company logo"`, which both invents a false positive and
 * HIDES every true positive in whatever else it consumed.
 *
 * This walks the file tracking string, template and comment state, so
 * a `/*` inside a string is text and a quote inside a comment is not a
 * string.
 */
function stripComments(src) {
  let out = '';
  let state = 'code';
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') {
        state = 'line';
        i += 2;
        out += ' ';
        continue;
      }
      if (c === '/' && d === '*') {
        state = 'block';
        i += 2;
        out += ' ';
        continue;
      }
      if (c === "'") state = 'sq';
      else if (c === '"') state = 'dq';
      else if (c === '`') state = 'tpl';
      out += c;
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += c;
      }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') {
        state = 'code';
        i += 2;
      } else i += 1;
      continue;
    }
    // inside a string or template
    if (c === '\\') {
      out += c + (d ?? '');
      i += 2;
      continue;
    }
    if (
      (state === 'sq' && c === "'") ||
      (state === 'dq' && c === '"') ||
      (state === 'tpl' && c === '`')
    ) {
      state = 'code';
    }
    out += c;
    i += 1;
  }
  return out;
}

const ENTITIES = [
  [/&amp;/g, '&'],
  [/&nbsp;/g, ' '],
  [/&apos;/g, "'"],
  [/&quot;/g, '"'],
  [/&mdash;/g, '—'],
];
function decode(s) {
  return ENTITIES.reduce((acc, [re, ch]) => acc.replace(re, ch), s);
}

/** Collapse whitespace, so a wrapped JSX label equals its one-line form. */
function norm(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/** Every string the product could render: literals and JSX text. */
function productStrings() {
  const exact = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(tsx?|css)$/.test(e.name)) continue;
      const src = stripComments(fs.readFileSync(p, 'utf8'));
      for (const m of src.matchAll(/'([^'\\\n]{2,})'|"([^"\\\n]{2,})"|`([^`\\]{2,})`/g)) {
        exact.add(norm(decode(m[1] ?? m[2] ?? m[3])));
      }
      // JSX text nodes: >Open a member store<
      //
      // Newlines are ALLOWED and the result is whitespace-collapsed,
      // because prettier breaks a JSX label onto its own line the moment
      // the element has more than one attribute:
      //
      //     <Button variant="primary" onClick={…}>
      //       Edit product
      //     </Button>
      //
      // Excluding \n here reported "Edit product", "Invite member",
      // "New endpoint" and sixty more as text the product does not
      // render — every one of them a live button. A gate that
      // over-reports is a gate somebody turns off, which costs the
      // under-report too.
      // A text run is bounded by a tag OR an expression on either side.
      // `>text<` alone misses the commonest shape there is —
      //
      //     <p>Bypasses the state-machine matrix. Currently:{' '}
      //
      // where prettier's own `{' '}` spacer closes the run. It also
      // misses the tail after any interpolation (`}…<`). Both halves
      // reported live product copy as absent.
      for (const m of src.matchAll(/[>}]([^<>{}]{2,})[<{]/g)) exact.add(norm(decode(m[1])));
    }
  };
  for (const d of SOURCES) {
    const abs = path.join(REPO, d);
    if (fs.existsSync(abs)) walk(abs);
  }
  return { exact, blob: [...exact].join('\u0000') };
}

/** Literal text selectors, each with whether it is an EXACT match. */
function selectors(src) {
  const found = [];
  const at = (index) => src.slice(0, index).split('\n').length;
  // { name: 'X' } / { hasText: 'X' } — exact when `exact: true` follows.
  for (const m of src.matchAll(/(?:name|hasText):\s*'([^'\\]{2,})'(\s*,\s*exact:\s*true)?/g)) {
    found.push({ text: m[1], exact: Boolean(m[2]), line: at(m.index) });
  }
  // getByText('X', { exact: true }) / getByLabel('X') / getByPlaceholder('X')
  for (const m of src.matchAll(
    /getBy(?:Text|Label|Placeholder)\(\s*'([^'\\]{2,})'\s*(,\s*\{\s*exact:\s*true)?/g,
  )) {
    found.push({ text: m[1], exact: Boolean(m[2]), line: at(m.index) });
  }
  // A label handed to a helper is a plain ARGUMENT, invisible above.
  for (const m of src.matchAll(
    new RegExp(`\\b(?:${HELPERS.join('|')})\\(\\s*\\w+\\s*,\\s*'([^'\\\\]{2,})'`, 'g'),
  )) {
    found.push({ text: m[1], exact: true, line: at(m.index) });
  }
  return found;
}

function regexSelectorCount(src) {
  return [...src.matchAll(/getBy(?:Text|Label|Placeholder|Role)\([^)]*\/[^/]+\/[gimsuy]*/g)].length;
}

describe('every text a flow clicks exists in the product', () => {
  const { exact, blob } = productStrings();
  let regexes = 0;
  const missing = [];

  for (const rel of FLOW_FILES) {
    const src = fs.readFileSync(path.join(TUTORIALS, rel), 'utf8');
    regexes += regexSelectorCount(src);
    for (const sel of selectors(src)) {
      if (EXPECTED_ABSENT.has(sel.text)) continue;
      const text = norm(sel.text);
      const found = sel.exact ? exact.has(text) : blob.includes(text);
      if (!found) missing.push(`${rel}:${sel.line}  ${sel.exact ? '[exact] ' : ''}"${sel.text}"`);
    }
  }

  it('reports how much of the surface it cannot resolve', () => {
    // Printed, not asserted: a regex selector is unresolvable by
    // construction, and the number being large is the honest caveat on
    // everything below it.
    console.log(
      `    (${regexes} regex selectors skipped — not literals; only a hand grep reaches these)`,
    );
    assert.ok(regexes >= 0);
  });

  it('every literal selector is text the product renders', () => {
    assert.deepEqual(
      missing,
      [],
      'These flows click text that exists nowhere in the product. Either the copy was ' +
        'renamed and the selector must follow, or the literal is not product copy and ' +
        'belongs in EXPECTED_ABSENT with its reason:\n  ' +
        missing.join('\n  '),
    );
  });
});
