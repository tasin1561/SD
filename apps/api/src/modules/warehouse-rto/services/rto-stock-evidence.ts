import { StockMovementType, type Prisma } from '@skydrop/db';
import type { LeftStockMovement } from './rto-restock-sources';
import type { HeldMovement } from './rto-held-returns';

type Db = Pick<Prisma.TransactionClient, 'stockMovement'>;

/**
 * The ledger reads RTO receive and finalize both need, written once.
 * Read-only and outside any transaction: `stock_movements` is append-only,
 * so a retry reads the same answer.
 */

/**
 * Every movement a finalize writes against the shipment — gate 2 (WMS-8):
 * if any exists, the movement transaction already committed. RETURN_RESTOCK
 * is a line finalized the pre-WMS-8e way (straight to a sellable bin);
 * TRANSFER_OUT and ADJUSTMENT_DECREASE are a booked line leaving the
 * returns hold. Nothing else writes those two types with a shipment id.
 */
export const FINALIZE_MOVEMENT_TYPES: readonly StockMovementType[] = [
  StockMovementType.RETURN_RESTOCK,
  StockMovementType.TRANSFER_OUT,
  StockMovementType.ADJUSTMENT_DECREASE,
];

/**
 * Where the order's stock LEFT (WMS-8c): PACK_CONFIRM, or DISPATCH before
 * Model C, read by ORDER — a supersede leaves them on the original
 * shipment (CUR-3) — plus the ids a PACK_REVERSED gave back.
 */
export async function loadPackEvidence(
  db: Db,
  orderId: string,
): Promise<{ leftMovements: LeftStockMovement[]; reversedMovementIds: Set<string> }> {
  const leftMovements = await db.stockMovement.findMany({
    where: {
      orderId,
      type: { in: [StockMovementType.PACK_CONFIRM, StockMovementType.DISPATCH] },
    },
    select: {
      id: true,
      warehouseId: true,
      binId: true,
      batchId: true,
      qtyChange: true,
      orderItemId: true,
      variantId: true,
    },
  });
  const reversed =
    leftMovements.length === 0
      ? []
      : await db.stockMovement.findMany({
          where: { orderId, type: StockMovementType.PACK_REVERSED },
          select: { metadata: true },
        });
  const reversedMovementIds = new Set(
    reversed
      .map((m) => (m.metadata as { reversesMovementId?: string } | null)?.reversesMovementId)
      .filter((id): id is string => typeof id === 'string'),
  );
  return { leftMovements, reversedMovementIds };
}

/** The WMS-8e receive bookings of one shipment (`RETURN_RECEIVE`). */
export async function loadHeldReturns(db: Db, shipmentId: string): Promise<HeldMovement[]> {
  return db.stockMovement.findMany({
    where: { shipmentId, type: StockMovementType.RETURN_RECEIVE },
    select: { warehouseId: true, binId: true, batchId: true, qtyChange: true, metadata: true },
  });
}
