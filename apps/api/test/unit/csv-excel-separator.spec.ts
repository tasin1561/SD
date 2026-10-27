import { CsvParserService } from '../../src/modules/catalog-csv-import/services/csv-parser.service';
import { CsvImportService } from '../../src/modules/catalog-csv-import/services/csv-import.service';
import { OrderCsvParserService } from '../../src/modules/order-csv-import/services/order-csv-parser.service';
import { OrderCsvImportService } from '../../src/modules/order-csv-import/services/order-csv-import.service';
import { StoreOrderCsvImportService } from '../../src/modules/order-csv-import/services/store-order-csv-import.service';
import {
  CSV_TEMPLATE_PREFIX,
  stripCsvSeparatorHint,
} from '../../src/common/text/csv-separator-hint';

/**
 * Excel splits a CSV on the Windows "List separator", not on commas, so our
 * templates open with `sep=,`. Emitting it without the parsers skipping it
 * (or the reverse) is a regression — the round trips here are what catch it.
 */
const U = undefined as never;
const BOM = '\uFEFF';
const buf = (s: string): Buffer => Buffer.from(s, 'utf8');

const templates: Array<{ name: string; csv: string }> = [
  { name: 'catalog', csv: new CsvImportService(U, U, U, U, U, U, U).buildTemplate() },
  { name: 'seller orders', csv: new OrderCsvImportService(U, U, U, U, U, U).buildTemplate() },
  {
    name: 'store orders',
    csv: new StoreOrderCsvImportService(U, U, U, U, U, U, U).buildTemplate(),
  },
];

const parsers: Array<{
  name: string;
  parse: (b: Buffer) => { headers: string[]; rowCount: number };
}> = [
  { name: 'catalog', parse: (b) => new CsvParserService().parse(b) },
  { name: 'orders', parse: (b) => new OrderCsvParserService().parse(b) },
];

describe('templates carry a BOM and the Excel separator hint', () => {
  it.each(templates)('$name template starts with BOM + sep=,', ({ csv }) => {
    expect(csv.startsWith(`${BOM}sep=,\n`)).toBe(true);
    expect(csv.startsWith(CSV_TEMPLATE_PREFIX)).toBe(true);
  });
});

describe('every template round-trips through its own parser', () => {
  const pairs: Array<[string, string, (typeof parsers)[number]]> = [
    ['catalog', templates[0]!.csv, parsers[0]!],
    ['seller orders', templates[1]!.csv, parsers[1]!],
    ['store orders', templates[2]!.csv, parsers[1]!],
  ];
  it.each(pairs)('%s: headers are the header row, sample rows parse', (_n, csv, parser) => {
    const lines = csv.slice(CSV_TEMPLATE_PREFIX.length).trimEnd().split('\n');
    const out = parser.parse(buf(csv));
    expect(out.headers).toEqual(lines[0]!.split(','));
    expect(out.headers).not.toContain('sep=');
    expect(out.rowCount).toBe(lines.length - 1);
  });
});

describe.each(parsers)('$name parser: separator hint handling', ({ parse }) => {
  it('skips a `sep=,` first line and uses commas', () => {
    const out = parse(buf('sep=,\nA,B\n1,2\n'));
    expect(out.headers).toEqual(['A', 'B']);
    expect(out.rowCount).toBe(1);
  });

  it('skips a `sep=;` first line and uses semicolons', () => {
    const out = parse(buf('sep=;\nA;B\n1;2\n'));
    expect(out.headers).toEqual(['A', 'B']);
  });

  it('a `sep=;` file keeps commas inside cells (delimiter is honoured, not guessed)', () => {
    const out = parse(buf('sep=;\nA;B\n1,5;2\n')) as unknown as {
      headers: string[];
      rows: Record<string, string>[];
    };
    expect(out.headers).toEqual(['A', 'B']);
    expect(out.rows[0]).toEqual({ A: '1,5', B: '2' });
  });

  it('a file with NO hint and semicolons still auto-detects (sellers rely on this)', () => {
    const out = parse(buf('A;B;C\n1;2;3\n'));
    expect(out.headers).toEqual(['A', 'B', 'C']);
  });

  it('handles BOM + hint line together, with CRLF', () => {
    const out = parse(buf(`${BOM}sep=,\r\nA,B\r\n1,2\r\n`));
    expect(out.headers).toEqual(['A', 'B']);
    expect(out.rowCount).toBe(1);
  });

  it('only a first-line hint is skipped: data beginning with `sep=` survives', () => {
    const out = parse(buf('A,B\nsep=x,2\nsep=,3\n'));
    expect(out.headers).toEqual(['A', 'B']);
    expect(out.rowCount).toBe(2);
  });
});

describe('stripCsvSeparatorHint', () => {
  it('leaves delimiter undefined without a hint', () => {
    expect(stripCsvSeparatorHint('A;B\n1;2\n')).toEqual({ text: 'A;B\n1;2\n' });
  });
  it('is case-insensitive and returns the delimiter', () => {
    expect(stripCsvSeparatorHint('SEP=;\nA;B')).toEqual({ text: 'A;B', delimiter: ';' });
  });
  it('does not treat a longer first cell as a hint', () => {
    expect(stripCsvSeparatorHint('sep=ab,c\n1,2').delimiter).toBeUndefined();
  });
});
