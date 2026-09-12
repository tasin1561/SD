import { createHash } from 'node:crypto';
import Papa from 'papaparse';
import { readSheet, readZipFiles, sheetNames } from '../../../common/xlsx/xlsx-reader';
import { isXls, readXlsWorkbook } from '../../../common/xls/xls-reader';

/**
 * What a downloaded billing file LOOKS like — pure, no browser, no I/O.
 *
 * The probe exists because nobody here has seen Delhivery's invoice files.
 * So this does not parse them into anything; it describes them: which
 * format, which sheets, where the header row is, the first few rows, how
 * many rows, and the sums of the columns that look like money — the
 * figures somebody needs to decide how the itemized file relates to the
 * invoice total. The invoice data is OURS and is kept verbatim (trimmed
 * for size); only session material is ever removed, and that is
 * `scrubSessionMaterial`'s job, not this one's.
 */

const MAX_SHEETS = 12;
const MAX_COLUMNS = 60;
const MAX_CELL = 150;
const SAMPLE_ROWS = 5;
const MAX_ZIP_ENTRIES = 8;
/** Rows scanned for a header — past this, the "title" rows are the data. */
const HEADER_SCAN_ROWS = 15;
const MONEY_HEADER =
  /amount|total|charge|freight|gst|tax|value|net|price|cod|fee|weight|cgst|sgst|igst|rate/i;

export type FileKind = 'xlsx' | 'xls' | 'csv' | 'zip' | 'pdf' | 'html' | 'unknown';

export interface SheetSample {
  readonly name: string;
  readonly rowCount: number;
  /** 0-based index of the row taken as the header, or null when none looked like one. */
  readonly headerRowIndex: number | null;
  readonly header: readonly string[];
  readonly firstRows: readonly (readonly string[])[];
  /** Data rows below the header (total rows excluded). */
  readonly dataRowCount: number;
  /** For each money-looking column: the sum of the numeric cells below the header. */
  readonly columnSums: readonly {
    readonly column: string;
    readonly sumInr: string;
    readonly numericCells: number;
  }[];
  /** Rows whose first non-empty cell says "total" — a file stating its own total. */
  readonly totalRows: readonly (readonly string[])[];
}

export interface FileSummary {
  readonly kind: FileKind;
  readonly bytes: number;
  readonly sha256: string;
  readonly sheets?: readonly SheetSample[];
  readonly sheetNames?: readonly string[];
  readonly entries?: readonly {
    readonly name: string;
    readonly bytes: number;
    readonly summary: FileSummary | null;
  }[];
  readonly pdfPages?: number;
  readonly note?: string;
}

const clip = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, MAX_CELL);

/** "₹1,23,456.70" / "(12.5)" / "-3" → paise, or null when it is not a number. */
export function moneyToPaise(raw: string): number | null {
  let s = raw.replace(/[₹,\s]|INR|Rs\.?/gi, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const paiseToString = (p: number): string =>
  `${p < 0 ? '-' : ''}${Math.floor(Math.abs(p) / 100)}.${String(Math.abs(p) % 100).padStart(2, '0')}`;

/** A header is a row with at least two non-empty cells, mostly not numbers. */
function findHeader(rows: readonly (readonly string[])[]): number | null {
  for (let i = 0; i < Math.min(rows.length, HEADER_SCAN_ROWS); i++) {
    const cells = (rows[i] ?? []).map((c) => c.trim()).filter((c) => c !== '');
    if (cells.length < 2) continue;
    const numeric = cells.filter((c) => moneyToPaise(c) !== null).length;
    if (numeric * 2 < cells.length) return i;
  }
  return null;
}

const isTotalRow = (row: readonly string[]): boolean =>
  /^(grand\s+)?(sub\s*)?total\b/i.test(row.find((c) => c.trim() !== '')?.trim() ?? '');

/** Describe one sheet's rows. */
export function sampleRows(name: string, rows: readonly (readonly string[])[]): SheetSample {
  const trimmed = rows.map((r) => r.slice(0, MAX_COLUMNS).map(clip));
  const headerRowIndex = findHeader(trimmed);
  const header = headerRowIndex === null ? [] : (trimmed[headerRowIndex] ?? []);
  const body = trimmed.slice(headerRowIndex === null ? 0 : headerRowIndex + 1);
  const nonEmpty = body.filter((r) => r.some((c) => c !== ''));
  const totalRows = nonEmpty.filter(isTotalRow);
  const data = nonEmpty.filter((r) => !isTotalRow(r));

  const columnSums: { column: string; sumInr: string; numericCells: number }[] = [];
  header.forEach((h, col) => {
    if (h === '' || !MONEY_HEADER.test(h)) return;
    let sum = 0;
    let numericCells = 0;
    for (const r of data) {
      const p = moneyToPaise(r[col] ?? '');
      if (p === null) continue;
      sum += p;
      numericCells += 1;
    }
    if (numericCells > 0) columnSums.push({ column: h, sumInr: paiseToString(sum), numericCells });
  });

  return {
    name,
    rowCount: rows.length,
    headerRowIndex,
    header,
    firstRows: data.slice(0, SAMPLE_ROWS),
    dataRowCount: data.length,
    columnSums,
    totalRows: totalRows.slice(0, 3),
  };
}

function parseCsv(text: string): string[][] {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: false });
  return parsed.data.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : []));
}

/**
 * Describe a downloaded file. Never throws: a file it cannot read is
 * reported as such, because "we could not read it" is itself a finding.
 */
export function summariseFile(name: string, body: Buffer, depth = 0): FileSummary {
  const base = { bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') };
  try {
    const isZip = body.length >= 4 && body.readUInt32LE(0) === 0x04034b50;
    if (isZip) {
      const files = readZipFiles(body);
      if (files.has('[Content_Types].xml')) {
        const names = sheetNames(body);
        return {
          ...base,
          kind: 'xlsx',
          sheetNames: names,
          sheets: names.slice(0, MAX_SHEETS).map((n) => sampleRows(n, readSheet(body, n))),
        };
      }
      const entries = [...files.entries()].slice(0, MAX_ZIP_ENTRIES).map(([entry, buf]) => ({
        name: entry,
        bytes: buf.length,
        summary: depth === 0 ? summariseFile(entry, buf, depth + 1) : null,
      }));
      return {
        ...base,
        kind: 'zip',
        entries,
        ...(files.size > MAX_ZIP_ENTRIES
          ? { note: `${files.size} entries; first ${MAX_ZIP_ENTRIES} described` }
          : {}),
      };
    }
    if (isXls(body)) {
      const wb = readXlsWorkbook(body);
      return {
        ...base,
        kind: 'xls',
        sheetNames: wb.sheetNames,
        sheets: wb.sheetNames.slice(0, MAX_SHEETS).map((n) => sampleRows(n, wb.sheet(n) ?? [])),
      };
    }
    const head = body.subarray(0, 1024).toString('latin1');
    if (/^\s*%PDF/.test(head)) {
      const pages = (body.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
      return { ...base, kind: 'pdf', pdfPages: pages };
    }
    if (/^\s*(<!doctype html|<html|<\?xml|<)/i.test(head)) {
      return {
        ...base,
        kind: 'html',
        note: 'the download answered with a web page, not a file — likely an app route or a sign-in page',
      };
    }
    if (/\.(csv|txt|tsv)$/i.test(name) || /[,\t]/.test(head)) {
      return { ...base, kind: 'csv', sheets: [sampleRows(name, parseCsv(body.toString('utf8')))] };
    }
    return { ...base, kind: 'unknown' };
  } catch (err) {
    return {
      ...base,
      kind: 'unknown',
      note: `could not be read: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`,
    };
  }
}

// ── Choosing which invoice rows to download ─────────────────────────────

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function monthIndex(word: string): number {
  return MONTHS.indexOf(word.slice(0, 3).toLowerCase());
}

/**
 * The LATEST date written anywhere in a cell, as epoch ms. A period cell
 * ("01 Aug 2026 - 31 Aug 2026") dates the invoice by its end. Numeric
 * dates are read day-first, as India writes them.
 */
export function latestDateIn(cell: string): number | null {
  const found: number[] = [];
  const push = (y: number, m: number, d: number): void => {
    if (y < 2000 || y > 2100 || m < 0 || m > 11 || d < 1 || d > 31) return;
    found.push(Date.UTC(y, m, d));
  };
  for (const x of cell.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    push(Number(x[1]), Number(x[2]) - 1, Number(x[3]));
  }
  for (const x of cell.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g)) {
    push(Number(x[3]), Number(x[2]) - 1, Number(x[1]));
  }
  for (const x of cell.matchAll(/\b(\d{1,2})[\s-]([A-Za-z]{3,9})[\s,-]+(\d{4})\b/g)) {
    push(Number(x[3]), monthIndex(x[2] ?? ''), Number(x[1]));
  }
  for (const x of cell.matchAll(/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    push(Number(x[3]), monthIndex(x[1] ?? ''), Number(x[2]));
  }
  // "Aug 2026" / "August-2026" — a month, dated by its last day. Only when
  // no day-level date was found: "12 Sep 2026" also contains "Sep 2026",
  // and reading it as the 30th would reorder invoices within a month.
  if (found.length > 0) return Math.max(...found);
  for (const x of cell.matchAll(/\b([A-Za-z]{3,9})[\s-]+(\d{4})\b/g)) {
    const m = monthIndex(x[1] ?? '');
    if (m >= 0) push(Number(x[2]), m, new Date(Date.UTC(Number(x[2]), m + 1, 0)).getUTCDate());
  }
  return found.length === 0 ? null : Math.max(...found);
}

export interface InvoicePick {
  readonly rowIndex: number;
  readonly reason: string;
}

/**
 * Which rows to download: the MOST RECENT invoice, and at most one more
 * of a different type when a type column exists and the types differ.
 * "Most recent" is read from the date/period columns; with none, the row
 * the page lists first.
 */
export function pickInvoiceRows(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): InvoicePick[] {
  if (rows.length === 0) return [];
  const dateCols = headers
    .map((h, i) => (/date|period|month|billing\s*cycle|\bfrom\b|\bto\b/i.test(h) ? i : -1))
    .filter((i) => i >= 0);
  const dateOf = (r: readonly string[]): number | null => {
    const cells = dateCols.length > 0 ? dateCols.map((i) => r[i] ?? '') : [...r];
    const ds = cells.map(latestDateIn).filter((d): d is number => d !== null);
    return ds.length === 0 ? null : Math.max(...ds);
  };
  const order = rows
    .map((r, i) => ({ i, d: dateOf(r) }))
    .sort((a, b) => (b.d ?? -Infinity) - (a.d ?? -Infinity) || a.i - b.i);
  const first = order[0];
  if (first === undefined) return [];
  const picks: InvoicePick[] = [
    {
      rowIndex: first.i,
      reason:
        first.d === null
          ? 'no date could be read from any row — took the first row listed'
          : `most recent (${new Date(first.d).toISOString().slice(0, 10)})`,
    },
  ];
  const typeCol = headers.findIndex(
    (h) => /type|category|service|nature|description/i.test(h) && !/number|no\.?$|\bid\b/i.test(h),
  );
  if (typeCol >= 0) {
    const firstType = (rows[first.i]?.[typeCol] ?? '').trim().toLowerCase();
    const other = order.find(
      (o) => (rows[o.i]?.[typeCol] ?? '').trim().toLowerCase() !== firstType,
    );
    if (other !== undefined) {
      picks.push({
        rowIndex: other.i,
        reason: `most recent of a different "${headers[typeCol] ?? 'type'}" (${rows[other.i]?.[typeCol] ?? ''})`,
      });
    }
  }
  return picks;
}

// ── Keeping session material out of what is stored ─────────────────────

const SENSITIVE_KEY =
  /^(cookies?|set-cookie|authorization|auth|token|access_?token|refresh_?token|id_?token|jwt|session(id)?|storage_?state|password|passwd|secret|x-amz-security-token|x-amz-signature|x-amz-credential|signature)$/i;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const URL_IN_TEXT = /https?:\/\/[^\s"'<>]+/g;

/**
 * A url with every query VALUE and the fragment removed; the parameter
 * NAMES are kept, because "their download link is presigned" is a finding
 * and the signature is not. Anything unparseable is returned unchanged.
 */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const names = [...new Set([...u.searchParams.keys()])];
    return `${u.origin}${u.pathname}${names.length === 0 ? '' : `?${names.map((n) => `${n}=…`).join('&')}`}`;
  } catch {
    return raw;
  }
}

/** One string with any bearer token or signed url taken out. */
export function scrubText(s: string): string {
  return s
    .replace(JWT, '[redacted-token]')
    .replace(URL_IN_TEXT, (u) => (u.includes('?') || u.includes('#') ? redactUrl(u) : u));
}

/**
 * A deep copy with session material removed: any value under a key that
 * names a cookie, token, password or signature, any JWT, and the query of
 * any url. Applied to the whole findings object before it is stored, so a
 * field somebody adds later cannot carry a session into the audit log.
 */
export function scrubSessionMaterial<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return scrubText(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object' && !Buffer.isBuffer(v)) {
      const out: Record<string, unknown> = {};
      for (const [k, inner] of Object.entries(v)) {
        out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : walk(inner);
      }
      return out;
    }
    return v;
  };
  return walk(value) as T;
}
