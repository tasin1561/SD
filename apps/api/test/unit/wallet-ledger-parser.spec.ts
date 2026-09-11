import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LedgerFormatError,
  parseWalletLedger,
} from '../../src/modules/wallet-ledger/services/wallet-ledger-parser';
import { readSheet, sheetNames, XlsxError } from '../../src/common/xlsx/xlsx-reader';

const FIXTURE = readFileSync(join(__dirname, '..', 'fixtures', 'delhivery-wallet-sample.xlsx'));
const parsed = (): ReturnType<typeof parseWalletLedger> => parseWalletLedger(FIXTURE);
const byId = (id: string) => parsed().txns.find((t) => t.txnId === id);

/** `Σ debits − Σ credits` for one parcel leg, which is what the import
 *  now writes as the cost. */
function net(awb: string, leg: 'FORWARD' | 'RTO' = 'FORWARD'): number {
  return parsed()
    .txns.filter((t) => t.awbNumber === awb && t.leg === leg && t.category === 'PARCEL')
    .reduce((a, t) => a + (t.kind === 'DEBIT' ? 1 : -1) * Number(t.amountInr), 0);
}

describe('the xlsx reader', () => {
  it('reads sheet names and cells placed by REFERENCE, not by order', () => {
    // A blank cell is simply absent from the XML. Counting elements
    // instead of reading `r="C4"` shifts every value after a gap into the
    // wrong column — which for this file means reading an amount out of
    // a date.
    expect(sheetNames(FIXTURE)).toEqual(['Summary', 'Deductions', 'Refunds']);
    const rows = readSheet(FIXTURE, 'Deductions');
    expect(rows[0]?.[1]).toBe('Miles');
    expect(rows[0]?.[2]).toBe('AWB');
  });

  it('refuses a file it does not understand rather than guessing', () => {
    expect(() => readSheet(Buffer.from('not a zip at all'), 'Summary')).toThrow(XlsxError);
  });

  it('names the sheets it DOES have when asked for one it does not', () => {
    expect(() => readSheet(FIXTURE, 'Nope')).toThrow(/Deductions/);
  });
});

/**
 * A parcel's cost is the NET of its transactions.
 *
 * The parser used to return the latest debit per AWB. On 90 days of real
 * data that was wrong for 705 of 11,389 parcels — always overstating, by
 * ₹67,614 against a true total of ₹775,577 — because Delhivery charges,
 * reverses and re-charges the same waybill.
 */
describe('parseWalletLedger — every transaction, both directions', () => {
  it('keeps BOTH halves of a re-cut charge, and the credit between them', () => {
    // ₹100 charged, ₹100 refunded, ₹85.65 charged again. Latest-debit
    // happened to be right here, which is exactly why the bug hid.
    expect(net('AWB-REVISED')).toBeCloseTo(85.65, 2);
    expect(parsed().txns.filter((t) => t.awbNumber === 'AWB-REVISED')).toHaveLength(3);
  });

  it('a fully reversed charge nets to ZERO, not to the debit', () => {
    // The case latest-debit got wrong: charged ₹60.04 and refunded in
    // full. The parcel cost nothing and used to be booked at full
    // freight.
    expect(net('AWB-ZERO')).toBeCloseTo(0, 2);
  });

  it('keeps the forward and RTO legs APART', () => {
    // An RTO is charged in ADDITION to the delivery, not instead of it.
    // One column for both would charge the same carriage twice (TRE-6).
    expect(net('AWB-BOTH', 'FORWARD')).toBeCloseTo(57.46, 2);
    expect(net('AWB-BOTH', 'RTO')).toBeCloseTo(56.28, 2);
  });

  it('ignores rows that are not money', () => {
    // Only a successful row is money that moved. AWB-PLAIN carries a
    // failed ₹99.99 that must not be read.
    expect(net('AWB-PLAIN')).toBeCloseTo(40, 2);
    expect(parsed().rowsSkipped).toBe(1);
  });

  describe('adjustments are not a parcel’s cost', () => {
    it('recognises one even when it CARRIES a waybill', () => {
      // 36 of the 37 on the 90-day sample did. "Has an AWB" is not the
      // test; their own `stage`/`code` marker is.
      expect(byId('TX8')?.category).toBe('ADJUSTMENT');
      expect(byId('TX8')?.awbNumber).toBe('AWB-PLAIN');
      // …and it stays out of that parcel's cost.
      expect(net('AWB-PLAIN')).toBeCloseTo(40, 2);
    });

    it('reads a ledger-level credit that names no parcel at all', () => {
      // The ₹1,290 lost-shipment credit note. It is absent from their
      // `AWB Refunds` sheet, which is why the wider `Refunds` sheet is
      // the one read.
      expect(byId('TX11')).toMatchObject({ category: 'ADJUSTMENT', awbNumber: null });
    });
  });

  it('reads the timestamps as IST, which is what the panel means', () => {
    // No zone is written in the file. Reading it as UTC would date every
    // charge five and a half hours early, and some on the wrong day.
    expect(byId('TX6')?.occurredAt.toISOString()).toBe('2026-08-20T04:30:00.000Z');
  });

  it('carries the file’s own totals, so the import can check the arithmetic', () => {
    // opening + recharges + refunds − deductions = the closing balance.
    // Every row is on one side of that, so a truncated file breaks it.
    const out = parsed();
    expect(out.sumInr).toBe('458.26');
    expect(out.statedTotalInr).toBe('458.26');
    expect(out.summary.openingBalanceInr).toBe('1000.00');
    expect(out.summary.totalRechargesInr).toBe('5000.00');
  });

  it('REFUSES a file that carries the same transaction twice', () => {
    // Their id is the identity the whole import rests on. A file with
    // ₹40 and ₹99 under one id cannot describe itself, and silently
    // keeping either would set a parcel's cost by whichever won the
    // iteration order.
    const contradictory = readFileSync(
      join(__dirname, '..', 'fixtures', 'delhivery-wallet-duplicate-txn.xlsx'),
    );
    expect(() => parseWalletLedger(contradictory)).toThrow(/more than once/);
  });

  it('refuses a workbook that is not a wallet export', () => {
    expect(() => parseWalletLedger(Buffer.from('nonsense'))).toThrow(LedgerFormatError);
  });
});
