import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { StockTransferService } from '../../inventory-transfer/services/stock-transfer.service';
import { NON_PICKABLE_BIN_TYPES } from '../../inventory-shared/bin-policy.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

/**
 * Shelving a return.
 *
 * A returned parcel comes back into RTO_HOLD, which is deliberately not
 * pickable: the goods are on the returns bench, not on a shelf, and
 * until somebody physically walks them somewhere the system should not
 * promise them to the next customer. That promise is what INV-3's
 * bin-type filter withholds.
 *
 * Putaway is the moment the promise becomes safe to make. The person who
 * inspected the item does it — they are already holding it — and the
 * system tells them where the unit lived last, because a returned SKU
 * almost always belongs back with its siblings.
 *
 * Mechanically it is an ordinary same-warehouse bin transfer, so it goes
 * through `StockTransferService` and lands as a paired
 * TRANSFER_OUT/TRANSFER_IN in the ledger like any other move. Nothing
 * here writes stock directly (INV-1).
 */

export interface RtoPutawayPending {
  readonly shipmentItemId: string;
  readonly variantId: string;
  readonly skuCode: string;
  readonly productName: string;
  readonly quantity: number;
  readonly holdBinId: string;
  readonly holdBinCode: string;
  /**
   * The warehouse the goods are physically in — the RECEIVING one, which
   * on a cross-warehouse return is not where the parcel shipped from.
   * Exposed because the operator's screen has to offer bins from THIS
   * building and cannot work it out from anything else on the row.
   */
  readonly warehouseId: string;
  readonly batchId: string;
  /**
   * Where this unit sat before it shipped. A suggestion only — the bin
   * may have been re-purposed, or the return may have landed in a
   * different building entirely, so it is offered and never applied.
   */
  readonly suggestedBinId: string | null;
  readonly suggestedBinCode: string | null;
  readonly suggestionReason: 'PICKED_FROM' | 'RECENT_LOCATION' | null;
}

export interface RtoPutawayLineInput {
  readonly shipmentItemId: string;
  readonly destBinId: string;
}

export interface RtoPutawayResult {
  readonly shipmentId: string;
  readonly movedCount: number;
  readonly lines: ReadonlyArray<{
    shipmentItemId: string;
    destBinId: string;
    qty: number;
    transferGroupId: string;
  }>;
}

@Injectable()
export class RtoPutawayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: StockTransferService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * What is sitting in hold for this parcel, with a suggested shelf.
   *
   * Only RESTOCK lines appear: a written-off unit has no stock to move
   * (the dispatch decrement stands and nothing was added back).
   */
  async listPending(shipmentId: string): Promise<RtoPutawayPending[]> {
    const shipment = await this.prisma.client.shipment.findFirst({
      where: { id: shipmentId, deletedAt: null },
      select: {
        id: true,
        originWarehouseId: true,
        rtoReceivedWarehouseId: true,
        items: {
          select: {
            id: true,
            quantity: true,
            rtoDisposition: true,
            pickedBinId: true,
            pickedBatchId: true,
            orderItem: {
              select: {
                variantId: true,
                skuCode: true,
                productName: true,
                order: { select: { sellerId: true } },
              },
            },
          },
        },
      },
    });
    if (!shipment) {
      throw new BadRequestException({
        code: 'SHIPMENT_NOT_FOUND',
        message: 'Shipment not found',
      });
    }
    const warehouseId = shipment.rtoReceivedWarehouseId ?? shipment.originWarehouseId;

    const out: RtoPutawayPending[] = [];
    for (const item of shipment.items) {
      if (item.rtoDisposition !== 'RESTOCK') continue;
      const variantId = item.orderItem.variantId;
      const sellerId = item.orderItem.order.sellerId;

      // Find the hold row this line's goods are actually sitting in.
      const holdLevel = await this.prisma.client.stockLevel.findFirst({
        where: {
          sellerId,
          variantId,
          warehouseId,
          qtyOnHand: { gt: 0 },
          bin: { type: { in: [...NON_PICKABLE_BIN_TYPES] }, deletedAt: null },
        },
        select: { binId: true, batchId: true, bin: { select: { code: true } } },
      });
      if (!holdLevel) continue; // already shelved, or never held

      const suggestion = await this.suggestBin(sellerId, variantId, warehouseId, item.pickedBinId);
      out.push({
        shipmentItemId: item.id,
        variantId,
        skuCode: item.orderItem.skuCode,
        productName: item.orderItem.productName,
        quantity: item.quantity,
        holdBinId: holdLevel.binId,
        holdBinCode: holdLevel.bin.code,
        warehouseId,
        batchId: holdLevel.batchId,
        suggestedBinId: suggestion?.binId ?? null,
        suggestedBinCode: suggestion?.code ?? null,
        suggestionReason: suggestion?.reason ?? null,
      });
    }
    return out;
  }

  /**
   * Move the chosen lines out of hold and onto a shelf.
   *
   * Per-line isolation on purpose: shelving is physical work done one
   * carton at a time, and one bad destination should not undo the units
   * already walked to their shelves.
   */
  async putaway(
    shipmentId: string,
    lines: readonly RtoPutawayLineInput[],
    staffId: string,
    ctx?: ClientContext,
  ): Promise<RtoPutawayResult> {
    if (lines.length === 0) {
      throw new BadRequestException({
        code: 'RTO_PUTAWAY_NO_LINES',
        message: 'Nothing to put away',
      });
    }
    const pending = await this.listPending(shipmentId);
    const byItem = new Map(pending.map((p) => [p.shipmentItemId, p]));

    const results: Array<{
      shipmentItemId: string;
      destBinId: string;
      qty: number;
      transferGroupId: string;
    }> = [];

    for (const line of lines) {
      const p = byItem.get(line.shipmentItemId);
      if (!p) {
        throw new ConflictException({
          code: 'RTO_PUTAWAY_NOT_IN_HOLD',
          message: `Item ${line.shipmentItemId} is not sitting in a hold bin — it may already have been put away`,
        });
      }
      const destBin = await this.prisma.client.warehouseBin.findFirst({
        where: { id: line.destBinId, deletedAt: null },
        select: { id: true, warehouseId: true, type: true, code: true },
      });
      if (!destBin) {
        throw new BadRequestException({
          code: 'DEST_BIN_NOT_FOUND',
          message: `Bin ${line.destBinId} not found`,
        });
      }
      // Shelving into another hold bin would move the carton and leave
      // it just as unsellable — almost certainly a mis-tap.
      if (NON_PICKABLE_BIN_TYPES.includes(destBin.type)) {
        throw new BadRequestException({
          code: 'DEST_BIN_NOT_PICKABLE',
          message: `Bin ${destBin.code} is a ${destBin.type} bin — putting the goods there would leave them unsellable`,
        });
      }

      const seller = await this.prisma.client.stockLevel.findFirst({
        where: { binId: p.holdBinId, variantId: p.variantId, batchId: p.batchId },
        select: { sellerId: true, warehouseId: true },
      });
      if (!seller) {
        throw new ConflictException({
          code: 'RTO_PUTAWAY_STOCK_VANISHED',
          message: `The held stock for item ${line.shipmentItemId} is no longer there`,
        });
      }
      if (destBin.warehouseId !== seller.warehouseId) {
        throw new BadRequestException({
          code: 'DEST_BIN_WRONG_WAREHOUSE',
          message: `Bin ${destBin.code} is in a different warehouse from the returned goods`,
        });
      }

      const transfer = await this.transfers.transfer(
        {
          sellerId: seller.sellerId,
          variantId: p.variantId,
          qty: p.quantity,
          sourceWarehouseId: seller.warehouseId,
          sourceBinId: p.holdBinId,
          sourceBatchId: p.batchId,
          destWarehouseId: seller.warehouseId,
          destBinId: destBin.id,
          // Same batch: putaway moves WHERE the goods are, never what
          // they are. Re-batching would break FEFO and the freight
          // lineage the batch carries.
          destBatchId: p.batchId,
          reason: `RTO putaway — shipment ${shipmentId}`,
        },
        staffId,
      );
      results.push({
        shipmentItemId: line.shipmentItemId,
        destBinId: destBin.id,
        qty: p.quantity,
        transferGroupId: transfer.transferGroupId,
      });
    }

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'warehouse.rto.putaway',
      entityType: 'shipment',
      entityId: shipmentId,
      severity: 'LOW',
      metadata: {
        movedCount: results.length,
        lines: results,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
      },
    });

    return { shipmentId, movedCount: results.length, lines: results };
  }

  // ── internal ──────────────────────────────────────────────────────

  /**
   * "Where was this before?"
   *
   * First choice is the bin it was picked from — a returned SKU belongs
   * back with its siblings, and the picker's own record is the most
   * specific answer we have. That is only usable when the parcel came
   * back to the building it left, and when the bin is still a place
   * goods can be picked from.
   *
   * Otherwise: wherever else this variant currently lives in THIS
   * warehouse, most-stocked first. Cross-warehouse returns land here,
   * and so does anything whose original bin has since been retired.
   */
  private async suggestBin(
    sellerId: string,
    variantId: string,
    warehouseId: string,
    pickedBinId: string | null,
  ): Promise<{ binId: string; code: string; reason: 'PICKED_FROM' | 'RECENT_LOCATION' } | null> {
    if (pickedBinId) {
      const picked = await this.prisma.client.warehouseBin.findFirst({
        where: {
          id: pickedBinId,
          warehouseId,
          deletedAt: null,
          type: { notIn: [...NON_PICKABLE_BIN_TYPES] },
        },
        select: { id: true, code: true },
      });
      if (picked) return { binId: picked.id, code: picked.code, reason: 'PICKED_FROM' };
    }
    const recent = await this.prisma.client.stockLevel.findFirst({
      where: {
        sellerId,
        variantId,
        warehouseId,
        qtyOnHand: { gt: 0 },
        bin: { type: { notIn: [...NON_PICKABLE_BIN_TYPES] }, deletedAt: null },
      },
      orderBy: { qtyOnHand: 'desc' },
      select: { binId: true, bin: { select: { code: true } } },
    });
    if (recent) {
      return { binId: recent.binId, code: recent.bin.code, reason: 'RECENT_LOCATION' };
    }
    return null;
  }
}
