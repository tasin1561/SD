import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { journeyOwnerLabel, type MilestoneOwner } from '@skydrop/ui/status';

const ROOT = join(process.cwd(), '../..');

/**
 * WHOSE act a journey line was, in ONE place.
 *
 * The owner word had FOUR implementations of
 * `owner === 'SKYDROP' ? 'Skydrop' : 'Courier'` — two in the shared
 * journey component, one here, one in apps/seller. That is what let the
 * field stay two-valued for so long, and it is what would have made
 * widening it a four-file change where three of the files quietly
 * carried on calling a seller's own cancellation "Courier".
 *
 * FE-6's rule is that a status vocabulary gets ONE exhaustive mapper in
 * `@skydrop/ui/status`, never a per-component map. This pins both
 * halves: the words, and the absence of a fifth copy.
 */
describe('journeyOwnerLabel', () => {
  it('gives every owner a word a person reads', () => {
    const words: Record<MilestoneOwner, string> = {
      SKYDROP: 'Skydrop',
      SELLER: 'Seller',
      STORE: 'Store',
      COURIER: 'Courier',
    };
    for (const [owner, word] of Object.entries(words)) {
      expect(journeyOwnerLabel(owner as MilestoneOwner)).toBe(word);
    }
  });

  it('says "Seller", not "You" — the same word in both apps', () => {
    // A seller's order page is read by several people at one company,
    // and on a reseller order it is read by the seller ABOUT a store's
    // act, so "You" would be wrong for a colleague's line and confusing
    // beside "Store". One word set is also one thing to keep true.
    expect(journeyOwnerLabel('SELLER')).toBe('Seller');
  });

  it('is the only place the owner becomes a word', () => {
    const files = [
      ...globSync('apps/admin/src/**/*.{ts,tsx}', { cwd: ROOT }),
      ...globSync('apps/seller/src/**/*.{ts,tsx}', { cwd: ROOT }),
      ...globSync('packages/ui/src/**/*.{ts,tsx}', { cwd: ROOT }),
    ].filter((f) => !f.includes('/tests/') && !f.includes('/status/'));

    expect(files.length).toBeGreaterThan(200);

    // A private ternary over the owner value. Each of the four that
    // existed turned any new value into "Courier" — the one thing it
    // may never say about our own act or the seller's.
    const privateMap = /\b[a-z]\.owner\s*===\s*'(SKYDROP|SELLER|STORE|COURIER)'/;
    const offenders = files.filter((f) => privateMap.test(readFileSync(join(ROOT, f), 'utf8')));

    expect(offenders).toEqual([]);
  });
});
