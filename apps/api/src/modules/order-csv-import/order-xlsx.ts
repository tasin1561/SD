import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { normalizeHeader } from './order-csv-fields';

/**
 * `.xlsx` as a second FILE FORMAT for the order importer — never a second
 * importer. `parseXlsx` turns the first worksheet into the SAME
 * `{ headers, rows, rowCount }` shape papaparse yields, so alias matching,
 * grouping, the two-grain required fields, staging and duplicates all run
 * untouched. One definition of a valid order, two containers.
 *
 * Why bother: a phone typed into a numeric Excel cell survives here as the
 * number it is (`919876543210`), where a CSV export of the same sheet prints
 * `9.19877E+11` and the digits are gone.
 *
 * A zip is a far larger attack surface than text, so before exceljs sees a
 * byte the archive is inspected: entry count and total UNCOMPRESSED size are
 * capped (zip-bomb), then sheet count and row count. Cached cell values only —
 * a formula is never evaluated.
 */
export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const XLSX_LIMITS = {
  maxZipEntries: 200,
  maxUncompressedBytes: 32 * 1024 * 1024,
  maxSheets: 10,
} as const;

/** `PK\x03\x04` — the zip local-file-header magic. Extension alone proves nothing. */
export function isXlsxBuffer(buf: Buffer): boolean {
  return (
    buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04
  );
}

const bad = (message: string): BadRequestException =>
  new BadRequestException({ code: 'XLSX_REJECTED', message });

/** Walk the zip central directory without inflating anything. */
function assertZipIsSane(buf: Buffer): void {
  const min = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw bad('This file is not a readable .xlsx workbook.');
  const entries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff) {
    throw bad('This workbook is too large or complex to import. Save it as a plain .xlsx or CSV.');
  }
  if (entries > XLSX_LIMITS.maxZipEntries) {
    throw bad(`This workbook has too many internal parts (${entries}). Save it as a plain .xlsx.`);
  }
  let off = cdOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) {
      throw bad('This file is not a readable .xlsx workbook.');
    }
    total += buf.readUInt32LE(off + 24);
    if (total > XLSX_LIMITS.maxUncompressedBytes) {
      throw bad('This workbook expands to far more data than an order file should. Not imported.');
    }
    off +=
      46 + buf.readUInt16LE(off + 28) + buf.readUInt16LE(off + 30) + buf.readUInt16LE(off + 32);
  }
}

/** A cached cell value → the string a CSV cell would carry. */
export function xlsxCellToString(v: ExcelJS.CellValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return numberToPlainString(v);
  if (v instanceof Date) return dateToString(v);
  if (typeof v === 'object') {
    // Formula cells: the CACHED result, never an evaluation.
    if ('result' in v) return xlsxCellToString(v.result as ExcelJS.CellValue);
    if ('richText' in v)
      return v.richText
        .map((r) => r.text)
        .join('')
        .trim();
    if ('text' in v && typeof v.text === 'string') return v.text.trim();
    if ('error' in v) return '';
  }
  return '';
}

/** Never scientific notation: a phone must stay `919876543210`. */
function numberToPlainString(n: number): string {
  if (!Number.isFinite(n)) return '';
  const rounded = Number(n.toPrecision(15));
  if (Number.isInteger(rounded)) {
    return Math.abs(rounded) < 1e21 ? String(rounded) : BigInt(rounded).toString();
  }
  return String(rounded);
}

function dateToString(d: Date): string {
  const iso = d.toISOString();
  return iso.endsWith('T00:00:00.000Z')
    ? iso.slice(0, 10)
    : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

export interface ParsedSheet {
  headers: string[];
  rows: Array<Record<string, string>>;
  rowCount: number;
}

export async function parseXlsx(buffer: Buffer, maxRows: number): Promise<ParsedSheet> {
  assertZipIsSane(buffer);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw bad('This file could not be read as an .xlsx workbook.');
  }
  if (wb.worksheets.length > XLSX_LIMITS.maxSheets) {
    throw bad(
      `This workbook has ${wb.worksheets.length} sheets; keep the orders on the first one.`,
    );
  }
  const ws = wb.worksheets[0];
  if (ws === undefined) throw bad('This workbook has no sheets.');

  const grid: string[][] = [];
  const maxGridRows = maxRows + 5; // header + a possible `sep=,` line + slack
  ws.eachRow({ includeEmpty: false }, (row) => {
    if (grid.length > maxGridRows) return;
    const cells: string[] = [];
    for (let c = 1; c <= row.cellCount; c++) cells.push(xlsxCellToString(row.getCell(c).value));
    if (cells.some((x) => x !== '')) grid.push(cells);
  });
  if (grid.length > maxGridRows) {
    throw bad(`This sheet has more than ${maxRows} rows; the limit is ${maxRows}. Split the file.`);
  }
  // Someone saved our CSV template as xlsx: its Excel `sep=,` hint is a cell.
  const first = grid[0];
  if (
    first !== undefined &&
    first.filter((x) => x !== '').length === 1 &&
    /^sep=.$/i.test(first[0] ?? '')
  ) {
    grid.shift();
  }
  const headerCells = grid.shift();
  if (headerCells === undefined) return { headers: [], rows: [], rowCount: 0 };

  const seen = new Map<string, number>();
  const cols: Array<{ index: number; header: string }> = [];
  headerCells.forEach((h, index) => {
    if (h === '') return;
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    cols.push({ index, header: n === 1 ? h : `${h}_${n - 1}` });
  });
  const rows = grid.map((cells) => {
    const rec: Record<string, string> = {};
    for (const c of cols) rec[c.header] = cells[c.index] ?? '';
    return rec;
  });
  return { headers: cols.map((c) => c.header), rows, rowCount: rows.length };
}

/** A string that a spreadsheet would run as a formula, defused. */
export function neutraliseFormula(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE8EEF7' },
};
const RED_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };

function widthFor(header: string, samples: readonly string[]): number {
  const longest = Math.max(header.length, ...samples.map((s) => s.length));
  return Math.min(40, Math.max(12, longest + 3));
}

/** The downloadable `.xlsx` template: same columns and sample rows as the CSV. */
export async function buildTemplateXlsx(
  headers: readonly string[],
  rows: ReadonlyArray<readonly string[]>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Orders', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = headers.map((h, i) => ({
    header: h,
    key: `c${i}`,
    width: widthFor(
      h,
      rows.map((r) => r[i] ?? ''),
    ),
  }));
  const phoneCol = headers.findIndex((h) => normalizeHeader(h) === 'customer phone') + 1;
  for (const r of rows) {
    ws.addRow(
      headers.map((_, i) => {
        const v = r[i] ?? '';
        // Numbers where they are numbers; text where a leading zero or the
        // phone must stay exactly as typed.
        return i + 1 !== phoneCol && /^[1-9]\d{0,14}(\.\d+)?$|^0(\.\d+)?$/.test(v) ? Number(v) : v;
      }),
    );
  }
  // The phone column is TEXT: the fix that stops Excel mangling it at source.
  if (phoneCol > 0) ws.getColumn(phoneCol).numFmt = '@';
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.fill = HEADER_FILL;
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 30;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface XlsxErrorRow {
  rowNumber: number;
  /** Header of the offending column, or null when the problem is the row as a whole. */
  errorHeader: string | null;
  reason: string;
  original: Record<string, string>;
}

/** Rejected rows only, in the file's column order, offending cells red with the reason on them. */
export async function buildErrorReportXlsx(
  headers: readonly string[],
  errors: readonly XlsxErrorRow[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Rejected rows', { views: [{ state: 'frozen', ySplit: 1 }] });
  const all = [...headers, 'Row', 'Error'];
  ws.columns = all.map((h, i) => ({
    header: neutraliseFormula(h),
    key: `c${i}`,
    width: i === all.length - 1 ? 60 : widthFor(h, []),
  }));
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.fill = HEADER_FILL;
  for (const e of errors) {
    const row = ws.addRow([
      ...headers.map((h) => neutraliseFormula(e.original[h] ?? '')),
      e.rowNumber,
      neutraliseFormula(e.reason),
    ]);
    const mark = (col: number): void => {
      const cell = row.getCell(col);
      cell.fill = RED_FILL;
      cell.font = { color: { argb: 'FF9C0006' } };
      cell.note = neutraliseFormula(e.reason);
    };
    const at = e.errorHeader === null ? -1 : headers.indexOf(e.errorHeader);
    if (at >= 0) mark(at + 1);
    mark(all.length); // the Error cell is always red
  }
  // Text columns: a phone must not be re-numbered when the seller fixes it.
  headers.forEach((h, i) => {
    if (normalizeHeader(h) === 'customer phone') ws.getColumn(i + 1).numFmt = '@';
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
