import { unrefundedCharge } from '../../src/common/money/order-charge-pairing';

/**
 * The pairing that decides what a cancelled order owes back.
 *
 * Extracted from `OrderChargesRefundService` (2026-09-30) so the screen
 * that TELLS a seller the figure and the service that CREDITS it ask
 * the same question. Its rules are the interesting part, and each one
 * was a real decision:
 *
 *   · charges and refunds PAIR UP, because an order can be billed,
 *     refunded and billed again (lost, refunded, then found and
 *     delivered) — so "refunded once" is not "nothing owed";
 *   · the NEWEST unpaired charge is the one a refund now returns;
 *   · never charged is null, which is the ordinary case for a seller on
 *     the default AT_DELIVERY timing.
 */
describe('unrefundedCharge', () => {
  const c = (id: string, amount: string): { id: string; amount: string } => ({ id, amount });

  it('is null when the order was never charged', () => {
    expect(unrefundedCharge([], [])).toBeNull();
  });

  it('returns the charge when nothing has been given back', () => {
    expect(unrefundedCharge([c('e2', '200')], [])).toEqual(c('e2', '200'));
  });

  it('is null once every charge has its refund', () => {
    expect(unrefundedCharge([c('e2', '200')], [{ linkedEntryId: 'e2' }])).toBeNull();
  });

  it('owes again after a re-bill — charges outnumber refunds', () => {
    // Newest first, as the ledger's uuidv7 ids sort. e4 is the re-bill.
    expect(unrefundedCharge([c('e4', '200'), c('e2', '200')], [{ linkedEntryId: 'e2' }])).toEqual(
      c('e4', '200'),
    );
  });

  it('is null when a refund points at nothing and the counts still balance', () => {
    // An unlinked refund cannot be matched to a charge, but it is still
    // a refund: counting it is what stops a second credit going out.
    expect(unrefundedCharge([c('e2', '200')], [{ linkedEntryId: null }])).toBeNull();
  });
});
