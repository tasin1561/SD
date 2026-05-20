import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  OrderStatus,
  ReservationReleaseReason,
  RtoDisposition,
  RtoItemCondition,
  StockMovementReasonCode,
  StockMovementType,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderReadService } from '../../order/services/order-read.service';
import { OrderWriteService } from '../../order/services/order-write.service';
import { StockMutationService } from '../../inventory-shared/stock-mutation.service';
import { StockReservationService } from '../../inventory-stock/services/stock-reservation.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

export interface FinalizeRtoItemSummary {
  shipmentItemId: string;
  orderItemId: string;
  disposition: RtoDisposition;
  quantity: number;
  /** WRITE_OFF only: the ADJUSTMENT_DECREASE movement id (null for
   *  RESTOCK lines — no movement; and null for WRITE_OFF lines whose
   *  movement-gate skipped on retry). */
  movementId: string | null;
}

export interface FinalizeRtoResult {
  shipmentId: string;
  orderId: string;
  status: OrderStatus;
  restockedCount: number;
  writtenOffCount: number;
  items: FinalizeRtoItemSummary[];
  /** true ⇒ the gate-2 existence query fired — ADJUSTMENT_DECREASE
   *  rows already present for this shipment, so the WRITE_OFF movement
   *  tx was skipped on this call (recovery from a prior
   *  crash-after-movements). */
  movementsAlreadyApplied: boolean;
  /** true ⇒ idempotent no-op (order already RTO_RESTOCKED). */
  alreadyFinalized: boolean;
  /** Count of ACTIVE reservations released this call (excludes
   *  reservations that were already-RELEASED → idempotent no-op). */
  reservationsReleased: number;
}

/**
 * Module 8 — RTO disposition finalize (commit 15 ORIGINAL, REVISED in
 * the conservation-bug follow-on fix).
 *
 * ── BUG-FIX RATIONALE (the rewrite) ───────────────────────────────────
 * The original commit-15 finalize() issued `RETURN_RESTOCK +qty`
 * movements for RESTOCK items, INFLATING `stock_levels.qtyOnHand` on
 * top of an undecremented baseline. The full-lifecycle conservation
 * e2e (stock-conservation-rto.e2e-spec) empirically proved that
 * qtyOnHand is NEVER decremented during the normal lifecycle — no
 * `StockMovementType.PICK` / PACK_CONFIRM / DISPATCH movement is
 * issued anywhere in M8 (or anywhere else; system-wide grep confirms).
 * The `StockReservationService.fulfill()` at DELIVERED only clears
 * `qtyReserved` (clamped decrement) and marks the reservation
 * FULFILLED — its JSDoc-promised "separate PICK movement for the
 * physical qtyOnHand decrement" is unimplemented.
 *
 * Under THIS reality (model B per the pre-fix design conversation —
 * qtyOnHand stays static through transit, only changes when goods
 * truly leave permanently) the correct RTO finalize is:
 *
 *   - RESTOCK : RELEASE the ACTIVE reservation (clears qtyReserved
 *               via clamped decrement, marks RELEASED). NO stock
 *               movement — qtyOnHand was never decremented; nothing
 *               to add back. The unit is back on the shelf because it
 *               never logically left.
 *   - WRITE_OFF: RELEASE the ACTIVE reservation, AND issue an
 *                ADJUSTMENT_DECREASE -qty stock movement. The unit
 *                truly left the system (damaged, lost, etc.); the
 *                ledger must reflect that.
 *
 * The "missing qtyOnHand decrement on the happy path" gap (bug 1) is
 * a LATENT pre-existing M6/M9/M10 concern (no flow drives orders to
 * DELIVERED yet outside god mode); resolution depends on the still-
 * undecided decrement-timing model (A: at-dispatch vs B: at-permanent-
 * departure) and is tracked in phase-1a-debt as a HIGH-priority entry.
 * IF M9/M10 adopts Model A, this finalize() RESTOCK path MUST be
 * revisited (RETURN_RESTOCK becomes correct again under A).
 *
 * ── SAGA (unchanged shape, refined semantics) ─────────────────────────
 *   1. Pre-flight: gate 1 (order.status===RTO_RESTOCKED short-circuit),
 *      ORDER_NOT_RTO_READY, RTO_INSPECTION_INCOMPLETE,
 *      RTO_RESTOCK_MISSING_CONTEXT (RESTOCK lines need
 *      pickedBin/Batch — the release() give-back targets them),
 *      RTO_WRITE_OFF_MISSING_CONTEXT (WRITE_OFF lines need them too
 *      for the ADJUSTMENT_DECREASE target), RTO_NO_ITEMS.
 *   2. Releases (per ACTIVE reservation): release() owns its own tx
 *      (composes via N independent calls). Idempotent natively —
 *      already-RELEASED returns alreadyInactive:true no-op. Failures
 *      partway are retry-safe.
 *   3. Gate 2 (movement-level idempotency, WRITE_OFF only): existence
 *      query on (shipmentId, type=ADJUSTMENT_DECREASE). If present →
 *      skip the WRITE_OFF movement loop (recovery from prior
 *      crash-after-movements).
 *   4. WRITE_OFF movements: `runWithRetry((tx) => for each WRITE_OFF
 *      item: mutation.apply(tx, ADJUSTMENT_DECREASE, -qty,
 *      reasonCode: mapped from rtoCondition))`. Atomic block
 *      (INV-1/INV-6).
 *   5. Authoritative transition: RTO_RECEIVED → RTO_RESTOCKED (own tx).
 *
 * Failure-ordering invariant preserved: a crash after releases /
 * movements leaves the order in RTO_RECEIVED (truthful, recoverable);
 * a crash before releases leaves stock untouched. Both retry-safe.
 *
 * ── reasonCode CHOICE ─────────────────────────────────────────────────
 * Per-line reasonCode for WRITE_OFF movements is mapped from
 * `shipment_items.rtoCondition`:
 *   - DAMAGED → DAMAGED_IN_WAREHOUSE
 *   - MISSING → LOST
 *   - GOOD    → OTHER (operationally rare: writing off a GOOD item;
 *                      documented in phase-1a-debt — add dedicated
 *                      RTO_WRITE_OFF value if ops demands).
 *
 * Reservation release reason: OTHER for both RESTOCK and WRITE_OFF —
 * ReservationReleaseReason has no RTO-specific value (closest is
 * ORDER_REJECTED_BY_COURIER, semantically misleading: refers to pre-
 * shipment courier rejection, not RTO terminal). Tracked in
 * phase-1a-debt — additive enum value in Phase 2 if ops/reports
 * demand RTO-specific filtering.
 */
@Injectable()
export class RtoDispositionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderReadService,
    private readonly orderWrite: OrderWriteService,
    private readonly mutation: StockMutationService,
    private readonly reservations: StockReservationService,
    private readonly audit: AuditLogService,
  ) {}

  async finalize(
    shipmentId: string,
    staffId: string,
    ctx?: ClientContext,
  ): Promise<FinalizeRtoResult> {
    const shipment = await this.prisma.client.shipment.findFirst({
      where: { id: shipmentId, deletedAt: null },
      select: {
        id: true,
        originWarehouseId: true,
        orderShipments: {
          select: { orderId: true },
          orderBy: { shipmentSequence: 'asc' },
          take: 1,
        },
        items: {
          select: {
            id: true,
            orderItemId: true,
            quantity: true,
            rtoCondition: true,
            rtoDisposition: true,
            pickedBinId: true,
            pickedBatchId: true,
            orderItem: {
              select: { id: true, variantId: true, order: { select: { sellerId: true } } },
            },
          },
        },
      },
    });
    if (!shipment) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: `Shipment ${shipmentId} not found`,
      });
    }
    const orderId = shipment.orderShipments[0]?.orderId;
    if (orderId === undefined) {
      throw new NotFoundException({
        code: 'ORDER_SHIPMENT_MISSING',
        message: `Shipment ${shipmentId} has no OrderShipment junction`,
      });
    }
    const order = await this.orders.getById(orderId);
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: `Order ${orderId} for shipment ${shipmentId} not found`,
      });
    }

    // ── GATE 1: idempotency short-circuit on already-finalized.
    if (order.status === OrderStatus.RTO_RESTOCKED) {
      const summary = this.buildItemSummaries(shipment.items, null);
      return {
        shipmentId,
        orderId,
        status: OrderStatus.RTO_RESTOCKED,
        restockedCount: summary.filter(
          (s) => s.disposition === RtoDisposition.RESTOCK,
        ).length,
        writtenOffCount: summary.filter(
          (s) => s.disposition === RtoDisposition.WRITE_OFF,
        ).length,
        items: summary,
        movementsAlreadyApplied: true,
        alreadyFinalized: true,
        reservationsReleased: 0,
      };
    }
    if (order.status !== OrderStatus.RTO_RECEIVED) {
      throw new ConflictException({
        code: 'ORDER_NOT_RTO_READY',
        message: `Order is ${order.status}; RTO finalize requires RTO_RECEIVED`,
      });
    }

    if (shipment.items.length === 0) {
      throw new ConflictException({
        code: 'RTO_NO_ITEMS',
        message: `Shipment ${shipmentId} has no items to finalize`,
      });
    }

    // ── Inspection-completeness check.
    const uninspected = shipment.items.filter(
      (i) => i.rtoCondition === null || i.rtoDisposition === null,
    );
    if (uninspected.length > 0) {
      throw new ConflictException({
        code: 'RTO_INSPECTION_INCOMPLETE',
        message: `${uninspected.length} shipment item(s) have not been inspected`,
        cause: uninspected.map((i) => i.id),
      });
    }

    const restockItems = shipment.items.filter(
      (i) => i.rtoDisposition === RtoDisposition.RESTOCK,
    );
    const writeOffItems = shipment.items.filter(
      (i) => i.rtoDisposition === RtoDisposition.WRITE_OFF,
    );

    // Both RESTOCK and WRITE_OFF need pickedBin/Batch context:
    //   - RESTOCK: the phase-2 reservation's bin/batch is what
    //     release() decrements via the clamped give-back. If the
    //     reservation IS phase-2, the values live on the reservation
    //     itself, NOT on shipment_items — so missing pickedBin/Batch is
    //     a soft anomaly here (release still works). But we surface it
    //     loudly for ops awareness.
    //   - WRITE_OFF: ADJUSTMENT_DECREASE targets a concrete bin+batch
    //     on stock_levels. Without those we can't issue the movement.
    const writeOffMissingContext = writeOffItems.filter(
      (i) => i.pickedBinId === null || i.pickedBatchId === null,
    );
    if (writeOffMissingContext.length > 0) {
      throw new ConflictException({
        code: 'RTO_WRITE_OFF_MISSING_CONTEXT',
        message: `${writeOffMissingContext.length} WRITE_OFF item(s) have no pickedBin/pickedBatch — adjustment target unknown`,
        cause: writeOffMissingContext.map((i) => i.id),
      });
    }

    const actor = { type: ActorType.STAFF, id: staffId };

    // ── Releases (per ACTIVE reservation). release() owns its own tx
    //    and is natively idempotent (already-RELEASED → no-op), so we
    //    iterate sequentially without needing a movement-style gate.
    //    The clamped qtyReserved decrement happens inside release()
    //    for phase-2 reservations (INV-4).
    const activeResvs = await this.reservations.listActiveForOrder(orderId);
    let reservationsReleased = 0;
    for (const resv of activeResvs) {
      const r = await this.reservations.release(
        resv.id,
        ReservationReleaseReason.OTHER, // debt: dedicated RTO_FINALIZED value, Phase 2
        actor,
      );
      if (!r.alreadyInactive) reservationsReleased += 1;
    }

    // ── GATE 2: movement-level idempotency, WRITE_OFF only.
    //    ADJUSTMENT_DECREASE is now the marker (was RETURN_RESTOCK in
    //    the original commit-15 bug). stock_movements has no native
    //    unique constraint; the explicit existence query IS the gate.
    let movementsAlreadyApplied = false;
    let itemSummaries: FinalizeRtoItemSummary[] = [];
    if (writeOffItems.length > 0) {
      const existingMovement = await this.prisma.client.stockMovement.findFirst(
        {
          where: {
            shipmentId,
            type: StockMovementType.ADJUSTMENT_DECREASE,
          },
          select: { id: true },
        },
      );
      movementsAlreadyApplied = existingMovement !== null;

      if (!movementsAlreadyApplied) {
        const movementIds = await this.mutation.runWithRetry(async (tx) => {
          const ids: Array<{ shipmentItemId: string; movementId: string }> = [];
          for (const item of writeOffItems) {
            const binId = item.pickedBinId;
            const batchId = item.pickedBatchId;
            if (binId === null || batchId === null) {
              // Already pre-flighted; defensive guard for type narrowing.
              throw new ConflictException({
                code: 'RTO_WRITE_OFF_MISSING_CONTEXT',
                message: `item ${item.id} pick context vanished mid-finalize`,
              });
            }
            const result = await this.mutation.apply(tx, {
              sellerId: item.orderItem.order.sellerId,
              variantId: item.orderItem.variantId,
              warehouseId: shipment.originWarehouseId,
              binId,
              batchId,
              qtyChange: -item.quantity, // the unit truly left the system
              type: StockMovementType.ADJUSTMENT_DECREASE,
              actorType: ActorType.STAFF,
              actorId: staffId,
              reasonCode: reasonCodeFor(item.rtoCondition),
              reason: `RTO write-off: rtoCondition=${item.rtoCondition ?? 'unknown'}`,
              orderId,
              orderItemId: item.orderItemId,
              shipmentId,
            });
            ids.push({ shipmentItemId: item.id, movementId: result.movementId });
          }
          return ids;
        });
        itemSummaries = this.buildItemSummaries(
          shipment.items,
          new Map(movementIds.map((m) => [m.shipmentItemId, m.movementId])),
        );
      } else {
        itemSummaries = this.buildItemSummaries(shipment.items, null);
      }
    } else {
      itemSummaries = this.buildItemSummaries(shipment.items, null);
    }

    // ── Authoritative transition (its own tx). Gate 1 ensures retry
    //    safety; gate 2 ensures no double-decrement; release()
    //    idempotency handles the reservation side.
    await this.orderWrite.transitionStatus({
      orderId,
      to: OrderStatus.RTO_RESTOCKED,
      actor,
      expectedFrom: OrderStatus.RTO_RECEIVED,
      reason: `RTO finalize on shipment ${shipmentId}`,
      ...(ctx !== undefined ? { ctx } : {}),
    });

    const restockedCount = restockItems.length;
    const writtenOffCount = writeOffItems.length;

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'rto.finalized',
      entityType: 'shipment',
      entityId: shipmentId,
      severity: 'MEDIUM',
      metadata: {
        orderId,
        restockedCount,
        writtenOffCount,
        reservationsReleased,
        movementsAlreadyApplied,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    return {
      shipmentId,
      orderId,
      status: OrderStatus.RTO_RESTOCKED,
      restockedCount,
      writtenOffCount,
      items: itemSummaries,
      movementsAlreadyApplied,
      alreadyFinalized: false,
      reservationsReleased,
    };
  }

  // ── internal ──────────────────────────────────────────────────────

  private buildItemSummaries(
    items: ReadonlyArray<{
      id: string;
      orderItemId: string;
      quantity: number;
      rtoDisposition: RtoDisposition | null;
    }>,
    movementIdByItem: Map<string, string> | null,
  ): FinalizeRtoItemSummary[] {
    return items.map((i) => ({
      shipmentItemId: i.id,
      orderItemId: i.orderItemId,
      disposition: i.rtoDisposition ?? RtoDisposition.WRITE_OFF,
      quantity: i.quantity,
      movementId: movementIdByItem?.get(i.id) ?? null,
    }));
  }
}

/** Map the inspector's per-line rtoCondition to the most specific
 *  reasonCode the existing enum offers. DAMAGED→DAMAGED_IN_WAREHOUSE,
 *  MISSING→LOST, GOOD/null→OTHER (operationally rare to write off a
 *  GOOD item; debt-noted for a dedicated value). */
function reasonCodeFor(
  condition: RtoItemCondition | null,
): StockMovementReasonCode {
  switch (condition) {
    case RtoItemCondition.DAMAGED:
      return StockMovementReasonCode.DAMAGED_IN_WAREHOUSE;
    case RtoItemCondition.MISSING:
      return StockMovementReasonCode.LOST;
    default:
      return StockMovementReasonCode.OTHER;
  }
}
