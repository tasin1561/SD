import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ASSOC-1's privacy boundary, on the frontend side.
 *
 * The constraint: "the associate shouldn't be able to see how much the
 * reseller is getting paid and what's the cost?" The API withholds both —
 * `catalogue.sell` is the catalogue with the store's cost removed, and
 * an `associate-response-boundary.spec.ts` sweeps the response shapes.
 * This is the OTHER half: that nothing in this app reaches for them.
 *
 * It matters because this portal talks to endpoints a store OWNER also
 * uses. `GET /store/orders/:id` answers an owner with `transferPriceInr`
 * on every line and a transfer total; `GET /store/orders/:id/money` is
 * what the order earns the store. Whether those reach this app is
 * decided by what its code asks for, and a field added to a type "while
 * we are in here" is exactly how a boundary stops holding.
 *
 * A scan rather than a render test on purpose: a render test proves one
 * screen, and the thing worth proving is that NO screen does it.
 */

const SRC = path.resolve(__dirname, '..');

/**
 * Names that are the store's cost or the store's earnings. Each is the
 * exact spelling the store-facing API uses, so a copy-paste from
 * apps/reseller trips it.
 */
const FORBIDDEN: ReadonlyArray<readonly [pattern: RegExp, why: string]> = [
  [/transferPriceInr/, 'what the STORE pays its seller for the product'],
  [/transferInr/, 'the transfer total — the store’s cost for the whole order'],
  [/transferTotalInr/, 'the transfer total'],
  [/\/money\b/, 'GET /store/orders/:id/money — what the order earns the store'],
  [/suggestedRetailInr/, 'the seller’s suggested retail, which brackets the store’s margin'],
  [/minRetailInr|maxRetailInr/, 'the seller’s retail range, which brackets the store’s margin'],
  [/feeSplit|FeeSplit/, 'the RS-4 fee split — who pays what between store and seller'],
  [/\/store\/terms/, 'the seller’s terms, from which the store’s margin is derivable'],
  [/\/store\/wallet/, 'the store’s money'],
  [/\/store\/reports/, 'the store’s reports'],
  [/\/store\/expenses/, 'the store’s own book'],
  [/\/store\/catalogue(?!\/sell)/, 'the catalogue projection that carries the store’s cost'],
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'tests' || entry === 'node_modules') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Comments read exactly like code to a regex, and this file's own
 * reasoning names every forbidden thing out loud. Strip them, or a
 * paragraph explaining why something is withheld reads as the thing
 * being used — the lesson from the spec that asserted on a docblock and
 * passed while testing nothing.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('ASSOC-1 — the store’s cost and earnings are not in this app', () => {
  const files = walk(SRC);

  it('finds the app’s own sources', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const [pattern, why] of FORBIDDEN) {
    it(`never mentions ${pattern.source} (${why})`, () => {
      const hits = files.filter((f) => pattern.test(stripComments(readFileSync(f, 'utf8'))));
      expect(
        hits.map((f) => path.relative(SRC, f)),
        `An associate must not learn ${why}. If an endpoint has genuinely started answering this and it is safe, say why here — do not render it.`,
      ).toEqual([]);
    });
  }
});
