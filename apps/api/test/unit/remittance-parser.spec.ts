import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DelhiveryRemittanceParser,
  RemittanceParserRegistry,
  ShiprocketRemittanceParser,
} from '../../src/modules/courier-settlement/services/remittance-parser.service';
import { buildXls, type XlsCell } from '../helpers/xls-builder';

/**
 * Built against a REAL Delhivery remittance export, not a guess. The
 * fixture keeps that file's exact header and row shape with the
 * seller's catalogue and order names replaced — the column contract is
 * what these pin.
 */
const CSV = readFileSync(join(__dirname, '../fixtures/delhivery-remittance.csv'), 'utf8');

function registry(): RemittanceParserRegistry {
  return new RemittanceParserRegistry(
    new DelhiveryRemittanceParser(),
    new ShiprocketRemittanceParser(),
  );
}

describe('Delhivery remittance parsing', () => {
  it('reads every waybill line', () => {
    const { rows } = registry().parse('delhivery', CSV);
    expect(rows).toHaveLength(6);
    expect(rows[0]?.awbNumber).toBe('38061110519610');
  });

  it('takes the settled amount from Amount Payable, not COD Amount', () => {
    // They are EQUAL in every sample row, which is precisely what would
    // let the wrong column ship unnoticed — until Delhivery starts
    // netting its charges and the two diverge.
    const { rows } = registry().parse('delhivery', CSV);
    expect(rows[0]?.settledInr).toBe('1000.0');
    expect(rows[5]?.settledInr).toBe('2600.0');
  });

  it('keeps the seller’s own order name but never treats it as an identifier', () => {
    // "OV Beauty (S. SA)22" in the real file — free text a person typed,
    // not unique, and not ours. Matching on it would attribute money by
    // a customer-service label.
    const { rows } = registry().parse('delhivery', CSV);
    expect(rows[0]?.externalRef).toBe('REF-1');
    expect(Object.keys(rows[0] ?? {})).toContain('awbNumber');
  });

  it('numbers each row so a complaint can name one', () => {
    const { rows } = registry().parse('delhivery', CSV);
    // Line 2 is the first data row — 1-based, past the header.
    expect(rows[0]?.line).toBe(2);
  });

  it('reads the same file sent as bytes, as it arrives from an upload', () => {
    expect(registry().parse('delhivery', Buffer.from(CSV, 'utf8')).rows).toHaveLength(6);
  });

  it('ignores the byte-order mark an Excel "CSV UTF-8" save puts in front', () => {
    expect(registry().parse('delhivery', '﻿' + CSV).rows).toHaveLength(6);
  });

  it('refuses a file whose columns are not this courier’s', () => {
    expect(() => registry().parse('delhivery', 'a,b,c\n1,2,3')).toThrow(
      /REMITTANCE_COLUMNS_MISSING|does not look like/,
    );
  });

  it('refuses a courier whose format nobody has seen, by name', () => {
    // Guessing a new courier's columns would look right and attribute the
    // wrong numbers. It says so instead.
    expect(() => registry().parse('bluedart', CSV)).toThrow(/REMITTANCE_FORMAT_UNKNOWN|bluedart/);
  });

  it('refuses a file with a header and nothing under it', () => {
    const headerOnly = CSV.split('\n')[0] ?? '';
    expect(() => registry().parse('delhivery', headerOnly)).toThrow(/REMITTANCE_EMPTY|No waybills/);
  });

  it('tolerates padded headers, which exports produce', () => {
    const padded = CSV.replace('Waybill Number', ' Waybill Number ');
    expect(registry().parse('delhivery', padded).rows).toHaveLength(6);
  });
});

// ── Shiprocket ────────────────────────────────────────────────────────
// The two sheets below restate the headers of a REAL Shiprocket export
// (2026-09-11) exactly, including the lower-case `total_adjusted_amt`.
// The parcel values are the real ones; the waybills keep the real shapes,
// including three Excel stored as numbers.

const AWB_HEADER = [
  'CRF ID',
  'AWB',
  'Delivered Date',
  'Shipped Date',
  'Order Id',
  'Courier',
  'Order Value',
  'Channel Name',
  'Remittance Date',
  'UTR',
  'total_adjusted_amt',
  'Linked CRF Ids',
];
const CRF_HEADER = [
  'Date',
  'CRF ID',
  'COD Available',
  'Freight Charges from COD',
  'Early COD Charges',
  'RTO Reversal Amount',
  'Remittance Amount',
  'Remittance Method',
  'UTR',
  'Adjusted Amount',
  'Status',
  'remarks',
];
const UTR = 'IN22625415423299';
const PARCELS: ReadonlyArray<[string | number, number, string]> = [
  ['SF3396030642KR', 1200, 'Shadowfax Surface'],
  ['SF3771704958KR', 1600, 'Shadowfax Surface'],
  ['SF3771705148KR', 1500, 'Shadowfax Surface'],
  ['SF3771722319KR', 1500, 'Shadowfax Surface'],
  ['SF3771722330KR', 1600, 'Shadowfax Surface'],
  ['SF3771727200KR', 1800, 'Shadowfax Surface'],
  [14112364794902, 1500, 'Xpressbees Surface'],
  [14112364353912, 1800, 'Xpressbees Surface'],
  [14112363492751, 1600, 'Xpressbees Surface'],
  [80150663154, 1600, 'Blue Dart Air'],
];

function parcelRow(
  [awb, value, courier]: readonly [string | number, number, string],
  i: number,
  crf: number = 13449838,
  utr: string = UTR,
  extra: { adjusted?: XlsCell; linked?: XlsCell } = {},
): XlsCell[] {
  return [
    crf,
    awb,
    '2026-09-01 15:47:41',
    '2026-08-21 03:14:41',
    1095984941 + i,
    courier,
    value,
    'CUSTOM',
    '2026-09-11 02:07:17',
    utr,
    extra.adjusted ?? null,
    extra.linked ?? null,
  ];
}

function payoutRow(p: {
  crf?: number;
  cod: number;
  freight?: number;
  early?: number;
  rto?: number;
  remitted: number;
  utr?: string;
  adjusted?: XlsCell;
  status?: string;
}): XlsCell[] {
  return [
    '2026-09-11 02:07:17',
    p.crf ?? 13449838,
    p.cod,
    p.freight ?? 0,
    p.early ?? 0,
    p.rto ?? 0,
    p.remitted,
    'Prepaid',
    p.utr ?? UTR,
    p.adjusted ?? null,
    p.status ?? 'Remittance success',
    'Remitted',
  ];
}

function srFile(parcels: XlsCell[][], payouts: XlsCell[][]): Buffer {
  return buildXls([
    { name: 'AWB level report', rows: [AWB_HEADER, ...parcels] },
    { name: 'CRF level report', rows: [CRF_HEADER, ...payouts] },
  ]);
}

const REAL_SHAPE = (): Buffer =>
  srFile(
    PARCELS.map((p, i) => parcelRow(p, i)),
    [payoutRow({ cod: 15700, remitted: 15700 })],
  );

describe('Shiprocket remittance parsing', () => {
  it('reads every parcel of the real export shape', () => {
    const { rows, warnings } = registry().parse('shiprocket', REAL_SHAPE());
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({
      awbNumber: 'SF3396030642KR',
      settledInr: '1200',
      externalRef: '1095984941',
      line: 2,
      flag: null,
    });
    expect(warnings).toEqual([]);
  });

  it('reads a waybill Excel stored as a number as its exact digits', () => {
    const { rows } = registry().parse('shiprocket', REAL_SHAPE());
    expect(rows.map((r) => r.awbNumber)).toEqual(
      expect.arrayContaining(['14112364794902', '14112364353912', '80150663154']),
    );
  });

  it('states the payout the file describes — UTR, collected, kept back, remitted', () => {
    const { summary } = registry().parse('shiprocket', REAL_SHAPE());
    expect(summary).toEqual({
      references: [UTR],
      remittedInr: '15700.00',
      codInr: '15700.00',
      deductedInr: '0.00',
      earlyCodFeeInr: '0.00',
      freightInr: '0.00',
      rtoReversalInr: '0.00',
    });
  });

  it('REFUSES a file whose parcels do not add up to its own collected total', () => {
    // The two sheets disagree about the same money; allocating from
    // either would be allocating a guess.
    const file = srFile(
      PARCELS.map((p, i) => parcelRow(p, i)),
      [payoutRow({ cod: 15900, remitted: 15900 })],
    );
    expect(() => registry().parse('shiprocket', file)).toThrow(
      /REMITTANCE_TOTALS_DISAGREE|disagree/,
    );
  });

  it('REFUSES parcels that name a remittance the payout sheet does not list', () => {
    const file = srFile(
      [parcelRow(PARCELS[0] ?? ['X', 1, 'c'], 0), parcelRow(['SF9KR', 100, 'c'], 1, 999)],
      [payoutRow({ cod: 1200, remitted: 1200 })],
    );
    expect(() => registry().parse('shiprocket', file)).toThrow(/999/);
  });

  it('reports deductions beside the total and never splits them across parcels', () => {
    const file = srFile(
      PARCELS.map((p, i) => parcelRow(p, i)),
      [payoutRow({ cod: 15700, freight: 180, early: 20, remitted: 15500 })],
    );
    const { rows, summary, warnings } = registry().parse('shiprocket', file);
    expect(rows[0]?.settledInr).toBe('1200'); // what was collected, unchanged
    expect(summary).toMatchObject({ remittedInr: '15500.00', deductedInr: '200.00' });
    expect(warnings.join(' ')).toMatch(/kept back ₹200\.00/);
    expect(warnings.join(' ')).not.toMatch(/not the ₹/); // the arithmetic holds
  });

  it('warns when collected less deductions is not what Shiprocket says it remitted', () => {
    const file = srFile(
      PARCELS.map((p, i) => parcelRow(p, i)),
      [payoutRow({ cod: 15700, remitted: 15650 })],
    );
    expect(registry().parse('shiprocket', file).warnings.join(' ')).toMatch(/not the ₹15650\.00/);
  });

  it('flags a parcel Shiprocket adjusted, for allocation by hand — the column is unseen', () => {
    const file = srFile(
      PARCELS.map((p, i) => parcelRow(p, i, 13449838, UTR, i === 0 ? { adjusted: -50 } : {})),
      [payoutRow({ cod: 15700, remitted: 15700 })],
    );
    const { rows } = registry().parse('shiprocket', file);
    expect(rows[0]?.flag).toMatch(/adjusted this parcel by -50/);
    expect(rows[1]?.flag).toBeNull();
  });

  it('flags a parcel linked to other remittances', () => {
    const file = srFile(
      PARCELS.map((p, i) => parcelRow(p, i, 13449838, UTR, i === 2 ? { linked: '13440001' } : {})),
      [payoutRow({ cod: 15700, remitted: 15700 })],
    );
    expect(registry().parse('shiprocket', file).rows[2]?.flag).toMatch(/13440001/);
  });

  it('says so when one file covers more than one bank credit', () => {
    const file = srFile(
      [
        parcelRow(['SF1KR', 1000, 'c'], 0, 1, 'UTR-A'),
        parcelRow(['SF2KR', 2000, 'c'], 1, 2, 'UTR-B'),
      ],
      [
        payoutRow({ crf: 1, cod: 1000, remitted: 1000, utr: 'UTR-A' }),
        payoutRow({ crf: 2, cod: 2000, remitted: 2000, utr: 'UTR-B' }),
      ],
    );
    const { summary, warnings } = registry().parse('shiprocket', file);
    expect(summary?.references).toEqual(['UTR-A', 'UTR-B']);
    expect(warnings.join(' ')).toMatch(/2 bank credits/);
  });

  it('warns when Shiprocket does not mark the remittance a success', () => {
    const file = srFile(
      PARCELS.map((p, i) => parcelRow(p, i)),
      [payoutRow({ cod: 15700, remitted: 15700, status: 'Remittance pending' })],
    );
    expect(registry().parse('shiprocket', file).warnings.join(' ')).toMatch(/Remittance pending/);
  });

  it('reads the parcel sheet saved as CSV, and says the total could not be checked', () => {
    const csv = [
      AWB_HEADER.join(','),
      ['13449838', 'SF3396030642KR', '', '', '1095984941', 'Shadowfax Surface', '1200'].join(','),
    ].join('\n');
    const { rows, summary, warnings } = registry().parse('shiprocket', csv);
    expect(rows[0]?.awbNumber).toBe('SF3396030642KR');
    expect(summary).toBeNull();
    expect(warnings.join(' ')).toMatch(/could not be checked/);
  });

  it('refuses a workbook without the parcel sheet, naming what it found', () => {
    const file = buildXls([{ name: 'Sheet1', rows: [['AWB'], ['X']] }]);
    expect(() => registry().parse('shiprocket', file)).toThrow(/AWB level report.*Sheet1/);
  });

  it('refuses an unreadable spreadsheet as unreadable, not as the wrong courier', () => {
    const file = buildXls([{ name: 'AWB level report', rows: [['AWB', { formula: 1 }]] }]);
    expect(() => registry().parse('shiprocket', file)).toThrow(
      /REMITTANCE_FILE_UNREADABLE|formula/,
    );
  });
});
