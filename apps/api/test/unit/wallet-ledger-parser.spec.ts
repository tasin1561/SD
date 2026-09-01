import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LedgerFormatError,
  parseWalletLedger,
} from '../../src/modules/courier-wallet-import/services/wallet-ledger-parser';
import { readSheet, sheetNames, XlsxError } from '../../src/common/xlsx/xlsx-reader';

const FIXTURE = readFileSync(join(__dirname, '..', 'fixtures', 'delhivery-wallet-sample.xlsx'));

describe('the xlsx reader', () => {
  it('reads sheet names and cells placed by REFERENCE, not by order', () => {
    // A blank cell is simply absent from the XML. Counting elements
    // instead of reading `r="C4"` shifts every value after a gap into the
    // wrong column — which for this file means reading an amount out of
    // a date.
    expect(sheetNames(FIXTURE)).toEqual(['Summary', 'AWB Deductions']);
    const rows = readSheet(FIXTURE, 'AWB Deductions');
    expect(rows[0]?.[1]).toBe('Miles');
    expect(rows[0]?.[2]).toBe('AWB');
  });

  it('refuses a file it does not understand rather than guessing', () => {
    expect(() => readSheet(Buffer.from('not a zip at all'), 'Summary')).toThrow(XlsxError);
  });

  it('names the sheets it DOES have when asked for one it does not', () => {
    expect(() => readSheet(FIXTURE, 'Nope')).toThrow(/AWB Deductions/);
  });
});

describe('parseWalletLedger — the latest debit is the cost', () => {
  it('keeps the most recent debit when a charge was re-cut', () => {
    // Generating the AWB debits immediately; a weight recheck refunds
    // that and charges again, weeks later. The last one is what the
    // parcel cost.
    const out = parseWalletLedger(FIXTURE);
    expect(out.forward.get('AWB-REVISED')?.amountInr).toBe('85.65');
    expect(out.forward.get('AWB-REVISED')?.txnId).toBe('TX2');
  });

  it('keeps the forward and RTO legs APART', () => {
    // An RTO is charged in ADDITION to the delivery, not instead of it —
    // six AWBs in the real export carry both. One column for both would
    // charge the same carriage twice.
    const out = parseWalletLedger(FIXTURE);
    expect(out.forward.get('AWB-BOTH')?.amountInr).toBe('57.46');
    expect(out.rto.get('AWB-BOTH')?.amountInr).toBe('56.28');
  });

  it('ignores failed rows and credits', () => {
    // Only a successful debit is money that left. AWB-PLAIN has a failed
    // row at 99.99 and a stray credit at 12.34 that must not be read.
    const out = parseWalletLedger(FIXTURE);
    expect(out.forward.get('AWB-PLAIN')?.amountInr).toBe('40.00');
    expect(out.rowsSkipped).toBe(2);
  });

  it('reads the timestamps as IST, which is what the panel means', () => {
    // No zone is written in the file. Reading it as UTC would date every
    // charge five and a half hours early, and some on the wrong day.
    const out = parseWalletLedger(FIXTURE);
    const at = out.forward.get('AWB-PLAIN')?.chargedAt;
    expect(at?.toISOString()).toBe('2026-08-20T04:30:00.000Z');
  });

  it('sums what it read and reports the total the file states', () => {
    const out = parseWalletLedger(FIXTURE);
    expect(out.sumInr).toBe('337.33');
    expect(out.statedTotalInr).toBe('337.33');
  });

  it('refuses a workbook that is not a wallet export', () => {
    expect(() => parseWalletLedger(Buffer.from('nonsense'))).toThrow(LedgerFormatError);
  });
});
