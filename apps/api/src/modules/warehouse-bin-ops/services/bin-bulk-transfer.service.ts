import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ActorType, StockMovementType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { StockMutationService } from '../../inventory-shared/stock-mutation.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

/**
 * Re-shelving, in the two shapes it actually happens.
 *
 * The existing transfer endpoint moves ONE variant from one bin+batch to
 * another, which is right for a considered correction and wrong for
 * physical re-organisation. On a warehouse floor the unit of work is
 * either "this whole shelf goes over there" (you pick the box up and
 * carry it) or "here is a list from a re-organisation sheet".
 *
 * Both land as paired TRANSFER_OUT/TRANSFER_IN through the sole stock
 * writer (INV-1), and both commit as ONE transaction: a half-applied
 * re-shelving is worse than none, because the operator has no way to
 * tell which half went through.
 *
 * The batch is never changed. A move answers WHERE, not WHAT — re-batching
 * would break FEFO ordering and sever the goods-receipt link that inbound
 * freight is attributed through.
 */

export interface BulkTransferLine {
  readonly sellerId: string;
  readonly variantId: string;
  readonly batchId: string;
  readonly qty: number;
  readonly sourceBinId: string;
  readonly destBinId: string;
}

export interface BulkTransferResult {
  readonly warehouseId: string;
  readonly linesMoved: number;
  readonly unitsMoved: number;
}

@Injectable()
export class BinBulkTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly mutation: StockMutationService,
  ) {}

  /**
   * "Everything in A-01-03 goes to B-02-05."
   *
   * Expands the source bin's current contents into explicit lines and
   * hands them to the same transactional mover, so a whole-bin move and
   * a hand-written list cannot behave differently.
   */
  async moveWholeBin(
    warehouseId: string,
    sourceBinId: string,
    destBinId: string,
    staffId: string,
    ctx?: ClientContext,
  ): Promise<BulkTransferResult> {
    const levels = await this.prisma.client.stockLevel.findMany({
      where: { warehouseId, binId: sourceBinId, qtyOnHand: { gt: 0 } },
      select: { sellerId: true, variantId: true, batchId: true, qtyOnHand: true },
    });
    if (levels.length === 0) {
      throw new ConflictException({
        code: 'SOURCE_BIN_EMPTY',
        message: 'That bin holds nothing — there is nothing to move',
      });
    }
    return this.moveLines(
      warehouseId,
      levels.map((l) => ({
        sellerId: l.sellerId,
        variantId: l.variantId,
        batchId: l.batchId,
        qty: l.qtyOnHand,
        sourceBinId,
        destBinId,
      })),
      staffId,
      ctx,
    );
  }

  /**
   * A list of moves, applied together or not at all.
   */
  async moveLines(
    warehouseId: string,
    lines: readonly BulkTransferLine[],
    staffId: string,
    ctx?: ClientContext,
  ): Promise<BulkTransferResult> {
    if (lines.length === 0) {
      throw new BadRequestException({
        code: 'BULK_TRANSFER_NO_LINES',
        message: 'Nothing to move',
      });
    }
    for (const l of lines) {
      if (!Number.isInteger(l.qty) || l.qty <= 0) {
        throw new BadRequestException({
          code: 'INVALID_TRANSFER_QTY',
          message: 'Every line needs a positive whole quantity',
        });
      }
      if (l.sourceBinId === l.destBinId) {
        throw new BadRequestException({
          code: 'TRANSFER_SOURCE_EQUALS_DEST',
          message: 'A line moves stock from a bin to itself',
        });
      }
    }

    // Every bin named must live in THIS warehouse, or the movement would
    // write a stock_level whose warehouse and bin disagree.
    const binIds = [...new Set(lines.flatMap((l) => [l.sourceBinId, l.destBinId]))];
    const bins = await this.prisma.client.warehouseBin.findMany({
      where: { id: { in: binIds }, deletedAt: null },
      select: { id: true, warehouseId: true, code: true },
    });
    const byId = new Map(bins.map((b) => [b.id, b]));
    for (const id of binIds) {
      const bin = byId.get(id);
      if (!bin) {
        throw new BadRequestException({
          code: 'BIN_NOT_FOUND',
          message: `Bin ${id} not found`,
        });
      }
      if (bin.warehouseId !== warehouseId) {
        throw new BadRequestException({
          code: 'BIN_WRONG_WAREHOUSE',
          message: `Bin ${bin.code} is in a different warehouse`,
        });
      }
    }

    // One transaction for the whole submission. INV-1's version-CAS
    // retry wraps it, so contention re-runs the entire set rather than
    // leaving it half-applied.
    let unitsMoved = 0;
    await this.mutation.runWithRetry(async (tx) => {
      unitsMoved = 0;
      for (const l of lines) {
        const from = byId.get(l.sourceBinId)?.code ?? l.sourceBinId;
        const to = byId.get(l.destBinId)?.code ?? l.destBinId;
        await this.mutation.apply(tx, {
          sellerId: l.sellerId,
          variantId: l.variantId,
          warehouseId,
          binId: l.sourceBinId,
          batchId: l.batchId,
          qtyChange: -l.qty,
          type: StockMovementType.TRANSFER_OUT,
          actorType: ActorType.STAFF,
          actorId: staffId,
          reasonCode: null,
          reason: `Re-shelved ${from} → ${to}`,
        });
        await this.mutation.apply(tx, {
          sellerId: l.sellerId,
          variantId: l.variantId,
          warehouseId,
          // Same batch: a move answers WHERE, never WHAT.
          binId: l.destBinId,
          batchId: l.batchId,
          qtyChange: l.qty,
          type: StockMovementType.TRANSFER_IN,
          actorType: ActorType.STAFF,
          actorId: staffId,
          reasonCode: null,
          reason: `Re-shelved ${from} → ${to}`,
        });
        unitsMoved += l.qty;
      }
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'warehouse.bins.bulk_transfer',
      entityType: 'warehouse',
      entityId: warehouseId,
      severity: 'MEDIUM',
      metadata: {
        linesMoved: lines.length,
        unitsMoved,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
      },
    });

    return { warehouseId, linesMoved: lines.length, unitsMoved };
  }
}
