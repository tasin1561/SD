import ExcelJS from 'exceljs';
import { OrderCsvParserService } from '../../src/modules/order-csv-import/services/order-csv-parser.service';
import {
  CSV_EXTRAS_MAX_ENTRIES_PER_ROW,
  CSV_EXTRAS_MAX_TOTAL_BYTES,
  CSV_EXTRAS_MAX_VALUE_CHARS,
} from '../../src/modules/order-csv-import/order-csv-extras';

const parser = new OrderCsvParserService();

const HEAD = [
  '*Sale Order Number',
  '*Customer Name',
  '*Customer Phone',
  '*Shipping Address Line1',
  'Shipping Address Line2',
  '*Shipping Pincode',
  '*Item Sku Code',
  '*Quantity Ordered',
  'Transport Mode',
  'Customer Email(Optional)',
  'Gift Wrap Colour',
];

function row(ref: string, sku: string, extra: [string, string, string]): string[] {
  return [ref, 'Asha', '9876543210', '1 Main Rd', 'near temple', '110001', sku, '1', ...extra];
}

const csvOf = (rows: string[][]): Buffer =>
  Buffer.from([HEAD, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n'), 'utf8');

function group(buf: Buffer, headers = HEAD) {
  const parsed = parser.parse(buf);
  const { mapping } = parser.detectMapping(parsed.headers.length ? parsed.headers : headers);
  return parser.groupRows(parsed.rows, mapping);
}

describe('csv extras: the columns we do not use are kept, verbatim, per file row', () => {
  it('stores known-unused (with the reason) and unrecognised separately, as written', () => {
    const { groups, rowErrors } = group(csvOf([row('A1', 'SKU1', ['Express', 'a@b.in', 'Red'])]));
    expect(rowErrors).toEqual([]);
    const extras = groups[0]!.csvExtras!;
    expect(extras.v).toBe(1);
    expect(extras.rows).toHaveLength(1);
    const r = extras.rows[0]!;
    expect(r.row).toBe(2);
    // Header exactly as written, not normalised; Customer Email is NOT special-cased out.
    expect(r.unused.map((c) => [c.header, c.value])).toEqual([
      ['Transport Mode', 'Express'],
      ['Customer Email(Optional)', 'a@b.in'],
    ]);
    expect(r.unused[0]!.reason).toMatch(/we choose the courier/);
    expect(r.unrecognised).toEqual([{ header: 'Gift Wrap Colour', value: 'Red' }]);
  });

  it('keeps each row of a multi-row order separate and attributed to its own file row', () => {
    const { groups } = group(
      csvOf([
        row('A1', 'SKU1', ['Express', '', 'Red']),
        row('B2', 'SKU9', ['', '', 'Green']),
        row('A1', 'SKU2', ['Surface', '', '']),
      ]),
    );
    const a = groups.find((g) => g.externalRef === 'A1')!;
    expect(a.csvExtras!.rows.map((r) => r.row)).toEqual([2, 4]);
    expect(a.csvExtras!.rows[0]!.unrecognised[0]!.value).toBe('Red');
    expect(a.csvExtras!.rows[1]!.unused[0]!.value).toBe('Surface');
    expect(a.csvExtras!.rows[1]!.unrecognised).toEqual([]);
    const b = groups.find((g) => g.externalRef === 'B2')!;
    expect(b.csvExtras!.rows).toHaveLength(1);
    expect(b.csvExtras!.rows[0]!.row).toBe(3);
  });

  it('an order whose file carries no unused cells has no extras', () => {
    const { groups } = group(csvOf([row('A1', 'SKU1', ['', '', ''])]));
    expect(groups[0]!.csvExtras).toBeUndefined();
  });

  it('xlsx and csv produce the same stored shape for the same content', async () => {
    const rows = [row('A1', 'SKU1', ['Express', 'a@b.in', 'Red'])];
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.addRow(HEAD);
    for (const r of rows) ws.addRow(r);
    const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
    const fromXlsx = await parser.parseUpload(xlsx, 1000);
    const fromCsv = await parser.parseUpload(csvOf(rows), 1000);
    const g = (p: typeof fromCsv) =>
      parser.groupRows(p.rows, parser.detectMapping(p.headers).mapping).groups[0]!.csvExtras;
    expect(g(fromXlsx)).toEqual(g(fromCsv));
    expect(g(fromXlsx)).toBeDefined();
  });

  it('truncates an over-long value and still imports the order', () => {
    const long = 'x'.repeat(CSV_EXTRAS_MAX_VALUE_CHARS + 200);
    const { groups, rowErrors } = group(csvOf([row('A1', 'SKU1', ['Express', 'a@b.in', long])]));
    expect(rowErrors).toEqual([]);
    expect(groups).toHaveLength(1);
    const c = groups[0]!.csvExtras!.rows[0]!.unrecognised[0]!;
    expect(c.value).toHaveLength(CSV_EXTRAS_MAX_VALUE_CHARS);
    expect(c.truncated).toBe(true);
  });

  it('caps columns per row and total bytes, counts what it dropped, never refuses', () => {
    const many = Array.from(
      { length: CSV_EXTRAS_MAX_ENTRIES_PER_ROW + 25 },
      (_, i) => `Extra ${i}`,
    );
    const head = [...HEAD.slice(0, 8), ...many];
    const body = [...row('A1', 'SKU1', ['', '', '']).slice(0, 8), ...many.map(() => 'v')];
    const buf = Buffer.from([head, body].map((r) => r.join(',')).join('\n'), 'utf8');
    const p = parser.parse(buf);
    const out = parser.groupRows(p.rows, parser.detectMapping(p.headers).mapping);
    expect(out.rowErrors).toEqual([]);
    const e = out.groups[0]!.csvExtras!;
    expect(e.rows[0]!.unrecognised).toHaveLength(CSV_EXTRAS_MAX_ENTRIES_PER_ROW);
    expect(e.omitted).toBe(25);

    // Many rows of one order: the byte ceiling holds.
    const big = 'y'.repeat(CSV_EXTRAS_MAX_VALUE_CHARS);
    const rows = Array.from({ length: 200 }, () => row('A1', 'SKU1', ['Express', big, big]));
    const out2 = group(csvOf(rows));
    const e2 = out2.groups[0]!.csvExtras!;
    expect(JSON.stringify(e2).length).toBeLessThan(CSV_EXTRAS_MAX_TOTAL_BYTES * 1.5);
    expect(e2.omitted).toBeGreaterThan(0);
  });
});
