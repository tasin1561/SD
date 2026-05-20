import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  OrderStatus,
  RtoDisposition,
  StockMovementType,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderReadService } from '../../order/services/order-read.service';
import { OrderWriteService } from '../../order/services/order-write.service';
import { StockMutationService } from '../../inventory-shared/stock-mutation.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

export interface FinalizeRtoItemSummary {
  shipmentItemId: string;
  orderItemId: string;
  disposition: RtoDisposition;
  quantity: number;
  /** Set only for RESTOCK items that actually had a movement applied
   *  this call; null for WRITE_OFF items, and null for RESTOCK items
   *  that were skipped because the movement-gate fired (already applied
   *  in a prior call — see `movementsAlreadyApplied`). */
  movementId: string | null;
}

export interface FinalizeRtoResult {
  shipmentId: string;
  orderId: string;
  status: OrderStatus;
  restockedCount: number;
  writtenOffCount: number;
  items: FinalizeRtoItemSummary[];
  /** true ⇒ the existing-movements gate fired — RETURN_RESTOCK rows
   *  already present for this shipment, so the movement tx was skipped
   *  on this call (recovery from a prior crash-after-movements). */
  movementsAlreadyApplied: boolean;
  /** true ⇒ idempotent no-op (order already RTO_RESTOCKED). */
  alreadyFinalized: boolean;
}

/**
 * Module 8 — RTO disposition finalize (commit 15, WMS-8).
 *
 * The atomicity contract is a SAGA — not one Postgres transaction —
 * because `OrderWriteService.transitionStatus` owns its own tx and
 * cannot be enrolled in `StockMutationService.runWithRetry`'s tx (the
 * same M5↔M6 boundary that produced the M6 saga, verified pre-build).
 *
 * Ordering (locked decision: movements first, transition second):
 *   1. Pre-flight guards — idempotency short-circuit (order already
 *      RTO_RESTOCKED), status gate (must be RTO_RECEIVED), and
 *      inspection-completeness check (every line has rtoCondition +
 *      rtoDisposition; every RESTOCK line has a recorded pickedBin /
 *      pickedBatch — without those we'd have nowhere to put the stock
 *      back).
 *   2. Movement-level idempotency gate — query stock_movements for any
 *      existing RETURN_RESTOCK row keyed on this `shipmentId`. If present,
 *      skip the movement loop (recovery from a prior crash-after-movements
 *      — the runWithRetry block committed but the transition never landed).
 *      stock_movements has no native dedup key / unique constraint
 *      (verified — the ledger is append-only by design); the explicit
 *      existence query IS the gate.
 *   3. Movements — `runWithRetry((tx) => for each RESTOCK item:
 *      mutation.apply(tx, {type: RETURN_RESTOCK, qtyChange: +qty, ...}))`.
 *      All-or-nothing inside one Postgres transaction (INV-1/INV-6). On
 *      retry from a version conflict, the WHOLE block re-runs from
 *      scratch — no lost updates. `reasonCode` is `null`: per
 *      `REASON_CODE_REQUIRED` in StockMutationService, RETURN_RESTOCK
 *      does NOT require a reasonCode (INV-7 covers ADJUSTMENT_* /
 *      CYCLE_COUNT_ADJUST / EXPIRY_WRITE_OFF only); the movement TYPE
 *      itself encodes the semantic. The reasonCode enum has no
 *      `RTO_RESTOCK` value as of Phase 1A — adding one is a small
 *      additive migration if ops demands granularity.
 *   4. Transition — `transitionStatus(RTO_RECEIVED → RTO_RESTOCKED)` in
 *      its own tx (matrix edge has empty side-effects, verified). On
 *      retry after movements-OK / transition-FAIL, the movement gate
 *      from step 2 skips re-application; the transition retries cleanly.
 *
 * Invariant: visible-vs-silent failure ordering. A crash AFTER movements
 * leaves the order in RTO_RECEIVED (visible, recoverable). A crash BEFORE
 * movements rolls back atomically (stock untouched). The dangerous
 * "order looks done, stock missing" branch from Option B is impossible
 * by construction.
 *
 * Bin/batch source: `shipment_items.pickedBinId/pickedBatchId` (the
 * operational hint set during pick, CP1 Option A). Restock returns to
 * the original bin+batch. A missing pick context (NULL) for a RESTOCK
 * item is an inspection-side data anomaly — surfaced as 409
 * RTO_RESTOCK_MISSING_CONTEXT in pre-flight, BEFORE any movement, so
 * we never half-apply.
 *
 * WRITE_OFF items: NO movement is generated — the original PICK
 * decrement stands as the durable "stock left the system" record.
 * The order goes to RTO_RESTOCKED regardless of restock/write-off mix
 * (the status reflects "RTO processed"; per-item fate lives in
 * shipment_items.rtoDisposition).
 */
@Injectable()
export class RtoDispositionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderReadService,
    private readonly orderWrite: OrderWriteService,
    private readonly mutation: StockMutationService,
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
    const missingContext = restockItems.filter(
      (i) => i.pickedBinId === null || i.pickedBatchId === null,
    );
    if (missingContext.length > 0) {
      throw new ConflictException({
        code: 'RTO_RESTOCK_MISSING_CONTEXT',
        message: `${missingContext.length} RESTOCK item(s) have no pickedBin/pickedBatch — restock target unknown`,
        cause: missingContext.map((i) => i.id),
      });
    }

    // ── GATE 2: movement-level idempotency. stock_movements has no
    //    native dedup key; the explicit findFirst on (shipmentId, type)
    //    IS the gate. If any RETURN_RESTOCK row exists for this
    //    shipment, the prior call's runWithRetry tx committed — skip the
    //    movement loop on this retry (no double-restock).
    const existingMovement = await this.prisma.client.stockMovement.findFirst({
      where: {
        shipmentId,
        type: StockMovementType.RETURN_RESTOCK,
      },
      select: { id: true },
    });
    const movementsAlreadyApplied = existingMovement !== null;

    // ── Movements (skipped if gate 2 fired).
    const itemSummaries: FinalizeRtoItemSummary[] = [];
    if (!movementsAlreadyApplied && restockItems.length > 0) {
      const movementIds = await this.mutation.runWithRetry(async (tx) => {
        const ids: Array<{ shipmentItemId: string; movementId: string }> = [];
        for (const item of restockItems) {
          // Locals so TS narrows null away (filter predicate doesn't
          // refine the element type).
          const binId = item.pickedBinId;
          const batchId = item.pickedBatchId;
          if (binId === null || batchId === null) {
            // Already pre-flighted; defensive guard for type narrowing.
            throw new ConflictException({
              code: 'RTO_RESTOCK_MISSING_CONTEXT',
              message: `item ${item.id} pick context vanished mid-finalize`,
            });
          }
          const result = await this.mutation.apply(tx, {
            sellerId: item.orderItem.order.sellerId,
            variantId: item.orderItem.variantId,
            warehouseId: shipment.originWarehouseId,
            binId,
            batchId,
            qtyChange: item.quantity,
            type: StockMovementType.RETURN_RESTOCK,
            actorType: ActorType.STAFF,
            actorId: staffId,
            // reasonCode intentionally null: not required for
            // RETURN_RESTOCK per INV-7 / REASON_CODE_REQUIRED; the
            // movement TYPE encodes the semantic. A dedicated
            // RTO_RESTOCK enum value can be added if ops demands later.
            reasonCode: null,
            orderId,
            orderItemId: item.orderItemId,
            shipmentId,
          });
          ids.push({ shipmentItemId: item.id, movementId: result.movementId });
        }
        return ids;
      });
      itemSummaries.push(
        ...this.buildItemSummaries(shipment.items, new Map(
          movementIds.map((m) => [m.shipmentItemId, m.movementId]),
        )),
      );
    } else {
      itemSummaries.push(
        ...this.buildItemSummaries(shipment.items, null),
      );
    }

    // ── Authoritative transition (its own tx). Gate 2 ensures retry
    //    doesn't double-restock; this step retries idempotently.
    await this.orderWrite.transitionStatus({
      orderId,
      to: OrderStatus.RTO_RESTOCKED,
      actor: { type: ActorType.STAFF, id: staffId },
      expectedFrom: OrderStatus.RTO_RECEIVED,
      reason: `RTO finalize on shipment ${shipmentId}`,
      ...(ctx !== undefined ? { ctx } : {}),
    });

    const restockedCount = itemSummaries.filter(
      (s) => s.disposition === RtoDisposition.RESTOCK,
    ).length;
    const writtenOffCount = itemSummaries.filter(
      (s) => s.disposition === RtoDisposition.WRITE_OFF,
    ).length;

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
