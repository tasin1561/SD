import { Injectable } from '@nestjs/common';
import {
  ConsignmentLeg,
  ConsignmentStatus,
  GoodsReceiptStatus,
  Prisma,
  BinType,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * The SOLE writer of `consignments.status`, and it never takes the status
 * as an argument — it DERIVES it from the legs every time.
 *
 * Storing a status and hand-setting it at six call sites is how it comes
 * to disagree with the receipts underneath it, and the disagreement is
 * invisible: the row says IN_TRANSIT, the goods are on the shelf, and
 * nothing fails. Deriving means there is no state machine to get wrong.
 * It is STORED rather than computed on read only because a consignment
 * list would otherwise pay for a per-row aggregate.
 *
 * Precedence, most decisive first:
 *
 *  1. `cancelledAt` set          -> CANCELLED. A terminal fact.
 *  2. anything in a TRANSIT bin  -> IN_TRANSIT. Something is in the air,
 *     and that is the most urgent true thing about the consignment even
 *     when part of it has already landed.
 *  3. every leg COMPLETED and no
 *     stock left in Bangladesh    -> COMPLETED.
 *  4. the BD leg has been counted -> AT_BD.
 *  5. otherwise                   -> PENDING.
 *
 * Note what 2 and 4 do together on a partial dispatch: 300 of 500 in the
 * air reads IN_TRANSIT rather than flapping back to AT_BD as each
 * shipment lands. The panel shows the split; the status names the thing
 * worth knowing.
 */
@Injectable()
export class ConsignmentStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async recompute(
    consignmentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ConsignmentStatus> {
    const db = tx ?? this.prisma.client;
    const consignment = await db.consignment.findUnique({
      where: { id: consignmentId },
      select: {
        id: true,
        sellerId: true,
        status: true,
        cancelledAt: true,
        receipts: {
          select: { id: true, leg: true, status: true, warehouseId: true, dispatchedAt: true },
        },
      },
    });
    if (!consignment) return ConsignmentStatus.PENDING;

    const next = await this.derive(db, consignment);
    if (next !== consignment.status) {
      await db.consignment.update({ where: { id: consignmentId }, data: { status: next } });
    }
    return next;
  }

  private async derive(
    db: Prisma.TransactionClient | PrismaService['client'],
    c: {
      id: string;
      sellerId: string;
      cancelledAt: Date | null;
      receipts: Array<{
        id: string;
        leg: ConsignmentLeg | null;
        status: GoodsReceiptStatus;
        warehouseId: string;
        dispatchedAt: Date | null;
      }>;
    },
  ): Promise<ConsignmentStatus> {
    if (c.cancelledAt !== null) return ConsignmentStatus.CANCELLED;

    const inTransit = await db.stockLevel.aggregate({
      where: {
        sellerId: c.sellerId,
        qtyOnHand: { gt: 0 },
        bin: { type: BinType.TRANSIT, deletedAt: null },
        batch: { receivingNoteId: { in: c.receipts.map((r) => r.id) } },
      },
      _sum: { qtyOnHand: true },
    });
    if ((inTransit._sum.qtyOnHand ?? 0) > 0) return ConsignmentStatus.IN_TRANSIT;

    const legs = c.receipts;
    const bdLeg = legs.find((r) => r.leg === ConsignmentLeg.BD_INTAKE);
    const finalLegs = legs.filter((r) => r.leg === ConsignmentLeg.IN_FINAL);
    const terminal = (s: GoodsReceiptStatus): boolean =>
      s === GoodsReceiptStatus.COMPLETED || s === GoodsReceiptStatus.CANCELLED;

    // Stock still standing in Bangladesh means the journey is not over,
    // however many India legs have landed.
    if (bdLeg !== undefined) {
      const atBd = await db.stockLevel.aggregate({
        where: {
          sellerId: c.sellerId,
          warehouseId: bdLeg.warehouseId,
          qtyOnHand: { gt: 0 },
          batch: { receivingNoteId: bdLeg.id },
        },
        _sum: { qtyOnHand: true },
      });
      if ((atBd._sum.qtyOnHand ?? 0) > 0) return ConsignmentStatus.AT_BD;
    }

    const allLegsDone = legs.length > 0 && legs.every((r) => terminal(r.status));
    if (allLegsDone && finalLegs.some((r) => r.status === GoodsReceiptStatus.COMPLETED)) {
      return ConsignmentStatus.COMPLETED;
    }
    if (bdLeg !== undefined && terminal(bdLeg.status)) return ConsignmentStatus.AT_BD;
    return ConsignmentStatus.PENDING;
  }
}
