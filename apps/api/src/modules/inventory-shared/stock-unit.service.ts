import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ActorType, Prisma, StockUnitStatus } from '@skydrop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/* ============================================================================
 * R4 — StockUnitService IS THE ONLY WRITER of stock_units /
 * stock_unit_events (the same sole-writer discipline as
 * StockMutationService for stock_movements, INV-1, and
 * WalletService.applyEntry for the wallet ledger).
 * ----------------------------------------------------------------------------
 * It WRAPS the aggregate layer, it never replaces it. Every method takes
 * a `tx` and does unit-grained work ONLY; the caller keeps posting the
 * aggregate movement through StockMutationService in the SAME
 * transaction. That ordering is what keeps stock_levels.qtyOnHand
 * authoritative for both modes (INV-1/INV-3 untouched) while strict mode
 * adds enforcement on top.
 *
 * Every status change appends a stock_unit_events row. That table is
 * APPEND-ONLY — no update or delete path exists here by construction.
 * ========================================================================== */

/** A scan that does not match the expected unit. Never coerced. */
export class UnitScanRejectedError extends ConflictException {
  constructor(code: string, message: string, meta?: Record<string, unknown>) {
    super({ code, message, ...(meta === undefined ? {} : { cause: meta }) });
  }
}

export interface RegisterUnitsInput {
  readonly sellerId: string;
  readonly variantId: string;
  readonly warehouseId: string;
  readonly binId?: string | null;
  readonly batchId?: string | null;
  readonly goodsReceiptLineId?: string | null;
  /** How many physical units arrived. Must match `serials.length` when supplied. */
  readonly quantity: number;
  /**
   * Supplier-printed serials scanned at receiving. Omit (or pass fewer
   * than `quantity`) and Skydrop generates + prints the remainder — a
   * strict SKU must never be blocked at intake just because the supplier
   * doesn't serialize.
   */
  readonly serials?: readonly string[];
  readonly serialPrefix?: string;
  readonly actorType: ActorType;
  readonly actorId?: string | null;
  readonly note?: string | null;
}

export interface RegisteredUnit {
  readonly id: string;
  readonly serialBarcode: string;
  readonly isSystemGenerated: boolean;
}

export interface ScanUnitsInput {
  readonly sellerId: string;
  readonly variantId: string;
  readonly serials: readonly string[];
  readonly fromStatus: StockUnitStatus;
  readonly toStatus: StockUnitStatus;
  readonly gate: string;
  readonly actorType: ActorType;
  readonly actorId?: string | null;
  readonly warehouseId?: string | null;
  readonly shipmentId?: string | null;
  readonly shipmentItemId?: string | null;
  readonly note?: string | null;
}

@Injectable()
export class StockUnitService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Intake. Called INSIDE the goods-receipt transaction, right beside the
   * RECEIVING movement, so units and aggregate quantity commit or roll
   * back together — there is no window where one exists without the other.
   */
  async registerUnits(
    tx: Prisma.TransactionClient,
    input: RegisterUnitsInput,
  ): Promise<readonly RegisteredUnit[]> {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new BadRequestException({
        code: 'UNIT_QUANTITY_INVALID',
        message: `quantity must be a positive integer, got ${input.quantity}`,
      });
    }
    const supplied = (input.serials ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
    if (supplied.length > input.quantity) {
      throw new BadRequestException({
        code: 'UNIT_SERIAL_COUNT_MISMATCH',
        message: `${supplied.length} serials supplied for ${input.quantity} unit(s)`,
      });
    }
    const dupes = supplied.filter((s, i) => supplied.indexOf(s) !== i);
    if (dupes.length > 0) {
      throw new BadRequestException({
        code: 'UNIT_SERIAL_DUPLICATED',
        message: `Serial(s) repeated in one intake: ${[...new Set(dupes)].join(', ')}`,
      });
    }

    const prefix = input.serialPrefix ?? 'SDU';
    const out: RegisteredUnit[] = [];
    for (let i = 0; i < input.quantity; i += 1) {
      const scanned = supplied[i];
      const serial = scanned ?? this.generateSerial(prefix);
      let created: { id: string };
      try {
        created = await tx.stockUnit.create({
          data: {
            sellerId: input.sellerId,
            variantId: input.variantId,
            serialBarcode: serial,
            status: StockUnitStatus.IN_STOCK,
            warehouseId: input.warehouseId,
            binId: input.binId ?? null,
            batchId: input.batchId ?? null,
            goodsReceiptLineId: input.goodsReceiptLineId ?? null,
            isSystemGenerated: scanned === undefined,
            lastScanAt: new Date(),
            ...(input.actorType === ActorType.STAFF && input.actorId
              ? { lastScanByStaffId: input.actorId }
              : {}),
            note: input.note ?? null,
          },
          select: { id: true },
        });
      } catch (err) {
        // A supplier serial we have already seen for this seller is a
        // hard error, not something to silently renumber: it means two
        // physical units claim the same identity.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException({
            code: 'UNIT_SERIAL_ALREADY_REGISTERED',
            message: `Serial '${serial}' is already registered for this seller`,
          });
        }
        throw err;
      }
      await this.appendEvent(tx, {
        stockUnitId: created.id,
        fromStatus: null,
        toStatus: StockUnitStatus.IN_STOCK,
        gate: 'RECEIVING',
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        warehouseId: input.warehouseId,
        note: input.note ?? null,
        metadata: {
          goodsReceiptLineId: input.goodsReceiptLineId ?? null,
          isSystemGenerated: scanned === undefined,
        },
      });
      out.push({
        id: created.id,
        serialBarcode: serial,
        isSystemGenerated: scanned === undefined,
      });
    }
    return out;
  }

  /**
   * The scan gate. Resolves each serial, asserts it is the right SKU in
   * the right state (and right warehouse when one is supplied), moves it
   * and logs the scan. ALL-OR-NOTHING within the caller's tx: the first
   * bad serial throws, so a parcel is never half-scanned.
   */
  async scanUnits(tx: Prisma.TransactionClient, input: ScanUnitsInput): Promise<readonly string[]> {
    const serials = input.serials.map((s) => s.trim()).filter((s) => s.length > 0);
    if (serials.length === 0) {
      throw new BadRequestException({
        code: 'UNIT_SCAN_REQUIRED',
        message: 'At least one serial must be scanned',
      });
    }
    const dupes = serials.filter((s, i) => serials.indexOf(s) !== i);
    if (dupes.length > 0) {
      throw new UnitScanRejectedError(
        'UNIT_SCAN_DUPLICATED',
        `Serial(s) scanned twice in one submission: ${[...new Set(dupes)].join(', ')}`,
        { serials: [...new Set(dupes)] },
      );
    }

    const scannedIds: string[] = [];
    for (const serial of serials) {
      const unit = await tx.stockUnit.findUnique({
        where: {
          sellerId_serialBarcode: { sellerId: input.sellerId, serialBarcode: serial },
        },
        select: {
          id: true,
          variantId: true,
          status: true,
          warehouseId: true,
        },
      });
      if (!unit) {
        throw new NotFoundException({
          code: 'UNIT_NOT_FOUND',
          message: `No unit registered with serial '${serial}'`,
        });
      }
      if (unit.variantId !== input.variantId) {
        throw new UnitScanRejectedError(
          'UNIT_WRONG_SKU',
          `Serial '${serial}' belongs to a different SKU than this line`,
          { serial },
        );
      }
      if (unit.status !== input.fromStatus) {
        throw new UnitScanRejectedError(
          'UNIT_WRONG_STATUS',
          `Serial '${serial}' is ${unit.status}; this gate expects ${input.fromStatus}`,
          { serial, actual: unit.status, expected: input.fromStatus },
        );
      }
      if (
        input.warehouseId !== undefined &&
        input.warehouseId !== null &&
        unit.warehouseId !== input.warehouseId
      ) {
        throw new UnitScanRejectedError(
          'UNIT_WRONG_WAREHOUSE',
          `Serial '${serial}' is held at another warehouse`,
          { serial },
        );
      }

      await tx.stockUnit.update({
        where: { id: unit.id },
        data: {
          status: input.toStatus,
          lastScanAt: new Date(),
          ...(input.actorType === ActorType.STAFF && input.actorId
            ? { lastScanByStaffId: input.actorId }
            : {}),
          ...(input.shipmentItemId === undefined ? {} : { shipmentItemId: input.shipmentItemId }),
          ...(input.warehouseId === undefined || input.warehouseId === null
            ? {}
            : { warehouseId: input.warehouseId }),
        },
      });
      await this.appendEvent(tx, {
        stockUnitId: unit.id,
        fromStatus: unit.status,
        toStatus: input.toStatus,
        gate: input.gate,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        shipmentId: input.shipmentId ?? null,
        warehouseId: input.warehouseId ?? unit.warehouseId,
        note: input.note ?? null,
        metadata: { serial },
      });
      scannedIds.push(unit.id);
    }
    return scannedIds;
  }

  /**
   * Parcel-grained scan gate (the PACK gate). The packer re-scans the
   * whole parcel; the scanned set must match the units already attached
   * to this shipment EXACTLY — no missing unit (something never made it
   * into the box) and no extra unit (something from another parcel did).
   * Set equality is the point: a count check alone would pass a swap.
   */
  async scanUnitsForShipment(
    tx: Prisma.TransactionClient,
    input: {
      readonly sellerId: string;
      readonly shipmentId: string;
      readonly serials: readonly string[];
      readonly fromStatus: StockUnitStatus;
      readonly toStatus: StockUnitStatus;
      readonly gate: string;
      readonly actorType: ActorType;
      readonly actorId?: string | null;
      readonly note?: string | null;
    },
  ): Promise<number> {
    const expected = await tx.stockUnit.findMany({
      where: {
        sellerId: input.sellerId,
        status: input.fromStatus,
        shipmentItem: { shipmentId: input.shipmentId },
      },
      select: { id: true, serialBarcode: true, warehouseId: true },
    });
    const scanned = input.serials.map((s) => s.trim()).filter((s) => s.length > 0);
    const expectedSet = new Set(expected.map((u) => u.serialBarcode));
    const scannedSet = new Set(scanned);

    const missing = [...expectedSet].filter((s) => !scannedSet.has(s));
    const extra = [...scannedSet].filter((s) => !expectedSet.has(s));
    if (missing.length > 0 || extra.length > 0) {
      throw new UnitScanRejectedError(
        'UNIT_SCAN_SET_MISMATCH',
        `Scanned set does not match the parcel: ${missing.length} missing, ${extra.length} unexpected`,
        { missing, extra },
      );
    }

    for (const unit of expected) {
      await tx.stockUnit.update({
        where: { id: unit.id },
        data: {
          status: input.toStatus,
          lastScanAt: new Date(),
          ...(input.actorType === ActorType.STAFF && input.actorId
            ? { lastScanByStaffId: input.actorId }
            : {}),
        },
      });
      await this.appendEvent(tx, {
        stockUnitId: unit.id,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        gate: input.gate,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        shipmentId: input.shipmentId,
        warehouseId: unit.warehouseId,
        note: input.note ?? null,
        metadata: { serial: unit.serialBarcode },
      });
    }
    return expected.length;
  }

  /** How many units are attached to a shipment in a given status. Lets a
   *  gate decide whether strict enforcement applies to THIS parcel
   *  without duplicating the unit query. */
  async countForShipment(shipmentId: string, status: StockUnitStatus): Promise<number> {
    return this.prisma.client.stockUnit.count({
      where: { status, shipmentItem: { shipmentId } },
    });
  }

  /**
   * Move every unit already attached to a parcel line — used by the
   * gates that act on a whole parcel with no per-unit scan (dispatch
   * handoff, RTO write-off), where the AWB itself is the scanned thing.
   * Guarded on `fromStatus`, so a re-run moves nothing and returns 0
   * instead of walking units forward twice.
   */
  async advanceUnitsForShipment(
    tx: Prisma.TransactionClient,
    input: {
      readonly shipmentId: string;
      readonly fromStatus: StockUnitStatus;
      readonly toStatus: StockUnitStatus;
      readonly gate: string;
      readonly actorType: ActorType;
      readonly actorId?: string | null;
      readonly warehouseId?: string | null;
      /** Narrow to one parcel LINE — RTO disposition is per-line
       *  (one line restocks while another is written off). */
      readonly shipmentItemId?: string;
      /** Where the unit physically lands (RTO restock puts it back in a
       *  bin+batch). Omitted ⇒ location untouched. */
      readonly binId?: string | null;
      readonly batchId?: string | null;
      readonly writeOffReason?: string | null;
      readonly note?: string | null;
    },
  ): Promise<number> {
    const units = await tx.stockUnit.findMany({
      where: {
        status: input.fromStatus,
        ...(input.shipmentItemId === undefined
          ? { shipmentItem: { shipmentId: input.shipmentId } }
          : { shipmentItemId: input.shipmentItemId }),
      },
      select: { id: true, warehouseId: true },
    });
    for (const unit of units) {
      await tx.stockUnit.update({
        where: { id: unit.id },
        data: {
          status: input.toStatus,
          lastScanAt: new Date(),
          ...(input.actorType === ActorType.STAFF && input.actorId
            ? { lastScanByStaffId: input.actorId }
            : {}),
          ...(input.warehouseId === undefined || input.warehouseId === null
            ? {}
            : { warehouseId: input.warehouseId }),
          ...(input.binId === undefined ? {} : { binId: input.binId }),
          ...(input.batchId === undefined ? {} : { batchId: input.batchId }),
          ...(input.writeOffReason === undefined || input.writeOffReason === null
            ? {}
            : { writeOffReason: input.writeOffReason }),
        },
      });
      await this.appendEvent(tx, {
        stockUnitId: unit.id,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        gate: input.gate,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        shipmentId: input.shipmentId,
        warehouseId: input.warehouseId ?? unit.warehouseId,
        note: input.note ?? null,
        metadata: { viaShipment: true },
      });
    }
    return units.length;
  }

  /**
   * Move units belonging to ONE goods-receipt line — the consignment
   * gate, where a whole leg moves at once and there is no parcel to key
   * on.
   *
   * `limit` is what makes this usable for a partial dispatch: 300 of the
   * 500 units a line received go to India and the other 200 stay in
   * Bangladesh, so the caller asks for exactly as many as it moved in the
   * aggregate ledger. Oldest first (`createdAt`), which is the unit-level
   * echo of FEFO — the units that have been sitting longest travel first.
   *
   * Guarded on `fromStatus` like `advanceUnitsForShipment`, so a re-run
   * moves nothing and returns an empty list rather than walking units
   * forward twice.
   */
  async moveUnitsForReceiptLine(
    tx: Prisma.TransactionClient,
    input: {
      readonly goodsReceiptLineId: string;
      readonly fromStatus: StockUnitStatus;
      readonly toStatus: StockUnitStatus;
      readonly limit: number;
      readonly gate: string;
      readonly actorType: ActorType;
      readonly actorId?: string | null;
      /** Where the units end up. Omit any field to leave it untouched. */
      readonly warehouseId?: string | undefined;
      readonly binId?: string | undefined;
      readonly batchId?: string | undefined;
      /** Only when the units are leaving inventory for good. */
      readonly writeOffReason?: string | undefined;
      readonly note?: string | null;
      /** Narrow to units currently sitting in one bin — an arrival moves
       *  what is in TRANSIT, not what has already been shelved. */
      readonly currentBinId?: string | undefined;
    },
  ): Promise<readonly string[]> {
    if (input.limit <= 0) return [];
    const candidates = await tx.stockUnit.findMany({
      where: {
        goodsReceiptLineId: input.goodsReceiptLineId,
        status: input.fromStatus,
        ...(input.currentBinId === undefined ? {} : { binId: input.currentBinId }),
      },
      orderBy: { createdAt: 'asc' },
      take: input.limit,
      select: { id: true, serialBarcode: true },
    });
    if (candidates.length === 0) return [];

    const now = new Date();
    await tx.stockUnit.updateMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      data: {
        status: input.toStatus,
        ...(input.warehouseId === undefined ? {} : { warehouseId: input.warehouseId }),
        ...(input.binId === undefined ? {} : { binId: input.binId }),
        ...(input.batchId === undefined ? {} : { batchId: input.batchId }),
        ...(input.writeOffReason === undefined ? {} : { writeOffReason: input.writeOffReason }),
        lastScanAt: now,
        ...(input.actorId === undefined || input.actorId === null
          ? {}
          : { lastScanByStaffId: input.actorId }),
      },
    });
    for (const c of candidates) {
      await this.appendEvent(tx, {
        stockUnitId: c.id,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        gate: input.gate,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        note: input.note ?? null,
      });
    }
    return candidates.map((c) => c.serialBarcode);
  }

  /** How many units of this SKU sit IN_STOCK at a warehouse. Used to
   *  reconcile against the aggregate, never to replace it. */
  async countInStock(sellerId: string, variantId: string, warehouseId: string): Promise<number> {
    return this.prisma.client.stockUnit.count({
      where: { sellerId, variantId, warehouseId, status: StockUnitStatus.IN_STOCK },
    });
  }

  // ── internal ──────────────────────────────────────────────────────

  /** The ONLY writer of stock_unit_events. Append-only by construction. */
  private async appendEvent(
    tx: Prisma.TransactionClient,
    input: {
      stockUnitId: string;
      fromStatus: StockUnitStatus | null;
      toStatus: StockUnitStatus;
      gate: string;
      actorType: ActorType;
      actorId: string | null;
      shipmentId?: string | null;
      warehouseId?: string | null;
      note: string | null;
      metadata?: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await tx.stockUnitEvent.create({
      data: {
        stockUnitId: input.stockUnitId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        gate: input.gate,
        actorType: input.actorType,
        actorId: input.actorId,
        shipmentId: input.shipmentId ?? null,
        warehouseId: input.warehouseId ?? null,
        note: input.note,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      },
    });
  }

  /** `<PREFIX>-<26 bits of base32>` — short enough to print on a small
   *  label, wide enough that collisions are a non-event (and the unique
   *  index is the real guard either way). */
  private generateSerial(prefix: string): string {
    const body = randomBytes(8).toString('base64url').replace(/[-_]/g, '').toUpperCase();
    return `${prefix}-${body.slice(0, 10)}`;
  }
}
