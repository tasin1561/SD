import { Injectable } from '@nestjs/common';
import { BatchStatus, BinType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/** Bins whose stock is NOT pickable for customer orders. */
const NON_PICKABLE_BIN_TYPES: BinType[] = [
  BinType.RTO_HOLD,
  BinType.DAMAGED,
  BinType.QUARANTINE,
];

export interface AllocationPick {
  binId: string;
  batchId: string;
  qty: number;
}

export type AllocationStrategy = 'SINGLE_BATCH' | 'SPLIT' | 'PARTIAL' | 'NONE';

export interface AllocationPlan {
  sellerId: string;
  variantId: string;
  warehouseId: string;
  qtyRequired: number;
  picks: AllocationPick[];
  allocatedQty: number;
  shortfall: number;
  fullyAllocated: boolean;
  strategy: AllocationStrategy;
}

interface LevelRow {
  binId: string;
  batchId: string;
  avail: number;
  binPickOrder: number;
  binCode: string;
}

interface BatchGroup {
  batchId: string;
  expiresAt: Date | null;
  receivedAt: Date;
  avail: number;
  levels: LevelRow[];
}

/**
 * Pure allocation PLANNER (read-only — commit 14 applies the plan and
 * does the phase-2 writes). Locked decision #8: FEFO + single-batch
 * fulfillment preference.
 *
 * Algorithm (the rule that satisfies all three spec test cases):
 *
 *  1. Eligible stock = (seller,variant,warehouse) stock_levels with
 *     batch ACTIVE/non-deleted and bin NOT in RTO_HOLD/DAMAGED/QUARANTINE.
 *     Per-level allocatable = qtyOnHand − stock_levels.qtyReserved
 *     (phase-2 holds; phase-1 floats don't reduce physical availability).
 *  2. Group by batch; order batches FEFO:
 *     expiresAt ASC NULLS LAST, then receivedAt ASC (CLAUDE rule #5).
 *  3. WINDOW = the minimal FEFO prefix of batches whose cumulative
 *     availability ≥ qtyRequired (all batches if the total is short).
 *     Later-expiring batches outside the window are NOT considered — the
 *     point of FEFO is to move soonest-expiring stock first.
 *  4. SINGLE-BATCH preference: if any single batch *within the window*
 *     can cover the whole line, take the FEFO-earliest such batch.
 *  5. Otherwise SPLIT oldest-first across the window batches.
 *  6. Within a chosen batch, draw from its bins ordered by zone
 *     pickOrder, then bin code (deterministic, pick-path friendly).
 *
 * Worked: B1(exp6/1,5) B2(exp7/1,100) B3(exp8/1,50)
 *   - need 7 → window {B1,B2}; B2 covers alone → SINGLE_BATCH B2
 *   - need 4 → window {B1};  B1 covers alone → SINGLE_BATCH B1
 *  B1(exp6/1,5) B2(exp7/1,3) B3(exp8/1,50)
 *   - need 7 → window {B1,B2} (cum 8≥7; B3 never considered); no single
 *     covers → SPLIT 5·B1 + 2·B2
 */
@Injectable()
export class StockPickAllocationService {
  constructor(private readonly prisma: PrismaService) {}

  async allocateForOrderLine(input: {
    sellerId: string;
    variantId: string;
    warehouseId: string;
    qtyRequired: number;
  }): Promise<AllocationPlan> {
    const { sellerId, variantId, warehouseId, qtyRequired } = input;
    const base: Omit<AllocationPlan, 'picks' | 'allocatedQty' | 'shortfall' | 'fullyAllocated' | 'strategy'> =
      { sellerId, variantId, warehouseId, qtyRequired };

    if (!Number.isInteger(qtyRequired) || qtyRequired <= 0) {
      return { ...base, picks: [], allocatedQty: 0, shortfall: qtyRequired, fullyAllocated: false, strategy: 'NONE' };
    }

    const batches = await this.loadEligibleBatches(sellerId, variantId, warehouseId);
    if (batches.length === 0) {
      return { ...base, picks: [], allocatedQty: 0, shortfall: qtyRequired, fullyAllocated: false, strategy: 'NONE' };
    }

    // FEFO order.
    batches.sort(fefo);

    // Minimal FEFO prefix whose cumulative availability covers the line.
    const window: BatchGroup[] = [];
    let cum = 0;
    for (const b of batches) {
      window.push(b);
      cum += b.avail;
      if (cum >= qtyRequired) break;
    }
    const windowTotal = window.reduce((s, b) => s + b.avail, 0);

    // Single-batch preference (FEFO-earliest qualifying batch in window).
    const single = window.find((b) => b.avail >= qtyRequired);
    if (single) {
      return {
        ...base,
        picks: this.drawFromBatch(single, qtyRequired),
        allocatedQty: qtyRequired,
        shortfall: 0,
        fullyAllocated: true,
        strategy: 'SINGLE_BATCH',
      };
    }

    // Split oldest-first across the window.
    const picks: AllocationPick[] = [];
    let remaining = qtyRequired;
    for (const b of window) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, b.avail);
      picks.push(...this.drawFromBatch(b, take));
      remaining -= take;
    }
    const allocatedQty = qtyRequired - remaining;
    const fullyAllocated = remaining === 0 && windowTotal >= qtyRequired;
    return {
      ...base,
      picks,
      allocatedQty,
      shortfall: qtyRequired - allocatedQty,
      fullyAllocated,
      strategy: fullyAllocated ? 'SPLIT' : 'PARTIAL',
    };
  }

  // ---------- internal ----------

  private async loadEligibleBatches(
    sellerId: string,
    variantId: string,
    warehouseId: string,
  ): Promise<BatchGroup[]> {
    const levels = await this.prisma.client.stockLevel.findMany({
      where: {
        sellerId,
        variantId,
        warehouseId,
        qtyOnHand: { gt: 0 },
        bin: { type: { notIn: NON_PICKABLE_BIN_TYPES }, deletedAt: null },
        batch: { status: BatchStatus.ACTIVE, deletedAt: null },
      },
      select: {
        binId: true,
        batchId: true,
        qtyOnHand: true,
        qtyReserved: true,
        bin: { select: { code: true, zone: { select: { pickOrder: true } } } },
        batch: { select: { expiresAt: true, receivedAt: true } },
      },
    });

    const groups = new Map<string, BatchGroup>();
    for (const l of levels) {
      const avail = l.qtyOnHand - l.qtyReserved;
      if (avail <= 0) continue;
      let g = groups.get(l.batchId);
      if (!g) {
        g = {
          batchId: l.batchId,
          expiresAt: l.batch.expiresAt,
          receivedAt: l.batch.receivedAt,
          avail: 0,
          levels: [],
        };
        groups.set(l.batchId, g);
      }
      g.avail += avail;
      g.levels.push({
        binId: l.binId,
        batchId: l.batchId,
        avail,
        binPickOrder: l.bin.zone?.pickOrder ?? 100,
        binCode: l.bin.code,
      });
    }
    return [...groups.values()];
  }

  /** Draw `qty` from one batch, across its bins (zone pickOrder, then bin
   *  code). Assumes qty ≤ batch.avail (caller guarantees). */
  private drawFromBatch(batch: BatchGroup, qty: number): AllocationPick[] {
    const ordered = [...batch.levels].sort(
      (a, b) => a.binPickOrder - b.binPickOrder || a.binCode.localeCompare(b.binCode),
    );
    const picks: AllocationPick[] = [];
    let remaining = qty;
    for (const lvl of ordered) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, lvl.avail);
      if (take <= 0) continue;
      picks.push({ binId: lvl.binId, batchId: batch.batchId, qty: take });
      remaining -= take;
    }
    return picks;
  }
}

/** expiresAt ASC NULLS LAST, then receivedAt ASC. */
function fefo(a: BatchGroup, b: BatchGroup): number {
  if (a.expiresAt === null && b.expiresAt !== null) return 1;
  if (a.expiresAt !== null && b.expiresAt === null) return -1;
  if (a.expiresAt !== null && b.expiresAt !== null) {
    const d = a.expiresAt.getTime() - b.expiresAt.getTime();
    if (d !== 0) return d;
  }
  return a.receivedAt.getTime() - b.receivedAt.getTime();
}
