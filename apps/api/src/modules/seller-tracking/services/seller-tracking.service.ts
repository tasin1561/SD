import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ShipmentStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export interface TrackedShipmentRow {
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly awbNumber: string | null;
  readonly courierCode: string;
  readonly status: ShipmentStatus;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly recipientName: string;
  readonly recipientCity: string;
  readonly lastScanAt: Date | null;
  readonly lastScanStatus: ShipmentStatus | null;
  readonly lastScanDescription: string | null;
  readonly lastScanLocation: string | null;
  /** How many delivery attempts have failed. Zero for most parcels. */
  readonly failedAttempts: number;
  readonly createdAt: Date;
}

export interface TrackedShipmentDetail extends TrackedShipmentRow {
  readonly events: ReadonlyArray<{
    id: string;
    eventAt: Date;
    status: ShipmentStatus;
    description: string | null;
    location: string | null;
    source: string;
  }>;
  readonly attempts: ReadonlyArray<{
    id: string;
    attemptNumber: number;
    attemptedAt: Date;
    outcome: string;
    failureReason: string | null;
    failureNotes: string | null;
    nextAttemptScheduledAt: Date | null;
  }>;
}

/**
 * Where a seller's parcels are.
 *
 * Distinct from the PUBLIC tracking projection (TRK-8) on purpose. That
 * one is deliberately blind — no internal ids, no PII, no raw courier
 * codes, no failure reasons — because anyone with an AWB can read it.
 * This is the seller's OWN data, and the things the public view hides
 * are exactly the things they need: why a delivery failed, how many
 * attempts have been made, when the next one is due.
 *
 * Ownership is the WHERE clause, never a check afterwards: every query
 * joins through `order_shipments -> orders.sellerId`, so a shipment that
 * is not theirs cannot be returned and then filtered out.
 */
@Injectable()
export class SellerTrackingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Only parcels that have LEFT. A shipment with no AWB has not been
   * handed to anyone, so it has nothing to track and would sit in the
   * list as a permanent "no updates yet".
   */
  private static readonly IN_FLIGHT = { awbNumber: { not: null }, deletedAt: null } as const;

  async list(
    sellerId: string,
    query: { status?: ShipmentStatus; search?: string; limit?: number },
  ): Promise<TrackedShipmentRow[]> {
    const where: Prisma.ShipmentWhereInput = {
      ...SellerTrackingService.IN_FLIGHT,
      orderShipments: { some: { order: { sellerId, deletedAt: null } } },
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.search === undefined || query.search.trim() === ''
        ? {}
        : {
            OR: [
              { awbNumber: { contains: query.search.trim(), mode: 'insensitive' } },
              { shipmentNumber: { contains: query.search.trim(), mode: 'insensitive' } },
              { destRecipientName: { contains: query.search.trim(), mode: 'insensitive' } },
            ],
          }),
    };

    const rows = await this.prisma.client.shipment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, query.limit ?? 100)),
      select: {
        id: true,
        shipmentNumber: true,
        awbNumber: true,
        courierCode: true,
        status: true,
        destRecipientName: true,
        destCity: true,
        createdAt: true,
        orderShipments: {
          select: { order: { select: { id: true, orderNumber: true } } },
          orderBy: { shipmentSequence: 'asc' },
          take: 1,
        },
        // The newest scan only. Pulling a whole timeline per row to show
        // one line of it is how a list page starts timing out once a
        // seller has a few hundred parcels.
        trackingEvents: {
          orderBy: { eventAt: 'desc' },
          take: 1,
          select: { eventAt: true, status: true, description: true, locationCity: true },
        },
        _count: { select: { deliveryAttempts: true } },
      },
    });

    return rows.map((r) => {
      const scan = r.trackingEvents[0] ?? null;
      const order = r.orderShipments[0]?.order ?? null;
      return {
        shipmentId: r.id,
        shipmentNumber: r.shipmentNumber,
        awbNumber: r.awbNumber,
        courierCode: r.courierCode,
        status: r.status,
        orderId: order?.id ?? '',
        orderNumber: order?.orderNumber ?? '',
        recipientName: r.destRecipientName,
        recipientCity: r.destCity,
        lastScanAt: scan?.eventAt ?? null,
        lastScanStatus: scan?.status ?? null,
        lastScanDescription: scan?.description ?? null,
        lastScanLocation: scan?.locationCity ?? null,
        failedAttempts: r._count.deliveryAttempts,
        createdAt: r.createdAt,
      };
    });
  }

  /** One parcel's full history. */
  async detail(sellerId: string, shipmentId: string): Promise<TrackedShipmentDetail> {
    const row = await this.prisma.client.shipment.findFirst({
      where: {
        id: shipmentId,
        deletedAt: null,
        // Ownership in the WHERE. A seller asking for somebody else's
        // shipment gets the same 404 as one asking for a shipment that
        // does not exist — the two are indistinguishable on purpose.
        orderShipments: { some: { order: { sellerId, deletedAt: null } } },
      },
      select: {
        id: true,
        shipmentNumber: true,
        awbNumber: true,
        courierCode: true,
        status: true,
        destRecipientName: true,
        destCity: true,
        createdAt: true,
        orderShipments: {
          select: { order: { select: { id: true, orderNumber: true } } },
          orderBy: { shipmentSequence: 'asc' },
          take: 1,
        },
        trackingEvents: {
          // eventAt, never createdAt: the scan time is when it happened,
          // and a backfilled scan must land in the right place in the
          // story rather than at the end of it (TRK-3).
          orderBy: { eventAt: 'desc' },
          select: {
            id: true,
            eventAt: true,
            status: true,
            description: true,
            locationCity: true,
            locationName: true,
            source: true,
          },
        },
        deliveryAttempts: {
          orderBy: { attemptedAt: 'desc' },
          select: {
            id: true,
            attemptNumber: true,
            attemptedAt: true,
            outcome: true,
            failureReason: true,
            failureNotes: true,
            nextAttemptScheduledAt: true,
          },
        },
      },
    });
    if (row === null) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: 'No parcel found with that reference',
      });
    }

    const scan = row.trackingEvents[0] ?? null;
    const order = row.orderShipments[0]?.order ?? null;
    return {
      shipmentId: row.id,
      shipmentNumber: row.shipmentNumber,
      awbNumber: row.awbNumber,
      courierCode: row.courierCode,
      status: row.status,
      orderId: order?.id ?? '',
      orderNumber: order?.orderNumber ?? '',
      recipientName: row.destRecipientName,
      recipientCity: row.destCity,
      lastScanAt: scan?.eventAt ?? null,
      lastScanStatus: scan?.status ?? null,
      lastScanDescription: scan?.description ?? null,
      lastScanLocation: scan?.locationCity ?? null,
      failedAttempts: row.deliveryAttempts.length,
      createdAt: row.createdAt,
      events: row.trackingEvents.map((e) => ({
        id: e.id,
        eventAt: e.eventAt,
        status: e.status,
        description: e.description,
        location: e.locationCity ?? e.locationName,
        source: e.source,
      })),
      attempts: row.deliveryAttempts.map((a) => ({
        id: a.id,
        attemptNumber: a.attemptNumber,
        attemptedAt: a.attemptedAt,
        outcome: a.outcome,
        failureReason: a.failureReason,
        failureNotes: a.failureNotes,
        nextAttemptScheduledAt: a.nextAttemptScheduledAt,
      })),
    };
  }

  /** The timeline for an ORDER, so the seller never needs the AWB. */
  async forOrder(sellerId: string, orderId: string): Promise<TrackedShipmentDetail[]> {
    const shipments = await this.prisma.client.shipment.findMany({
      where: {
        deletedAt: null,
        orderShipments: { some: { orderId, order: { sellerId, deletedAt: null } } },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return Promise.all(shipments.map((s) => this.detail(sellerId, s.id)));
  }
}
