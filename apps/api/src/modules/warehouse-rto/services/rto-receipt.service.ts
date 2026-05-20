import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, OrderStatus, ShipmentStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderReadService } from '../../order/services/order-read.service';
import { OrderWriteService } from '../../order/services/order-write.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

export interface ReceiveRtoResult {
  shipmentId: string;
  orderId: string;
  awbNumber: string;
  status: OrderStatus;
  rtoReceivedAt: Date;
  /** true ⇒ idempotent no-op (already RTO_RECEIVED + stamped). */
  alreadyReceived: boolean;
}

/**
 * Module 8 — RTO receipt (commit 14, WMS-8). Marks the parcel as
 * physically arrived at the warehouse for RTO processing: stamps
 * shipment.rtoReceivedAt + drives the order to RTO_RECEIVED.
 *
 * Saga discipline (mirrors PickExecutionService.complete /
 * PackService.complete): operational stamp FIRST (guarded updateMany
 * idempotent on retry), authoritative transitionStatus LAST. Cross-
 * boundary failure (stamp OK / transition FAIL) leaves a TRUTHFUL
 * intermediate (rtoReceivedAt set, order still RTO_IN_TRANSIT/INITIATED)
 * that converges on retry — the stamp's guard skips re-application and
 * the transition retries cleanly.
 */
@Injectable()
export class RtoReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderReadService,
    private readonly orderWrite: OrderWriteService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Receive the RTO parcel by AWB. Canonical AWB is `shipments.awbNumber`
   * (Layer 7; `awb_labels` is the versioned PDF table, separate
   * concern). 404 on missing AWB / shipment / order. 409
   * ORDER_NOT_RTO_RECEIVABLE when the order is not in
   * {RTO_INITIATED, RTO_IN_TRANSIT} — the only inbound matrix edges to
   * RTO_RECEIVED.
   */
  async receive(
    awbNumber: string,
    staffId: string,
    ctx?: ClientContext,
  ): Promise<ReceiveRtoResult> {
    const shipment = await this.prisma.client.shipment.findFirst({
      where: { awbNumber, deletedAt: null },
      select: {
        id: true,
        awbNumber: true,
        status: true,
        rtoReceivedAt: true,
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
        message: `No shipment found with AWB ${awbNumber}`,
      });
    }
    const orderId = shipment.orderShipments[0]?.orderId;
    if (orderId === undefined) {
      throw new NotFoundException({
        code: 'ORDER_SHIPMENT_MISSING',
        message: `Shipment ${shipment.id} has no OrderShipment junction`,
      });
    }
    const order = await this.orders.getById(orderId);
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: `Order ${orderId} for shipment ${shipment.id} not found`,
      });
    }

    // Idempotent short-circuit: already RTO_RECEIVED + stamped.
    if (
      order.status === OrderStatus.RTO_RECEIVED &&
      shipment.rtoReceivedAt !== null
    ) {
      return {
        shipmentId: shipment.id,
        orderId,
        awbNumber,
        status: OrderStatus.RTO_RECEIVED,
        rtoReceivedAt: shipment.rtoReceivedAt,
        alreadyReceived: true,
      };
    }
    if (
      order.status !== OrderStatus.RTO_INITIATED &&
      order.status !== OrderStatus.RTO_IN_TRANSIT
    ) {
      throw new ConflictException({
        code: 'ORDER_NOT_RTO_RECEIVABLE',
        message: `Order is ${order.status}; RTO receive requires RTO_INITIATED or RTO_IN_TRANSIT`,
      });
    }

    const now = new Date();
    // 1. OPERATIONAL stamp FIRST (idempotent: a retry after a failed
    //    transition finds rtoReceivedAt already set → count 0, original
    //    timestamp preserved).
    const stamped = await this.prisma.client.shipment.updateMany({
      where: {
        id: shipment.id,
        rtoReceivedAt: null,
      },
      data: { rtoReceivedAt: now },
    });
    const rtoReceivedAt =
      stamped.count === 1 ? now : (shipment.rtoReceivedAt ?? now);

    // 2. AUTHORITATIVE transition LAST. expectedFrom uses the order's
    //    actual current status — RTO_INITIATED or RTO_IN_TRANSIT — so
    //    the matrix accepts either path.
    await this.orderWrite.transitionStatus({
      orderId,
      to: OrderStatus.RTO_RECEIVED,
      actor: { type: ActorType.STAFF, id: staffId },
      expectedFrom: order.status,
      reason: `RTO parcel ${awbNumber} received at warehouse`,
      ...(ctx !== undefined ? { ctx } : {}),
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'rto.received',
      entityType: 'shipment',
      entityId: shipment.id,
      severity: 'LOW',
      metadata: {
        orderId,
        awbNumber,
        priorStatus: order.status,
        shipmentStatus: shipment.status as ShipmentStatus,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    return {
      shipmentId: shipment.id,
      orderId,
      awbNumber,
      status: OrderStatus.RTO_RECEIVED,
      rtoReceivedAt,
      alreadyReceived: false,
    };
  }
}
