import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { BatchStatus, BinType, Prisma } from '@skydrop/db';
import {
  BinPolicyService,
  NON_PICKABLE_BIN_TYPES,
} from '../../inventory-shared/bin-policy.service';

export interface RestockTarget {
  readonly warehouseId: string;
  readonly binId: string;
  readonly batchId: string;
  /** true ⇒ this is a child batch at a warehouse other than origin. */
  readonly crossWarehouse: boolean;
}

/** Where a unit put back in stock lands, and why there. */
export interface SellableDestination {
  readonly binId: string;
  /** PICKED_FROM — bin tracking is on and the shelf it left from is usable.
   *  FLOOR — tracking is off, or no such shelf. */
  readonly reason: 'PICKED_FROM' | 'FLOOR';
}

type BinReader = Pick<Prisma.TransactionClient, 'warehouseBin'>;

/**
 * "Is this the shelf the unit came off, and can it go back there?"
 *
 * The ONE test, shared by the finalize destination (WMS-8e) and the return
 * putaway's suggestion (BIN-3): a live bin, in the warehouse the goods are
 * physically in, of a type a picker can reach. A bin in another building,
 * a retired one, or a hold / damaged / transit bin is not a shelf.
 */
export async function findUsableShelf(
  db: BinReader,
  binId: string | null | undefined,
  warehouseId: string,
): Promise<{ id: string; code: string } | null> {
  if (!binId) return null;
  return db.warehouseBin.findFirst({
    where: {
      id: binId,
      warehouseId,
      deletedAt: null,
      type: { notIn: [...NON_PICKABLE_BIN_TYPES] },
    },
    select: { id: true, code: true },
  });
}

/**
 * R6b + WMS-8e — where does a returned unit actually go?
 *
 * Three places, each with one job:
 *
 *  - The RETURNS HOLD (`RTO_HOLD`, e.g. R-01-01) holds what came back and
 *    has not been decided yet. Booked there AT RECEIVE (`holdBinId` +
 *    `bookingBatch`), never at finalize.
 *  - A SELLABLE bin (`sellableDestination`) is where "Put back in stock"
 *    lands at finalize: the warehouse's FLOOR bin when bin tracking is off;
 *    when it is on, the shelf the unit was picked from if that shelf is in
 *    this warehouse and still pickable, else FLOOR. Sellable at once
 *    (BIN-2) — the unit is decided and in the building.
 *  - The DAMAGED bin (`damagedBinId`, e.g. D-01-01) is where "Keep aside
 *    (damaged)" lands. Refused by name when there is none.
 *
 * The BATCH follows the goods. Same warehouse: the batch the unit left
 * from. Different warehouse: a CHILD batch at the receiving warehouse
 * (R6b), because `stock_batches` is warehouse-scoped and crediting the
 * origin batch would book stock into a building that does not hold it.
 * The child inherits:
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
 */
@Injectable()
export class RtoRestockTargetService {
  private readonly logger = new Logger(RtoRestockTargetService.name);

  constructor(private readonly binPolicy: BinPolicyService) {}

  /**
   * A line finalized WITHOUT a receive booking (received before WMS-8e,
   * or where there was no hold bin): its RETURN_RESTOCK goes straight to
   * a sellable bin in the RECEIVING warehouse, in the batch the unit left
   * from (same warehouse) or a lineage child batch (cross-warehouse).
   *
   * It used to land in the returns hold and wait for a putaway. Since
   * WMS-8e the hold is for returns nobody has decided about; by finalize
   * this one HAS been decided, so it is shelved there and then.
   */
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
    const destination = await this.sellableDestination(tx, {
      warehouseId: input.receivedWarehouseId,
      candidateBinIds: [input.pickedBinId],
    });
    const batchId = await this.bookingBatch(tx, input);
    return {
      warehouseId: input.receivedWarehouseId,
      binId: destination.binId,
      batchId,
      crossWarehouse: input.receivedWarehouseId !== input.originWarehouseId,
    };
  }

  /**
   * WMS-8d — where a "Keep aside (damaged)" unit goes on a line WITHOUT a
   * receive booking: the RECEIVING warehouse's DAMAGED bin, in the batch
   * rule `bookingBatch` applies. A booked line takes its DAMAGED bin from
   * `damagedBinId` and keeps the batch it was booked in.
   */
  async resolveDamagedHold(
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
    const binId = await this.damagedBinId(tx, input.receivedWarehouseId);
    const batchId = await this.bookingBatch(tx, input);
    return {
      warehouseId: input.receivedWarehouseId,
      binId,
      batchId,
      crossWarehouse: input.receivedWarehouseId !== input.originWarehouseId,
    };
  }

  /**
   * The receiving warehouse's DAMAGED bin, or REFUSED
   * (`RTO_NO_DAMAGED_BIN`). Falling back to hold or storage would put a
   * damaged unit where it waits to be decided about again (hold) or where
   * it is sellable at once (storage) — the two outcomes this disposition
   * exists to prevent. Thrown inside finalize's movement transaction, so
   * nothing is half-applied.
   */
  async damagedBinId(tx: Prisma.TransactionClient, warehouseId: string): Promise<string> {
    const binId = await this.findBinByType(tx, warehouseId, BinType.DAMAGED);
    if (binId !== null) return binId;
    const warehouse = await tx.warehouse.findUnique({
      where: { id: warehouseId },
      select: { code: true },
    });
    throw new ConflictException({
      code: 'RTO_NO_DAMAGED_BIN',
      message:
        `Warehouse ${warehouse?.code ?? warehouseId} has no DAMAGED bin to keep ` +
        'damaged returns aside in. Create one (Warehouse → Bins, type "Damaged — not pickable") ' +
        'and finalise again, or re-inspect the item(s) as Write off.',
    });
  }

  /**
   * WMS-8e — the returns hold a received parcel is booked into, or null
   * when the warehouse has none (the receive is recorded anyway and says
   * so; the line then finalizes straight to a sellable bin).
   */
  async holdBinId(tx: Prisma.TransactionClient, warehouseId: string): Promise<string | null> {
    return this.findBinByType(tx, warehouseId, BinType.RTO_HOLD);
  }

  /**
   * Where "Put back in stock" lands (WMS-8e). Bin tracking OFF (read
   * through `BinPolicyService`, BIN-1): the warehouse's FLOOR bin. ON: the
   * first candidate that is a usable shelf in this warehouse
   * (`findUsableShelf` — the same test the putaway suggestion uses), else
   * FLOOR. Candidates are offered most-authoritative first: where
   * PACK_CONFIRM took the unit, then the pick hint.
   */
  async sellableDestination(
    tx: Prisma.TransactionClient,
    input: {
      readonly warehouseId: string;
      readonly candidateBinIds: ReadonlyArray<string | null | undefined>;
    },
  ): Promise<SellableDestination> {
    if (await this.binPolicy.isTrackingEnabled(input.warehouseId, tx)) {
      for (const candidate of input.candidateBinIds) {
        const shelf = await findUsableShelf(tx, candidate, input.warehouseId);
        if (shelf !== null) return { binId: shelf.id, reason: 'PICKED_FROM' };
      }
    }
    return { binId: await this.binPolicy.floorBinId(input.warehouseId, tx), reason: 'FLOOR' };
  }

  /**
   * The batch a returned unit is booked in at the receiving warehouse: the
   * batch it left from when it came back to the same building, else the
   * lineage-preserving child batch (R6b).
   */
  async bookingBatch(
    tx: Prisma.TransactionClient,
    input: {
      readonly sellerId: string;
      readonly variantId: string;
      readonly originWarehouseId: string;
      readonly receivedWarehouseId: string;
      readonly pickedBatchId: string;
      readonly quantity: number;
      readonly staffId: string;
    },
  ): Promise<string> {
    if (input.receivedWarehouseId === input.originWarehouseId) return input.pickedBatchId;
    return this.resolveChildBatch(tx, input);
  }

  // ── internal ──────────────────────────────────────────────────────

  /** First live bin of the given type, lowest code wins. */
  private async findBinByType(
    tx: Prisma.TransactionClient,
    warehouseId: string,
    type: BinType,
  ): Promise<string | null> {
    const bin = await tx.warehouseBin.findFirst({
      where: { warehouseId, type, deletedAt: null },
      orderBy: { code: 'asc' },
      select: { id: true },
    });
    return bin?.id ?? null;
  }

  /**
   * Find-or-create the child batch. Guarded by a deterministic batchCode +
   * the `(sellerId, batchCode)` unique, so two concurrent returns for
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
