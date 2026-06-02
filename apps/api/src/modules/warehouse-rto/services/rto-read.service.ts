import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type OrderStatus,
  type RtoDisposition,
  type RtoItemCondition,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Read-only listing of a shipment + its items for the RTO operator UI.
 *
 * The inspect endpoint is keyed on shipment_item_id; without a
 * lookup the operator has nowhere to source those ids. This service
 * provides the lookup. Returns the shipment header (number, status,
 * order id) + every shipment_item with its current rtoCondition /
 * rtoDisposition (null until inspect is called).
 *
 * No RBAC scoping yet (Phase 1A — staff JWT is enough); operator
 * roles will gate this when the RBAC matrix lands.
 */
export interface RtoShipmentItem {
  shipmentItemId: string;
  orderItemId: string;
  skuCode: string;
  productName: string;
  variantLabel: string | null;
  quantity: number;
  rtoCondition: RtoItemCondition | null;
  rtoDisposition: RtoDisposition | null;
  rtoInspectionNotes: string | null;
}

export interface RtoShipmentDetail {
  shipmentId: string;
  shipmentNumber: string;
  orderId: string | null;
  orderStatus: OrderStatus | null;
  awbNumber: string | null;
  rtoReceivedAt: Date | null;
  items: RtoShipmentItem[];
}

@Injectable()
export class RtoReadService {
  constructor(private readonly prisma: PrismaService) {}

  async loadShipment(shipmentId: string): Promise<RtoShipmentDetail> {
    const shipment = await this.prisma.client.shipment.findFirst({
      where: { id: shipmentId, deletedAt: null },
      select: {
        id: true,
        shipmentNumber: true,
        awbNumber: true,
        rtoReceivedAt: true,
        orderShipments: {
          select: {
            order: {
              select: {
                id: true,
                status: true,
              },
            },
          },
        },
        items: {
          select: {
            id: true,
            orderItemId: true,
            skuCode: true,
            productName: true,
            variantLabel: true,
            quantity: true,
            rtoCondition: true,
            rtoDisposition: true,
            rtoInspectionNotes: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!shipment) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: `Shipment ${shipmentId} not found`,
      });
    }
    const firstOrder = shipment.orderShipments[0]?.order ?? null;
    return {
      shipmentId: shipment.id,
      shipmentNumber: shipment.shipmentNumber,
      orderId: firstOrder?.id ?? null,
      orderStatus: (firstOrder?.status as OrderStatus | undefined) ?? null,
      awbNumber: shipment.awbNumber,
      rtoReceivedAt: shipment.rtoReceivedAt,
      items: shipment.items.map((it) => ({
        shipmentItemId: it.id,
        orderItemId: it.orderItemId,
        skuCode: it.skuCode,
        productName: it.productName,
        variantLabel: it.variantLabel,
        quantity: it.quantity,
        rtoCondition: it.rtoCondition,
        rtoDisposition: it.rtoDisposition,
        rtoInspectionNotes: it.rtoInspectionNotes,
      })),
    };
  }
}
