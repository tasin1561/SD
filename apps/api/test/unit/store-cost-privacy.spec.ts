import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrderStatus, Prisma } from '@skydrop/db';
import { scorecard } from '../../src/modules/reseller-reports/services/reseller-scorecard';

/**
 * RS-3 / ASSOC-1 boundary 1 — THE SELLER'S UNIT COST NEVER REACHES A
 * RESELLER STORE.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────
 * The boundary was real before this spec and held in three places, and
 * NOT ONE of them had a test naming it. Two of the three are a single
 * token wide:
 *
 *   · `StoreCatalogueItem` does not DECLARE the field.
 *   · `StoreAnalysisService.analysis()` passes `unitCostInr: null` into
 *     the shared scorecard.
 *   · `StoreOrderRates` is `Omit<Scorecard, 'marginInr' | …>`.
 *
 * A `: null` with no spec behind it is one refactor from becoming a
 * value, and NOTHING FAILS WHEN A PRIVACY BOUNDARY OPENS — the figure
 * simply starts being correct, on a screen, for the wrong audience. The
 * same is true of an `Omit` whose key list somebody tidies, and of a
 * field added to a response interface because the API needed it
 * somewhere else.
 *
 * ── WHY THE SELLER'S OWN TWIN IS ASSERTED TOO ────────────────────────
 * `SellerResellerAnalysisService` passes the REAL cost into the SAME
 * function. Pinning the contrast is what proves the store's `null` is a
 * deliberate withholding rather than a value nobody had to hand — and
 * it is the half that would otherwise be "fixed" by somebody who found
 * the null and thought it a bug.
 *
 * Source assertions, like `impersonation-deny-list.spec.ts`: the
 * question is what the code DECLARES, which is answerable from the
 * source and is the earliest point the mistake is visible. COMMENTS ARE
 * STRIPPED FIRST — a docblock explaining a rule reads exactly like the
 * rule to a regex, and a spec in this repo has already passed while
 * asserting on a comment.
 */

const SRC = join(__dirname, '../../src');

/** The file's code with every comment removed. */
function code(relative: string): string {
  return readFileSync(join(SRC, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The body of `export interface <name> { … }`, comments already gone. */
function interfaceBody(src: string, name: string): string {
  const at = src.indexOf(`export interface ${name}`);
  expect(at).toBeGreaterThanOrEqual(0);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated interface ${name}`);
}

/** Every member name an interface body declares. */
function members(body: string): string[] {
  return [...body.matchAll(/(?:^|[\s{;,])(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:/gm)].map(
    (m) => m[1] ?? '',
  );
}

const CATALOGUE = 'modules/reseller-catalogue/services/reseller-catalogue.service.ts';
const STORE_ANALYSIS = 'modules/reseller-reports/services/store-analysis.service.ts';
const SELLER_ANALYSIS = 'modules/reseller-reports/services/seller-reseller-analysis.service.ts';

describe('the seller’s cost never reaches a reseller store (RS-3)', () => {
  it('StoreCatalogueItem declares no cost field at all', () => {
    // The strongest of the three: the field is not merely nulled, it is
    // absent from the type, so a handler cannot put one there without
    // this failing to compile first and this test second.
    const declared = members(interfaceBody(code(CATALOGUE), 'StoreCatalogueItem'));
    expect(declared.filter((f) => /cost/i.test(f))).toEqual([]);
  });

  it('StoreCatalogueItem’s members are exactly these — a new one is a decision', () => {
    // Named in full rather than sampled. This is the ONE projection a
    // store sees of the seller's catalogue; a field added to it is a
    // field shown to every store user, and this test is where somebody
    // has to say so out loud.
    expect(members(interfaceBody(code(CATALOGUE), 'StoreCatalogueItem')).sort()).toEqual(
      [
        'availableQty',
        'description',
        'imageUrls',
        'maxRetailInr',
        'minRetailInr',
        'skuCode',
        'suggestedRetailInr',
        'title',
        'transferPriceInr',
        'variantId',
        'variantLabel',
      ].sort(),
    );
  });

  it('StoreAnalysisService feeds the scorecard a NULL unit cost', () => {
    // The store's own analysis runs the SAME pure scorecard the seller's
    // does. What makes it the store's view is this one argument.
    expect(code(STORE_ANALYSIS)).toMatch(/unitCostInr:\s*null/);
    // And nothing in that file reaches for a real one. `costOf(` is the
    // seller-side helper; its presence here would mean the null above
    // had a sibling that is not null.
    expect(code(STORE_ANALYSIS)).not.toMatch(/unitCostInr:\s*costOf\(/);
  });

  it('the SELLER’s own analysis feeds it the real cost — the contrast is the proof', () => {
    // Without this, the null above reads as "we had no cost to hand",
    // and the obvious tidy-up is to go and fetch one.
    expect(code(SELLER_ANALYSIS)).toMatch(/unitCostInr:\s*costOf\(/);
  });

  it('StoreOrderRates omits every cost-derived figure the Scorecard carries', () => {
    // The third holder, and the one most likely to be lost to a tidy-up:
    // an Omit key list looks like noise until you know what each key is.
    const src = code(STORE_ANALYSIS);
    const omit = /export type StoreOrderRates = Omit<\s*Scorecard,\s*([\s\S]*?)>;/.exec(src)?.[1];
    expect(omit).toBeDefined();
    const keys = [...(omit ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
    // marginInr and marginCoverage are (transfer − the SELLER's unit
    // cost); the other three are the store's own trade and are omitted
    // only because the store reads them elsewhere.
    expect(keys).toEqual(expect.arrayContaining(['marginInr', 'marginCoverage']));
  });

  it('fed what the store path feeds it, the scorecard reports NO margin coverage', () => {
    // The behavioural half: a source check says the argument is null, and
    // this says what that means. `marginInr` stays at zero with coverage
    // 0 of N — "no data", never a figure somebody could read as a margin.
    const card = scorecard([
      {
        status: OrderStatus.DELIVERED,
        everConfirmed: true,
        lines: [
          { quantity: 3, transferInr: dec('400'), retailInr: dec('650'), unitCostInr: null },
          { quantity: 1, transferInr: dec('120'), retailInr: dec('199'), unitCostInr: null },
        ],
      },
    ]);
    expect(card.marginCoverage).toEqual({ linesWithCost: 0, lines: 2 });
    expect(card.marginInr).toBe('0.00');
  });
});

/** A Decimal, so the lines above read as money rather than as plumbing. */
function dec(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}
