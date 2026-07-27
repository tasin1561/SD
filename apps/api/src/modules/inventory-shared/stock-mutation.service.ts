import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ActorType, Prisma, StockMovementReasonCode, StockMovementType } from '@skydrop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/* ============================================================================
 * INV-1 — StockMutationService IS THE ONLY WRITER.
 * ----------------------------------------------------------------------------
 * No other code may INSERT into stock_movements or change
 * stock_levels.qtyOnHand. Every stock change goes through apply(tx, input):
 *
 *   1. SELECT the current stock_level (the (seller,variant,wh,bin,batch)
 *      unique row). No FOR UPDATE — stock_levels.version handles concurrency.
 *   2. Compute qtyBefore (current on-hand, 0 if the row is new) and qtyAfter.
 *   3. Version-guarded UPDATE (or INSERT for a brand-new location):
 *        UPDATE ... SET qty_on_hand=$after, version=version+1
 *        WHERE id=$id AND version=$seenVersion
 *      0 rows affected  ->  someone else moved it  ->  RetryableStockConflict.
 *   4. Append the immutable stock_movement (qtyBefore/qtyAfter snapshots)
 *      only AFTER the level write succeeded.
 *
 * The caller owns the transaction. apply() does exactly ONE attempt; on a
 * version clash it throws RetryableStockConflictError and the WHOLE
 * transaction must be retried fresh (a Postgres tx is poisoned by the
 * unique-violation create race, so per-statement retry is impossible).
 * runWithRetry() is the sanctioned wrapper: up to 3 fresh-tx attempts,
 * then 409 STOCK_CONCURRENCY_CONFLICT (INV-6). stock_movements is
 * append-only and never updated/deleted (INV-3 / schema).
 * ========================================================================== */

/** Thrown on a stock_levels.version clash or a concurrent-create race.
 *  Signals "retry the whole transaction", not a client error. */
export class RetryableStockConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableStockConflictError';
  }
}

/** Types whose movement MUST carry a reasonCode (INV-7). */
const REASON_CODE_REQUIRED: ReadonlySet<StockMovementType> = new Set([
  StockMovementType.ADJUSTMENT_INCREASE,
  StockMovementType.ADJUSTMENT_DECREASE,
  StockMovementType.CYCLE_COUNT_ADJUST,
  StockMovementType.EXPIRY_WRITE_OFF,
]);

export interface StockMutationInput {
  sellerId: string;
  variantId: string;
  warehouseId: string;
  /** stock_levels is always located at a concrete bin + batch. */
  binId: string;
  batchId: string;
  /** Signed, non-zero. Negative = stock leaves; positive = stock arrives. */
  qtyChange: number;
  type: StockMovementType;
  actorType: ActorType;
  actorId?: string | null;
  reason?: string | null;
  reasonCode?: StockMovementReasonCode | null;
  orderId?: string | null;
  orderItemId?: string | null;
  shipmentId?: string | null;
  adjustmentId?: string | null;
  transferGroupId?: string | null;
  fromBinId?: string | null;
  toBinId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
}

export interface StockMutationResult {
  stockLevelId: string;
  movementId: string;
  qtyBefore: number;
  qtyAfter: number;
  version: number;
}

const MAX_ATTEMPTS = 3;

@Injectable()
export class StockMutationService {
  private readonly logger = new Logger(StockMutationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * One mutation attempt inside the caller's transaction. Throws
   * RetryableStockConflictError on a version/create clash — the caller
   * (or runWithRetry) must retry the whole transaction.
   */
  async apply(
    tx: Prisma.TransactionClient,
    input: StockMutationInput,
  ): Promise<StockMutationResult> {
    if (!Number.isInteger(input.qtyChange) || input.qtyChange === 0) {
      throw new ConflictException({
        code: 'INVALID_STOCK_DELTA',
        message: 'qtyChange must be a non-zero integer',
      });
    }
    if (REASON_CODE_REQUIRED.has(input.type) && !input.reasonCode) {
      // INV-7: an adjustment/discrepancy movement with no reasonCode is a
      // programming error, not a user error — fail loudly, never persist.
      throw new ConflictException({
        code: 'REASON_CODE_REQUIRED',
        message: `reasonCode is required for movement type ${input.type}`,
      });
    }

    const level = await tx.stockLevel.findUnique({
      where: {
        sellerId_variantId_warehouseId_binId_batchId: {
          sellerId: input.sellerId,
          variantId: input.variantId,
          warehouseId: input.warehouseId,
          binId: input.binId,
          batchId: input.batchId,
        },
      },
      select: { id: true, qtyOnHand: true, version: true },
    });

    const qtyBefore = level?.qtyOnHand ?? 0;
    const qtyAfter = qtyBefore + input.qtyChange;
    if (qtyAfter < 0) {
      // Stock must never go negative. This is a logic error in the caller
      // (decrementing more than on hand) — NOT retryable.
      throw new ConflictException({
        code: 'INSUFFICIENT_ON_HAND',
        message: `Stock would go negative (have ${qtyBefore}, change ${input.qtyChange})`,
      });
    }

    let stockLevelId: string;
    let newVersion: number;

    if (level) {
      const upd = await tx.stockLevel.updateMany({
        where: { id: level.id, version: level.version },
        data: { qtyOnHand: qtyAfter, version: { increment: 1 } },
      });
      if (upd.count !== 1) {
        throw new RetryableStockConflictError(
          `stock_level ${level.id} version moved from ${level.version}`,
        );
      }
      stockLevelId = level.id;
      newVersion = level.version + 1;
    } else {
      try {
        const created = await tx.stockLevel.create({
          data: {
            sellerId: input.sellerId,
            variantId: input.variantId,
            warehouseId: input.warehouseId,
            binId: input.binId,
            batchId: input.batchId,
            qtyOnHand: qtyAfter,
            qtyReserved: 0,
            version: 0,
          },
          select: { id: true },
        });
        stockLevelId = created.id;
        newVersion = 0;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // Concurrent create of the same (seller,variant,wh,bin,batch).
          throw new RetryableStockConflictError('concurrent stock_level create race');
        }
        throw err;
      }
    }

    // Append-only ledger row, written ONLY after the level write succeeded.
    const movement = await tx.stockMovement.create({
      data: {
        sellerId: input.sellerId,
        variantId: input.variantId,
        warehouseId: input.warehouseId,
        binId: input.binId,
        batchId: input.batchId,
        type: input.type,
        qtyChange: input.qtyChange,
        qtyBefore,
        qtyAfter,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        reason: input.reason ?? null,
        reasonCode: input.reasonCode ?? null,
        orderId: input.orderId ?? null,
        orderItemId: input.orderItemId ?? null,
        shipmentId: input.shipmentId ?? null,
        adjustmentId: input.adjustmentId ?? null,
        transferGroupId: input.transferGroupId ?? null,
        fromBinId: input.fromBinId ?? null,
        toBinId: input.toBinId ?? null,
        metadata: input.metadata ?? Prisma.DbNull,
      },
      select: { id: true },
    });

    return {
      stockLevelId,
      movementId: movement.id,
      qtyBefore,
      qtyAfter,
      version: newVersion,
    };
  }

  /**
   * Runs `fn` inside a fresh transaction, retrying the WHOLE transaction up
   * to 3 times on a RetryableStockConflictError (INV-6). Each retry re-runs
   * `fn` from scratch, so every apply() inside it re-SELECTs current state
   * (no lost updates). Exhaustion surfaces as 409 STOCK_CONCURRENCY_CONFLICT.
   *
   * Postgres default isolation is READ COMMITTED (locked decision #9) — no
   * explicit isolationLevel needed; the version guard provides correctness.
   */
  async runWithRetry<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    maxAttempts = MAX_ATTEMPTS,
  ): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.prisma.client.$transaction((tx) => fn(tx));
      } catch (err) {
        if (err instanceof RetryableStockConflictError) {
          lastErr = err;
          this.logger.warn(
            { attempt, maxAttempts, reason: err.message },
            'Stock mutation version conflict; retrying transaction',
          );
          continue;
        }
        throw err;
      }
    }
    throw new ConflictException({
      code: 'STOCK_CONCURRENCY_CONFLICT',
      message: `Stock changed concurrently; gave up after ${maxAttempts} attempts`,
      cause: lastErr instanceof Error ? lastErr.message : String(lastErr),
    });
  }

  /** Convenience for the single-mutation case (one apply per transaction). */
  async applyWithRetry(input: StockMutationInput): Promise<StockMutationResult> {
    return this.runWithRetry((tx) => this.apply(tx, input));
  }
}
