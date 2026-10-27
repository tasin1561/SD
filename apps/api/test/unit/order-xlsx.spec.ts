import ExcelJS from 'exceljs';
import { OrderCsvImportService } from '../../src/modules/order-csv-import/services/order-csv-import.service';
import { OrderCsvParserService } from '../../src/modules/order-csv-import/services/order-csv-parser.service';
import {
  XLSX_LIMITS,
  buildErrorReportXlsx,
  isXlsxBuffer,
  neutraliseFormula,
  parseXlsx,
} from '../../src/modules/order-csv-import/order-xlsx';

const U = undefined as never;
const svc = new OrderCsvImportService(U, U, U, U, U, U);
const parser = new OrderCsvParserService();

async function sheetBuffer(
  build: (ws: ExcelJS.Worksheet, wb: ExcelJS.Workbook) => void,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb.addWorksheet('S'), wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('the xlsx template and the CSV template cannot drift', () => {
  it('reads back as exactly the headers and rows of the CSV template', async () => {
    const xlsx = await svc.buildTemplateXlsx();
    expect(isXlsxBuffer(xlsx)).toBe(true);
    const fromXlsx = await parseXlsx(xlsx, 1000);
    const fromCsv = parser.parse(Buffer.from(svc.buildTemplate(), 'utf8'));
    expect(fromXlsx.headers).toEqual(fromCsv.headers);
    expect(fromXlsx.rows).toEqual(fromCsv.rows);
  });

  it('formats Customer Phone as Text, freezes the header row, sets widths', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await svc.buildTemplateXlsx()) as unknown as ExcelJS.Buffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getColumn(6).numFmt).toBe('@');
    expect(typeof ws.getCell('F2').value).toBe('string');
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(ws.getColumn(1).width).toBeGreaterThanOrEqual(10);
  });

  it('parseUpload runs a workbook through the same importer as a CSV', async () => {
    const { groups, rowErrors } = await (async () => {
      const p = await parser.parseUpload(await svc.buildTemplateXlsx(), 1000);
      return parser.groupRows(p.rows, parser.detectMapping(p.headers).mapping);
    })();
    expect(rowErrors).toEqual([]);
    expect(groups.map((g) => g.lines.length)).toEqual([1, 1, 2]);
  });

  it('parseUpload sniffs bytes, not names: plain text goes down the CSV path', async () => {
    const p = await parser.parseUpload(Buffer.from('a,b\n1,2\n', 'utf8'), 10);
    expect(p.rows).toEqual([{ a: '1', b: '2' }]);
  });
});

describe('cell values', () => {
  it('a numeric phone stays plain digits, never scientific', async () => {
    const buf = await sheetBuffer((ws) => {
      ws.addRow(['Customer Phone', 'Quantity']);
      ws.addRow([919876543210, 2]);
    });
    const p = await parseXlsx(buf, 100);
    expect(p.rows[0]?.['Customer Phone']).toBe('919876543210');
    expect(p.rows[0]?.['Customer Phone']).not.toMatch(/e/i);
    expect(p.rows[0]?.Quantity).toBe('2');
  });

  it('reads the CACHED result of a formula and never evaluates it', async () => {
    const buf = await sheetBuffer((ws) => {
      ws.addRow(['A']);
      ws.getCell('A2').value = { formula: '1+1', result: 5 };
    });
    expect((await parseXlsx(buf, 100)).rows[0]?.A).toBe('5');
  });

  it('writes dates as ISO text', async () => {
    const buf = await sheetBuffer((ws) => {
      ws.addRow(['D', 'T']);
      ws.addRow([new Date('2026-10-27T00:00:00Z'), new Date('2026-10-27T10:30:00Z')]);
    });
    const r = (await parseXlsx(buf, 100)).rows[0];
    expect(r?.D).toBe('2026-10-27');
    expect(r?.T).toBe('2026-10-27 10:30:00');
  });

  it('skips a leading sep=, row', async () => {
    const buf = await sheetBuffer((ws) => {
      ws.addRow(['sep=,']);
      ws.addRow(['A', 'B']);
      ws.addRow(['1', '2']);
    });
    const p = await parseXlsx(buf, 100);
    expect(p.headers).toEqual(['A', 'B']);
    expect(p.rowCount).toBe(1);
  });
});

describe('limits', () => {
  it('refuses more rows than the cap, with a clear message', async () => {
    const buf = await sheetBuffer((ws) => {
      ws.addRow(['A']);
      for (let i = 0; i < 30; i++) ws.addRow([String(i)]);
    });
    await expect(parseXlsx(buf, 10)).rejects.toThrow(/more than 10 rows/);
  });

  it('refuses too many worksheets', async () => {
    const wb = new ExcelJS.Workbook();
    for (let i = 0; i <= XLSX_LIMITS.maxSheets; i++) wb.addWorksheet(`S${i}`).addRow(['A']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(parseXlsx(buf, 100)).rejects.toThrow(/sheets/);
  });

  it('refuses a zip that declares an absurd uncompressed size, before inflating', async () => {
    const cd = Buffer.alloc(46 + 1);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt32LE(0xfffffff0, 24); // uncompressed size
    cd.writeUInt16LE(1, 28); // name length
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(4, 16);
    const bomb = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), cd, eocd]);
    await expect(parseXlsx(bomb, 100)).rejects.toThrow(/expands/);
  });

  it('refuses a file that is a zip by magic but not a workbook', async () => {
    await expect(parseXlsx(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), 100)).rejects.toThrow(
      /not a readable/,
    );
  });
});

describe('the xlsx error report', () => {
  it('lists only the rejected rows, reddens the offending cell, defuses formulas', async () => {
    const headers = ['Order ID', 'Customer Phone', 'Customer Name'];
    const buf = await buildErrorReportXlsx(headers, [
      {
        rowNumber: 3,
        errorHeader: 'Customer Phone',
        reason: 'bad phone',
        original: {
          'Order ID': 'SD-1',
          'Customer Phone': '9.19877E+11',
          'Customer Name': '=HYPERLINK("x")',
        },
      },
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.worksheets[0]!;
    expect(ws.actualRowCount).toBe(2);
    expect(ws.getRow(1).values).toEqual([undefined, ...headers, 'Row', 'Error']);
    const phone = ws.getCell('B2');
    expect((phone.fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFFFC7CE');
    expect(JSON.stringify(phone.note)).toContain('bad phone');
    // The untouched cell is not red; the formula text is defused.
    expect(ws.getCell('A2').fill).toBeUndefined();
    expect(ws.getCell('C2').value).toBe('\'=HYPERLINK("x")');
    expect(ws.getCell('E2').value).toBe('bad phone');
    expect(ws.getCell('D2').value).toBe(3);
  });

  it.each(['=1+1', '+91 98', '-5', '@SUM(A1)'])('neutralises %s', (v) => {
    expect(neutraliseFormula(v)).toBe(`'${v}`);
  });
});
