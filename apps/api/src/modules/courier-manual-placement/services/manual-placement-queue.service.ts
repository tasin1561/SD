import { Injectable } from '@nestjs/common';
import { OrderStatus, ShipmentStatus } from '@skydrop/db';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { StockReservationService } from '../../inventory-stock/services/stock-reservation.service';

export interface ManualPlacementQueueRow {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly sellerId: string;
  readonly sellerCompanyName: string | null;
  /** The LIVE shipment — the one an AWB should be typed onto. */
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  /** Where it is going, so an operator can quote a courier without opening it. */
  readonly destCity: string;
  readonly destPostalCode: string;
  readonly codAmountInr: string | null;
  /** How long it has been waiting, in hours — the queue's whole point. */
  readonly waitingHours: number;
  readonly arrivedAt: Date;
  /**
   * WHY it is here, in the courier's own words where we have them.
   * A "suspicious consignee" and an unserved pincode need completely
   * different responses, and an operator staring at a list of order
   * numbers cannot tell them apart.
   */
  readonly reason: string | null;
  readonly reasonCode: string | null;
  /**
   * Does it still need picking? Two genuinely different jobs share this
   * queue: a parcel packed and waiting on a courier goes out today,
   * while one refused at confirmation has not been touched and will
   * take the warehouse path after the AWB is typed (CUR-8 as amended).
   */
  readonly needsPicking: boolean;
}

/**
 * The manual-placement worklist.
 *
 * Every order at PENDING_MANUAL_PLACEMENT is, by definition, one no
 * courier would take automatically and one that will not move until a
 * person arranges carriage. Until now there was no list of them: the
 * panel to place an AWB lived on the order detail page, so finding the
 * work meant already knowing which order to open. An order nobody
 * thought to look at simply waited.
 *
 * A read-only projection over live rows — nothing is cached and no
 * status is stored, so an order leaves this list the moment its AWB is
 * recorded, with nothing to keep in sync.
 */
/** The audit action written when an order is routed to manual placement.
 *  Both arrival paths — a refusal at confirmation and one at manifest
 *  close — write it, so every row in the queue can say why it is here. */
const ROUTING_AUDIT_ACTION = 'order.awb_at_confirmation_non_serviceable';

@Injectable()
export class ManualPlacementQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reservations: StockReservationService,
  ) {}

  async list(now: Date = new Date()): Promise<ManualPlacementQueueRow[]> {
    // The LIVE shipment only. A refusal RETIRES the old shipment and
    // creates a replacement (CUR-7), so an order here usually has two —
    // and typing the AWB on the retired one is refused. The queue must
    // hand over the one that works.
    const links = await this.prisma.client.orderShipment.findMany({
      where: {
        order: { status: OrderStatus.PENDING_MANUAL_PLACEMENT, deletedAt: null },
        shipment: {
          status: ShipmentStatus.CREATED,
          awbNumber: null,
          supersededAt: null,
          deletedAt: null,
        },
      },
      select: {
        orderId: true,
        shipmentId: true,
        order: {
          select: {
            orderNumber: true,
            sellerId: true,
            codAmountInr: true,
            updatedAt: true,
            seller: { select: { companyName: true } },
          },
        },
        shipment: {
          select: {
            shipmentNumber: true,
            createdAt: true,
            destCity: true,
            destPostalCode: true,
            supersedesShipmentId: true,
          },
        },
      },
      orderBy: { shipment: { createdAt: 'asc' } },
    });
    if (links.length === 0) return [];

    // Why each one is here.
    //
    // The courier's own words are only in the AUDIT row written when the
    // order was routed — there is no per-shipment error column, and the
    // REPLACEMENT shipment has no failure of its own to report, which is
    // why reading the shipment alone tells an operator nothing. The
    // retired shipment carries the coded reason; the audit row carries
    // the sentence. Both are worth showing: "[ER0005] suspicious
    // order/consignee" and "pincode not served" need completely
    // different responses.
    const orderIds = links.map((l) => l.orderId);
    const audits = await this.prisma.client.auditLog.findMany({
      where: {
        entityType: 'order',
        entityId: { in: orderIds },
        action: ROUTING_AUDIT_ACTION,
      },
      select: { entityId: true, metadata: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    // First wins — the list is newest-first, so this keeps the most
    // recent refusal per order rather than the one it was first
    // refused for.
    const errorByOrder = new Map<string, string>();
    for (const a of audits) {
      if (a.entityId === null || errorByOrder.has(a.entityId)) continue;
      const meta = a.metadata as { error?: unknown } | null;
      const err = typeof meta?.error === 'string' ? meta.error : null;
      if (err !== null) errorByOrder.set(a.entityId, err);
    }

    const retiredIds = links
      .map((l) => l.shipment.supersedesShipmentId)
      .filter((id): id is string => id !== null);
    const retired =
      retiredIds.length === 0
        ? []
        : await this.prisma.client.shipment.findMany({
            where: { id: { in: retiredIds } },
            select: { id: true, supersedeReason: true },
          });
    const reasonById = new Map(retired.map((r) => [r.id, r]));

    const rows: ManualPlacementQueueRow[] = [];
    for (const link of links) {
      const prior =
        link.shipment.supersedesShipmentId === null
          ? undefined
          : reasonById.get(link.shipment.supersedesShipmentId);

      // Is it on a shelf, or does it still need picking? Same question
      // `ManualPlacementService.resolveReadiness` asks at the moment the
      // AWB is typed — surfaced here so the answer is visible BEFORE
      // somebody commits to a courier and a price.
      const active = await this.reservations.listActiveForOrderWithLocations(link.orderId);
      const needsPicking =
        active.length === 0 || active.some((r) => r.binId === null || r.batchId === null);

      const arrivedAt = link.shipment.createdAt;
      rows.push({
        orderId: link.orderId,
        orderNumber: link.order.orderNumber,
        sellerId: link.order.sellerId,
        sellerCompanyName: link.order.seller?.companyName ?? null,
        shipmentId: link.shipmentId,
        shipmentNumber: link.shipment.shipmentNumber,
        destCity: link.shipment.destCity,
        destPostalCode: link.shipment.destPostalCode,
        codAmountInr: link.order.codAmountInr?.toString() ?? null,
        waitingHours: Math.max(0, Math.floor((now.getTime() - arrivedAt.getTime()) / 3_600_000)),
        arrivedAt,
        reason: errorByOrder.get(link.orderId) ?? null,
        reasonCode: prior?.supersedeReason ?? null,
        needsPicking,
      });
    }
    return rows;
  }
}
