import { RtoDisposition, RtoItemCondition } from '@skydrop/db';
import type { RestockSource } from './rto-restock-sources';

/**
 * WMS-8d (2026-09-13) — a returned line inspected BY QUANTITY.
 *
 * "What if this product has 2 qty? One is good and another is damaged?"
 * Condition and disposition were recorded once per shipment line, so a
 * qty-2 line got one choice for both units. A line now carries ROWS, each
 * with its own quantity, condition, disposition and notes; the rows sum
 * to the line's quantity. An unsplit line is ONE row covering the whole
 * quantity, which is exactly what the old columns said.
 *
 * PURE: no Prisma, no Nest. The inspection service validates and writes
 * rows with these helpers; finalize reads them back with `effectiveRows`
 * and splits the pack sources across them with `splitSourcesAcrossRows`.
 */

export interface InspectionRow {
  readonly quantity: number;
  readonly condition: RtoItemCondition;
  readonly disposition: RtoDisposition;
  readonly notes: string | null;
}

/** The line summary the `shipment_items.rto*` columns keep. */
export interface InspectionSummary {
  readonly condition: RtoItemCondition;
  readonly disposition: RtoDisposition;
  readonly notes: string | null;
}

export type RowValidationError =
  | { readonly code: 'RTO_SPLIT_EMPTY' }
  | { readonly code: 'RTO_SPLIT_ROW_QUANTITY_INVALID'; readonly position: number }
  | {
      readonly code: 'RTO_SPLIT_QUANTITY_MISMATCH';
      readonly lineQuantity: number;
      readonly rowsQuantity: number;
    };

/** Blank notes become null, so "no note" has one spelling. */
export function cleanNotes(notes: string | null | undefined): string | null {
  const trimmed = notes?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * The rows a line's quantity may be split into, or why not.
 *
 * Every row carries at least one unit, and the rows cover the line's
 * quantity EXACTLY — fewer would leave units nobody decided about, more
 * would decide about units that are not there.
 */
export function validateRows(
  lineQuantity: number,
  rows: readonly InspectionRow[],
): RowValidationError | null {
  if (rows.length === 0) return { code: 'RTO_SPLIT_EMPTY' };
  for (const [i, row] of rows.entries()) {
    if (!Number.isInteger(row.quantity) || row.quantity < 1) {
      return { code: 'RTO_SPLIT_ROW_QUANTITY_INVALID', position: i + 1 };
    }
  }
  const rowsQuantity = rows.reduce((sum, r) => sum + r.quantity, 0);
  if (rowsQuantity !== lineQuantity) {
    return { code: 'RTO_SPLIT_QUANTITY_MISMATCH', lineQuantity, rowsQuantity };
  }
  return null;
}

/** Worst first: a line with any missing unit reads as missing, then damaged. */
const CONDITION_RANK: Readonly<Record<RtoItemCondition, number>> = {
  [RtoItemCondition.MISSING]: 3,
  [RtoItemCondition.DAMAGED]: 2,
  [RtoItemCondition.GOOD]: 1,
};

/**
 * The priority the LINE-level disposition summary follows:
 *   INSPECT_LATER — anything undecided keeps the whole line open (finalize
 *                   refuses; the receipt list counts it as undecided).
 *   RESTOCK       — any unit heading back to sellable stock.
 *   HOLD_DAMAGED  — any unit kept aside.
 *   WRITE_OFF     — only when every unit is written off.
 * Readers that need the truth per unit read the rows.
 */
const DISPOSITION_RANK: Readonly<Record<RtoDisposition, number>> = {
  [RtoDisposition.INSPECT_LATER]: 4,
  [RtoDisposition.RESTOCK]: 3,
  [RtoDisposition.HOLD_DAMAGED]: 2,
  [RtoDisposition.WRITE_OFF]: 1,
};

/** The one-value-per-line summary kept on `shipment_items.rto*`. */
export function summarizeRows(rows: readonly InspectionRow[]): InspectionSummary {
  const first = rows[0];
  if (first === undefined) {
    throw new Error('summarizeRows: a line always has at least one row');
  }
  if (rows.length === 1) {
    return { condition: first.condition, disposition: first.disposition, notes: first.notes };
  }
  let condition = first.condition;
  let disposition = first.disposition;
  for (const r of rows) {
    if (CONDITION_RANK[r.condition] > CONDITION_RANK[condition]) condition = r.condition;
    if (DISPOSITION_RANK[r.disposition] > DISPOSITION_RANK[disposition]) {
      disposition = r.disposition;
    }
  }
  const notes = [...new Set(rows.map((r) => r.notes).filter((n): n is string => n !== null))];
  return { condition, disposition, notes: notes.length === 0 ? null : notes.join(' · ') };
}

/**
 * The rows finalize applies. Stored rows win; a line inspected before the
 * rows existed (or a fixture without them) is ONE row made of its summary
 * columns, covering the whole quantity — the backfill migration writes
 * exactly that, so both paths agree. An uninspected line has no rows.
 */
export function effectiveRows(line: {
  readonly quantity: number;
  readonly rtoCondition: RtoItemCondition | null;
  readonly rtoDisposition: RtoDisposition | null;
  readonly rtoInspectionNotes?: string | null;
  readonly rtoInspections?: readonly InspectionRow[] | undefined;
}): readonly InspectionRow[] {
  if (line.rtoInspections !== undefined && line.rtoInspections.length > 0) {
    return line.rtoInspections;
  }
  if (line.rtoCondition === null || line.rtoDisposition === null) return [];
  return [
    {
      quantity: line.quantity,
      condition: line.rtoCondition,
      disposition: line.rtoDisposition,
      notes: line.rtoInspectionNotes ?? null,
    },
  ];
}

/** Units per disposition on one line. */
export function quantitiesByDisposition(
  rows: readonly InspectionRow[],
): Readonly<Record<RtoDisposition, number>> {
  const out: Record<RtoDisposition, number> = {
    [RtoDisposition.RESTOCK]: 0,
    [RtoDisposition.WRITE_OFF]: 0,
    [RtoDisposition.INSPECT_LATER]: 0,
    [RtoDisposition.HOLD_DAMAGED]: 0,
  };
  for (const r of rows) out[r.disposition] += r.quantity;
  return out;
}

/** Does this disposition put the unit back into our stock (a RETURN_RESTOCK)? */
export function returnsToStock(disposition: RtoDisposition): boolean {
  switch (disposition) {
    case RtoDisposition.RESTOCK:
    case RtoDisposition.HOLD_DAMAGED:
      return true;
    case RtoDisposition.WRITE_OFF:
    case RtoDisposition.INSPECT_LATER:
      return false;
  }
}

/** Two row lists that say the same thing, compared in order. */
export function sameRows(a: readonly InspectionRow[], b: readonly InspectionRow[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((r, i) => {
    const o = b[i];
    return (
      o !== undefined &&
      r.quantity === o.quantity &&
      r.condition === o.condition &&
      r.disposition === o.disposition &&
      (r.notes ?? null) === (o.notes ?? null)
    );
  });
}

export interface RowSources {
  /** Index into the line's rows. */
  readonly rowIndex: number;
  readonly sources: readonly RestockSource[];
}

/**
 * Hand a line's resolved restock sources (largest first, summing to the
 * units coming back) to the rows that return units to stock, in ROW
 * ORDER. Deterministic: the same rows and sources always produce the
 * same split, so a retry lands every unit in the same place. A source
 * that straddles two rows is cut in two.
 *
 * Throws when the sources do not cover the rows exactly — finalize
 * resolved them for exactly that quantity, so a mismatch is a bug, not
 * something to paper over by restocking less.
 */
export function splitSourcesAcrossRows(
  rows: readonly InspectionRow[],
  sources: readonly RestockSource[],
): RowSources[] {
  const remaining: Array<{
    warehouseId: string;
    binId: string;
    batchId: string;
    quantity: number;
  }> = sources.map((s) => ({
    warehouseId: s.warehouseId,
    binId: s.binId,
    batchId: s.batchId,
    quantity: s.quantity,
  }));
  let cursor = 0;
  const out: RowSources[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    if (!returnsToStock(row.disposition)) continue;
    let needed = row.quantity;
    const taken: RestockSource[] = [];
    while (needed > 0) {
      const src = remaining[cursor];
      if (src === undefined) {
        throw new Error('splitSourcesAcrossRows: sources do not cover the rows');
      }
      const take = Math.min(needed, src.quantity);
      taken.push({ ...src, quantity: take });
      src.quantity -= take;
      needed -= take;
      if (src.quantity === 0) cursor += 1;
    }
    out.push({ rowIndex, sources: taken });
  }
  if (remaining.some((s, i) => i >= cursor && s.quantity > 0)) {
    throw new Error('splitSourcesAcrossRows: sources exceed the rows');
  }
  return out;
}
