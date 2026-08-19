import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every surface that shows an order's lines must show ALL of them.
 *
 * The edit page rendered `items[0]` alone — written when an order was
 * single-line — so a two-product order looked like a one-product order
 * on the very page you go to in order to check it. Nothing caught it:
 * a behavioural test written against a one-line fixture passes on both
 * the broken and the fixed version, which is exactly why this one reads
 * the source instead.
 *
 * Structural, deliberately: the failure mode is "a line is missing from
 * the screen", and the thing that distinguishes correct from broken is
 * whether the code iterates or indexes.
 */
const FILES = [
  'src/app/(authed)/orders/[id]/edit/_components/edit-order-form.tsx',
  'src/app/(authed)/orders/_components/order-detail.tsx',
];

describe('order line rendering', () => {
  for (const rel of FILES) {
    it(`${rel} iterates the items rather than indexing one`, () => {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      const body = src
        .split('\n')
        .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
        .join('\n');
      expect(body).toMatch(/items\.map\(/);
      expect(body).not.toMatch(/items\[0\]/);
    });
  }
});
