import { Injectable, NotFoundException } from '@nestjs/common';
import { ShipmentStatus, TrackingEventType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  WHATSAPP_COURIER,
  WHATSAPP_FAILED_EVENTS,
  WHATSAPP_OFD_EVENTS,
  WHATSAPP_TAIL_MS,
  WHATSAPP_VIEWER_STALE_MS,
} from '../whatsapp.constants';
import { CourierWhatsappRequestService } from './courier-whatsapp-request.service';
import { WhatsappBreakerStore } from './whatsapp-breaker.store';

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
  /** A fresh read was just queued; the page polls for it briefly. */
  readonly checking: boolean;
  /** The reader's breaker is open until this instant: shown messages may be behind. */
  readonly pausedUntil: string | null;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly request: CourierWhatsappRequestService,
    private readonly breaker: WhatsappBreakerStore,
  ) {}

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
      return {
        enabled,
        shipmentId: null,
        awbNumber: null,
        lastCheckedAt: null,
        checking: false,
        messages: [],
      };
    }
    const ship = await this.prisma.client.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        awbNumber: true,
        courierCode: true,
        status: true,
        courierWhatsappCheck: { select: { lastAttemptAt: true } },
        courierWhatsappMessages: {
          select: { text: true, sentLabel: true, sentAt: true },
          // Insertion order is the window's order: ids are uuidv7.
          orderBy: { id: 'asc' },
        },
      },
    });
    const last = ship?.courierWhatsappCheck?.lastAttemptAt ?? null;
    // Viewer-driven refresh: opening an order whose copy is stale queues
    // ONE read (jobId-deduped, 2-minute per-parcel floor). Delhivery is
    // never called here — the worker does it.
    const bs = await this.breaker.state().catch(() => null);
    const pausedUntil =
      bs !== null && bs.status === 'open' && bs.openUntil !== null && bs.openUntil > Date.now()
        ? new Date(bs.openUntil).toISOString()
        : null;
    let checking = false;
    if (
      enabled &&
      pausedUntil === null &&
      ship !== null &&
      ship.courierCode === WHATSAPP_COURIER &&
      ship.awbNumber !== null &&
      (last === null || Date.now() - last.getTime() > WHATSAPP_VIEWER_STALE_MS) &&
      (await this.worthReading(shipmentId, ship.status))
    ) {
      const out = await this.request.request(shipmentId, { kind: 'viewer' }).catch(() => null);
      checking = out?.queued === true;
    }
    return {
      enabled,
      checking,
      pausedUntil,
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

  /** A delivery-time scan exists, and the parcel is live or finished under 7 days ago. */
  private async worthReading(shipmentId: string, status: ShipmentStatus): Promise<boolean> {
    const trigger = await this.prisma.client.trackingEvent.findFirst({
      where: {
        shipmentId,
        eventType: {
          in: [...WHATSAPP_OFD_EVENTS, ...WHATSAPP_FAILED_EVENTS].map((t) => TrackingEventType[t]),
        },
      },
      select: { eventAt: true },
    });
    if (trigger === null) return false;
    const finished: readonly ShipmentStatus[] = [
      ShipmentStatus.DELIVERED,
      ShipmentStatus.RTO_DELIVERED,
      ShipmentStatus.CANCELLED,
      ShipmentStatus.LOST,
      ShipmentStatus.DAMAGED,
    ];
    if (!finished.includes(status)) return true;
    const latest = await this.prisma.client.trackingEvent.findFirst({
      where: { shipmentId },
      orderBy: { eventAt: 'desc' },
      select: { eventAt: true },
    });
    return latest !== null && Date.now() - latest.eventAt.getTime() < WHATSAPP_TAIL_MS;
  }
}
