import { Currency, InboundFreightMode, Prisma } from '@skydrop/db';

import { money, rupees } from '../../src/common/money/format-money';
import { freightRecordedDescription } from '../../src/modules/inbound-freight/services/inbound-freight.service';

const dec = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

/**
 * The freight line on a seller's consignment timeline said the money
 * wrong, in two different ways at once.
 *
 *   Freight billed — ₹5688.89 (7680.00 BDT as agreed) …
 *
 * The rupee figure was ungrouped — reportedly the only ungrouped rupee
 * figure a seller is shown anywhere, since every other one renders
 * through `Money` in `@skydrop/ui` (FE-6) — and the taka figure carried
 * a trailing ISO code where the seller's own currency has a symbol.
 *
 * A stored sentence cannot call a React component, which is exactly how
 * it escaped the rule, so `common/money/format-money.ts` is the server
 * side of the same rule: ONE formatter, grouped en-IN (which is correct
 * for taka too — Bangladesh groups in lakhs), symbol in front, U+2212
 * for a negative.
 *
 * ── WHAT THIS DOES NOT FIX ───────────────────────────────────────────
 * `consignment_events` is append-only (CNS-6). Every freight line
 * already written keeps its ungrouped figure for ever; this reaches
 * bills recorded from here on.
 */
describe('the freight timeline line states money the way a seller reads it', () => {
  it('groups the rupee total', () => {
    const d = freightRecordedDescription({
      totalInr: dec('5688.89'),
      agreedAmount: dec('5688.89'),
      agreedCurrency: Currency.INR,
      mode: InboundFreightMode.PAY_LATER,
      lineCount: 3,
      units: 42,
    });
    expect(d).toContain('₹5,688.89');
    expect(d).not.toContain('₹5688.89');
  });

  it('states an agreed taka figure with its own symbol, grouped, and no ISO code', () => {
    const d = freightRecordedDescription({
      totalInr: dec('5688.89'),
      agreedAmount: dec('7680.00'),
      agreedCurrency: Currency.BDT,
      mode: InboundFreightMode.PAY_LATER,
      lineCount: 3,
      units: 42,
    });
    expect(d).toContain('(৳7,680.00 as agreed)');
    expect(d).not.toContain('BDT');
    expect(d).not.toContain('7680.00');
  });

  it('says nothing about the agreed amount when the bill was agreed in rupees', () => {
    // Unchanged behaviour, pinned so the formatter change cannot
    // accidentally start printing "(₹5,688.89 as agreed)" beside an
    // identical figure.
    const d = freightRecordedDescription({
      totalInr: dec('5688.89'),
      agreedAmount: dec('5688.89'),
      agreedCurrency: Currency.INR,
      mode: InboundFreightMode.PAY_NOW,
      lineCount: 1,
      units: 1,
    });
    expect(d).not.toContain('as agreed');
  });

  it('groups a lakh the Indian way, in both currencies', () => {
    // ₹12,34,567.00 — not ₹1,234,567.00. Bangladesh groups the same way,
    // so one formatter is correct for both and there is no per-currency
    // locale table to drift.
    expect(money(dec('1234567'), Currency.INR)).toBe('₹12,34,567.00');
    expect(money(dec('1234567'), Currency.BDT)).toBe('৳12,34,567.00');
  });

  it('writes a negative with U+2212, not a hyphen', () => {
    expect(rupees(dec('-388.60'))).toBe('−₹388.60');
  });

  it('is the same function the wallet notes use', async () => {
    // Two copies of this arithmetic is how the figure on a seller's
    // wallet and the figure on their timeline come to disagree about a
    // separator, with the seller unable to tell both came from us.
    const wallet =
      await import('../../src/modules/admin-wallet-transfer/services/staff-wallet-transfer.service');
    expect(wallet.rupees).toBe(rupees);
  });
});
