import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  OrderCancellationReason,
  OrderStatus,
  ShipmentStatus,
  StockMovementType,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderWriteService } from '../../order/services/order-write.service';
import { CourierFeeAccrualService } from '../../seller-wallet-accrual/services/courier-fee-accrual.service';
import { StockReservationService } from '../../inventory-stock/services/stock-reservation.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

/** The generic catch-all courier (seeded) every manual placement is
 *  booked under — the actual carrier name is free-text reference. */
const MANUAL_COURIER_CODE = 'manual';

export interface ManualPlacementResult {
  shipmentId: string;
  orderId: string;
  awbNumber: string;
  orderStatus: OrderStatus;
  shipmentStatus: ShipmentStatus;
  /** true ⇒ idempotent no-op (order was already DISPATCHED with this
   *  manual AWB). */
  alreadyPlaced: boolean;
}

export interface ManualCancelResult {
  shipmentId: string;
  orderId: string;
  orderStatus: OrderStatus;
  /** true ⇒ idempotent no-op (order was already in a cancel terminal). */
  alreadyCancelled: boolean;
}

/** An order that already carries a manual AWB and is being picked, packed
 *  or handed over. Re-submitting the same AWB is a no-op, not a clash. */
const WAREHOUSE_IN_PROGRESS: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.PENDING_PICK,
  OrderStatus.PICKED,
  OrderStatus.PACKED,
  OrderStatus.PENDING_DISPATCH,
]);

const CANCEL_TERMINALS: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.CANCELLED,
  OrderStatus.CANCELLED_BY_ADMIN,
  OrderStatus.REJECTED,
  OrderStatus.REJECTED_BY_CUSTOMER,
  OrderStatus.REJECTED_NDR,
]);

/**
 * Module 9 — manual courier placement (commit 14, CUR-8).
 *
 * When Delhivery rejects a destination (non-serviceable) or fails AWB
 * generation, the AWB job auto-supersedes the shipment and routes the
 * order to PENDING_MANUAL_PLACEMENT (CUR-7). A MANUAL_PLACEMENT_ADMIN
 * then arranges a non-integrated courier OUT OF BAND, hands over the
 * (already picked + packed) parcel, and records the courier's AWB here.
 *
 * placeAwb:
 *   - Targets the LIVE replacement shipment (status CREATED). Its order
 *     must be PENDING_MANUAL_PLACEMENT.
 *   - CONSERVATION BY ROUTING (CUR-8, amended 2026-09-02): every ACTIVE
 *     reservation phase-2 (bin+batch populated, "ON_SHELF") ⇒ stamp the
 *     AWB and dispatch — under Model C (2026-09-03) that is stock-neutral,
 *     because ON_SHELF can only be reached having already passed through
 *     PACKED, where the decrement already fired. Any phase-1 residual
 *     ("AWAITING_PICK") ⇒ stamp the AWB and route to PENDING_PICK instead,
 *     so the parcel flows pick → pack → handoff and the DISPATCH_STOCK
 *     side-effect fires exactly once, at PACK, later. Zero ACTIVE
 *     reservations remains a genuine anomaly and is refused.
 *   - Saga ordering (visible-vs-silent): stamp the AWB on the shipment
 *     FIRST (operational, visible), then transition the order LAST (the
 *     durable lifecycle fact). A crash between leaves the order with the
 *     AWB stamped — visible + recoverable; a retry re-runs the transition
 *     (idempotent either way — the ON_SHELF path's DISPATCH gate is
 *     shipment-grained; the AWAITING_PICK path just re-enters PENDING_PICK).
 *   - Idempotent: AWB stamped + order DISPATCHED ⇒ alreadyPlaced; AWB
 *     stamped + order still PENDING_MANUAL_PLACEMENT ⇒ converge by
 *     re-running the transition.
 *
 * cancelUnfulfillable: an order no courier can carry → transition
 * PENDING_MANUAL_PLACEMENT → CANCELLED_BY_ADMIN (UNPACK_STOCK under
 * Model C: reverses whatever PACK_CONFIRM movements exist for the
 * shipment — none, if this order arrived via a pick shortfall rather
 * than a courier rejection — and releases any still-ACTIVE reservation;
 * the shipment is voided via the order engine's cancel-terminal hook).
 * Idempotent on an already-cancelled order.
 */
@Injectable()
export class ManualPlacementService {
  private readonly logger = new Logger(ManualPlacementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly orderWrite: OrderWriteService,
    private readonly reservations: StockReservationService,
    private readonly courierFeeAccrual: CourierFeeAccrualService,
  ) {}

  async placeAwb(
    shipmentId: string,
    input: { awbNumber: string; courierName: string; serviceType?: string },
    staffId: string,
    ctx?: ClientContext,
  ): Promise<ManualPlacementResult> {
    const awbNumber = input.awbNumber.trim();
    const { shipment, orderId, orderStatus, sellerId } = await this.loadShipmentContext(shipmentId);

    // Idempotency / convergent recovery.
    if (shipment.awbNumber !== null) {
      if (!shipment.isManualCourier) {
        throw new ConflictException({
          code: 'SHIPMENT_ALREADY_HAS_AWB',
          message: `Shipment ${shipmentId} already carries a courier AWB`,
        });
      }
      if (orderStatus === OrderStatus.DISPATCHED) {
        return {
          shipmentId,
          orderId,
          awbNumber: shipment.awbNumber,
          orderStatus,
          shipmentStatus: shipment.status,
          alreadyPlaced: true,
        };
      }
      if (orderStatus === OrderStatus.PENDING_MANUAL_PLACEMENT) {
        // AWB stamp landed, the transition did not — converge, to
        // whichever of the two step-2s this parcel needed.
        this.logger.warn(
          { shipmentId, orderId },
          'Manual AWB already stamped but order still PENDING_MANUAL_PLACEMENT — re-running the transition',
        );
        const readiness = await this.resolveReadiness(orderId);
        return readiness === 'ON_SHELF'
          ? this.dispatchAfterStamp(shipmentId, orderId, shipment.awbNumber, staffId, ctx)
          : this.handOffToWarehouse(shipmentId, orderId, shipment.awbNumber, staffId, ctx);
      }
      if (WAREHOUSE_IN_PROGRESS.has(orderStatus)) {
        // The AWB is on it and it is already moving through the
        // warehouse — a second submit of the same AWB is someone
        // checking, not a conflict.
        return {
          shipmentId,
          orderId,
          awbNumber: shipment.awbNumber,
          orderStatus,
          shipmentStatus: shipment.status,
          alreadyPlaced: true,
        };
      }
      throw new ConflictException({
        code: 'ORDER_NOT_MANUAL_PLACEMENT',
        message: `Order is ${orderStatus}; manual placement requires PENDING_MANUAL_PLACEMENT`,
      });
    }

    if (shipment.status !== ShipmentStatus.CREATED) {
      throw new ConflictException({
        code: 'SHIPMENT_NOT_MANUAL_ELIGIBLE',
        message: `Shipment is ${shipment.status}; manual placement requires a CREATED shipment (use the live replacement, not a superseded one)`,
      });
    }
    if (orderStatus !== OrderStatus.PENDING_MANUAL_PLACEMENT) {
      throw new ConflictException({
        code: 'ORDER_NOT_MANUAL_PLACEMENT',
        message: `Order is ${orderStatus}; manual placement requires PENDING_MANUAL_PLACEMENT`,
      });
    }

    // Does this parcel go straight out, or does it still need picking?
    const readiness = await this.resolveReadiness(orderId);

    // AWB uniqueness (shipments.awb_number is UNIQUE — pre-check for a
    // clean 409 instead of a raw DB constraint error).
    const awbClash = await this.prisma.client.shipment.findFirst({
      where: { awbNumber },
      select: { id: true },
    });
    if (awbClash !== null) {
      throw new ConflictException({
        code: 'AWB_ALREADY_IN_USE',
        message: `AWB ${awbNumber} is already assigned to another shipment`,
      });
    }

    // STEP 1 (visible-vs-silent: FIRST) — stamp the manual AWB.
    const now = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      await tx.shipment.update({
        where: { id: shipmentId },
        data: {
          awbNumber,
          courierCode: MANUAL_COURIER_CODE,
          isManualCourier: true,
          // Two facts, two columns. These used to share `serviceType`
          // as `serviceType ?? courierName`, which meant an operator who
          // typed a real service type lost the carrier name entirely and
          // nothing said so.
          manualCourierName: input.courierName.trim(),
          serviceType: input.serviceType?.trim() ?? null,
          awbGeneratedAt: now,
          // CUR-2b, exactly: carrying an AWB is not the same fact as
          // where the parcel physically IS, and both warehouse queues
          // select on `status = 'created'` (WMS-2). Stamping
          // AWB_GENERATED on a parcel that still needs picking takes it
          // out of the pick queue and the pack queue in one move, and
          // nothing reports that — the order simply never appears on a
          // picker's screen again.
          ...(readiness === 'ON_SHELF' ? { status: ShipmentStatus.AWB_GENERATED } : {}),
        },
      });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          actorId: staffId,
          sellerId,
          action: 'shipment.manual_awb_placed',
          entityType: 'shipment',
          entityId: shipmentId,
          severity: 'MEDIUM',
          metadata: {
            orderId,
            awbNumber,
            courierName: input.courierName.trim(),
            serviceType: input.serviceType ?? null,
            ipAddress: ctx?.ipAddress ?? null,
            userAgent: ctx?.userAgent ?? null,
            requestId: ctx?.requestId ?? null,
          },
        },
        tx,
      );
    });

    // The parcel is now entered with a courier — the same physical
    // event the Delhivery AWB job represents, so the same AT_AWB charge
    // hook belongs here. Without it, a manually-placed parcel on a
    // prepaid-fee seller went out unbilled at entry and only got charged
    // if it later delivered.
    await this.courierFeeAccrual.tryEarlyAccrual(orderId);

    // STEP 2 (LAST) — the durable transition.
    return readiness === 'ON_SHELF'
      ? this.dispatchAfterStamp(shipmentId, orderId, awbNumber, staffId, ctx)
      : this.handOffToWarehouse(shipmentId, orderId, awbNumber, staffId, ctx);
  }

  /** STEP 2 of placeAwb — transition the order to DISPATCHED and mark the
   *  shipment HANDED_TO_COURIER. Stock-neutral under Model C: the
   *  DISPATCH_STOCK decrement already fired at PICKED → PACKED, since
   *  reaching ON_SHELF readiness implies the parcel was already packed. */
  private async dispatchAfterStamp(
    shipmentId: string,
    orderId: string,
    awbNumber: string,
    staffId: string,
    ctx?: ClientContext,
  ): Promise<ManualPlacementResult> {
    const transition = await this.orderWrite.transitionStatus({
      orderId,
      to: OrderStatus.DISPATCHED,
      actor: { type: ActorType.STAFF, id: staffId },
      expectedFrom: OrderStatus.PENDING_MANUAL_PLACEMENT,
      reason: `Manual courier placement — AWB ${awbNumber}`,
      ...(ctx !== undefined ? { ctx } : {}),
    });

    await this.prisma.client.shipment.update({
      where: { id: shipmentId },
      data: {
        status: ShipmentStatus.HANDED_TO_COURIER,
        pickedUpByCourierAt: new Date(),
      },
    });

    return {
      shipmentId,
      orderId,
      awbNumber,
      orderStatus: transition.status,
      shipmentStatus: ShipmentStatus.HANDED_TO_COURIER,
      alreadyPlaced: false,
    };
  }

  /** STEP 2 of placeAwb, for a parcel that has not been picked yet —
   *  send it into the warehouse flow with its manual AWB already on it.
   *  No stock side-effect here: the shipment keeps its CREATED status so
   *  the pick queue can see it (WMS-2), and qtyOnHand decrements once, at
   *  DISPATCH, after pack and handoff (CUR-3) — the ordinary path, which
   *  is the point. Idempotent: re-running converges via the transition's
   *  own expectedFrom guard. */
  private async handOffToWarehouse(
    shipmentId: string,
    orderId: string,
    awbNumber: string,
    staffId: string,
    ctx?: ClientContext,
  ): Promise<ManualPlacementResult> {
    const transition = await this.orderWrite.transitionStatus({
      orderId,
      to: OrderStatus.PENDING_PICK,
      actor: { type: ActorType.STAFF, id: staffId },
      expectedFrom: OrderStatus.PENDING_MANUAL_PLACEMENT,
      reason: `Manual courier placement — AWB ${awbNumber}; parcel still to be picked`,
      ...(ctx !== undefined ? { ctx } : {}),
    });

    return {
      shipmentId,
      orderId,
      awbNumber,
      orderStatus: transition.status,
      shipmentStatus: ShipmentStatus.CREATED,
      alreadyPlaced: false,
    };
  }

  async cancelUnfulfillable(
    shipmentId: string,
    reason: string,
    staffId: string,
    ctx?: ClientContext,
  ): Promise<ManualCancelResult> {
    const { orderId, orderStatus } = await this.loadShipmentContext(shipmentId);

    if (CANCEL_TERMINALS.has(orderStatus)) {
      return { shipmentId, orderId, orderStatus, alreadyCancelled: true };
    }
    if (orderStatus !== OrderStatus.PENDING_MANUAL_PLACEMENT) {
      throw new ConflictException({
        code: 'ORDER_NOT_MANUAL_PLACEMENT',
        message: `Order is ${orderStatus}; cancel-unfulfillable requires PENDING_MANUAL_PLACEMENT`,
      });
    }

    // PENDING_MANUAL_PLACEMENT → CANCELLED_BY_ADMIN carries UNPACK_STOCK
    // under Model C (2026-09-03): if the parcel arrived here via a
    // courier rejection it already passed through PACKED, so its
    // PACK_CONFIRM movement is reversed; if it arrived via a pick
    // shortfall there is nothing to reverse and this is a clean no-op.
    // Either way any still-ACTIVE reservation is released, and the
    // cancel-terminal hook voids the shipment.
    const transition = await this.orderWrite.transitionStatus({
      orderId,
      to: OrderStatus.CANCELLED_BY_ADMIN,
      actor: { type: ActorType.STAFF, id: staffId },
      expectedFrom: OrderStatus.PENDING_MANUAL_PLACEMENT,
      cancellationReason: OrderCancellationReason.NO_COURIER_AVAILABLE,
      reason: `Manual placement cancelled — unfulfillable: ${reason}`,
      ...(ctx !== undefined ? { ctx } : {}),
    });

    return {
      shipmentId,
      orderId,
      orderStatus: transition.status,
      alreadyCancelled: false,
    };
  }

  /** Conservation guard — reject if the order is not fully phase-2
   *  allocated (a residual phase-1 reservation means the goods were
   *  never picked; dispatching would leak the reservation). */
  /**
   * Is this parcel physically ready to leave, or does it still need to be
   * picked and packed?
   *
   * This used to be `assertFullyAllocated`, and a phase-1 residual was a
   * 409 telling the operator to route the order back to PENDING_PICK
   * themselves. That is a correct conservation guard and a bad instruction:
   * the two orders that reach manual placement look identical to whoever
   * is typing the AWB, and only one of them is refused.
   *
   * The guard was written for the order that arrives here from a PICK
   * SHORTFALL (WMS-4) — already picked at, goods missing from the shelf.
   * But an order also arrives here straight from a COURIER REFUSAL at
   * confirmation (CUR-2b), and that one has never been near the warehouse.
   * Nothing is wrong with it. It needs picking, which is the ordinary next
   * step, not an error to report.
   *
   * So conservation is preserved by ROUTING rather than by refusing: a
   * parcel that is not on a shelf yet goes to PENDING_PICK with its manual
   * AWB already stamped, and dispatches through the normal pick → pack →
   * handoff path where DISPATCH_STOCK fires exactly once, at PICKED →
   * PACKED under Model C (CUR-3).
   *
   * Model C wrinkle (2026-09-03): a courier-rejection arrival (already
   * packed) now has ZERO active reservations by the time it gets here —
   * pack.complete already `fulfill()`ed it, same as this method used to
   * assume only happened at DISPATCH. "No active reservations" therefore
   * stopped being a reliable anomaly signal on its own. The real question
   * is "did this order's stock ever leave the shelf": a PACK_CONFIRM
   * movement is queried by orderId (survives a supersede — it stays keyed
   * to the ORIGINAL shipment, not the live replacement placeAwb targets)
   * as the ground truth. Zero active reservations AND no PACK_CONFIRM
   * movement is the only shape left that is a genuine anomaly.
   */
  private async resolveReadiness(orderId: string): Promise<'ON_SHELF' | 'AWAITING_PICK'> {
    const active = await this.reservations.listActiveForOrderWithLocations(orderId);
    if (active.length === 0) {
      const packed = await this.prisma.client.stockMovement.findFirst({
        where: { orderId, type: StockMovementType.PACK_CONFIRM },
        select: { id: true },
      });
      if (packed !== null) {
        return 'ON_SHELF';
      }
      throw new ConflictException({
        code: 'MANUAL_PLACEMENT_NO_RESERVATIONS',
        message: `Order ${orderId} has no active reservations — cannot manually dispatch`,
      });
    }
    const unallocated = active.some((r) => r.binId === null || r.batchId === null);
    return unallocated ? 'AWAITING_PICK' : 'ON_SHELF';
  }

  /** Load a shipment + its order context (the latest OrderShipment
   *  junction). */
  private async loadShipmentContext(shipmentId: string): Promise<{
    shipment: {
      id: string;
      status: ShipmentStatus;
      awbNumber: string | null;
      isManualCourier: boolean;
    };
    orderId: string;
    orderStatus: OrderStatus;
    sellerId: string;
  }> {
    const shipment = await this.prisma.client.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        status: true,
        awbNumber: true,
        isManualCourier: true,
        orderShipments: {
          select: {
            order: { select: { id: true, status: true, sellerId: true } },
          },
          orderBy: { shipmentSequence: 'desc' },
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
    const order = shipment.orderShipments[0]?.order;
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_SHIPMENT_MISSING',
        message: `Shipment ${shipmentId} has no OrderShipment junction`,
      });
    }
    return {
      shipment: {
        id: shipment.id,
        status: shipment.status,
        awbNumber: shipment.awbNumber,
        isManualCourier: shipment.isManualCourier,
      },
      orderId: order.id,
      orderStatus: order.status,
      sellerId: order.sellerId,
    };
  }
}
