import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  BatchStatus,
  BinType,
  ReservationStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';

/** Phase-2 populate lost the qtyReserved CAS race — retry the whole
 *  plan+apply with freshly-read state. */
class RetryablePickConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryablePickConflictError';
  }
}

const MAX_POPULATE_ATTEMPTS = 3;

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

export interface AppliedAllocation {
  reservationId: string;
  strategy: AllocationStrategy;
  allocatedQty: number;
  shortfall: number;
  /** Reservation ids now carrying phase-2 (bin+batch) holds. */
  phase2ReservationIds: string[];
  /** Residual phase-1 reservation id holding the unallocated shortfall,
   *  if any (so total reserved qty is conserved). */
  residualReservationId: string | null;
  alreadyAllocated: boolean;
}

export interface ReleasedAllocation {
  reservationId: string;
  /** The single ACTIVE phase-1 row the holds collapsed back into. */
  phase1ReservationId: string;
  /** Phase-2 qty returned to a phase-1 float (= the qtyReserved given
   *  back on stock_levels). */
  releasedQty: number;
  /** true ⇒ already phase-1, untouched (idempotent no-op). */
  alreadyPhase1: boolean;
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
 *
 * ── SANCTIONED CROSS-MODULE API (Module 8) ─────────────────────────────
 *
 * allocateForOrderLine({sellerId,variantId,warehouseId,qtyRequired}):
 *     AllocationPlan
 *   PURE, READ-ONLY planner/preview — no writes, no reservation needed.
 *   Returns the FEFO/single-batch/split plan (or PARTIAL/NONE if short).
 *
 * allocateAndPopulate(reservationId, actor?): AppliedAllocation
 *   The phase-1 → phase-2 transition Module 8 calls at pick-task
 *   generation for an existing ACTIVE phase-1 reservation.
 *
 *   FULL-CONSUME ONLY: it ALWAYS plans for the FULL reservation qty
 *   (reservation.qtyReserved). There is NO partial-qty parameter and
 *   partial picks (qty < reservation.qty) are NOT supported in Phase 1A.
 *   When the physically allocatable qty is short, it allocates what it
 *   can (phase-2 rows) and the UN-allocated remainder stays as a RESIDUAL
 *   PHASE-1 row (binId/batchId NULL) so the total reserved qty is
 *   CONSERVED (= the original phase-1 qty). The conservation invariant is
 *   therefore non-trivial: original phase-1 row → first pick; extra picks
 *   → new ACTIVE phase-2 rows; shortfall → residual phase-1 row;
 *   Σ(new rows) = allocatedQty + shortfall = original qty. Idempotent
 *   (already-phase-2 returns untouched). HARD physical guard:
 *   version-CAS on stock_levels (≤3 attempts → 409
 *   PICK_ALLOCATION_CONFLICT). Module 8 owns operational escalation of a
 *   persistent shortfall.
 *
 * releaseAllocation(reservationId, actor?): ReleasedAllocation
 *   The INVERSE of allocateAndPopulate — Module 8 calls this on pick
 *   abandonment / 4h pick-timeout (WMS-5) to undo the phase-1 → phase-2
 *   split so the line is cleanly re-pickable. Collapses ALL ACTIVE
 *   reservation rows for the line's (orderId, orderItemId) group back
 *   into a SINGLE ACTIVE phase-1 row (bin/batch NULL) of the conserved
 *   total qty, deleting the transient extra rows, and gives the phase-2
 *   holds back to stock_levels.qtyReserved via the CLAMPED monotonic
 *   decrement (INV-4 — no version-CAS needed for a give-back, exactly
 *   mirroring StockReservationService.release/fulfill). Conservation:
 *   Σ(group rows) is preserved (= the original phase-1 qty), so INV-3
 *   availability is unchanged. Idempotent: a group with no phase-2 rows
 *   returns alreadyPhase1:true untouched. 404/409 mirror
 *   allocateAndPopulate. Expand-by-need on the M5 boundary (same
 *   precedent as StockReservationService.listActiveForOrder).
 * ───────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class StockPickAllocationService {
  private readonly logger = new Logger(StockPickAllocationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

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

  /**
   * Phase-1 → phase-2. Module 8 calls this at pick-task generation for an
   * existing ACTIVE phase-1 reservation (NULL bin/batch). It plans the
   * allocation, then in ONE transaction:
   *
   *  - version-guarded increment of stock_levels.qtyReserved for every
   *    pick (capacity-checked: qtyOnHand − qtyReserved ≥ pick.qty). The
   *    shared stock_levels.version is the CAS token (locked decision #9) —
   *    this is the HARD physical guard that phase-1's soft check defers to.
   *    A lost race re-plans with fresh state (≤3 attempts → 409).
   *  - the original phase-1 row becomes the first pick (bin+batch set);
   *    extra picks become new ACTIVE phase-2 rows; any shortfall stays as
   *    a residual phase-1 row. Total reserved qty is CONSERVED (= the
   *    original phase-1 qty), so INV-3 availability is unchanged by the
   *    conversion while INV-4's stock_levels.qtyReserved rises by exactly
   *    the allocated qty.
   *
   * Idempotent: a reservation already carrying bin+batch returns untouched.
   */
  async allocateAndPopulate(
    reservationId: string,
    actor: { type: ActorType; id?: string | null } = { type: ActorType.SYSTEM },
  ): Promise<AppliedAllocation> {
    const resv = await this.prisma.client.stockReservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        sellerId: true,
        variantId: true,
        warehouseId: true,
        binId: true,
        batchId: true,
        qtyReserved: true,
        orderId: true,
        orderItemId: true,
        status: true,
        expiresAt: true,
      },
    });
    if (!resv) {
      throw new NotFoundException({
        code: 'RESERVATION_NOT_FOUND',
        message: 'Reservation not found',
      });
    }
    if (resv.status !== ReservationStatus.ACTIVE) {
      throw new ConflictException({
        code: 'RESERVATION_NOT_ACTIVE',
        message: `Reservation is ${resv.status}, cannot allocate`,
      });
    }
    if (resv.binId !== null && resv.batchId !== null) {
      // Already phase-2 — idempotent.
      return {
        reservationId,
        strategy: 'SINGLE_BATCH',
        allocatedQty: resv.qtyReserved,
        shortfall: 0,
        phase2ReservationIds: [resv.id],
        residualReservationId: null,
        alreadyAllocated: true,
      };
    }

    const need = resv.qtyReserved;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_POPULATE_ATTEMPTS; attempt += 1) {
      const plan = await this.allocateForOrderLine({
        sellerId: resv.sellerId,
        variantId: resv.variantId,
        warehouseId: resv.warehouseId,
        qtyRequired: need,
      });
      if (plan.allocatedQty === 0) {
        // Nothing pickable right now — leave the phase-1 claim intact for
        // a later retry (stock may arrive). Not an error.
        return {
          reservationId,
          strategy: 'NONE',
          allocatedQty: 0,
          shortfall: need,
          phase2ReservationIds: [],
          residualReservationId: resv.id,
          alreadyAllocated: false,
        };
      }

      try {
        return await this.prisma.client.$transaction(async (tx) => {
          // 1. Hard physical guard: version-guarded qtyReserved increments.
          for (const pick of plan.picks) {
            const lvl = await tx.stockLevel.findUnique({
              where: {
                sellerId_variantId_warehouseId_binId_batchId: {
                  sellerId: resv.sellerId,
                  variantId: resv.variantId,
                  warehouseId: resv.warehouseId,
                  binId: pick.binId,
                  batchId: pick.batchId,
                },
              },
              select: { id: true, qtyOnHand: true, qtyReserved: true, version: true },
            });
            if (!lvl || lvl.qtyOnHand - lvl.qtyReserved < pick.qty) {
              throw new RetryablePickConflictError(
                `level capacity changed for bin ${pick.binId} batch ${pick.batchId}`,
              );
            }
            const upd = await tx.stockLevel.updateMany({
              where: { id: lvl.id, version: lvl.version },
              data: {
                qtyReserved: { increment: pick.qty },
                version: { increment: 1 },
              },
            });
            if (upd.count !== 1) {
              throw new RetryablePickConflictError(
                `stock_level ${lvl.id} version moved`,
              );
            }
          }

          // 2. Convert reservation rows (conserve total reserved qty).
          const phase2Ids: string[] = [];
          const [first, ...rest] = plan.picks;
          if (first) {
            await tx.stockReservation.update({
              where: { id: resv.id },
              data: { binId: first.binId, batchId: first.batchId, qtyReserved: first.qty },
            });
            phase2Ids.push(resv.id);
          }
          for (const pick of rest) {
            const created = await tx.stockReservation.create({
              data: {
                sellerId: resv.sellerId,
                variantId: resv.variantId,
                warehouseId: resv.warehouseId,
                binId: pick.binId,
                batchId: pick.batchId,
                qtyReserved: pick.qty,
                orderId: resv.orderId,
                orderItemId: resv.orderItemId,
                status: ReservationStatus.ACTIVE,
                expiresAt: resv.expiresAt,
              },
              select: { id: true },
            });
            phase2Ids.push(created.id);
          }

          let residualReservationId: string | null = null;
          if (plan.shortfall > 0) {
            const residual = await tx.stockReservation.create({
              data: {
                sellerId: resv.sellerId,
                variantId: resv.variantId,
                warehouseId: resv.warehouseId,
                binId: null,
                batchId: null,
                qtyReserved: plan.shortfall,
                orderId: resv.orderId,
                orderItemId: resv.orderItemId,
                status: ReservationStatus.ACTIVE,
                expiresAt: resv.expiresAt,
              },
              select: { id: true },
            });
            residualReservationId = residual.id;
          }

          await this.audit.log(
            {
              actorType: actor.type,
              actorId: actor.id ?? null,
              action: 'inventory.reservation.allocated',
              entityType: 'stock_reservation',
              entityId: resv.id,
              metadata: {
                sellerId: resv.sellerId,
                variantId: resv.variantId,
                warehouseId: resv.warehouseId,
                strategy: plan.strategy,
                allocatedQty: plan.allocatedQty,
                shortfall: plan.shortfall,
                picks: plan.picks,
              },
            },
            tx,
          );

          return {
            reservationId,
            strategy: plan.strategy,
            allocatedQty: plan.allocatedQty,
            shortfall: plan.shortfall,
            phase2ReservationIds: phase2Ids,
            residualReservationId,
            alreadyAllocated: false,
          };
        });
      } catch (err) {
        if (err instanceof RetryablePickConflictError) {
          lastErr = err;
          this.logger.warn(
            { attempt, reservationId, reason: err.message },
            'Phase-2 populate conflict; re-planning',
          );
          continue;
        }
        throw err;
      }
    }

    throw new ConflictException({
      code: 'PICK_ALLOCATION_CONFLICT',
      message: `Could not allocate after ${MAX_POPULATE_ATTEMPTS} attempts (concurrent contention)`,
      cause: lastErr instanceof Error ? lastErr.message : String(lastErr),
    });
  }

  /**
   * Inverse of allocateAndPopulate (WMS-5). Collapses the line's ACTIVE
   * reservation group back to ONE phase-1 row of the conserved total,
   * giving phase-2 holds back to stock_levels (clamped, no version-CAS).
   */
  async releaseAllocation(
    reservationId: string,
    actor: { type: ActorType; id?: string | null } = { type: ActorType.SYSTEM },
  ): Promise<ReleasedAllocation> {
    const anchor = await this.prisma.client.stockReservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        status: true,
        orderId: true,
        orderItemId: true,
      },
    });
    if (!anchor) {
      throw new NotFoundException({
        code: 'RESERVATION_NOT_FOUND',
        message: 'Reservation not found',
      });
    }
    if (anchor.status !== ReservationStatus.ACTIVE) {
      throw new ConflictException({
        code: 'RESERVATION_NOT_ACTIVE',
        message: `Reservation is ${anchor.status}, cannot release allocation`,
      });
    }

    // The whole line's allocation group (allocateAndPopulate may have
    // split it into the converted original + extra phase-2 rows + a
    // residual phase-1 row).
    const group = await this.prisma.client.stockReservation.findMany({
      where: {
        orderId: anchor.orderId,
        orderItemId: anchor.orderItemId,
        status: ReservationStatus.ACTIVE,
      },
      select: {
        id: true,
        sellerId: true,
        variantId: true,
        warehouseId: true,
        binId: true,
        batchId: true,
        qtyReserved: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const phase2 = group.filter(
      (r) => r.binId !== null && r.batchId !== null,
    );
    // Survivor: the anchor if still in the group, else the FEFO-earliest
    // row — deterministic so concurrent callers converge.
    const survivor =
      group.find((r) => r.id === reservationId) ?? group[0];
    if (!survivor) {
      // Group vanished between the two reads (released elsewhere) — no-op.
      return {
        reservationId,
        phase1ReservationId: reservationId,
        releasedQty: 0,
        alreadyPhase1: true,
      };
    }
    if (phase2.length === 0) {
      // Already a pure phase-1 float — idempotent no-op.
      return {
        reservationId,
        phase1ReservationId: survivor.id,
        releasedQty: 0,
        alreadyPhase1: true,
      };
    }

    const total = group.reduce((s, r) => s + r.qtyReserved, 0);
    const releasedQty = phase2.reduce((s, r) => s + r.qtyReserved, 0);

    await this.prisma.client.$transaction(async (tx) => {
      // 1. Give the phase-2 holds back to stock_levels — atomic SQL
      //    decrement, clamped so a double-release can't go negative
      //    (INV-4; monotonic give-back ⇒ no version-CAS, mirrors
      //    StockReservationService.release/fulfill).
      for (const r of phase2) {
        // Locals so TS narrows null away for the phase-2 filter (the
        // `phase2` array predicate doesn't narrow the element type).
        const binId = r.binId;
        const batchId = r.batchId;
        if (binId === null || batchId === null) continue;
        await tx.stockLevel.updateMany({
          where: {
            sellerId: r.sellerId,
            variantId: r.variantId,
            warehouseId: r.warehouseId,
            binId,
            batchId,
            qtyReserved: { gte: r.qtyReserved },
          },
          data: { qtyReserved: { decrement: r.qtyReserved } },
        });
      }

      // 2. Collapse the group → the survivor becomes the single phase-1
      //    row holding the conserved total; the rest are deleted.
      await tx.stockReservation.update({
        where: { id: survivor.id },
        data: { binId: null, batchId: null, qtyReserved: total },
      });
      const toDelete = group
        .filter((r) => r.id !== survivor.id)
        .map((r) => r.id);
      if (toDelete.length > 0) {
        await tx.stockReservation.deleteMany({
          where: { id: { in: toDelete } },
        });
      }

      await this.audit.log(
        {
          actorType: actor.type,
          actorId: actor.id ?? null,
          action: 'inventory.reservation.allocation_released',
          entityType: 'stock_reservation',
          entityId: survivor.id,
          metadata: {
            orderId: anchor.orderId,
            orderItemId: anchor.orderItemId,
            releasedQty,
            conservedTotal: total,
            collapsedReservationIds: group.map((r) => r.id),
          },
        },
        tx,
      );
    });

    return {
      reservationId,
      phase1ReservationId: survivor.id,
      releasedQty,
      alreadyPhase1: false,
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
