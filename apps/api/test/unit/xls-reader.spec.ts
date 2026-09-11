import { isXls, readXlsSheet, readXlsWorkbook, XlsError } from '../../src/common/xls/xls-reader';
import { buildXls, buildWorkbookStream, wrapInCompoundFile } from '../helpers/xls-builder';

/**
 * The .xls reader behind Shiprocket's remittance upload. Files are built
 * byte by byte (test/helpers/xls-builder) so each container and record
 * shape a single real export never shows is exercised on purpose.
 */
const HEADER = ['CRF ID', 'AWB', 'Order Value'];
const ROWS = [
  HEADER,
  [13449838, 'SF3396030642KR', 1200],
  [13449838, 14112364794902, 1500],
  [13449838, 80150663154, 1599.5],
];

describe('xls reader — the container', () => {
  it('recognises a compound file by its signature, and nothing else', () => {
    expect(isXls(buildXls([{ name: 'S', rows: ROWS }]))).toBe(true);
    expect(isXls(Buffer.from('CRF ID,AWB\n1,2\n'))).toBe(false);
    expect(isXls(Buffer.from([0x50, 0x4b, 0x03, 0x04, ...new Array<number>(600).fill(0)]))).toBe(
      false,
    );
  });

  it('reads a small workbook stored in the mini stream', () => {
    const file = buildXls([{ name: 'S', rows: ROWS }]);
    expect(readXlsSheet(file, 'S')[1]).toEqual(['13449838', 'SF3396030642KR', '1200']);
  });

  it('reads a large workbook from regular sectors', () => {
    const many = [HEADER, ...Array.from({ length: 400 }, (_, i) => [1, `SF${1000 + i}KR`, i])];
    const stream = buildWorkbookStream([{ name: 'S', rows: many }]);
    expect(stream.length).toBeGreaterThanOrEqual(4096);
    const rows = readXlsSheet(wrapInCompoundFile(stream), 'S');
    expect(rows).toHaveLength(401);
    expect(rows[400]).toEqual(['1', 'SF1399KR', '399']);
  });

  it("tolerates the real export's quirk: the root chain running into the workbook", () => {
    // Shiprocket's file has its root entry's FAT chain continuing into the
    // workbook's sectors; strict readers call that corruption. Each stream
    // cut at its own declared size reads correctly.
    const many = [HEADER, ...Array.from({ length: 400 }, (_, i) => [1, `SF${i}KR`, i])];
    const stream = buildWorkbookStream([{ name: 'S', rows: many }]);
    const rows = readXlsSheet(wrapInCompoundFile(stream, { overlapQuirk: true }), 'S');
    expect(rows[1]).toEqual(['1', 'SF0KR', '0']);
    expect(rows).toHaveLength(401);
  });

  it('refuses bytes that are not a workbook, and names what it has when a sheet is missing', () => {
    expect(() => readXlsWorkbook(Buffer.from('not a spreadsheet'.padEnd(600, ' ')))).toThrow(
      XlsError,
    );
    const file = buildXls([{ name: 'AWB level report', rows: ROWS }]);
    expect(() => readXlsSheet(file, 'Nope')).toThrow(/has: AWB level report/);
  });
});

describe('xls reader — cells', () => {
  it('reads a waybill stored as a number as its exact digits', () => {
    // 14112364794902 is a real Xpressbees waybill Excel kept as a double.
    // "1.4112364794902e+13" would match nothing and look like a bad file.
    const rows = readXlsSheet(buildXls([{ name: 'S', rows: ROWS }]), 'S');
    expect(rows[2]?.[1]).toBe('14112364794902');
    expect(rows[3]?.[1]).toBe('80150663154');
    expect(rows[3]?.[2]).toBe('1599.5');
  });

  it.each(['rk', 'mulrk'] as const)('decodes whole numbers written as %s', (integers) => {
    const rows = readXlsSheet(buildXls([{ name: 'S', rows: [[1, 2, 3, -7]] }], { integers }), 'S');
    expect(rows[0]).toEqual(['1', '2', '3', '-7']);
  });

  it('reads strings split across CONTINUE records, in both character widths', () => {
    // A tiny record size forces splits mid-string, where the next record
    // restates whether the rest is one byte per character or two.
    const words = ['Remittance success', 'Shadowfax Surface', 'রেমিট্যান্স ₹১৫,৭০০', 'CUSTOM'];
    const file = buildXls([{ name: 'S', rows: [words] }], { sstChunk: 13 });
    expect(readXlsSheet(file, 'S')[0]).toEqual(words);
  });

  it('keeps a row gap as an empty row, so row numbers stay true', () => {
    const rows = readXlsSheet(buildXls([{ name: 'S', rows: [['a'], [], ['b']] }]), 'S');
    expect(rows).toEqual([['a'], [], ['b']]);
  });

  it('reads each of several sheets by name', () => {
    const wb = readXlsWorkbook(
      buildXls([
        { name: 'AWB level report', rows: [['AWB'], ['X1']] },
        { name: 'CRF level report', rows: [['UTR'], ['IN22625415423299']] },
      ]),
    );
    expect(wb.sheetNames).toEqual(['AWB level report', 'CRF level report']);
    expect(wb.sheet('CRF level report')?.[1]).toEqual(['IN22625415423299']);
  });

  it('refuses a formula rather than reading its cached value, and names the cell', () => {
    const file = buildXls([{ name: 'S', rows: [['a', { formula: 5 }]] }]);
    expect(() => readXlsSheet(file, 'S')).toThrow(/B1 is a formula/);
  });

  it('refuses an error cell (#N/A and friends)', () => {
    const file = buildXls([{ name: 'S', rows: [[{ error: 0x2a }]] }]);
    expect(() => readXlsSheet(file, 'S')).toThrow(/A1 holds an error value/);
  });

  it('refuses a workbook older than Excel 97', () => {
    const file = buildXls([{ name: 'S', rows: [['a']] }], { biffVersion: 0x0500 });
    expect(() => readXlsWorkbook(file)).toThrow(/older/);
  });
});
