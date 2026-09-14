import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ActorType, BinType, RtoDisposition, StockMovementType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { StockTransferService } from '../../inventory-transfer/services/stock-transfer.service';
import { NON_PICKABLE_BIN_TYPES } from '../../inventory-shared/bin-policy.service';
import { effectiveRows, quantitiesByDisposition } from './rto-inspection-rows';
import { findUsableShelf } from './rto-restock-target.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

/**
 * Shelving a return — now only the returns a PRE-WMS-8e finalize left in hold.
 *
 * Until 2026-09-14 finalize put a restocked unit into RTO_HOLD and this
 * service was the step that made it sellable. Since WMS-8e the hold holds
 * what came back and has NOT been decided (booked at receive), and "Put
 * back in stock" moves the unit straight to a sellable bin at finalize, so
 * a return finalized since needs no putaway. What can still be sitting in
 * hold waiting for a shelf is a unit an older finalize restocked there —
 * a `RETURN_RESTOCK` into an RTO_HOLD bin for this shipment — and that is
 * the only thing offered. Nothing written since produces one, so the list
 * empties itself as those are shelved.
 *
 * The distinction that must hold: an UNDECIDED unit (booked at receive, not
 * yet finalized) sharing the same hold bin and batch is never offered. Its
 * receive booking, net of its finalize movements out, is subtracted from
 * what the hold row holds before anything is offered.
 *
 * The person shelving is told where the unit lived last, because a returned
 * SKU almost always belongs back with its siblings.
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
   * Only RESTOCKED units appear, and only out of an RTO_HOLD bin: a
   * written-off unit has no stock to move (the dispatch decrement stands
   * and nothing was added back), and a unit KEPT ASIDE DAMAGED (WMS-8d)
   * sits in the DAMAGED bin on purpose — offering to shelve it would make
   * a damaged unit sellable with one tap. A split line offers exactly its
   * restocked quantity, never the whole line.
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
            orderItemId: true,
            quantity: true,
            rtoCondition: true,
            rtoDisposition: true,
            rtoInspections: {
              select: { quantity: true, condition: true, disposition: true, notes: true },
              orderBy: { position: 'asc' },
            },
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

    // What a pre-WMS-8e finalize restocked INTO a returns hold for this
    // shipment. A return finalized since writes no RETURN_RESTOCK into a
    // hold bin (a booked line leaves the hold by a transfer; an unbooked
    // one restocks straight to a sellable bin), so this is empty for it.
    const restocks = await this.prisma.client.stockMovement.findMany({
      where: { shipmentId, type: StockMovementType.RETURN_RESTOCK, qtyChange: { gt: 0 } },
      select: { orderItemId: true, binId: true, batchId: true, qtyChange: true },
    });
    if (restocks.length === 0) return [];
    const restockBinIds = [
      ...new Set(restocks.map((r) => r.binId).filter((b): b is string => b !== null)),
    ];
    // RTO_HOLD ONLY: the other non-pickable bins hold goods on purpose —
    // the DAMAGED bin holds units kept aside damaged (WMS-8d), which must
    // never be offered to a shelf.
    const holdBins = await this.prisma.client.warehouseBin.findMany({
      where: { id: { in: restockBinIds }, type: BinType.RTO_HOLD, deletedAt: null },
      select: { id: true, code: true },
    });
    const holdCode = new Map(holdBins.map((b) => [b.id, b.code]));

    const out: RtoPutawayPending[] = [];
    for (const item of shipment.items) {
      const restockQty = quantitiesByDisposition(effectiveRows(item))[RtoDisposition.RESTOCK];
      if (restockQty === 0) continue;
      const variantId = item.orderItem.variantId;
      const sellerId = item.orderItem.order.sellerId;

      const groups = new Map<string, { binId: string; batchId: string; quantity: number }>();
      for (const r of restocks) {
        if (r.orderItemId !== item.orderItemId || r.binId === null || r.batchId === null) continue;
        if (!holdCode.has(r.binId)) continue;
        const key = `${r.binId}|${r.batchId}`;
        const g = groups.get(key);
        if (g !== undefined) g.quantity += r.qtyChange;
        else groups.set(key, { binId: r.binId, batchId: r.batchId, quantity: r.qtyChange });
      }
      let holdLevel: { binId: string; batchId: string; quantity: number } | null = null;
      for (const g of [...groups.values()].sort((a, b) => b.quantity - a.quantity)) {
        const level = await this.prisma.client.stockLevel.findFirst({
          where: { sellerId, variantId, binId: g.binId, batchId: g.batchId },
          select: { qtyOnHand: true },
        });
        const undecided = await this.undecidedInHold(variantId, g.binId, g.batchId);
        const offerable = Math.min(g.quantity, restockQty, (level?.qtyOnHand ?? 0) - undecided);
        if (offerable > 0) {
          holdLevel = { ...g, quantity: offerable };
          break;
        }
      }
      if (holdLevel === null) continue; // already shelved, or never held

      const suggestion = await this.suggestBin(sellerId, variantId, warehouseId, item.pickedBinId);
      out.push({
        shipmentItemId: item.id,
        variantId,
        skuCode: item.orderItem.skuCode,
        productName: item.orderItem.productName,
        quantity: holdLevel.quantity,
        holdBinId: holdLevel.binId,
        holdBinCode: holdCode.get(holdLevel.binId) ?? holdLevel.binId,
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
   * Units booked into this hold row at receive (WMS-8e) that no finalize
   * has moved out yet — returns nobody has decided about. Only a receive
   * booking and a finalize write these types with a shipment id at a hold
   * bin, so their sum is exactly what is still undecided there.
   */
  private async undecidedInHold(
    variantId: string,
    binId: string,
    batchId: string,
  ): Promise<number> {
    const rows = await this.prisma.client.stockMovement.findMany({
      where: {
        variantId,
        binId,
        batchId,
        shipmentId: { not: null },
        type: {
          in: [
            StockMovementType.RETURN_RECEIVE,
            StockMovementType.TRANSFER_OUT,
            StockMovementType.ADJUSTMENT_DECREASE,
          ],
        },
      },
      select: { qtyChange: true },
    });
    return Math.max(
      0,
      rows.reduce((sum, r) => sum + r.qtyChange, 0),
    );
  }

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
    // The same shelf test finalize uses for "Put back in stock" (WMS-8e).
    const picked = await findUsableShelf(this.prisma.client, pickedBinId, warehouseId);
    if (picked) return { binId: picked.id, code: picked.code, reason: 'PICKED_FROM' };
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
