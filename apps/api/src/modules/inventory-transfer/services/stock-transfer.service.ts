import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, StockMovementType } from '@skydrop/db';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { StockMutationService } from '../../inventory-shared/stock-mutation.service';
import {
  MOVE_MAKES_STOCK_SELLABLE_CODE,
  moveMakesStockSellableMessage,
  moveWouldMakeStockSellable,
} from '../../inventory-shared/bin-policy.service';

export interface StockTransferInput {
  readonly sellerId: string;
  readonly variantId: string;
  readonly qty: number;
  readonly sourceWarehouseId: string;
  readonly sourceBinId: string;
  readonly sourceBatchId: string;
  readonly destWarehouseId: string;
  readonly destBinId: string;
  readonly destBatchId: string;
  readonly reason?: string | null;
  /**
   * The caller has ALREADY established which units may leave a bin a
   * picker cannot reach, and that they should become sellable.
   *
   * Ordinarily this move is refused (BIN-2 — see
   * `moveWouldMakeStockSellable`), because it silently reverses a
   * decision somebody made about those goods. `RtoPutawayService` is the
   * one path for which it is the whole point: it offers only the units a
   * finalize restocked, subtracts the ones nobody has decided about yet,
   * and refuses a non-pickable destination of its own — so by the time
   * it calls here the judgement has been made and recorded.
   *
   * It is NOT reachable from any HTTP body: `CreateStockTransferDto` does
   * not declare it, and the admin controller builds this input field by
   * field rather than passing the DTO through.
   * `stock-transfer-non-pickable.spec.ts` pins that `RtoPutawayService`
   * is the only source file that passes it.
   */
  readonly allowFromNonPickableBin?: true;
}

export interface StockTransferResult {
  /** Shared id linking the paired OUT/IN movements (`stock_movements.transferGroupId`). */
  readonly transferGroupId: string;
  readonly outMovementId: string;
  readonly inMovementId: string;
  readonly qty: number;
}

/**
 * R6 (revised-plan roadmap) — real inter-warehouse (and intra-warehouse
 * bin-to-bin) stock transfer. Implements the founder's "we may receive
 * the RTO products at any warehouse … then we will send this to the
 * designated warehouse" step as a genuinely ledgered operation.
 *
 * Wires up three schema seams that existed since M0 but were never used
 * by any code: the `TRANSFER_OUT` / `TRANSFER_IN` movement types and
 * `stock_movements.transferGroupId` (the shared id that lets the two
 * legs be read back as one transfer).
 *
 * Conservation: both legs go through `StockMutationService.apply` — the
 * INV-1 sole writer — inside ONE `runWithRetry` transaction, so a
 * transfer can never half-apply. Net qtyOnHand across both warehouses
 * is unchanged by construction (−qty then +qty, same absolute value).
 *
 * Batches are warehouse-scoped in this schema, so the caller MUST name
 * the destination batch explicitly; there is deliberately no
 * find-or-create-batch convenience here, because inventing a batch
 * silently would lose expiry/unit-cost lineage that FEFO picking
 * depends on.
 */
@Injectable()
export class StockTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mutation: StockMutationService,
    private readonly audit: AuditLogService,
  ) {}

  async transfer(input: StockTransferInput, staffId: string): Promise<StockTransferResult> {
    if (!Number.isInteger(input.qty) || input.qty <= 0) {
      throw new BadRequestException({
        code: 'INVALID_TRANSFER_QTY',
        message: 'qty must be a positive integer',
      });
    }

    const sameLocation =
      input.sourceWarehouseId === input.destWarehouseId &&
      input.sourceBinId === input.destBinId &&
      input.sourceBatchId === input.destBatchId;
    if (sameLocation) {
      throw new BadRequestException({
        code: 'TRANSFER_SOURCE_EQUALS_DEST',
        message:
          'Source and destination (warehouse, bin, batch) are identical — nothing to transfer',
      });
    }

    // Destination bin + batch must actually belong to the destination
    // warehouse, else the movement would write a stock_level whose
    // warehouse/bin/batch disagree with each other.
    const [sourceBin, destBin, destBatch] = await Promise.all([
      this.prisma.client.warehouseBin.findFirst({
        where: { id: input.sourceBinId, deletedAt: null },
        select: { id: true, code: true, type: true },
      }),
      this.prisma.client.warehouseBin.findFirst({
        where: { id: input.destBinId, deletedAt: null },
        select: { id: true, warehouseId: true, code: true, type: true },
      }),
      this.prisma.client.stockBatch.findFirst({
        where: { id: input.destBatchId, deletedAt: null },
        select: { id: true, warehouseId: true, variantId: true, sellerId: true },
      }),
    ]);
    if (!sourceBin) {
      throw new NotFoundException({
        code: 'SOURCE_BIN_NOT_FOUND',
        message: `Source bin ${input.sourceBinId} not found`,
      });
    }
    if (!destBin) {
      throw new NotFoundException({
        code: 'DEST_BIN_NOT_FOUND',
        message: `Destination bin ${input.destBinId} not found`,
      });
    }
    if (destBin.warehouseId !== input.destWarehouseId) {
      throw new BadRequestException({
        code: 'DEST_BIN_WAREHOUSE_MISMATCH',
        message: `Destination bin ${input.destBinId} belongs to warehouse ${destBin.warehouseId}, not ${input.destWarehouseId}`,
      });
    }
    if (!destBatch) {
      throw new NotFoundException({
        code: 'DEST_BATCH_NOT_FOUND',
        message: `Destination batch ${input.destBatchId} not found`,
      });
    }
    if (destBatch.warehouseId !== input.destWarehouseId) {
      throw new BadRequestException({
        code: 'DEST_BATCH_WAREHOUSE_MISMATCH',
        message: `Destination batch ${input.destBatchId} belongs to warehouse ${destBatch.warehouseId}, not ${input.destWarehouseId}`,
      });
    }
    // A batch is per (seller, variant, warehouse) — transferring into a
    // batch for a different seller/variant would corrupt attribution.
    if (destBatch.sellerId !== input.sellerId || destBatch.variantId !== input.variantId) {
      throw new BadRequestException({
        code: 'DEST_BATCH_OWNER_MISMATCH',
        message: `Destination batch ${input.destBatchId} does not belong to this seller/variant`,
      });
    }

    // A transfer may not make unsellable stock sellable (BIN-2). The
    // warehouse/batch checks above stop a move writing an INCOHERENT
    // stock_level; this one stops a coherent move that quietly reverses
    // a decision — a return nobody triaged, a unit written off as
    // damaged, or goods still in the air between Dhaka and India
    // (CNS-1). The only sanctioned exception states itself; see
    // `allowFromNonPickableBin`.
    if (
      input.allowFromNonPickableBin !== true &&
      moveWouldMakeStockSellable(sourceBin.type, destBin.type)
    ) {
      throw new BadRequestException({
        code: MOVE_MAKES_STOCK_SELLABLE_CODE,
        message: moveMakesStockSellableMessage(sourceBin, destBin),
      });
    }

    const transferGroupId = randomUUID();

    // Both legs in ONE transaction — INSUFFICIENT_ON_HAND from the OUT
    // leg (apply() refuses to take qtyOnHand negative) rolls the whole
    // thing back, so an over-transfer can never credit the destination.
    const { outMovementId, inMovementId } = await this.mutation.runWithRetry(async (tx) => {
      const out = await this.mutation.apply(tx, {
        sellerId: input.sellerId,
        variantId: input.variantId,
        warehouseId: input.sourceWarehouseId,
        binId: input.sourceBinId,
        batchId: input.sourceBatchId,
        qtyChange: -input.qty,
        type: StockMovementType.TRANSFER_OUT,
        actorType: ActorType.STAFF,
        actorId: staffId,
        reasonCode: null,
        reason: input.reason ?? 'Inter-warehouse transfer (out)',
        transferGroupId,
        fromBinId: input.sourceBinId,
        toBinId: input.destBinId,
      });
      const incoming = await this.mutation.apply(tx, {
        sellerId: input.sellerId,
        variantId: input.variantId,
        warehouseId: input.destWarehouseId,
        binId: input.destBinId,
        batchId: input.destBatchId,
        qtyChange: input.qty,
        type: StockMovementType.TRANSFER_IN,
        actorType: ActorType.STAFF,
        actorId: staffId,
        reasonCode: null,
        reason: input.reason ?? 'Inter-warehouse transfer (in)',
        transferGroupId,
        fromBinId: input.sourceBinId,
        toBinId: input.destBinId,
      });
      return { outMovementId: out.movementId, inMovementId: incoming.movementId };
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      sellerId: input.sellerId,
      action: 'staff.stock.transferred',
      entityType: 'stock_transfer',
      entityId: transferGroupId,
      severity: 'MEDIUM',
      metadata: {
        variantId: input.variantId,
        qty: input.qty,
        sourceWarehouseId: input.sourceWarehouseId,
        sourceBinId: input.sourceBinId,
        sourceBatchId: input.sourceBatchId,
        destWarehouseId: input.destWarehouseId,
        destBinId: input.destBinId,
        destBatchId: input.destBatchId,
        crossWarehouse: input.sourceWarehouseId !== input.destWarehouseId,
      },
    });

    return { transferGroupId, outMovementId, inMovementId, qty: input.qty };
  }
}
