import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  OrderStatus,
  RtoDisposition,
  RtoItemCondition,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderReadService } from '../../order/services/order-read.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

export interface InspectRtoItemInput {
  condition: RtoItemCondition;
  disposition: RtoDisposition;
  notes?: string | null;
}

export interface InspectRtoItemResult {
  shipmentItemId: string;
  shipmentId: string;
  orderId: string;
  rtoCondition: RtoItemCondition;
  rtoDisposition: RtoDisposition;
  rtoDisposedByStaffId: string;
  rtoInspectionNotes: string | null;
}

/**
 * Module 8 — per-item RTO inspection (commit 14, WMS-8). The
 * warehouse operator records each returned line's condition + intended
 * disposition. Multiple shipment_items per parcel inspected separately;
 * finalize (commit 15) requires ALL lines inspected before atomic
 * disposition.
 *
 * Pick-allocation source-of-truth invariant (CP1 Option A): the
 * authoritative pick context is the phase-2 reservations; shipment_items
 * is operational metadata. RTO inspection follows the same pattern —
 * shipment_items.rto* columns are operational, NOT cross-domain authority.
 *
 * Idempotent on re-inspection (operator may correct judgment); the
 * update overwrites prior values and re-audits. Gated on order.status
 * === RTO_RECEIVED so inspection can only happen on a received parcel.
 */
@Injectable()
export class RtoInspectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderReadService,
    private readonly audit: AuditLogService,
  ) {}

  async inspect(
    shipmentItemId: string,
    input: InspectRtoItemInput,
    staffId: string,
    ctx?: ClientContext,
  ): Promise<InspectRtoItemResult> {
    const item = await this.prisma.client.shipmentItem.findUnique({
      where: { id: shipmentItemId },
      select: {
        id: true,
        shipmentId: true,
        shipment: {
          select: {
            id: true,
            orderShipments: {
              select: { orderId: true },
              orderBy: { shipmentSequence: 'asc' },
              take: 1,
            },
          },
        },
      },
    });
    if (!item) {
      throw new NotFoundException({
        code: 'SHIPMENT_ITEM_NOT_FOUND',
        message: `Shipment item ${shipmentItemId} not found`,
      });
    }
    const orderId = item.shipment.orderShipments[0]?.orderId;
    if (orderId === undefined) {
      throw new NotFoundException({
        code: 'ORDER_SHIPMENT_MISSING',
        message: 'Shipment item has no resolvable order',
      });
    }
    const order = await this.orders.getById(orderId);
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: `Order ${orderId} not found`,
      });
    }
    if (order.status !== OrderStatus.RTO_RECEIVED) {
      throw new ConflictException({
        code: 'ORDER_NOT_INSPECTABLE',
        message: `Order is ${order.status}; RTO inspection requires RTO_RECEIVED`,
      });
    }

    const notes = input.notes ?? null;
    await this.prisma.client.shipmentItem.update({
      where: { id: shipmentItemId },
      data: {
        rtoCondition: input.condition,
        rtoDisposition: input.disposition,
        rtoDisposedByStaffId: staffId,
        rtoInspectionNotes: notes,
      },
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'rto.inspected',
      entityType: 'shipment_item',
      entityId: shipmentItemId,
      severity: 'MEDIUM',
      metadata: {
        orderId,
        shipmentId: item.shipmentId,
        condition: input.condition,
        disposition: input.disposition,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    return {
      shipmentItemId,
      shipmentId: item.shipmentId,
      orderId,
      rtoCondition: input.condition,
      rtoDisposition: input.disposition,
      rtoDisposedByStaffId: staffId,
      rtoInspectionNotes: notes,
    };
  }
}
