import * as xlsx from '../../src/common/xlsx/xlsx-reader';
import { parseWalletLedger } from '../../src/modules/wallet-ledger/services/wallet-ledger-parser';

/**
 * Which rows are the price of moving a parcel, and which are the account's.
 *
 * Carriage is always written against a waybill: on the production ledger
 * (2026-09-12) every one of 23,435 carriage rows carries `wbn` in its
 * description. The 18 that did not were lost-shipment claim payouts and
 * one lump debit per "Communication VAS" invoice — filed as carriage
 * because their shipment status was blank, and blank is in the parcel
 * vocabulary. A claim payout netted into a parcel made its courier cost
 * negative.
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
  'Shipment status',
];

const row = (o: {
  id: string;
  awb: string;
  type: 'debit' | 'credit';
  amt: string;
  desc: string;
  shipmentStatus?: string;
}): string[] => [
  '2026-09-01 10:00:00',
  o.amt,
  o.awb,
  o.id,
  o.type,
  o.desc,
  'success',
  o.shipmentStatus ?? '',
];

function sheets(deductions: string[][], refunds: string[][]): void {
  (xlsx.readSheet as jest.Mock).mockImplementation((_file: Buffer, name: string) => {
    if (name === 'Deductions') return [HEADER, ...deductions];
    if (name === 'Refunds') return [HEADER, ...refunds];
    return [];
  });
}

const CARRIAGE = row({
  id: 'MTX-CARRIAGE',
  awb: '38061110509316',
  type: 'debit',
  amt: '58.83',
  desc: '{"wbn": "38061110509316", "zn": "B", "cgm": 160.0, "st": "Delivered"}',
  shipmentStatus: 'Delivered',
});
const CLAIM = row({
  id: 'MTX-CLAIM',
  awb: '38061110487620',
  type: 'credit',
  amt: '1499.00',
  desc: '{"notes":"Claim settled - CMS"}',
});
const VAS_LUMP = row({
  id: 'MTX-VAS',
  awb: '',
  type: 'debit',
  amt: '6934.27',
  desc: '{"user":"BIRD-Tech","description":{"remarks":"VAS: NDR Whatsapp Verification","service_type":"VAS Services:NDR"},"serial_number":"EPVASH26140201"}',
});

describe('classifying a Delhivery wallet row', () => {
  beforeEach(() => sheets([CARRIAGE, VAS_LUMP], [CLAIM]));
  const byId = (id: string) => parseWalletLedger(Buffer.from('x')).txns.find((t) => t.txnId === id);

  it('a row written against a waybill (`wbn`) is the parcel’s carriage', () => {
    expect(byId('MTX-CARRIAGE')).toMatchObject({
      category: 'PARCEL',
      awbNumber: '38061110509316',
    });
  });

  it('a lost-shipment claim payout names no waybill and is the ACCOUNT’s, even with an AWB beside it', () => {
    // ₹1,499 is the value of the lost goods, not a refund of carriage.
    expect(byId('MTX-CLAIM')).toMatchObject({
      category: 'ADJUSTMENT',
      kind: 'CREDIT',
      awbNumber: '38061110487620',
    });
  });

  it('a Communication VAS lump debit is the account’s, not a parcel’s', () => {
    expect(byId('MTX-VAS')).toMatchObject({ category: 'ADJUSTMENT', kind: 'DEBIT' });
    expect(byId('MTX-VAS')?.detail).toMatchObject({ serial_number: 'EPVASH26140201' });
  });

  it('a description that is not JSON names no waybill either', () => {
    sheets(
      [
        row({
          id: 'MTX-PLAIN',
          awb: 'AWB1',
          type: 'debit',
          amt: '10.00',
          desc: 'free text',
          shipmentStatus: 'Delivered',
        }),
      ],
      [],
    );
    expect(byId('MTX-PLAIN')?.category).toBe('ADJUSTMENT');
  });

  it('their stage/code marker still wins even when a waybill is named', () => {
    sheets(
      [
        row({
          id: 'MTX-RECON',
          awb: '38061110523994',
          type: 'debit',
          amt: '72.28',
          desc: '{"wbn": "38061110523994", "code": "Freight adjustment debit", "stage": "Settlement based on reconciliation"}',
        }),
      ],
      [],
    );
    expect(byId('MTX-RECON')?.category).toBe('ADJUSTMENT');
  });
});
