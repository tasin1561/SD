import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type OrderStatus, type RtoDisposition, type RtoItemCondition } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import { effectiveRows } from './rto-inspection-rows';

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
  /**
   * WMS-8d — the line inspected by quantity. One row covering the whole
   * line when it was not split (including lines inspected before rows
   * existed); empty until inspected. The rto* fields above summarise it.
   */
  rtoInspections: RtoInspectionRowView[];
  /**
   * The product's current primary picture (thumbnail preferred), as a
   * presigned URL minted for THIS response — never stored. Null when the
   * variant has no image, or when the catalogue read failed (fail-open:
   * an inspector without a picture can still inspect; one without the
   * screen cannot). The inspector judges the item's condition with the
   * box open, and a photograph answers "is this even the right thing"
   * before a SKU string does.
   */
  thumbnailUrl: string | null;
}

export interface RtoInspectionRowView {
  quantity: number;
  condition: RtoItemCondition;
  disposition: RtoDisposition;
  notes: string | null;
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
  private readonly logger = new Logger(RtoReadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogReadService,
  ) {}

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
            rtoInspections: {
              select: { quantity: true, condition: true, disposition: true, notes: true },
              orderBy: { position: 'asc' },
            },
            // The line snapshot carries no variant id; the order line it
            // was cut from does (the FK the shipment line already holds).
            orderItem: { select: { variantId: true } },
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
    const thumbs = await this.thumbnails(shipment.items.map((it) => it.orderItem.variantId));
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
        rtoInspections: effectiveRows(it).map((r) => ({
          quantity: r.quantity,
          condition: r.condition,
          disposition: r.disposition,
          notes: r.notes,
        })),
        thumbnailUrl: thumbs.get(it.orderItem.variantId) ?? null,
      })),
    };
  }

  /**
   * One catalogue read for every line on the parcel, through the
   * sanctioned boundary (MUST #13) — the same method the call centre and
   * order detail use, so every staff screen agrees on which picture is
   * "the" picture and none of them serves a full-size original in a
   * thumbnail cell. The access decision was made by the handler that
   * called `loadShipment`; nothing here widens it.
   */
  private async thumbnails(variantIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    try {
      return await this.catalog.thumbnailUrlsByVariant(variantIds);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'RTO line thumbnails unavailable; rendering without them (fail-open)',
      );
      return new Map();
    }
  }
}
