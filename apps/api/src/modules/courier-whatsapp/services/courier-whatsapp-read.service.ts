import { Injectable, NotFoundException } from '@nestjs/common';
import { ShipmentStatus, TicketStatus, TrackingEventType } from '@skydrop/db';
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

/** The Delhivery taxonomy category the staff "fake attempt" ticket is raised under. */
export const FAKE_ATTEMPT_CATEGORY = 'not-delivered.fake-remark';
export const FAKE_ATTEMPT_OPEN_STATUSES: readonly TicketStatus[] = [
  TicketStatus.OPEN,
  TicketStatus.NEGOTIATING,
];

export interface CourierWhatsappMessageView {
  readonly text: string;
  /** The time exactly as the courier's window showed it. */
  readonly sentLabel: string;
  /** Only when the label carried a full date; otherwise null. */
  readonly sentAt: string | null;
}

/** Delhivery's NDR panel facts (latest snapshot). null field = could not read. */
export interface CourierNdrView {
  readonly open: boolean | null;
  readonly attemptsFailed: number | null;
  readonly attemptsMax: number | null;
  readonly deadlineDays: number | null;
  readonly remarkVerified: boolean | null;
  /** The courier's own words: staff only, otherwise null. */
  readonly reasonText: string | null;
  readonly readAt: string;
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
  /**
   * Delhivery no longer shows this conversation (it was taken off their
   * panel). The messages below are our saved copy; no further reads.
   */
  readonly closed: boolean;
  readonly messages: readonly CourierWhatsappMessageView[];
  /** Latest NDR panel snapshot, or null when none was ever read. */
  readonly ndr: CourierNdrView | null;
  /**
   * STAFF only: the open "fake attempt" ticket of this parcel, if any.
   * Always null for a client / store / associate.
   */
  readonly fakeAttemptTicket: { readonly id: string; readonly number: string } | null;
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
    // Staff (no seller scope) see the courier's words whole; a client does not.
    return this.forShipment(order.orderShipments[0]?.shipmentId ?? null, scope.sellerId !== null);
  }

  /** For callers whose scope is already proven (store / associate). */
  async forProvenOrder(orderId: string): Promise<CourierWhatsappView> {
    const link = await this.prisma.client.orderShipment.findFirst({
      where: { orderId },
      orderBy: { shipmentSequence: 'desc' },
      select: { shipmentId: true },
    });
    return this.forShipment(link?.shipmentId ?? null, true);
  }

  private async forShipment(
    shipmentId: string | null,
    maskOtp: boolean,
  ): Promise<CourierWhatsappView> {
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
        pausedUntil: null,
        closed: false,
        messages: [],
        ndr: null,
        fakeAttemptTicket: null,
      };
    }
    const ship = await this.prisma.client.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        awbNumber: true,
        courierCode: true,
        status: true,
        courierWhatsappCheck: { select: { lastAttemptAt: true, lastOutcome: true } },
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
    const closed = ship?.courierWhatsappCheck?.lastOutcome === 'HIDDEN';
    let checking = false;
    if (
      enabled &&
      !closed &&
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
    const snap = await this.prisma.client.courierNdrPanelSnapshot.findFirst({
      where: { shipmentId },
      orderBy: [{ readAt: 'desc' }, { id: 'desc' }],
    });
    const fake = maskOtp
      ? null
      : await this.prisma.client.ticket.findFirst({
          where: {
            shipmentId,
            issueCategoryExternalId: FAKE_ATTEMPT_CATEGORY,
            status: { in: [...FAKE_ATTEMPT_OPEN_STATUSES] },
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, ticketNumber: true },
        });
    return {
      enabled,
      checking,
      pausedUntil,
      closed,
      shipmentId,
      awbNumber: ship?.awbNumber ?? null,
      lastCheckedAt: ship?.courierWhatsappCheck?.lastAttemptAt.toISOString() ?? null,
      ndr:
        snap === null
          ? null
          : {
              open: snap.open,
              attemptsFailed: snap.attemptsFailed,
              attemptsMax: snap.attemptsMax,
              deadlineDays: snap.deadlineDays,
              remarkVerified: snap.remarkVerified,
              reasonText: maskOtp ? null : snap.reasonText,
              readAt: snap.readAt.toISOString(),
            },
      fakeAttemptTicket: fake === null ? null : { id: fake.id, number: fake.ticketNumber },
      messages: (ship?.courierWhatsappMessages ?? []).map((m) => ({
        text: maskOtp ? maskDeliveryOtp(m.text) : m.text,
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

/**
 * Delhivery's out-for-delivery message carries the CUSTOMER's delivery
 * OTP ("Share OTP 7397 only when they arrive"). Owner, 2026-11-16: only
 * staff may see it — a client, member store or associate sees "OTP ••••".
 * The stored message is untouched (insert-only); this is display only.
 */
export function maskDeliveryOtp(text: string): string {
  return text.replace(/(\bOTP\b[^0-9]{0,12})\d{3,8}/gi, '$1••••');
}
