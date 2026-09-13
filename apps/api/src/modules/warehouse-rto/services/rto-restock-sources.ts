/**
 * Where did a returned unit LEAVE our stock from? (2026-09-13)
 *
 * RTO finalize credits a RESTOCK line back with a `RETURN_RESTOCK +qty`
 * movement, and that movement needs a concrete (bin, batch). It used to
 * read `shipment_items.pickedBinId/pickedBatchId` and nothing else — an
 * OPERATIONAL HINT (WMS-9) written only by the retired per-parcel pick
 * station (`PickExecutionService.recordItem`). The everyday print-first
 * batch pick never wrote it, so every real return picked that way was
 * refused at finalize (`RTO_RESTOCK_MISSING_CONTEXT`): on production, 6 of
 * 13 lines on real packed parcels, all batch-picked, all unrestockable.
 *
 * The authoritative answer was always in the ledger. Under Model C
 * (CUR-3) the ONE lifecycle decrement is a `PACK_CONFIRM` movement per
 * phase-2 reservation, carrying the exact warehouse, bin and batch the
 * stock came off; `PACK_REVERSED` gives one back, naming it through
 * `metadata.reversesMovementId`. Pre-Model-C orders carry a `DISPATCH`
 * movement instead, which is the same fact written at a different edge.
 *
 * PRECEDENCE — the movement wins over the hint, always.
 *   The movement is where `stock_levels.qtyOnHand` was actually
 *   decremented. Crediting anywhere else leaves one (bin, batch) row short
 *   and another long by the same amount, forever — and the hint CAN
 *   differ: `recordItem` takes the bin/batch the picker typed or scanned,
 *   while PACK_CONFIRM takes the reservation's. A disagreement is reported
 *   (audit metadata + a warn), never refused: refusing would block a
 *   return because a picker pulled from the shelf next to the allocated
 *   one, which is a fact about the hint, not about the stock.
 *   The hint is used ONLY when the line has no pack evidence at all and a
 *   hint exists — the legacy path, kept so nothing that restocked before
 *   stops restocking now; it is flagged in the audit.
 *
 * A line with NEITHER a hint NOR net pack evidence never left stock
 * through Skydrop (seeded / imported data). Restocking it would ADD stock
 * that was never taken out, so it is refused by name
 * (`RTO_RESTOCK_NEVER_LEFT_STOCK`). A line whose quantity exceeds what
 * left for it is refused for the shortfall (`RTO_RESTOCK_EXCEEDS_STOCK_LEFT`)
 * rather than restocked in part — a partial restock would look finished.
 *
 * Matching: a movement is attributed to a line by `orderItemId` (always
 * set on PACK_CONFIRM — it is copied from the reservation); a movement
 * with no order item falls into a per-VARIANT pool that any line of that
 * variant may draw from. Pools are CONSUMED as lines draw on them, so two
 * lines can never both claim the same unit. Pure: no Prisma, no Nest, so
 * every case is testable without a database.
 */

export interface LeftStockMovement {
  readonly id: string;
  readonly warehouseId: string;
  readonly binId: string | null;
  readonly batchId: string | null;
  /** Negative for PACK_CONFIRM / DISPATCH (stock left). */
  readonly qtyChange: number;
  readonly orderItemId: string | null;
  readonly variantId: string;
}

export interface RestockLine {
  readonly shipmentItemId: string;
  readonly orderItemId: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly pickedBinId: string | null;
  readonly pickedBatchId: string | null;
}

export interface RestockSource {
  readonly warehouseId: string;
  readonly binId: string;
  readonly batchId: string;
  readonly quantity: number;
}

export type RestockSourceOrigin = 'PACK_MOVEMENT' | 'PICK_HINT';

export interface ResolvedRestockLine {
  readonly shipmentItemId: string;
  readonly origin: RestockSourceOrigin;
  /** Largest first; quantities sum to the line's quantity exactly. */
  readonly sources: readonly RestockSource[];
  /** Set when a hint exists and names a (bin, batch) no source used. */
  readonly hintDisagrees: boolean;
}

export interface RestockShortfall {
  readonly shipmentItemId: string;
  readonly quantity: number;
  readonly leftQuantity: number;
}

export interface RestockSourceResolution {
  readonly resolved: readonly ResolvedRestockLine[];
  /** No hint and no net pack evidence — never left stock through us. */
  readonly neverLeft: readonly string[];
  /** Some pack evidence, but less than the line's quantity. */
  readonly shortfalls: readonly RestockShortfall[];
}

interface PoolEntry {
  warehouseId: string;
  binId: string;
  batchId: string;
  remaining: number;
}

function poolKey(m: { warehouseId: string; binId: string; batchId: string }): string {
  return `${m.warehouseId}|${m.binId}|${m.batchId}`;
}

export function resolveRestockSources(input: {
  readonly lines: readonly RestockLine[];
  /** PACK_CONFIRM / DISPATCH movements for the ORDER (by orderId, CUR-3). */
  readonly leftMovements: readonly LeftStockMovement[];
  /** Ids named by PACK_REVERSED `metadata.reversesMovementId`. */
  readonly reversedMovementIds: ReadonlySet<string>;
  /** The shipment's origin warehouse — where a hint-only line is credited. */
  readonly originWarehouseId: string;
}): RestockSourceResolution {
  // Pools of what left, net of give-backs, keyed by order item (or by
  // variant when a movement names no order item).
  const pools = new Map<string, Map<string, PoolEntry>>();
  for (const m of input.leftMovements) {
    if (input.reversedMovementIds.has(m.id)) continue;
    if (m.binId === null || m.batchId === null) continue;
    if (m.qtyChange >= 0) continue;
    const owner = m.orderItemId !== null ? `oi:${m.orderItemId}` : `v:${m.variantId}`;
    let pool = pools.get(owner);
    if (pool === undefined) {
      pool = new Map();
      pools.set(owner, pool);
    }
    const loc = { warehouseId: m.warehouseId, binId: m.binId, batchId: m.batchId };
    const key = poolKey(loc);
    const entry = pool.get(key);
    if (entry !== undefined) entry.remaining += -m.qtyChange;
    else pool.set(key, { ...loc, remaining: -m.qtyChange });
  }

  const resolved: ResolvedRestockLine[] = [];
  const neverLeft: string[] = [];
  const shortfalls: RestockShortfall[] = [];

  for (const line of input.lines) {
    // The line's own order item first, then anything that named only
    // the variant. Largest first so a split line restocks as few rows as
    // possible; ties broken on the key so the result is deterministic.
    const candidates = [
      ...(pools.get(`oi:${line.orderItemId}`)?.values() ?? []),
      ...(pools.get(`v:${line.variantId}`)?.values() ?? []),
    ]
      .filter((e) => e.remaining > 0)
      .sort((a, b) => b.remaining - a.remaining || poolKey(a).localeCompare(poolKey(b)));
    const available = candidates.reduce((sum, e) => sum + e.remaining, 0);

    if (available === 0) {
      if (line.pickedBinId !== null && line.pickedBatchId !== null) {
        resolved.push({
          shipmentItemId: line.shipmentItemId,
          origin: 'PICK_HINT',
          sources: [
            {
              warehouseId: input.originWarehouseId,
              binId: line.pickedBinId,
              batchId: line.pickedBatchId,
              quantity: line.quantity,
            },
          ],
          hintDisagrees: false,
        });
      } else {
        neverLeft.push(line.shipmentItemId);
      }
      continue;
    }
    if (available < line.quantity) {
      shortfalls.push({
        shipmentItemId: line.shipmentItemId,
        quantity: line.quantity,
        leftQuantity: available,
      });
      continue;
    }

    let needed = line.quantity;
    const sources: RestockSource[] = [];
    for (const e of candidates) {
      if (needed === 0) break;
      const take = Math.min(needed, e.remaining);
      e.remaining -= take;
      needed -= take;
      const existing = sources.find((s) => poolKey(s) === poolKey(e));
      if (existing !== undefined) {
        sources[sources.indexOf(existing)] = { ...existing, quantity: existing.quantity + take };
      } else {
        sources.push({
          warehouseId: e.warehouseId,
          binId: e.binId,
          batchId: e.batchId,
          quantity: take,
        });
      }
    }

    const hintDisagrees =
      line.pickedBinId !== null &&
      line.pickedBatchId !== null &&
      !sources.some((s) => s.binId === line.pickedBinId && s.batchId === line.pickedBatchId);
    resolved.push({
      shipmentItemId: line.shipmentItemId,
      origin: 'PACK_MOVEMENT',
      sources,
      hintDisagrees,
    });
  }

  return { resolved, neverLeft, shortfalls };
}
