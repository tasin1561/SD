import { Injectable } from '@nestjs/common';
import { OrderStatus, ShipmentStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TrackingEventAppendService } from '../../tracking-events/services/tracking-event-append.service';
import { NSA_PARCEL_GONE_STATUSES } from './order-attention.service';

/**
 * One parcel the courier tried and failed to deliver, still with the
 * courier. Every field is the seller's own order's data; the NDR panel
 * facts are optional (no snapshot yet). `reasonText` is staff-only and
 * is never selected.
 */
export interface SellerFailedAttemptView {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly recipientName: string;
  readonly recipientPhoneE164: string;
  readonly codAmountInr: string | null;
  readonly awbNumber: string | null;
  readonly courierCode: string | null;
  /** The latest failed-attempt scan's own time (TRK-3). Null only if no such scan was recorded. */
  readonly failedAt: Date | null;
  readonly attemptCount: number;
  /** That scan's description, e.g. "Consignee Unavailable". */
  readonly lastRemark: string | null;
  readonly lastLocation: string | null;
  readonly attemptsFailed: number | null;
  readonly attemptsMax: number | null;
  readonly deadlineDays: number | null;
  readonly remarkVerified: boolean | null;
}

/**
 * Order statuses whose parcel can be "attempted, failed, still with the
 * courier": DELIVERY_FAILED is the lifecycle state for it. IN_TRANSIT and
 * OUT_FOR_DELIVERY are included ONLY when the latest shipment itself says
 * DELIVERY_ATTEMPTED, because the order status can lag the shipment (the
 * TRK-4 guard skips a scan whose edge the order has not reached).
 * RTO_*, DELIVERED, LOST_IN_TRANSIT and cancelled states are never listed.
 */
const LAGGING_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.IN_TRANSIT,
  OrderStatus.OUT_FOR_DELIVERY,
];

@Injectable()
export class SellerFailedAttemptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tracking: TrackingEventAppendService,
  ) {}

  async list(sellerId: string): Promise<readonly SellerFailedAttemptView[]> {
    const rows = await this.prisma.client.order.findMany({
      where: {
        sellerId,
        deletedAt: null,
        OR: [
          { status: OrderStatus.DELIVERY_FAILED },
          {
            status: { in: [...LAGGING_ORDER_STATUSES] },
            orderShipments: {
              some: { shipment: { status: ShipmentStatus.DELIVERY_ATTEMPTED } },
            },
          },
        ],
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        recipientName: true,
        recipientPhoneE164: true,
        codAmountInr: true,
        orderShipments: {
          select: {
            shipment: {
              select: { id: true, awbNumber: true, courierCode: true, status: true },
            },
          },
          orderBy: { shipmentSequence: 'desc' },
          take: 1,
        },
      },
    });

    // Latest shipment decides; a parcel already delivered / returning / lost
    // / cancelled is never listed even if the order row lags.
    const live = rows.flatMap((r) => {
      const ship = r.orderShipments[0]?.shipment ?? null;
      if (ship !== null && NSA_PARCEL_GONE_STATUSES.has(ship.status)) return [];
      // The shipment is the courier's truth: with one on file the parcel
      // is listed only while it still SAYS failed-attempt, so a re-attempt
      // (OUT_FOR_DELIVERY / IN_TRANSIT again) drops it and a new failure
      // brings it back. Without a shipment the order status decides.
      const stillFailed =
        ship !== null
          ? ship.status === ShipmentStatus.DELIVERY_ATTEMPTED
          : r.status === OrderStatus.DELIVERY_FAILED;
      if (!stillFailed) return [];
      return [{ r, ship }];
    });
    if (live.length === 0) return [];

    const shipIds = live.flatMap((x) => (x.ship === null ? [] : [x.ship.id]));
    const attempts = await this.tracking.failedAttemptsFor(shipIds);
    const snaps =
      shipIds.length === 0
        ? []
        : await this.prisma.client.courierNdrPanelSnapshot.findMany({
            where: { shipmentId: { in: shipIds } },
            orderBy: { readAt: 'desc' },
            select: {
              shipmentId: true,
              attemptsFailed: true,
              attemptsMax: true,
              deadlineDays: true,
              remarkVerified: true,
            },
          });
    const snapByShip = new Map<string, (typeof snaps)[number]>();
    for (const s of snaps) if (!snapByShip.has(s.shipmentId)) snapByShip.set(s.shipmentId, s);

    const out: SellerFailedAttemptView[] = live.map(({ r, ship }) => {
      const a = ship === null ? undefined : attempts.get(ship.id);
      const snap = ship === null ? undefined : snapByShip.get(ship.id);
      return {
        orderId: r.id,
        orderNumber: r.orderNumber,
        recipientName: r.recipientName,
        recipientPhoneE164: r.recipientPhoneE164,
        codAmountInr: r.codAmountInr === null ? null : r.codAmountInr.toFixed(2),
        awbNumber: ship?.awbNumber ?? null,
        courierCode: ship?.courierCode ?? null,
        failedAt: a?.latest.eventAt ?? null,
        attemptCount: a?.count ?? 0,
        lastRemark: a?.latest.description ?? null,
        lastLocation: a?.latest.location ?? null,
        attemptsFailed: snap?.attemptsFailed ?? null,
        attemptsMax: snap?.attemptsMax ?? null,
        deadlineDays: snap?.deadlineDays ?? null,
        remarkVerified: snap?.remarkVerified ?? null,
      };
    });
    // Newest failed first; rows with no scan time sink to the bottom.
    return out.sort((x, y) => (y.failedAt?.getTime() ?? 0) - (x.failedAt?.getTime() ?? 0));
  }
}
