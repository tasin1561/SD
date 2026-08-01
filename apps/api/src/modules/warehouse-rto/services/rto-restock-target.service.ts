import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { BatchStatus, BinType, Prisma } from '@skydrop/db';

export interface RestockTarget {
  readonly warehouseId: string;
  readonly binId: string;
  readonly batchId: string;
  /** true ⇒ this is a child batch at a warehouse other than origin. */
  readonly crossWarehouse: boolean;
}

/**
 * Where a return lands, in preference order.
 *
 * RTO_HOLD FIRST, deliberately: a return is received, not yet sellable.
 * It sits in hold until someone inspects it and shelves it (return
 * putaway), which is what stops an untriaged return being promised to
 * the next customer. That gate only means anything because availability
 * (INV-3) excludes non-pickable bins — before that it counted hold
 * stock as sellable and the order shortfalled at pick time instead.
 */
const TARGET_BIN_TYPES: readonly BinType[] = [BinType.RTO_HOLD, BinType.STORAGE];

/**
 * R6b — where does a returned unit actually go?
 *
 * Same-warehouse returns go back to the bin+batch they were picked from;
 * nothing to resolve. A return that landed at a DIFFERENT warehouse used
 * to be refused outright (`RTO_RESTOCK_WAREHOUSE_MISMATCH`), because
 * `stock_batches` is warehouse-scoped and crediting the origin bin would
 * book stock into a building that does not physically hold it.
 *
 * The founder's answer: make it sellable where it landed, without losing
 * lineage. So we find-or-create a CHILD batch at the receiving warehouse
 * that inherits from the original:
 *
 *  - `expiresAt` / `manufacturedAt` — FEFO stays correct. This is the
 *    load-bearing one: a generic "returns" batch would make a
 *    six-months-old unit look as fresh as today's stock.
 *  - `unitCostInr` / `unitCostBdt` — margin reporting stays honest.
 *  - `receivingNoteId` — copied, NOT cleared, so the batch → goods
 *    receipt → inbound-freight chain still resolves. A unit that comes
 *    back and later sells must still attribute its freight to the
 *    consignment that actually carried it into India.
 *  - `parentBatchId` — the explicit record of where these goods came from.
 *
 * The child's `batchCode` is DETERMINISTIC (`<parent>-RTO-<warehouse>`),
 * which is what makes this find-or-create rather than create: a second
 * return from the same batch to the same warehouse joins the existing
 * child instead of colliding on the `(sellerId, batchCode)` unique.
 *
 * If the receiving warehouse has no bin that can hold returns, we still
 * refuse — but with a code that tells ops exactly what to create, rather
 * than the old "transfer it or write it off".
 */
@Injectable()
export class RtoRestockTargetService {
  private readonly logger = new Logger(RtoRestockTargetService.name);

  async resolve(
    tx: Prisma.TransactionClient,
    input: {
      readonly sellerId: string;
      readonly variantId: string;
      readonly originWarehouseId: string;
      readonly receivedWarehouseId: string;
      readonly pickedBinId: string;
      readonly pickedBatchId: string;
      readonly quantity: number;
      readonly staffId: string;
    },
  ): Promise<RestockTarget> {
    // Same warehouse: the BATCH is still correct — the goods are the
    // same goods, with the same expiry and the same freight lineage.
    //
    // The BIN is not. At finalize the carton is on the returns bench,
    // not back on the shelf it was picked from; nobody has carried it
    // there. Booking it into the picked bin claims a putaway that never
    // happened, and — because that bin IS pickable — offers the unit to
    // the next customer before anyone has physically shelved it.
    //
    // So it lands in hold, exactly like a cross-warehouse return, and
    // `RtoPutawayService` is what moves it to a shelf. A warehouse with
    // no hold bin falls through to STORAGE and behaves as it always did.
    if (input.receivedWarehouseId === input.originWarehouseId) {
      const holdBinId = await this.findBinByTypes(tx, input.originWarehouseId, [BinType.RTO_HOLD]);
      return {
        warehouseId: input.originWarehouseId,
        binId: holdBinId ?? input.pickedBinId,
        batchId: input.pickedBatchId,
        crossWarehouse: false,
      };
    }

    const binId = await this.resolveBin(tx, input.receivedWarehouseId);
    const batchId = await this.resolveChildBatch(tx, input);
    return {
      warehouseId: input.receivedWarehouseId,
      binId,
      batchId,
      crossWarehouse: true,
    };
  }

  // ── internal ──────────────────────────────────────────────────────

  /** First live bin of any of the given types, lowest code wins. */
  private async findBinByTypes(
    tx: Prisma.TransactionClient,
    warehouseId: string,
    types: readonly BinType[],
  ): Promise<string | null> {
    for (const type of types) {
      const bin = await tx.warehouseBin.findFirst({
        where: { warehouseId, type, deletedAt: null },
        orderBy: { code: 'asc' },
        select: { id: true },
      });
      if (bin) return bin.id;
    }
    return null;
  }

  private async resolveBin(tx: Prisma.TransactionClient, warehouseId: string): Promise<string> {
    const found = await this.findBinByTypes(tx, warehouseId, TARGET_BIN_TYPES);
    if (found) return found;
    throw new ConflictException({
      code: 'RTO_RESTOCK_NO_TARGET_BIN',
      message:
        `Warehouse ${warehouseId} received this return but has no RTO_HOLD or STORAGE bin to put it in. ` +
        `Create one (RTO_HOLD is the intended home for returned goods) and re-finalize, ` +
        `or re-inspect the item(s) as WRITE_OFF.`,
    });
  }

  /**
   * Find-or-create the child batch. Guarded by a deterministic batchCode +
   * the `(sellerId, batchCode)` unique, so two concurrent finalizes for
   * the same batch/warehouse converge on ONE child rather than racing to
   * create two.
   */
  private async resolveChildBatch(
    tx: Prisma.TransactionClient,
    input: {
      sellerId: string;
      variantId: string;
      receivedWarehouseId: string;
      pickedBatchId: string;
      quantity: number;
      staffId: string;
    },
  ): Promise<string> {
    const parent = await tx.stockBatch.findUnique({
      where: { id: input.pickedBatchId },
      select: {
        id: true,
        batchCode: true,
        manufacturedAt: true,
        expiresAt: true,
        unitCostInr: true,
        unitCostBdt: true,
        receivingNoteId: true,
      },
    });
    if (!parent) {
      throw new ConflictException({
        code: 'RTO_RESTOCK_PARENT_BATCH_MISSING',
        message: `Original batch ${input.pickedBatchId} no longer exists; cannot derive a return batch`,
      });
    }

    const warehouse = await tx.warehouse.findUniqueOrThrow({
      where: { id: input.receivedWarehouseId },
      select: { code: true },
    });
    const childCode = `${parent.batchCode}-RTO-${warehouse.code}`;

    const existing = await tx.stockBatch.findUnique({
      where: {
        sellerId_batchCode: { sellerId: input.sellerId, batchCode: childCode },
      },
      select: { id: true },
    });
    if (existing) {
      // initialQty is a running record of how much has been credited into
      // this return batch, so a second return adds to it. The
      // authoritative on-hand number remains stock_levels (INV-3).
      await tx.stockBatch.update({
        where: { id: existing.id },
        data: { initialQty: { increment: input.quantity } },
      });
      return existing.id;
    }

    const child = await tx.stockBatch.create({
      data: {
        sellerId: input.sellerId,
        variantId: input.variantId,
        warehouseId: input.receivedWarehouseId,
        batchCode: childCode,
        // Inherited so FEFO + margin + the freight chain all stay correct.
        manufacturedAt: parent.manufacturedAt,
        expiresAt: parent.expiresAt,
        unitCostInr: parent.unitCostInr,
        unitCostBdt: parent.unitCostBdt,
        receivingNoteId: parent.receivingNoteId,
        parentBatchId: parent.id,
        status: BatchStatus.ACTIVE,
        initialQty: input.quantity,
        receivedAt: new Date(),
        receivedById: input.staffId,
      },
      select: { id: true },
    });
    this.logger.log(
      {
        parentBatchId: parent.id,
        childBatchId: child.id,
        warehouseId: input.receivedWarehouseId,
        batchCode: childCode,
      },
      'R6b: created a cross-warehouse RTO child batch',
    );
    return child.id;
  }
}
