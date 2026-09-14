import { RtoDisposition, RtoItemCondition, StockMovementReasonCode } from '@skydrop/db';
import { returnsToStock, type InspectionRow } from './rto-inspection-rows';

/**
 * WMS-8e (2026-09-14) — a return is BOOKED at receive and MOVED at finalize.
 *
 * Owner: "R-01-01 should hold products that are received but not decided
 * yet or will decide later. Then Put back in stock goes to floor. D-01-01
 * (damaged) for damaged." So `RtoReceiptService.receive` books each line's
 * units into the receiving warehouse's RTO_HOLD bin with a
 * `RETURN_RECEIVE` +qty movement, and finalize moves them OUT of the hold:
 * a transfer to a sellable bin (RESTOCK) or to the DAMAGED bin
 * (HOLD_DAMAGED), or an `ADJUSTMENT_DECREASE` (WRITE_OFF).
 *
 * These helpers turn the stored `RETURN_RECEIVE` movements back into "what
 * is sitting in hold for this line, and where", and hand that to the
 * inspection rows. PURE: no Prisma, no Nest.
 */

/** A `RETURN_RECEIVE` movement as finalize reads it back. */
export interface HeldMovement {
  readonly warehouseId: string;
  readonly binId: string | null;
  readonly batchId: string | null;
  readonly qtyChange: number;
  readonly metadata: unknown;
}

/** Units of one line sitting in one (hold bin, batch). */
export interface HeldSource {
  readonly warehouseId: string;
  readonly binId: string;
  readonly batchId: string;
  readonly quantity: number;
  /** Where these units originally LEFT stock (PACK_CONFIRM's bin) — the
   *  shelf a restock goes back to when bin tracking is on. */
  readonly leftFromBinIds: readonly string[];
}

/** What a receive booking writes into `metadata`, and reads back here. */
export interface ReceiveBookingMetadata {
  readonly shipmentItemId: string;
  readonly leftFromWarehouseId: string;
  readonly leftFromBinId: string;
  readonly leftFromBatchId: string;
}

function readMeta(metadata: unknown): Partial<ReceiveBookingMetadata> {
  if (metadata === null || typeof metadata !== 'object') return {};
  return metadata as Partial<ReceiveBookingMetadata>;
}

/**
 * The receive bookings of one shipment, per LINE, grouped by (warehouse,
 * bin, batch), largest first. A line absent from the map was not booked at
 * receive — received before WMS-8e, received where there was no hold bin,
 * or a line that never left our stock — and finalizes the pre-WMS-8e way.
 */
export function heldByLine(movements: readonly HeldMovement[]): Map<string, HeldSource[]> {
  const byLine = new Map<string, Map<string, HeldSource>>();
  for (const m of movements) {
    const meta = readMeta(m.metadata);
    const line = meta.shipmentItemId;
    if (typeof line !== 'string' || m.binId === null || m.batchId === null) continue;
    if (m.qtyChange <= 0) continue;
    const key = `${m.warehouseId}|${m.binId}|${m.batchId}`;
    let pool = byLine.get(line);
    if (pool === undefined) {
      pool = new Map();
      byLine.set(line, pool);
    }
    const prior = pool.get(key);
    const leftFrom = typeof meta.leftFromBinId === 'string' ? [meta.leftFromBinId] : [];
    pool.set(key, {
      warehouseId: m.warehouseId,
      binId: m.binId,
      batchId: m.batchId,
      quantity: (prior?.quantity ?? 0) + m.qtyChange,
      leftFromBinIds: [...new Set([...(prior?.leftFromBinIds ?? []), ...leftFrom])],
    });
  }
  const out = new Map<string, HeldSource[]>();
  for (const [line, pool] of byLine) {
    out.set(
      line,
      [...pool.values()].sort(
        (a, b) =>
          b.quantity - a.quantity ||
          `${a.warehouseId}|${a.binId}|${a.batchId}`.localeCompare(
            `${b.warehouseId}|${b.binId}|${b.batchId}`,
          ),
      ),
    );
  }
  return out;
}

export function heldQuantity(sources: readonly HeldSource[]): number {
  return sources.reduce((sum, s) => sum + s.quantity, 0);
}

export interface RowHeld {
  /** Index into the line's rows. */
  readonly rowIndex: number;
  readonly sources: readonly HeldSource[];
}

/**
 * Hand a booked line's held units to its inspection rows.
 *
 * Rows that come back into our stock (RESTOCK, HOLD_DAMAGED) are served
 * FIRST, in row order, and must be covered in full — finalize has already
 * refused (`RTO_RESTOCK_EXCEEDS_STOCK_LEFT`) when they cannot be, so a
 * shortfall here is a bug and throws. WRITE_OFF rows then take what is left,
 * up to their quantity: a written-off unit that was booked leaves the hold
 * by an adjustment, and one that was never booked (it never left our stock
 * through us) has nothing to remove. Deterministic, so a retry lands every
 * unit in the same place. `leftover` is held stock no row claimed — zero
 * whenever the booking was no larger than the line.
 */
export function splitHeldAcrossRows(
  rows: readonly InspectionRow[],
  held: readonly HeldSource[],
): { allocations: RowHeld[]; leftover: number } {
  const pool = held.map((s) => ({ ...s, remaining: s.quantity }));
  let cursor = 0;
  const take = (wanted: number): HeldSource[] => {
    let needed = wanted;
    const taken: HeldSource[] = [];
    while (needed > 0) {
      const src = pool[cursor];
      if (src === undefined) break;
      const n = Math.min(needed, src.remaining);
      if (n > 0) {
        taken.push({
          warehouseId: src.warehouseId,
          binId: src.binId,
          batchId: src.batchId,
          quantity: n,
          leftFromBinIds: src.leftFromBinIds,
        });
        src.remaining -= n;
        needed -= n;
      }
      if (src.remaining === 0) cursor += 1;
    }
    return taken;
  };

  const byRow = new Map<number, HeldSource[]>();
  for (const [rowIndex, row] of rows.entries()) {
    if (!returnsToStock(row.disposition)) continue;
    const sources = take(row.quantity);
    if (heldQuantity(sources) !== row.quantity) {
      throw new Error('splitHeldAcrossRows: held units do not cover the returning rows');
    }
    byRow.set(rowIndex, sources);
  }
  for (const [rowIndex, row] of rows.entries()) {
    if (row.disposition !== RtoDisposition.WRITE_OFF) continue;
    const sources = take(row.quantity);
    if (sources.length > 0) byRow.set(rowIndex, sources);
  }
  const allocations = [...byRow.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rowIndex, sources]) => ({ rowIndex, sources }));
  const leftover = pool.reduce((sum, s) => sum + s.remaining, 0);
  return { allocations, leftover };
}

/**
 * INV-7: a write-off out of the returns hold carries a reason, mapped from
 * what the inspector found. F2-exhaustive — a new condition fails to compile
 * until somebody decides what it means for stock.
 */
export function writeOffReasonCode(condition: RtoItemCondition): StockMovementReasonCode {
  switch (condition) {
    case RtoItemCondition.DAMAGED:
      return StockMovementReasonCode.DAMAGED_IN_WAREHOUSE;
    case RtoItemCondition.MISSING:
      return StockMovementReasonCode.LOST;
    case RtoItemCondition.GOOD:
      return StockMovementReasonCode.OTHER;
  }
}
