import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, OrderStatus, ShipmentStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderReadService } from '../../order/services/order-read.service';
import { OrderWriteService } from '../../order/services/order-write.service';
import { StockReservationService } from '../../inventory-stock/services/stock-reservation.service';
import type { AppliedAllocation } from '../../inventory-stock/services/stock-pick-allocation.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { PickAllocationService } from './pick-allocation.service';

export interface PickAllocationSummary {
  reservationId: string;
  orderItemId: string;
  strategy: AppliedAllocation['strategy'];
  allocatedQty: number;
  shortfall: number;
}

export interface StartPickResult {
  shipmentId: string;
  orderId: string;
  /** PENDING_PICK = allocation fully covered, picker may pick;
   *  PENDING_MANUAL_PLACEMENT = WMS-4 shortfall, escalated. */
  status: OrderStatus;
  fullyAllocated: boolean;
  allocations: PickAllocationSummary[];
}

export interface RecordPickItemResult {
  shipmentItemId: string;
  pickedBinId: string;
  pickedBatchId: string;
}

export interface CompletePickResult {
  shipmentId: string;
  orderId: string;
  status: OrderStatus;
  pickCompletedAt: Date;
  /** true ⇒ idempotent no-op (already PICKED + completed). */
  alreadyComplete: boolean;
}

/**
 * Module 8 — pick execution (WMS-1/3/4/9). The picker's work on a parcel
 * already CLAIMED by `PickQueueService.pullNext` (commit 4): start →
 * recordItem(s) → complete.
 *
 * ── SAGA DISCIPLINE ────────────────────────────────────────────────────
 * Every order status change goes through `OrderWriteService.
 * transitionStatus` (ORD-3 / MUST #16) — the M8 pick edges
 * (CONFIRMED→PENDING_PICK, PENDING_PICK→PICKED,
 * PENDING_PICK→PENDING_MANUAL_PLACEMENT) all have EMPTY matrix
 * side-effects, so each is its own atomic transitionStatus tx (order
 * row + events + audit). The M5 phase-2 allocation runs through
 * `PickAllocationService.allocateForPick` (WMS-3), which owns its OWN
 * version-CAS tx (INV-1/INV-6) and takes no tx param — it is NEVER
 * nested in another tx (the documented M5↔M8 boundary rule). The two
 * are composed as a SAGA, not a distributed tx:
 *
 *   start: transition CONFIRMED→PENDING_PICK FIRST (WMS-1 "first pick
 *     START"); THEN allocate per reservation; on ANY shortfall /
 *     RETRY_EXHAUSTED / anomaly, fail-route PENDING_PICK→
 *     PENDING_MANUAL_PLACEMENT (WMS-4 — the commit-1 matrix edge; M5
 *     conservation keeps the residual phase-1 reservation intact, so
 *     nothing is lost and a supervisor resolves). NEVER a 500.
 *
 * The invariant: the order state never lies about the pick. A failure
 * AFTER the PENDING_PICK commit is SAFE by construction — PENDING_PICK
 * is a valid resting state, the M5 conservation invariant holds, and the
 * WMS-5 expiry (commit 7) / a re-pull / a supervisor reconciles. No
 * compensation is required because no step leaves a half-applied
 * cross-module effect (allocateAndPopulate is atomic + idempotent per
 * INV-1).
 *
 * Pick-allocation source of truth (locked decision): the phase-2
 * `stock_reservations` (bin+batch+qty per row, INV-4) are authoritative.
 * `shipment_items.pickedBinId/pickedBatchId` is an OPERATIONAL HINT the
 * picker records at `recordItem` (the M5 surface intentionally does not
 * expose per-reservation bin/batch; the picker scans the bin they pulled
 * from). `complete` validates fully-allocated via the ORDER STATUS gate
 * (WMS-9: a shortfall already moved the order to PENDING_MANUAL_PLACEMENT
 * at `start`, so reaching `complete` in PENDING_PICK means allocation
 * succeeded) plus "every shipment_item recorded".
 */
@Injectable()
export class PickExecutionService {
  private readonly logger = new Logger(PickExecutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderReadService,
    private readonly orderWrite: OrderWriteService,
    private readonly reservations: StockReservationService,
    private readonly allocation: PickAllocationService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Begin the pick on a claimed parcel: drive the order into PENDING_PICK
   * (WMS-1) and convert its phase-1 reservations to phase-2 bin+batch
   * holds (WMS-3). A shortfall fail-routes to PENDING_MANUAL_PLACEMENT
   * (WMS-4) — not an error.
   */
  async start(
    shipmentId: string,
    staffId: string,
    ctx?: ClientContext,
  ): Promise<StartPickResult> {
    const { orderId } = await this.loadClaimedShipment(shipmentId, staffId);
    const actor = { type: ActorType.STAFF, id: staffId };

    const order = await this.orders.getById(orderId);
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: `Order ${orderId} for shipment ${shipmentId} not found`,
      });
    }

    // WMS-1: CONFIRMED → PENDING_PICK on the first START; a re-pick after
    // a WMS-5 expiry finds the order already PENDING_PICK (no bounce).
    if (order.status === OrderStatus.CONFIRMED) {
      await this.orderWrite.transitionStatus({
        orderId,
        to: OrderStatus.PENDING_PICK,
        actor,
        expectedFrom: OrderStatus.CONFIRMED,
        reason: `Pick started on shipment ${shipmentId}`,
        ...(ctx !== undefined ? { ctx } : {}),
      });
    } else if (order.status !== OrderStatus.PENDING_PICK) {
      throw new ConflictException({
        code: 'ORDER_NOT_PICKABLE',
        message: `Order is ${order.status}; a pick can only start from CONFIRMED or PENDING_PICK`,
      });
    }

    const active = await this.reservations.listActiveForOrder(orderId);
    if (active.length === 0) {
      // A CONFIRMED/PENDING_PICK order with no ACTIVE reservations is a
      // serious anomaly (the M5 reserve saga should have created them).
      // Keep the order state truthful — fail-route to manual, never 500.
      this.logger.error(
        { shipmentId, orderId },
        'Pick start: order has no ACTIVE reservations — escalating to manual placement',
      );
      await this.escalateToManual(orderId, actor, ctx, 'no_active_reservations');
      return {
        shipmentId,
        orderId,
        status: OrderStatus.PENDING_MANUAL_PLACEMENT,
        fullyAllocated: false,
        allocations: [],
      };
    }

    const allocations: PickAllocationSummary[] = [];
    let fullyAllocated = true;
    for (const resv of active) {
      try {
        const applied = await this.allocation.allocateForPick(resv.id, actor);
        const short =
          applied.shortfall > 0 ||
          applied.strategy === 'NONE' ||
          applied.strategy === 'PARTIAL';
        if (short) fullyAllocated = false;
        allocations.push({
          reservationId: resv.id,
          orderItemId: resv.orderItemId,
          strategy: applied.strategy,
          allocatedQty: applied.allocatedQty,
          shortfall: applied.shortfall,
        });
      } catch (err) {
        // WMS-3 exhausted, or a deterministic M5 anomaly on a
        // just-listed ACTIVE reservation — both mean the pick can't be
        // fully fulfilled now. Collect, don't abort the loop, don't 500.
        fullyAllocated = false;
        this.logger.warn(
          { shipmentId, orderId, reservationId: resv.id, err: (err as Error).message },
          'Pick start: allocation failed for a reservation — will escalate to manual placement',
        );
        allocations.push({
          reservationId: resv.id,
          orderItemId: resv.orderItemId,
          strategy: 'NONE',
          allocatedQty: 0,
          shortfall: resv.qtyReserved,
        });
      }
    }

    if (!fullyAllocated) {
      await this.escalateToManual(orderId, actor, ctx, 'pick_shortfall');
      return {
        shipmentId,
        orderId,
        status: OrderStatus.PENDING_MANUAL_PLACEMENT,
        fullyAllocated: false,
        allocations,
      };
    }

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'warehouse_pick.started',
      entityType: 'shipment',
      entityId: shipmentId,
      severity: 'LOW',
      metadata: {
        orderId,
        allocations,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    return {
      shipmentId,
      orderId,
      status: OrderStatus.PENDING_PICK,
      fullyAllocated: true,
      allocations,
    };
  }

  /**
   * Record the bin+batch the picker physically pulled a line from. This
   * is the OPERATIONAL HINT on `shipment_items` (the authoritative
   * allocation is the phase-2 reservations). Soft validation only
   * (Phase 1A, mirrors ORD-5): the shipment_items FKs to
   * warehouse_bins/stock_batches enforce id integrity at the DB.
   */
  async recordItem(
    shipmentId: string,
    staffId: string,
    input: { shipmentItemId: string; pickedBinId: string; pickedBatchId: string },
    ctx?: ClientContext,
  ): Promise<RecordPickItemResult> {
    const { orderId } = await this.loadClaimedShipment(shipmentId, staffId);

    const order = await this.orders.getById(orderId);
    if (!order || order.status !== OrderStatus.PENDING_PICK) {
      throw new ConflictException({
        code: 'PICK_NOT_IN_PROGRESS',
        message: `Order is ${order?.status ?? 'missing'}; items can only be recorded while PENDING_PICK`,
      });
    }

    const item = await this.prisma.client.shipmentItem.findUnique({
      where: { id: input.shipmentItemId },
      select: { id: true, shipmentId: true },
    });
    if (!item || item.shipmentId !== shipmentId) {
      throw new NotFoundException({
        code: 'SHIPMENT_ITEM_NOT_FOUND',
        message: `Shipment item ${input.shipmentItemId} is not part of shipment ${shipmentId}`,
      });
    }

    await this.prisma.client.shipmentItem.update({
      where: { id: input.shipmentItemId },
      data: {
        pickedBinId: input.pickedBinId,
        pickedBatchId: input.pickedBatchId,
      },
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'warehouse_pick.item_recorded',
      entityType: 'shipment_item',
      entityId: input.shipmentItemId,
      severity: 'LOW',
      metadata: {
        shipmentId,
        orderId,
        pickedBinId: input.pickedBinId,
        pickedBatchId: input.pickedBatchId,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    return {
      shipmentItemId: input.shipmentItemId,
      pickedBinId: input.pickedBinId,
      pickedBatchId: input.pickedBatchId,
    };
  }

  /**
   * Finish the pick: every line recorded ⇒ PENDING_PICK → PICKED (WMS-9).
   * Idempotent on an already-PICKED+completed parcel. The shipment's
   * operational completion is written (guarded) BEFORE the authoritative
   * transition so a transition failure leaves a re-callable PENDING_PICK
   * with the original `pickCompletedAt` preserved on retry.
   */
  async complete(
    shipmentId: string,
    staffId: string,
    ctx?: ClientContext,
  ): Promise<CompletePickResult> {
    const { orderId, pickCompletedAt: existing } =
      await this.loadClaimedShipment(shipmentId, staffId, {
        allowCompleted: true,
      });
    const actor = { type: ActorType.STAFF, id: staffId };

    const order = await this.orders.getById(orderId);
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: `Order ${orderId} for shipment ${shipmentId} not found`,
      });
    }

    // Idempotent no-op: a prior complete already drove PICKED + stamped
    // pickCompletedAt.
    if (order.status === OrderStatus.PICKED && existing !== null) {
      return {
        shipmentId,
        orderId,
        status: OrderStatus.PICKED,
        pickCompletedAt: existing,
        alreadyComplete: true,
      };
    }
    if (order.status !== OrderStatus.PENDING_PICK) {
      throw new ConflictException({
        code: 'PICK_NOT_IN_PROGRESS',
        message: `Order is ${order.status}; complete requires PENDING_PICK`,
      });
    }

    const items = await this.prisma.client.shipmentItem.findMany({
      where: { shipmentId },
      select: { id: true, pickedBinId: true, pickedBatchId: true },
    });
    const unrecorded = items.filter(
      (i) => i.pickedBinId === null || i.pickedBatchId === null,
    );
    if (items.length === 0 || unrecorded.length > 0) {
      throw new ConflictException({
        code: 'PICK_INCOMPLETE',
        message: `${unrecorded.length} shipment item(s) have no recorded bin/batch`,
        cause: unrecorded.map((i) => i.id),
      });
    }

    const now = new Date();
    // Guarded operational write FIRST (idempotent: a retry after a
    // failed transition finds pickCompletedAt already set → count 0,
    // original timestamp preserved).
    const stamped = await this.prisma.client.shipment.updateMany({
      where: {
        id: shipmentId,
        status: ShipmentStatus.CREATED,
        pickCompletedAt: null,
      },
      data: { pickCompletedAt: now, pickExpiresAt: null },
    });
    const pickCompletedAt =
      stamped.count === 1 ? now : (existing ?? now);

    // Authoritative transition LAST (WMS-9). expectedFrom guards a race.
    await this.orderWrite.transitionStatus({
      orderId,
      to: OrderStatus.PICKED,
      actor,
      expectedFrom: OrderStatus.PENDING_PICK,
      reason: `Pick completed on shipment ${shipmentId}`,
      ...(ctx !== undefined ? { ctx } : {}),
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'warehouse_pick.completed',
      entityType: 'shipment',
      entityId: shipmentId,
      severity: 'LOW',
      metadata: {
        orderId,
        itemCount: items.length,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    return {
      shipmentId,
      orderId,
      status: OrderStatus.PICKED,
      pickCompletedAt,
      alreadyComplete: false,
    };
  }

  // ── internal ──────────────────────────────────────────────────────

  /** Load + guard a parcel claimed by this picker. 404 / 403
   *  PICK_NOT_OWNED / 409 PICK_NOT_CLAIMED / 409 PICK_ALREADY_COMPLETED
   *  (the last suppressed when `allowCompleted`, for idempotent
   *  `complete`). Returns the resolved orderId + pickCompletedAt. */
  private async loadClaimedShipment(
    shipmentId: string,
    staffId: string,
    opts: { allowCompleted?: boolean } = {},
  ): Promise<{ orderId: string; pickCompletedAt: Date | null }> {
    const shipment = await this.prisma.client.shipment.findFirst({
      where: { id: shipmentId, deletedAt: null },
      select: {
        id: true,
        status: true,
        pickStartedAt: true,
        pickStartedByStaffId: true,
        pickCompletedAt: true,
        orderShipments: {
          select: { orderId: true },
          orderBy: { shipmentSequence: 'asc' },
          take: 1,
        },
      },
    });
    if (!shipment) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: `Shipment ${shipmentId} not found`,
      });
    }
    if (shipment.status !== ShipmentStatus.CREATED) {
      throw new ConflictException({
        code: 'SHIPMENT_NOT_PICKABLE',
        message: `Shipment is ${shipment.status}; pick operations require CREATED`,
      });
    }
    if (shipment.pickStartedAt === null) {
      throw new ConflictException({
        code: 'PICK_NOT_CLAIMED',
        message: `Shipment ${shipmentId} has not been pulled into a pick`,
      });
    }
    if (shipment.pickStartedByStaffId !== staffId) {
      throw new ForbiddenException({
        code: 'PICK_NOT_OWNED',
        message: 'This pick is claimed by another picker',
      });
    }
    if (shipment.pickCompletedAt !== null && !opts.allowCompleted) {
      throw new ConflictException({
        code: 'PICK_ALREADY_COMPLETED',
        message: `Shipment ${shipmentId} pick is already completed`,
      });
    }
    const orderId = shipment.orderShipments[0]?.orderId;
    if (orderId === undefined) {
      throw new NotFoundException({
        code: 'ORDER_SHIPMENT_MISSING',
        message: `Shipment ${shipmentId} has no OrderShipment junction`,
      });
    }
    return { orderId, pickCompletedAt: shipment.pickCompletedAt };
  }

  /** WMS-4 fail-route: PENDING_PICK → PENDING_MANUAL_PLACEMENT (no
   *  side-effect; M5 conservation keeps the residual phase-1). */
  private async escalateToManual(
    orderId: string,
    actor: { type: ActorType; id?: string | null },
    ctx: ClientContext | undefined,
    reason: string,
  ): Promise<void> {
    await this.orderWrite.transitionStatus({
      orderId,
      to: OrderStatus.PENDING_MANUAL_PLACEMENT,
      actor,
      expectedFrom: OrderStatus.PENDING_PICK,
      reason: `Pick escalated to manual placement (${reason})`,
      ...(ctx !== undefined ? { ctx } : {}),
    });
  }
}
