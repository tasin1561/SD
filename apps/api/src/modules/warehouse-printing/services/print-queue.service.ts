import { Injectable } from '@nestjs/common';
import { OrderStatus, ShipmentStatus } from '@skydrop/db';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export interface PrintQueueRow {
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly sellerCompanyName: string | null;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly courierCode: string;
  readonly courierName: string;
  readonly awbNumber: string | null;
  readonly isManualCourier: boolean;
  readonly destCity: string;
  readonly destPostalCode: string;
  readonly codAmountInr: string | null;
  readonly itemCount: number;
  readonly confirmedAtIso: string | null;
  readonly labelPrintedAtIso: string | null;
}

/**
 * The two waiting rooms of the print-first floor.
 *
 * A parcel earns its way onto the floor in two steps, and each one is a
 * queue somebody works from:
 *
 *   1. LABEL — it has a waybill but nothing on paper. Printing the label
 *      is what makes it a physical parcel anyone can act on.
 *   2. PICKING — the label is printed and on the bench; it is waiting to
 *      be put on a batch and walked.
 *
 * The two are separate because they are done by different people at
 * different times: labels come off an office printer in the morning, the
 * walk happens when a picker is free. Collapsing them into "ready to
 * pick" loses the fact that decides which of those two is blocked.
 */
@Injectable()
export class PrintQueueService {
  constructor(private readonly prisma: PrismaService) {}

  /** Parcels with a waybill whose label has NOT been printed. */
  async awaitingLabel(warehouseId?: string): Promise<PrintQueueRow[]> {
    return this.query({ labelPrinted: false, warehouseId });
  }

  /**
   * Parcels whose label IS printed and which are not on a batch yet.
   *
   * `pickBatchId: null` is the gate rather than a status: a parcel put on
   * a batch has left this queue even before the sheet is printed, and
   * showing it in both places is how the same parcel gets picked twice.
   */
  async awaitingPick(warehouseId?: string): Promise<PrintQueueRow[]> {
    return this.query({ labelPrinted: true, warehouseId, unbatchedOnly: true });
  }

  private async query(opts: {
    labelPrinted: boolean;
    warehouseId?: string | undefined;
    unbatchedOnly?: boolean;
  }): Promise<PrintQueueRow[]> {
    const links = await this.prisma.client.orderShipment.findMany({
      where: {
        // WMS-2's own eligibility, restated: the authoritative gate is
        // the ORDER's lifecycle status, never the shipment's operational
        // columns (WMS-9).
        order: {
          status: { in: [OrderStatus.CONFIRMED, OrderStatus.PENDING_PICK] },
          deletedAt: null,
        },
        shipment: {
          status: ShipmentStatus.CREATED,
          supersededAt: null,
          deletedAt: null,
          // A parcel with no waybill has nothing to print. It is not
          // ready and saying so here would put an un-actionable row in
          // front of somebody holding a printer.
          awbNumber: { not: null },
          labelPrintedAt: opts.labelPrinted ? { not: null } : null,
          ...(opts.unbatchedOnly === true ? { pickBatchId: null } : {}),
          ...(opts.warehouseId !== undefined ? { originWarehouseId: opts.warehouseId } : {}),
        },
      },
      select: {
        orderId: true,
        shipmentId: true,
        order: {
          select: {
            orderNumber: true,
            codAmountInr: true,
            confirmedAt: true,
            seller: { select: { companyName: true } },
            items: { select: { id: true } },
          },
        },
        shipment: {
          select: {
            shipmentNumber: true,
            courierCode: true,
            manualCourierName: true,
            awbNumber: true,
            isManualCourier: true,
            destCity: true,
            destPostalCode: true,
            labelPrintedAt: true,
            originWarehouseId: true,
            originWarehouse: { select: { name: true } },
          },
        },
      },
      orderBy: { order: { confirmedAt: 'asc' } },
    });

    return links.map((l) => ({
      shipmentId: l.shipmentId,
      shipmentNumber: l.shipment.shipmentNumber,
      orderId: l.orderId,
      orderNumber: l.order.orderNumber,
      sellerCompanyName: l.order.seller?.companyName ?? null,
      warehouseId: l.shipment.originWarehouseId,
      warehouseName: l.shipment.originWarehouse?.name ?? '—',
      courierCode: l.shipment.courierCode,
      courierName: l.shipment.isManualCourier
        ? (l.shipment.manualCourierName ?? 'Manual courier')
        : l.shipment.courierCode,
      awbNumber: l.shipment.awbNumber,
      isManualCourier: l.shipment.isManualCourier,
      destCity: l.shipment.destCity,
      destPostalCode: l.shipment.destPostalCode,
      codAmountInr: l.order.codAmountInr?.toString() ?? null,
      itemCount: l.order.items.length,
      confirmedAtIso: l.order.confirmedAt?.toISOString() ?? null,
      labelPrintedAtIso: l.shipment.labelPrintedAt?.toISOString() ?? null,
    }));
  }
}
