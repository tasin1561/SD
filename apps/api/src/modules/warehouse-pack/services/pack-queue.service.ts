import { Injectable, Logger } from '@nestjs/common';
import { InventoryMode } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { InventoryModeService } from '../../inventory-shared/inventory-mode.service';
import { OrderReadService, type ResolvedOrder } from '../../order/services/order-read.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

export interface PulledPackItem {
  shipmentItemId: string;
  orderItemId: string;
  variantId: string;
  skuCode: string;
  productName: string;
  variantLabel: string | null;
  quantity: number;
  unitWeightGrams: number | null;
  pickedBinId: string | null;
  pickedBatchId: string | null;
  /**
   * R4 — STRICT means `PackService.complete` demands the scanned serial
   * SET equal this parcel's PICKED units (UNIT-2); a packer screen that
   * cannot see this offers no scan field and the parcel is refused at
   * the end with nothing it can do about it.
   */
  inventoryMode: InventoryMode;
}

export interface PulledPack {
  shipmentId: string;
  shipmentNumber: string;
  orderId: string;
  courierCode: string;
  pickCompletedAt: Date | null;
  items: PulledPackItem[];
  order: ResolvedOrder | null;
}

/**
 * Module 8 — pack pull (commit 9). The packer-facing analogue of
 * PickQueueService.pullNext, but with NO PERSISTENT CLAIM (schema is
 * intentionally claim-free for pack — commit 1 added only
 * packCompletedAt/packedByStaffId).
 *
 * Race characteristics (documented design tradeoff): two packers pulling
 * SIMULTANEOUSLY get distinct shipments via `FOR UPDATE OF s SKIP LOCKED`
 * inside the tx. Two packers pulling SEQUENTIALLY (after the first
 * packer's tx commits but BEFORE they call complete) BOTH see the same
 * shipment — the race is then resolved at `PackService.complete`, which
 * is atomic-guarded on `(status=CREATED, pack_completed_at IS NULL)`:
 * the second packer's complete fails with 409 PACK_NOT_AVAILABLE and
 * they pull again. Phase 1A pack volume makes this race rare and the UX
 * (re-pull on 409) acceptable; if pack volume scales we can revisit by
 * adding packStartedAt/packStartedByStaffId (schema migration).
 *
 * Eligibility: shipment CREATED + pack_completed_at IS NULL AND the
 * shipment's order is in PICKED (WMS-9 — order status is the
 * authoritative gate; PICKED means the pick is done, ready to pack).
 * FIFO = `s.created_at ASC` (provisioning order). `FOR UPDATE OF s`
 * restricts row locking to `shipments` only (the orders join stays
 * read-only — no contention with OrderWriteService.transitionStatus).
 *
 * R0 (revised-plan roadmap): optional `courierCode` filter so a
 * packer can segregate parcels by destination courier while packing
 * (previously plain FIFO across all couriers). `courierCode` is
 * user-supplied, so it's passed as a bound parameter to
 * `$queryRawUnsafe`, never string-interpolated into the SQL text.
 */
@Injectable()
export class PackQueueService {
  private readonly logger = new Logger(PackQueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderReadService,
    private readonly modes: InventoryModeService,
  ) {}

  /** Returns the next eligible parcel (informational, no claim), or
   *  `null` (QUEUE_EMPTY). `courierCode` restricts the pull to that
   *  courier only. */
  async pullNext(
    _staffId: string,
    _ctx?: ClientContext,
    courierCode?: string,
  ): Promise<PulledPack | null> {
    const picked = await this.prisma.client.$transaction(async (tx) => {
      // The WHERE clause's fixed literals are enum values, never user
      // input. courierCode (when present) IS user-supplied — bound as
      // $1 rather than interpolated, same discipline as any other
      // caller-supplied value reaching raw SQL.
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT s.id
           FROM shipments s
           JOIN order_shipments os ON os.shipment_id = s.id
           JOIN orders o ON o.id = os.order_id
           WHERE s.status = 'created'
             AND s.pack_completed_at IS NULL
             AND s.deleted_at IS NULL
             AND o.deleted_at IS NULL
             AND o.status = 'picked'
             ${courierCode === undefined ? '' : 'AND s.courier_code = $1'}
           ORDER BY s.created_at ASC
           FOR UPDATE OF s SKIP LOCKED
           LIMIT 1`,
        ...(courierCode === undefined ? [] : [courierCode]),
      );
      const id = rows[0]?.id;
      if (id === undefined) return null;

      const shipment = await tx.shipment.findUnique({
        where: { id },
        select: {
          id: true,
          shipmentNumber: true,
          courierCode: true,
          pickCompletedAt: true,
          orderShipments: {
            select: { orderId: true },
            orderBy: { shipmentSequence: 'asc' },
            take: 1,
          },
          items: {
            select: {
              id: true,
              orderItemId: true,
              skuCode: true,
              productName: true,
              variantLabel: true,
              quantity: true,
              unitWeightGrams: true,
              pickedBinId: true,
              pickedBatchId: true,
              // R4 — shipment_items snapshots the SKU string, not the
              // variant id the mode resolves against. Same join the pick
              // gate walks.
              orderItem: {
                select: { variantId: true, order: { select: { sellerId: true } } },
              },
            },
          },
        },
      });
      if (!shipment) return null;
      return {
        shipmentId: shipment.id,
        shipmentNumber: shipment.shipmentNumber,
        orderId: shipment.orderShipments[0]?.orderId ?? null,
        courierCode: shipment.courierCode,
        pickCompletedAt: shipment.pickCompletedAt,
        sellerId: shipment.items[0]?.orderItem.order.sellerId ?? null,
        items: shipment.items.map((i) => ({
          shipmentItemId: i.id,
          orderItemId: i.orderItemId,
          variantId: i.orderItem.variantId,
          skuCode: i.skuCode,
          productName: i.productName,
          variantLabel: i.variantLabel,
          quantity: i.quantity,
          unitWeightGrams: i.unitWeightGrams,
          pickedBinId: i.pickedBinId,
          pickedBatchId: i.pickedBatchId,
        })),
      };
    });

    if (!picked) return null;

    // R4 — resolved outside the SKIP-LOCKED tx: a settings read must not
    // extend a lock the whole pack queue contends on.
    const items = await this.withModes(picked.sellerId, picked.items);

    if (picked.orderId === null) {
      this.logger.error(
        { shipmentId: picked.shipmentId },
        'Pulled pack shipment has no OrderShipment junction',
      );
      return {
        shipmentId: picked.shipmentId,
        shipmentNumber: picked.shipmentNumber,
        orderId: '',
        courierCode: picked.courierCode,
        pickCompletedAt: picked.pickCompletedAt,
        items,
        order: null,
      };
    }
    const order = await this.orders.getById(picked.orderId);
    if (!order) {
      this.logger.error(
        { shipmentId: picked.shipmentId, orderId: picked.orderId },
        'Pulled pack shipment references a missing/soft-deleted order',
      );
    }
    return {
      shipmentId: picked.shipmentId,
      shipmentNumber: picked.shipmentNumber,
      orderId: picked.orderId,
      courierCode: picked.courierCode,
      pickCompletedAt: picked.pickCompletedAt,
      items,
      order,
    };
  }

  /**
   * R4 — stamp each line with the mode the pack gate will enforce. ONE
   * batched resolve for the parcel, and FAIL-OPEN to NORMAL (UNIT-2): a
   * settings outage must leave the floor packing, not stall it behind a
   * scan field nobody can satisfy. `PackService.complete` re-resolves
   * and stays the authority; this is display only.
   */
  private async withModes(
    sellerId: string | null,
    items: readonly Omit<PulledPackItem, 'inventoryMode'>[],
  ): Promise<PulledPackItem[]> {
    const asNormal = (): PulledPackItem[] =>
      items.map((i) => ({ ...i, inventoryMode: InventoryMode.NORMAL }));
    if (sellerId === null) return asNormal();
    try {
      const modes = await this.modes.resolveForVariants(
        sellerId,
        items.map((i) => i.variantId),
      );
      return items.map((i) => ({
        ...i,
        inventoryMode: modes.get(i.variantId) ?? InventoryMode.NORMAL,
      }));
    } catch (err) {
      this.logger.warn(
        { sellerId, err: (err as Error).message },
        'Inventory-mode resolution failed on pack pull; reporting NORMAL (fail-open)',
      );
      return asNormal();
    }
  }
}
