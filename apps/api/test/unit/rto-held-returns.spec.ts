import { RtoDisposition, RtoItemCondition, StockMovementReasonCode } from '@skydrop/db';
import {
  heldByLine,
  heldQuantity,
  splitHeldAcrossRows,
  writeOffReasonCode,
  type HeldMovement,
  type HeldSource,
} from '../../src/modules/warehouse-rto/services/rto-held-returns';
import type { InspectionRow } from '../../src/modules/warehouse-rto/services/rto-inspection-rows';

/**
 * WMS-8e — what receive booked into the returns hold, read back per line and
 * handed to the inspection rows at finalize. Pure, so every case is cheap.
 */

function booked(over: Partial<HeldMovement> & { line?: string; leftFrom?: string } = {}) {
  const { line = 'si-1', leftFrom = 'bin-shelf', ...rest } = over;
  return {
    warehouseId: 'wh-1',
    binId: 'bin-hold',
    batchId: 'bat-1',
    qtyChange: 2,
    metadata: {
      shipmentItemId: line,
      leftFromWarehouseId: 'wh-1',
      leftFromBinId: leftFrom,
      leftFromBatchId: 'bat-1',
    },
    ...rest,
  } satisfies HeldMovement;
}

function row(
  quantity: number,
  disposition: RtoDisposition,
  condition: RtoItemCondition = RtoItemCondition.GOOD,
): InspectionRow {
  return { quantity, condition, disposition, notes: null };
}

function held(sources: Array<Partial<HeldSource>>): HeldSource[] {
  return sources.map((s) => ({
    warehouseId: 'wh-1',
    binId: 'bin-hold',
    batchId: 'bat-1',
    quantity: 1,
    leftFromBinIds: [],
    ...s,
  }));
}

describe('heldByLine', () => {
  it('groups a shipment’s receive bookings per line and per (bin, batch), largest first', () => {
    const map = heldByLine([
      booked({ line: 'si-1', batchId: 'bat-A', qtyChange: 1, leftFrom: 'shelf-A' }),
      booked({ line: 'si-1', batchId: 'bat-B', qtyChange: 3, leftFrom: 'shelf-B' }),
      booked({ line: 'si-1', batchId: 'bat-A', qtyChange: 1, leftFrom: 'shelf-A2' }),
      booked({ line: 'si-2', qtyChange: 2 }),
    ]);
    expect(map.get('si-1')).toEqual([
      expect.objectContaining({ batchId: 'bat-B', quantity: 3, leftFromBinIds: ['shelf-B'] }),
      expect.objectContaining({
        batchId: 'bat-A',
        quantity: 2,
        leftFromBinIds: ['shelf-A', 'shelf-A2'],
      }),
    ]);
    expect(heldQuantity(map.get('si-1') ?? [])).toBe(5);
    expect(heldQuantity(map.get('si-2') ?? [])).toBe(2);
  });

  it('a movement naming no line is not a booking of any line', () => {
    const map = heldByLine([booked({ metadata: null }), booked({ metadata: { other: 1 } })]);
    expect(map.size).toBe(0);
  });
});

describe('splitHeldAcrossRows', () => {
  it('an unsplit restocked line takes all of its held units', () => {
    const { allocations, leftover } = splitHeldAcrossRows(
      [row(2, RtoDisposition.RESTOCK)],
      held([{ quantity: 2 }]),
    );
    expect(allocations).toEqual([
      { rowIndex: 0, sources: [expect.objectContaining({ quantity: 2 })] },
    ]);
    expect(leftover).toBe(0);
  });

  it('1 RESTOCK + 1 HOLD_DAMAGED: one unit each, in row order', () => {
    const { allocations } = splitHeldAcrossRows(
      [
        row(1, RtoDisposition.RESTOCK),
        row(1, RtoDisposition.HOLD_DAMAGED, RtoItemCondition.DAMAGED),
      ],
      held([{ quantity: 2 }]),
    );
    expect(allocations.map((a) => [a.rowIndex, heldQuantity(a.sources)])).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });

  it('returning rows are served before a write-off row that comes first', () => {
    // One unit booked for a line of two: the restocked unit must be covered,
    // and the written-off one (which never came back through us) takes
    // nothing — there is nothing of it in the hold to remove.
    const { allocations, leftover } = splitHeldAcrossRows(
      [row(1, RtoDisposition.WRITE_OFF, RtoItemCondition.MISSING), row(1, RtoDisposition.RESTOCK)],
      held([{ quantity: 1 }]),
    );
    expect(allocations).toEqual([
      { rowIndex: 1, sources: [expect.objectContaining({ quantity: 1 })] },
    ]);
    expect(leftover).toBe(0);
  });

  it('a write-off row takes its booked units out of the hold', () => {
    const { allocations } = splitHeldAcrossRows(
      [row(2, RtoDisposition.WRITE_OFF, RtoItemCondition.DAMAGED)],
      held([{ quantity: 2 }]),
    );
    expect(allocations).toEqual([
      { rowIndex: 0, sources: [expect.objectContaining({ quantity: 2 })] },
    ]);
  });

  it('a source straddling two rows is cut, deterministically', () => {
    const { allocations } = splitHeldAcrossRows(
      [row(2, RtoDisposition.RESTOCK), row(2, RtoDisposition.HOLD_DAMAGED)],
      held([
        { batchId: 'bat-A', quantity: 3 },
        { batchId: 'bat-B', quantity: 1 },
      ]),
    );
    expect(allocations[0]?.sources.map((s) => [s.batchId, s.quantity])).toEqual([['bat-A', 2]]);
    expect(allocations[1]?.sources.map((s) => [s.batchId, s.quantity])).toEqual([
      ['bat-A', 1],
      ['bat-B', 1],
    ]);
  });

  it('throws when the held units cannot cover the returning rows (finalize refuses first)', () => {
    expect(() =>
      splitHeldAcrossRows([row(2, RtoDisposition.RESTOCK)], held([{ quantity: 1 }])),
    ).toThrow(/do not cover/);
  });

  it('reports held stock no row claims, rather than moving it', () => {
    const { leftover } = splitHeldAcrossRows(
      [row(1, RtoDisposition.RESTOCK)],
      held([{ quantity: 3 }]),
    );
    expect(leftover).toBe(2);
  });
});

describe('writeOffReasonCode (INV-7)', () => {
  it('maps what the inspector found to the adjustment reason', () => {
    expect(writeOffReasonCode(RtoItemCondition.DAMAGED)).toBe(
      StockMovementReasonCode.DAMAGED_IN_WAREHOUSE,
    );
    expect(writeOffReasonCode(RtoItemCondition.MISSING)).toBe(StockMovementReasonCode.LOST);
    expect(writeOffReasonCode(RtoItemCondition.GOOD)).toBe(StockMovementReasonCode.OTHER);
  });
});
