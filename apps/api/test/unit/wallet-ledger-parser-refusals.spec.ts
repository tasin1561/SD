import * as xlsx from '../../src/common/xlsx/xlsx-reader';
import {
  LedgerFormatError,
  parseWalletLedger,
} from '../../src/modules/wallet-ledger/services/wallet-ledger-parser';

/**
 * A successful transaction we cannot read is REFUSED, never skipped.
 *
 * It used to be counted as "skipped" and the import carried on, so a real
 * charge or credit with a blank id or an unreadable date went missing and
 * the only trace was a number nobody reads. A failed or pending row is
 * different: it is about something that did not happen, and skipping it
 * loses nothing.
 */
jest.mock('../../src/common/xlsx/xlsx-reader', () => ({
  ...jest.requireActual('../../src/common/xlsx/xlsx-reader'),
  readSheet: jest.fn(),
}));

const HEADER = [
  'Date & Time',
  'Miles',
  'AWB',
  'Txn ID',
  'Type',
  'Description',
  'Status',
  'Client',
  'Mode',
  'Zone',
  'Chargeable weight',
  'Shipment status',
  'Closure date',
];

const row = (o: {
  at?: string;
  amt?: string;
  id?: string;
  type?: string;
  status?: string;
}): string[] => [
  o.at ?? '2026-08-20 10:00:00',
  o.amt ?? '40.00',
  'DL1',
  o.id ?? 'MTX1',
  o.type ?? 'debit',
  '{}',
  o.status ?? 'success',
  'acct',
  'S',
  'B',
  '320.0',
  'Delivered',
  '',
];

function sheets(deductions: string[][], refunds: string[][] = []): void {
  (xlsx.readSheet as jest.Mock).mockImplementation((_file: Buffer, name: string) => {
    if (name === 'Deductions') return [HEADER, ...deductions];
    if (name === 'Refunds') return [HEADER, ...refunds];
    return [
      ['Total deductions', '40.00'],
      ['Total refunds', '12.00'],
    ];
  });
}

const FILE = Buffer.from('the reader is mocked');

describe('a successful row we cannot read stops the import', () => {
  it.each([
    ['no transaction id', { id: '' }, /Row 3 of the Deductions sheet .*no transaction id/],
    ['no readable amount', { amt: 'n/a' }, /no readable amount/],
    ['no readable date', { at: 'yesterday' }, /no readable date/],
    ['no debit/credit type', { type: '' }, /neither a debit nor a credit/],
    ['a credit filed under deductions', { type: 'credit' }, /credit filed under Deductions/],
  ])('%s', (_label, bad, message) => {
    // Spreadsheet row 3: the header is row 1, the good row is row 2.
    sheets([row({}), row({ id: 'MTX2', ...bad })]);
    expect(() => parseWalletLedger(FILE)).toThrow(LedgerFormatError);
    expect(() => parseWalletLedger(FILE)).toThrow(message);
  });

  it('a FAILED row is skipped, not refused — nothing happened', () => {
    sheets([row({}), row({ id: '', status: 'failed' })]);
    const out = parseWalletLedger(FILE);
    expect(out.txns).toHaveLength(1);
    expect(out.rowsSkipped).toBe(1);
  });

  it('reports the refunds total beside the Summary figure it is checked against', () => {
    sheets([row({})], [row({ id: 'MTX9', type: 'credit', amt: '12.00' })]);
    const out = parseWalletLedger(FILE);
    expect(out.refundsInr).toBe('12.00');
    expect(out.statedRefundsInr).toBe('12.00');
  });
});
