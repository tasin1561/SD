import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(__dirname, '../../src/modules/invoice/services/invoice.service.ts'),
  'utf8',
);

/**
 * A stored object URL must never reach a browser.
 *
 * Nothing in the bucket has been public since the 2026-07-28 security
 * pass: `pdfUrl` is a canonical pointer that DELIBERATELY does not
 * resolve, and handing it to a client produces an AccessDenied XML page
 * where the invoice should be. That is exactly what the seller order
 * page did — `generateForOrder` presigned and `getForSellerOrder`,
 * twenty lines below it, returned the stored pointer.
 *
 * Structural rather than behavioural because the failure is invisible
 * to a unit test with a mocked Spaces client: both versions return a
 * string, and only a real bucket tells them apart.
 */
describe('invoice reads presign, never return the stored URL', () => {
  it('every read path signs the storage key', () => {
    // Both the generate path and the seller read.
    const signs = SRC.match(/presignGetUrl\(/g) ?? [];
    expect(signs.length).toBeGreaterThanOrEqual(3);
  });

  it('no read hands back `pdfUrl` straight off the row', () => {
    // The exact shape of the bug: `pdfUrl: row.pdfUrl`.
    expect(SRC).not.toMatch(/pdfUrl:\s*row\.pdfUrl/);
    expect(SRC).not.toMatch(/pdfUrl:\s*existing\.pdfUrl/);
  });

  it('the seller read selects the storage KEY, which is what can be signed', () => {
    const read = SRC.slice(SRC.indexOf('async getForSellerOrder'));
    expect(read).toContain('pdfStorageKey: true');
  });
});
