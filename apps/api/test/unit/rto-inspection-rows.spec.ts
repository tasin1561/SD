import { BinType, RtoDisposition, RtoItemCondition } from '@skydrop/db';
import {
  effectiveRows,
  quantitiesByDisposition,
  returnsToStock,
  sameRows,
  splitSourcesAcrossRows,
  summarizeRows,
  validateRows,
  type InspectionRow,
} from '../../src/modules/warehouse-rto/services/rto-inspection-rows';
import { NON_PICKABLE_BIN_TYPES } from '../../src/modules/inventory-shared/bin-policy.service';

/**
 * WMS-8d — a returned line inspected by quantity ("2 came back: one good,
 * one damaged"). Pure helpers, so every case runs without a database.
 */
const good = (
  quantity: number,
  disposition: RtoDisposition = RtoDisposition.RESTOCK,
): InspectionRow => ({
  quantity,
  condition: RtoItemCondition.GOOD,
  disposition,
  notes: null,
});
const damaged = (
  quantity: number,
  disposition: RtoDisposition = RtoDisposition.HOLD_DAMAGED,
): InspectionRow => ({
  quantity,
  condition: RtoItemCondition.DAMAGED,
  disposition,
  notes: null,
});

describe('validateRows', () => {
  it('accepts rows that cover the line exactly', () => {
    expect(validateRows(2, [good(1), damaged(1)])).toBeNull();
    expect(validateRows(1, [good(1)])).toBeNull();
  });

  it('refuses rows that leave units undecided, or decide units that are not there', () => {
    expect(validateRows(3, [good(1), damaged(1)])).toEqual({
      code: 'RTO_SPLIT_QUANTITY_MISMATCH',
      lineQuantity: 3,
      rowsQuantity: 2,
    });
    expect(validateRows(1, [good(1), damaged(1)])).toMatchObject({
      code: 'RTO_SPLIT_QUANTITY_MISMATCH',
    });
  });

  it('refuses an empty split and a row of zero or a fraction', () => {
    expect(validateRows(2, [])).toEqual({ code: 'RTO_SPLIT_EMPTY' });
    expect(validateRows(2, [good(2), damaged(0)])).toEqual({
      code: 'RTO_SPLIT_ROW_QUANTITY_INVALID',
      position: 2,
    });
    expect(validateRows(2, [good(1.5), damaged(0.5)])).toMatchObject({
      code: 'RTO_SPLIT_ROW_QUANTITY_INVALID',
    });
  });
});

describe('summarizeRows — the one value per line the old columns keep', () => {
  it('an unsplit line summarises as itself', () => {
    expect(summarizeRows([{ ...damaged(2, RtoDisposition.WRITE_OFF), notes: 'crushed' }])).toEqual({
      condition: RtoItemCondition.DAMAGED,
      disposition: RtoDisposition.WRITE_OFF,
      notes: 'crushed',
    });
  });

  it('a split line reads as its worst condition and most-open disposition', () => {
    // RESTOCK outranks HOLD_DAMAGED: a line with a unit going back to
    // sellable stock must be seen by putaway-style readers as restocking.
    expect(summarizeRows([good(1), damaged(1)])).toMatchObject({
      condition: RtoItemCondition.DAMAGED,
      disposition: RtoDisposition.RESTOCK,
    });
    // Anything undecided keeps the whole line undecided.
    expect(summarizeRows([good(1), damaged(1, RtoDisposition.INSPECT_LATER)]).disposition).toBe(
      RtoDisposition.INSPECT_LATER,
    );
    // Held aside outranks written off.
    expect(summarizeRows([damaged(1, RtoDisposition.WRITE_OFF), damaged(1)]).disposition).toBe(
      RtoDisposition.HOLD_DAMAGED,
    );
    expect(
      summarizeRows([
        damaged(1),
        { ...good(1), condition: RtoItemCondition.MISSING, disposition: RtoDisposition.WRITE_OFF },
      ]).condition,
    ).toBe(RtoItemCondition.MISSING);
  });

  it('joins distinct row notes', () => {
    expect(
      summarizeRows([
        { ...good(1), notes: 'sealed' },
        { ...damaged(1), notes: 'cracked lens' },
      ]).notes,
    ).toBe('sealed · cracked lens');
  });
});

describe('effectiveRows', () => {
  it('stored rows win', () => {
    const rows = [good(1), damaged(1)];
    expect(
      effectiveRows({
        quantity: 2,
        rtoCondition: RtoItemCondition.DAMAGED,
        rtoDisposition: RtoDisposition.RESTOCK,
        rtoInspections: rows,
      }),
    ).toBe(rows);
  });

  it('a line inspected before rows existed is ONE row covering its whole quantity', () => {
    expect(
      effectiveRows({
        quantity: 3,
        rtoCondition: RtoItemCondition.GOOD,
        rtoDisposition: RtoDisposition.RESTOCK,
        rtoInspectionNotes: 'ok',
      }),
    ).toEqual([
      {
        quantity: 3,
        condition: RtoItemCondition.GOOD,
        disposition: RtoDisposition.RESTOCK,
        notes: 'ok',
      },
    ]);
  });

  it('an uninspected line has no rows', () => {
    expect(effectiveRows({ quantity: 2, rtoCondition: null, rtoDisposition: null })).toEqual([]);
  });
});

describe('quantitiesByDisposition / returnsToStock / sameRows', () => {
  it('counts units, not rows', () => {
    expect(quantitiesByDisposition([good(2), damaged(1), good(1)])).toEqual({
      [RtoDisposition.RESTOCK]: 3,
      [RtoDisposition.HOLD_DAMAGED]: 1,
      [RtoDisposition.WRITE_OFF]: 0,
      [RtoDisposition.INSPECT_LATER]: 0,
    });
  });

  it('RESTOCK and HOLD_DAMAGED put units back into stock; the others do not', () => {
    expect(returnsToStock(RtoDisposition.RESTOCK)).toBe(true);
    expect(returnsToStock(RtoDisposition.HOLD_DAMAGED)).toBe(true);
    expect(returnsToStock(RtoDisposition.WRITE_OFF)).toBe(false);
    expect(returnsToStock(RtoDisposition.INSPECT_LATER)).toBe(false);
  });

  it('a different split is a different finding', () => {
    expect(sameRows([good(2)], [good(2)])).toBe(true);
    expect(sameRows([good(2)], [good(1), damaged(1)])).toBe(false);
    expect(sameRows([good(1), damaged(1)], [damaged(1), good(1)])).toBe(false);
  });
});

describe('splitSourcesAcrossRows — deterministic, row order', () => {
  const src = (binId: string, quantity: number) => ({
    warehouseId: 'wh',
    binId,
    batchId: `bat-${binId}`,
    quantity,
  });

  it('hands sources to the returning rows in row order, skipping write-offs', () => {
    const rows = [good(1), damaged(1, RtoDisposition.WRITE_OFF), damaged(1)];
    expect(splitSourcesAcrossRows(rows, [src('A', 2)])).toEqual([
      { rowIndex: 0, sources: [src('A', 1)] },
      { rowIndex: 2, sources: [src('A', 1)] },
    ]);
  });

  it('cuts a source that straddles two rows', () => {
    expect(splitSourcesAcrossRows([good(2), damaged(2)], [src('A', 3), src('B', 1)])).toEqual([
      { rowIndex: 0, sources: [src('A', 2)] },
      { rowIndex: 1, sources: [src('A', 1), src('B', 1)] },
    ]);
  });

  it('throws when the sources do not cover the rows exactly — never restocks less', () => {
    expect(() => splitSourcesAcrossRows([good(2)], [src('A', 1)])).toThrow(/do not cover/);
    expect(() => splitSourcesAcrossRows([good(1)], [src('A', 2)])).toThrow(/exceed/);
  });
});

describe('the DAMAGED bin a kept-aside unit lands in is never sellable (BIN-2)', () => {
  it('DAMAGED is in the one shared non-pickable list', () => {
    expect(NON_PICKABLE_BIN_TYPES).toContain(BinType.DAMAGED);
  });
});
