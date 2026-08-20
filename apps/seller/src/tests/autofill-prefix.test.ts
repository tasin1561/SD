import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripSellerPrefix } from '../lib/seller-prefix';

/**
 * Filling the recipient name from a past order.
 *
 * The STORED name carries the seller code ("MSt Tasin") because that is
 * what goes on a courier label. The form's name input sits BEHIND a
 * fixed prefix box, so filling it raw renders "MSt MSt Tasin".
 *
 * Display-only — the server's compose is idempotent, so the double
 * prefix could never reach the database. It could certainly reach a
 * seller's eyes and make them edit a name that was not wrong.
 */
describe('autofill strips the seller prefix', () => {
  it('takes the code off a stored name', () => {
    expect(stripSellerPrefix('MSt', 'MSt Tasin')).toBe('Tasin');
  });

  it('leaves a name that merely starts with the same letters', () => {
    // The separator is why: a customer actually called "Mstislav" keeps
    // their name.
    expect(stripSellerPrefix('MSt', 'Mstislav Rostropovich')).toBe('Mstislav Rostropovich');
  });

  it('is a no-op for a seller with no code', () => {
    expect(stripSellerPrefix(null, 'Tasin')).toBe('Tasin');
  });

  it('the new-order form actually calls it when filling', () => {
    // The bug was not in the helper — it was that the fill did not use
    // it, while the edit form always had.
    const src = readFileSync(
      join(process.cwd(), 'src/app/(authed)/orders/new/_components/new-order-form.tsx'),
      'utf8',
    );
    expect(src).toMatch(/recipientName: stripSellerPrefix\(sellerInitials, r\.name\)/);
  });
});
