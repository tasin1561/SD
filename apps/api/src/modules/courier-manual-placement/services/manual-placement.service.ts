import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  OrderCancellationReason,
  OrderStatus,
  ShipmentStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderWriteService } from '../../order/services/order-write.service';
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
 *   - CONSERVATION GUARD: every ACTIVE reservation must be phase-2
 *     (bin+batch populated). A pick-shortfall PENDING_MANUAL_PLACEMENT
 *     order (residual phase-1 reservation, goods not on a shelf) is
 *     REJECTED — it must re-pick via → PENDING_PICK first. Dispatching
 *     it would decrement nothing and leak the reservation (Model A
 *     conservation cannot hold).
 *   - Saga ordering (visible-vs-silent): stamp the AWB on the shipment
 *     FIRST (operational, visible), then transition the order
 *     PENDING_MANUAL_PLACEMENT → DISPATCHED LAST (the durable lifecycle
 *     fact + the Model-A DISPATCH_STOCK qtyOnHand decrement). A crash
 *     between leaves the order PENDING_MANUAL_PLACEMENT with the AWB
 *     stamped — visible + recoverable; a retry re-runs the transition
 *     (the DISPATCH gate is shipment-grained idempotent).
 *   - Idempotent: AWB stamped + order DISPATCHED ⇒ alreadyPlaced; AWB
 *     stamped + order still PENDING_MANUAL_PLACEMENT ⇒ converge by
 *     re-running the transition.
 *
 * cancelUnfulfillable: an order no courier can carry → transition
 * PENDING_MANUAL_PLACEMENT → CANCELLED_BY_ADMIN (RELEASE_STOCK releases
 * the reservations; the shipment is voided via the order engine's
 * cancel-terminal hook). Idempotent on an already-cancelled order.
 */
@Injectable()
export class ManualPlacementService {
  private readonly logger = new Logger(ManualPlacementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly orderWrite: OrderWriteService,
    private readonly reservations: StockReservationService,
  ) {}

  async placeAwb(
    shipmentId: string,
    input: { awbNumber: string; courierName?: string; serviceType?: string },
    staffId: string,
    ctx?: ClientContext,
  ): Promise<ManualPlacementResult> {
    const awbNumber = input.awbNumber.trim();
    const { shipment, orderId, orderStatus, sellerId } =
      await this.loadShipmentContext(shipmentId);

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
        // AWB stamp landed, the transition did not — converge.
        this.logger.warn(
          { shipmentId, orderId },
          'Manual AWB already stamped but order still PENDING_MANUAL_PLACEMENT — re-running the dispatch transition',
        );
        return this.dispatchAfterStamp(
          shipmentId,
          orderId,
          shipment.awbNumber,
          staffId,
          ctx,
        );
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

    // CONSERVATION GUARD — every ACTIVE reservation must be phase-2.
    await this.assertFullyAllocated(orderId);

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
          serviceType: input.serviceType ?? input.courierName ?? null,
          awbGeneratedAt: now,
          status: ShipmentStatus.AWB_GENERATED,
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
            courierName: input.courierName ?? null,
            serviceType: input.serviceType ?? null,
            ipAddress: ctx?.ipAddress ?? null,
            userAgent: ctx?.userAgent ?? null,
            requestId: ctx?.requestId ?? null,
          },
        },
        tx,
      );
    });

    // STEP 2 (LAST) — the durable transition + Model-A DISPATCH_STOCK.
    return this.dispatchAfterStamp(shipmentId, orderId, awbNumber, staffId, ctx);
  }

  /** STEP 2 of placeAwb — transition the order to DISPATCHED (the
   *  DISPATCH_STOCK side-effect fires) and mark the shipment
   *  HANDED_TO_COURIER. Idempotent: the DISPATCH movement gate is
   *  shipment-grained, so a re-run after a crash never double-decrements. */
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

    // PENDING_MANUAL_PLACEMENT → CANCELLED_BY_ADMIN carries RELEASE_STOCK
    // (the engine releases every ACTIVE reservation) and the
    // cancel-terminal hook voids the shipment. No qtyOnHand change —
    // nothing was dispatched (Model A).
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
  private async assertFullyAllocated(orderId: string): Promise<void> {
    const active =
      await this.reservations.listActiveForOrderWithLocations(orderId);
    if (active.length === 0) {
      throw new ConflictException({
        code: 'MANUAL_PLACEMENT_NO_RESERVATIONS',
        message: `Order ${orderId} has no active reservations — cannot manually dispatch`,
      });
    }
    const unallocated = active.some(
      (r) => r.binId === null || r.batchId === null,
    );
    if (unallocated) {
      throw new ConflictException({
        code: 'MANUAL_PLACEMENT_NOT_ALLOCATED',
        message:
          'Order is not fully picked (a phase-1 reservation residual remains) — route it back to PENDING_PICK and re-pick before manual placement',
      });
    }
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
