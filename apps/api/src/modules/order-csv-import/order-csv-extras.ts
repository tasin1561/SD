import {
  ignoredReasonForHeader,
  lookupFieldForHeader,
  type OrderCsvField,
} from './order-csv-fields';

/**
 * The cells of an uploaded file that we do NOT use, kept on the order so the
 * seller can read them back (owner, 2026-10-27). This is a RECORD OF THEIR
 * FILE, not our data model: the header is stored exactly as they wrote it and
 * the value verbatim as text. Nothing reads it to decide anything.
 *
 * ORD-6: written once, at import, never edited. An order can span several
 * rows (ORD-9) and each row has its own extras, so the shape is keyed by the
 * 1-based file row number (header counted) — the same number
 * `StagedOrderRow` uses, so it matches the seller's spreadsheet.
 */
export interface CsvExtraUnused {
  header: string;
  value: string;
  /** Why we did not use it — written for a person to read. */
  reason: string;
  truncated?: true;
}
export interface CsvExtraUnrecognised {
  header: string;
  value: string;
  truncated?: true;
}
export interface CsvExtraRow {
  row: number;
  /** Known to us and deliberately not used. */
  unused: CsvExtraUnused[];
  /** We have no idea what this column is. */
  unrecognised: CsvExtraUnrecognised[];
}
export interface CsvExtras {
  v: 1;
  rows: CsvExtraRow[];
  /** Cells dropped because a cap was reached. Absent when nothing was dropped. */
  omitted?: number;
}

/** Caps — a pathological file must not write an unbounded blob into every order. */
export const CSV_EXTRAS_MAX_ENTRIES_PER_ROW = 60;
export const CSV_EXTRAS_MAX_VALUE_CHARS = 500;
export const CSV_EXTRAS_MAX_HEADER_CHARS = 120;
export const CSV_EXTRAS_MAX_TOTAL_BYTES = 32 * 1024;

const DUPLICATE_REASON = 'another column in your file already supplied this field';

/**
 * Never throws and never refuses: an over-long value is truncated (and
 * flagged), cells past a cap are counted in `omitted`. A long value in an
 * unused column must never fail an order.
 */
export function buildCsvExtras(
  rows: ReadonlyArray<{ rowNumber: number; raw: Record<string, unknown> }>,
  mapping: Partial<Record<OrderCsvField, string>>,
): CsvExtras | undefined {
  const used = new Set(Object.values(mapping));
  const out: CsvExtraRow[] = [];
  let omitted = 0;
  let bytes = 0;

  for (const { rowNumber, raw } of rows) {
    const entry: CsvExtraRow = { row: rowNumber, unused: [], unrecognised: [] };
    let count = 0;
    for (const [rawHeader, rawValue] of Object.entries(raw)) {
      if (used.has(rawHeader) || typeof rawValue !== 'string') continue;
      const value = rawValue.trim();
      if (value === '') continue;
      const cost = rawHeader.length + Math.min(value.length, CSV_EXTRAS_MAX_VALUE_CHARS) + 80;
      if (count >= CSV_EXTRAS_MAX_ENTRIES_PER_ROW || bytes + cost > CSV_EXTRAS_MAX_TOTAL_BYTES) {
        omitted += 1;
        continue;
      }
      count += 1;
      bytes += cost;
      const header = rawHeader.slice(0, CSV_EXTRAS_MAX_HEADER_CHARS);
      const cut = value.length > CSV_EXTRAS_MAX_VALUE_CHARS;
      const shown = cut ? value.slice(0, CSV_EXTRAS_MAX_VALUE_CHARS) : value;
      const reason =
        ignoredReasonForHeader(rawHeader) ??
        (lookupFieldForHeader(rawHeader) !== null ? DUPLICATE_REASON : null);
      if (reason !== null) {
        entry.unused.push({ header, value: shown, reason, ...(cut ? { truncated: true } : {}) });
      } else {
        entry.unrecognised.push({ header, value: shown, ...(cut ? { truncated: true } : {}) });
      }
    }
    if (entry.unused.length > 0 || entry.unrecognised.length > 0) out.push(entry);
  }
  if (out.length === 0 && omitted === 0) return undefined;
  return { v: 1, rows: out, ...(omitted > 0 ? { omitted } : {}) };
}
