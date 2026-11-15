import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export interface CourierWhatsappMessageView {
  readonly text: string;
  /** The time exactly as the courier's window showed it. */
  readonly sentLabel: string;
  /** Only when the label carried a full date; otherwise null. */
  readonly sentAt: string | null;
}

export interface CourierWhatsappView {
  readonly enabled: boolean;
  readonly shipmentId: string | null;
  readonly awbNumber: string | null;
  readonly lastCheckedAt: string | null;
  readonly messages: readonly CourierWhatsappMessageView[];
}

/** Who is asking; the order lookup is scoped by it, in the query. */
export type WhatsappScope = { readonly sellerId: string | null };

/**
 * Read side. The caller has ALREADY proven the order is theirs (seller
 * id in the query, or the store's own order read for stores and
 * associates); this only turns an order id into its live parcel's
 * stored messages.
 */
@Injectable()
export class CourierWhatsappReadService {
  constructor(private readonly prisma: PrismaService) {}

  /** @param scope sellerId set → the order must be that seller's (404 otherwise). */
  async forOrder(orderId: string, scope: WhatsappScope): Promise<CourierWhatsappView> {
    const order = await this.prisma.client.order.findFirst({
      where: {
        id: orderId,
        deletedAt: null,
        ...(scope.sellerId === null ? {} : { sellerId: scope.sellerId }),
      },
      select: {
        orderShipments: {
          select: { shipmentId: true },
          orderBy: { shipmentSequence: 'desc' },
          take: 1,
        },
      },
    });
    if (order === null) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'No order found with that reference',
      });
    }
    return this.forShipment(order.orderShipments[0]?.shipmentId ?? null);
  }

  /** For callers whose scope is already proven (store / associate). */
  async forProvenOrder(orderId: string): Promise<CourierWhatsappView> {
    const link = await this.prisma.client.orderShipment.findFirst({
      where: { orderId },
      orderBy: { shipmentSequence: 'desc' },
      select: { shipmentId: true },
    });
    return this.forShipment(link?.shipmentId ?? null);
  }

  private async forShipment(shipmentId: string | null): Promise<CourierWhatsappView> {
    const enabled =
      (
        await this.prisma.client.systemSetting.findUnique({
          where: { key: 'courier.delhivery_whatsapp_enabled' },
          select: { valueBoolean: true },
        })
      )?.valueBoolean === true;
    if (shipmentId === null) {
      return { enabled, shipmentId: null, awbNumber: null, lastCheckedAt: null, messages: [] };
    }
    const ship = await this.prisma.client.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        awbNumber: true,
        courierWhatsappCheck: { select: { lastAttemptAt: true } },
        courierWhatsappMessages: {
          select: { text: true, sentLabel: true, sentAt: true },
          // Insertion order is the window's order: ids are uuidv7.
          orderBy: { id: 'asc' },
        },
      },
    });
    return {
      enabled,
      shipmentId,
      awbNumber: ship?.awbNumber ?? null,
      lastCheckedAt: ship?.courierWhatsappCheck?.lastAttemptAt.toISOString() ?? null,
      messages: (ship?.courierWhatsappMessages ?? []).map((m) => ({
        text: m.text,
        sentLabel: m.sentLabel,
        sentAt: m.sentAt?.toISOString() ?? null,
      })),
    };
  }
}
