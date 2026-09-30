import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The unreachable-customers register names an order the way a PERSON
 * can.
 *
 * It showed the first eight characters of the order's uuid, which cannot
 * be read down a phone, matched against the order list, or searched for
 * — the seller's order search takes an order number, a reference, an
 * AWB, a recipient name or a phone, and not a uuid prefix. Worse,
 * `/needs-attention` lists the SAME orders by their number, so the two
 * screens about one thing disagreed about how to name it.
 *
 * Pinned by reading the source: the failure is a FALLBACK reappearing as
 * the primary, and a render test asserting "some identifier is shown"
 * would pass either way.
 *
 * Comments are stripped first — this file's own docblock, and the
 * component's, both name the slice.
 */
const REGISTER = join(
  __dirname,
  '..',
  'app',
  '(authed)',
  'holds',
  '_components',
  'hold-reviews-index.tsx',
);

function withoutComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('the unreachable-customers register', () => {
  const src = withoutComments(readFileSync(REGISTER, 'utf8'));

  it('leads with the order NUMBER', () => {
    expect(src).toContain('r.orderNumber');
  });

  it('uses the uuid only as a fallback, never on its own', () => {
    const slices = src.match(/orderId\.slice\(0, 8\)/g) ?? [];
    expect(slices).toHaveLength(1);
    // …and that one occurrence is the right-hand side of a ??.
    expect(src).toMatch(/r\.orderNumber \?\? `\$\{r\.orderId\.slice\(0, 8\)\}…`/);
  });

  it('hands the number to the decision dialog too', () => {
    expect(src).toMatch(/orderNumber: selected\.orderNumber/);
  });
});
