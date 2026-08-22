/**
 * The wallet is kept in ONE currency, and taka is a view of it.
 *
 * Two paths used to write a second, invisible balance:
 *
 *  - a cross-currency remittance debited INR and CREDITED the
 *    destination wallet the converted amount, described as conserving
 *    the ledger. The money did not move between two pots we keep — it
 *    left the business into the seller's bank — so every seller read
 *    "you are owed ৳12,300" immediately after being paid ৳12,300, and
 *    nothing ever debited it back.
 *  - a taka top-up credited a BDT wallet, which nothing displays: the
 *    seller would wire real money, see it accepted, and watch their
 *    balance not move.
 *
 * These are STRUCTURAL assertions, read off the sources. A behavioural
 * test needs a currency pair to be exercised, and the shape being
 * guarded is "no code path writes a non-INR entry" — which is a claim
 * about every path, including ones nobody thought to test.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '../../src/modules');

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8');
}

describe('the wallet is INR-canonical', () => {
  it('a remittance writes NO paired credit on the destination currency', () => {
    const src = read('admin-remittance/services/remittance.service.ts');
    expect(src).not.toContain('WalletEntryDirection.REMITTANCE_FX');
    // The remittance row still records what was actually wired — the
    // payment is not lost, it just is not a wallet balance.
    expect(src).toContain('fxRateSnapshot');
  });

  it('a top-up credits INR whatever currency was wired', () => {
    const src = read('wallet-topup/services/wallet-topup.service.ts');
    expect(src).toContain('currency: Currency.INR');
    expect(src).not.toContain('currency: existing.currency,\n        direction');
  });

  it('the seller wallet DERIVES its taka figure instead of reading a taka ledger', () => {
    const src = read('seller-wallet-read/seller-wallet.controller.ts');
    expect(src).not.toContain('balanceCached(seller.id, Currency.BDT)');
    expect(src).toContain('isConverted: true');
  });

  it('the admin balance endpoint does the same', () => {
    const src = read('admin-remittance/admin-remittance.controller.ts');
    expect(src).not.toContain('balanceCached(sellerId, Currency.BDT)');
    expect(src).toContain('isConverted: true');
  });

  it('a missing FX rate yields NO taka figure rather than zero', () => {
    // Zero is a number a seller would act on. "We cannot convert right
    // now" is the truth, and an absent card says it.
    for (const rel of [
      'seller-wallet-read/seller-wallet.controller.ts',
      'admin-remittance/admin-remittance.controller.ts',
    ]) {
      const src = read(rel);
      expect(src).toContain('bdt = null');
      expect(src).toContain('bdt === null');
    }
  });
});

describe('a claim is not a ledger entry', () => {
  // The seller's wallet page shows pending and rejected requests in
  // their own sections, and the ledger only ever shows money that
  // actually moved. That is not a UI filter — it holds because no entry
  // is written until the money is real, and these assertions are what
  // keep it that way.
  it('a top-up writes its entry ONLY on accept, never on submit', () => {
    const src = read('wallet-topup/services/wallet-topup.service.ts');
    const writes = src.split('applyEntry').length - 1;
    expect(writes).toBe(1);

    // ...and that one call sits after accept(), not in submit() or
    // reject(). Crediting on submission would let anyone raise their
    // balance with a form, and the reversal would land after they had
    // withdrawn against it (WAL-2).
    const accept = src.indexOf('async accept(');
    const reject = src.indexOf('async reject(');
    const write = src.indexOf('applyEntry');
    expect(accept).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(accept);
    expect(write).toBeLessThan(reject);
  });

  it('a withdrawal REQUEST writes no entry at all', () => {
    // The balance moves when the remittance is actually paid. A request
    // is a request; treating it as a debit would take money from a
    // seller for a transfer nobody had made yet.
    const src = read('seller-wallet-withdrawal/services/withdrawal-request.service.ts');
    expect(src).not.toMatch(/this\.wallet\.applyEntry\(/);
  });
});
