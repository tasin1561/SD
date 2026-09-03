import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  InventoryMode,
  OrderStatus,
  PickBatchStatus,
  Prisma,
  ShipmentStatus,
} from '@skydrop/db';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { InventoryModeService } from '../../inventory-shared/inventory-mode.service';
import { PickAllocationService } from '../../pick-allocation/pick-allocation.service';
import { StockReservationService } from '../../inventory-stock/services/stock-reservation.service';
import { OrderWriteService } from '../../order/services/order-write.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { PickBatchNumberingService } from './pick-batch-numbering.service';
import { PickListPdfService, type PickListLine } from './pick-list-pdf.service';

export interface PickBatchView {
  readonly id: string;
  readonly batchNumber: string;
  readonly status: PickBatchStatus;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly shipmentCount: number;
  readonly totalUnits: number;
  readonly createdAtIso: string;
  readonly createdByName: string | null;
  readonly printedAtIso: string | null;
  readonly printedByName: string | null;
  readonly shipments: ReadonlyArray<{
    shipmentId: string;
    shipmentNumber: string;
    orderNumber: string;
    awbNumber: string | null;
  }>;
}

export interface PickListResult {
  readonly batchId: string;
  readonly batchNumber: string;
  readonly pdfBase64: string;
  readonly fileName: string;
  readonly lineCount: number;
  readonly strictMode: boolean;
  /** Lines whose stock could not be allocated. Named, never silent. */
  readonly shortfalls: ReadonlyArray<{ skuCode: string; reason: string }>;
}

const MAX_PER_BATCH = 60;

/**
 * A batch is a walk.
 *
 * Creating one is cheap and reversible — it just marks which parcels are
 * going out together. PRINTING it is the commitment: that is when stock
 * is allocated to specific bins (phase-2, INV-4), which is what makes
 * the locations on the paper real rather than a guess about where the
 * goods probably are.
 *
 * Doing it the other way round — allocate at selection — holds stock
 * from the moment somebody ticks a box, including for batches that are
 * assembled and then abandoned. Doing it later, at pack, would print a
 * location that may have been picked clean by the time anybody walks to
 * it.
 */
@Injectable()
export class PickBatchService {
  private readonly logger = new Logger(PickBatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly numbering: PickBatchNumberingService,
    private readonly allocation: PickAllocationService,
    private readonly reservations: StockReservationService,
    private readonly modes: InventoryModeService,
    private readonly orderWrite: OrderWriteService,
    private readonly pdf: PickListPdfService,
  ) {}

  /**
   * Claim a set of parcels for one walk.
   *
   * The claim is the `pickBatchId` stamp, taken under a guarded
   * `updateMany` on `pickBatchId IS NULL` — never a read-then-write.
   * Two supervisors building batches at the same desk would otherwise
   * both read "unbatched" and both claim the same parcel, and the second
   * sheet would send somebody to fetch goods that are already on a
   * trolley.
   */
  async create(
    shipmentIds: readonly string[],
    staffId: string,
    ctx?: ClientContext,
  ): Promise<PickBatchView> {
    if (shipmentIds.length === 0) {
      throw new BadRequestException({
        code: 'NO_SHIPMENTS_SELECTED',
        message: 'Select at least one parcel for the batch',
      });
    }
    if (shipmentIds.length > MAX_PER_BATCH) {
      throw new BadRequestException({
        code: 'TOO_MANY_SHIPMENTS',
        message: `A batch holds at most ${MAX_PER_BATCH} parcels; a longer walk than that is two walks`,
      });
    }

    const rows = await this.prisma.client.shipment.findMany({
      where: { id: { in: [...shipmentIds] }, deletedAt: null },
      select: {
        id: true,
        shipmentNumber: true,
        status: true,
        labelPrintedAt: true,
        pickBatchId: true,
        originWarehouseId: true,
      },
    });
    if (rows.length !== shipmentIds.length) {
      throw new BadRequestException({
        code: 'SHIPMENT_NOT_FOUND',
        message: 'One or more selected parcels no longer exist',
      });
    }

    // A batch is ONE warehouse. A sheet listing shelves in two buildings
    // cannot be walked by one person, and the locations would collide.
    const warehouses = new Set(rows.map((r) => r.originWarehouseId));
    if (warehouses.size > 1) {
      throw new BadRequestException({
        code: 'MIXED_WAREHOUSES',
        message: 'Every parcel on a batch must ship from the same warehouse',
      });
    }
    const warehouseId = rows[0]?.originWarehouseId;
    if (warehouseId === undefined) {
      throw new BadRequestException({ code: 'NO_WAREHOUSE', message: 'No warehouse resolved' });
    }

    const unlabelled = rows.filter((r) => r.labelPrintedAt === null);
    if (unlabelled.length > 0) {
      throw new ConflictException({
        code: 'LABEL_NOT_PRINTED',
        message:
          `Print the shipping label first for: ${unlabelled.map((r) => r.shipmentNumber).join(', ')}. ` +
          'A picked parcel with no label sits on the bench with nothing saying where it goes.',
      });
    }
    const already = rows.filter((r) => r.pickBatchId !== null);
    if (already.length > 0) {
      throw new ConflictException({
        code: 'ALREADY_BATCHED',
        message: `Already on another batch: ${already.map((r) => r.shipmentNumber).join(', ')}`,
      });
    }

    return this.prisma.client.$transaction(async (tx) => {
      const batchNumber = await this.numbering.nextBatchNumber(tx);
      const batch = await tx.pickBatch.create({
        data: {
          batchNumber,
          warehouseId,
          status: PickBatchStatus.DRAFT,
          createdByStaffId: staffId,
        },
        select: { id: true, batchNumber: true, createdAt: true },
      });

      // The claim. `pickBatchId: null` in the WHERE is the whole guard.
      const claimed = await tx.shipment.updateMany({
        where: { id: { in: [...shipmentIds] }, pickBatchId: null },
        data: { pickBatchId: batch.id },
      });
      if (claimed.count !== shipmentIds.length) {
        throw new ConflictException({
          code: 'BATCH_CLAIM_LOST',
          message:
            'Somebody else put one of these parcels on a batch while you were selecting. Nothing was changed — refresh and try again.',
        });
      }

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          actorId: staffId,
          action: 'warehouse.pick_batch.created',
          entityType: 'pick_batch',
          entityId: batch.id,
          severity: 'MEDIUM',
          metadata: {
            batchNumber,
            warehouseId,
            shipmentIds: [...shipmentIds],
            ipAddress: ctx?.ipAddress ?? null,
            userAgent: ctx?.userAgent ?? null,
            requestId: ctx?.requestId ?? null,
          },
        },
        tx,
      );

      return this.viewFromTx(tx, batch.id);
    });
  }

  /**
   * Build the sheet — and allocate the stock it describes.
   *
   * Allocation happens HERE, not at confirm: the sheet has to carry real
   * bin codes, and a bin code is only real once the reservation points
   * at it. A shortfall therefore surfaces at the desk, on the paper,
   * before anybody has walked anywhere.
   */
  async buildList(batchId: string, staffId: string): Promise<PickListResult> {
    const batch = await this.prisma.client.pickBatch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        batchNumber: true,
        status: true,
        warehouseId: true,
        warehouse: { select: { name: true } },
        shipments: {
          select: {
            id: true,
            shipmentNumber: true,
            orderShipments: { select: { orderId: true }, take: 1 },
          },
        },
      },
    });
    if (batch === null) {
      throw new BadRequestException({ code: 'BATCH_NOT_FOUND', message: 'No such batch' });
    }
    if (batch.status === PickBatchStatus.CANCELLED) {
      throw new ConflictException({
        code: 'BATCH_CANCELLED',
        message: 'This batch was cancelled; its parcels are back in the queue',
      });
    }

    const orderIds = batch.shipments
      .map((s) => s.orderShipments[0]?.orderId)
      .filter((id): id is string => id !== undefined);

    // ALLOCATE. Per reservation, through the WMS-3 retry wrapper so a
    // transient version-CAS clash does not read as a shortfall.
    const shortfalls: Array<{ skuCode: string; reason: string }> = [];
    for (const orderId of orderIds) {
      const active = await this.reservations.listActiveForOrderWithLocations(orderId);
      for (const r of active) {
        if (r.binId !== null && r.batchId !== null) continue; // already phase-2
        try {
          await this.allocation.allocateForPick(r.id, { type: ActorType.STAFF, id: staffId });
        } catch (err) {
          // Named on the sheet rather than thrown: the rest of the batch
          // is still walkable, and a picker who knows one line is short
          // can bring the others back and let a supervisor deal with it.
          this.logger.warn(
            { batchId, reservationId: r.id, err: (err as Error).message },
            'Pick-batch allocation shortfall',
          );
          shortfalls.push({
            skuCode: r.variantId,
            reason: (err as Error).message.slice(0, 160),
          });
        }
      }
    }

    const { lines, strictMode, totalUnits } = await this.buildLines(batch.shipments, orderIds);
    const staff = await this.prisma.client.staffUser.findUnique({
      where: { id: staffId },
      select: { emailDisplay: true, email: true },
    });

    const pdf = await this.pdf.render({
      batchNumber: batch.batchNumber,
      warehouseName: batch.warehouse?.name ?? '—',
      printedAtIso: new Date().toISOString(),
      printedByName: staff?.emailDisplay ?? staff?.email ?? 'staff',
      shipmentCount: batch.shipments.length,
      totalUnits,
      strictMode,
      lines,
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'warehouse.pick_batch.list_built',
      entityType: 'pick_batch',
      entityId: batch.id,
      severity: 'LOW',
      metadata: {
        batchNumber: batch.batchNumber,
        lineCount: lines.length,
        shortfallCount: shortfalls.length,
      },
    });

    return {
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      pdfBase64: pdf.toString('base64'),
      fileName: `picking-list-${batch.batchNumber}.pdf`,
      lineCount: lines.length,
      strictMode,
      shortfalls,
    };
  }

  /**
   * The picker says the sheet is in their hand — send the parcels to be
   * picked and then packed.
   *
   * Guarded on DRAFT, so a second confirmation is a no-op rather than a
   * re-stamp claiming two prints. The per-order transition to
   * PENDING_PICK is POST-COMMIT and per-order isolated: one order that
   * has moved on underneath must not strand the rest of the walk.
   */
  async confirmPrinted(
    batchId: string,
    staffId: string,
    ctx?: ClientContext,
  ): Promise<{ batchNumber: string; alreadyPrinted: boolean; transitioned: number }> {
    const batch = await this.prisma.client.pickBatch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        batchNumber: true,
        status: true,
        shipments: { select: { orderShipments: { select: { orderId: true }, take: 1 } } },
      },
    });
    if (batch === null) {
      throw new BadRequestException({ code: 'BATCH_NOT_FOUND', message: 'No such batch' });
    }
    if (batch.status !== PickBatchStatus.DRAFT) {
      return { batchNumber: batch.batchNumber, alreadyPrinted: true, transitioned: 0 };
    }

    const now = new Date();
    const claimed = await this.prisma.client.pickBatch.updateMany({
      where: { id: batchId, status: PickBatchStatus.DRAFT },
      data: { status: PickBatchStatus.PRINTED, printedAt: now, printedByStaffId: staffId },
    });
    if (claimed.count === 0) {
      return { batchNumber: batch.batchNumber, alreadyPrinted: true, transitioned: 0 };
    }

    let transitioned = 0;
    for (const s of batch.shipments) {
      const orderId = s.orderShipments[0]?.orderId;
      if (orderId === undefined) continue;
      try {
        await this.orderWrite.transitionStatus({
          orderId,
          to: OrderStatus.PENDING_PICK,
          actor: { type: ActorType.STAFF, id: staffId },
          expectedFrom: OrderStatus.CONFIRMED,
          reason: `Picking list ${batch.batchNumber} printed`,
          ...(ctx !== undefined ? { ctx } : {}),
        });
        transitioned += 1;
      } catch (err) {
        // An order already in PENDING_PICK is the ordinary case on a
        // re-run and is not worth a failure; anything else is logged and
        // the walk continues.
        this.logger.warn(
          { batchId, orderId, err: (err as Error).message },
          'Pick-batch order transition skipped',
        );
      }
    }

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'warehouse.pick_batch.print_confirmed',
      entityType: 'pick_batch',
      entityId: batchId,
      severity: 'MEDIUM',
      metadata: {
        batchNumber: batch.batchNumber,
        shipmentCount: batch.shipments.length,
        transitioned,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    return { batchNumber: batch.batchNumber, alreadyPrinted: false, transitioned };
  }

  /**
   * The picker is back with the trolley.
   *
   * This is the step the print-first flow was missing, and its absence
   * would have been the same mistake as the automatic manifest close:
   * `PickExecutionService.complete` is the ONLY writer of
   * `OrderStatus.PICKED`, and the pack queue selects on exactly that —
   * so a batch printed and walked with nothing to close it would have
   * stranded every parcel in PENDING_PICK, picked in the real world and
   * invisible to the packing bench.
   *
   * Per-order isolated, and mirrors `complete`'s saga ordering: the
   * operational stamp FIRST (guarded on `pickCompletedAt IS NULL`, so a
   * re-run preserves the original timestamp), the authoritative
   * transition LAST.
   *
   * ── WHAT IT REFUSES ──────────────────────────────────────────────
   * A STRICT-mode line, by name. There, every unit carries a serial and
   * the scan at PICK is what binds units to the parcel — pack then
   * demands the scanned set EQUAL those units (UNIT-2). Closing a
   * strict pick from paper would leave the parcel with no bound units
   * and make the pack gate compare against nothing. Those parcels go
   * through the per-parcel station, which still exists for exactly this.
   */
  async markPicked(
    batchId: string,
    staffId: string,
    ctx?: ClientContext,
  ): Promise<{
    batchNumber: string;
    picked: number;
    skipped: ReadonlyArray<{ shipmentNumber: string; reason: string }>;
  }> {
    const batch = await this.prisma.client.pickBatch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        batchNumber: true,
        status: true,
        shipments: {
          select: {
            id: true,
            shipmentNumber: true,
            pickCompletedAt: true,
            orderShipments: { select: { orderId: true }, take: 1 },
          },
        },
      },
    });
    if (batch === null) {
      throw new BadRequestException({ code: 'BATCH_NOT_FOUND', message: 'No such batch' });
    }
    if (batch.status !== PickBatchStatus.PRINTED) {
      throw new ConflictException({
        code: 'BATCH_NOT_PRINTED',
        message:
          'Only a batch whose sheet was printed can be marked picked — print it first, then walk it',
      });
    }

    const now = new Date();
    const skipped: Array<{ shipmentNumber: string; reason: string }> = [];
    let picked = 0;

    for (const ship of batch.shipments) {
      const orderId = ship.orderShipments[0]?.orderId;
      if (orderId === undefined) continue;

      // STRICT is refused BY NAME rather than silently passed over.
      const strict = await this.isStrict(orderId);
      if (strict) {
        skipped.push({
          shipmentNumber: ship.shipmentNumber,
          reason: 'Serialised stock — scan its units at the pick station',
        });
        continue;
      }

      try {
        // Operational stamp FIRST (visible-vs-silent), guarded so a
        // re-run keeps the original time rather than moving it.
        await this.prisma.client.shipment.updateMany({
          where: { id: ship.id, status: ShipmentStatus.CREATED, pickCompletedAt: null },
          data: { pickCompletedAt: now, pickExpiresAt: null },
        });
        await this.orderWrite.transitionStatus({
          orderId,
          to: OrderStatus.PICKED,
          actor: { type: ActorType.STAFF, id: staffId },
          expectedFrom: OrderStatus.PENDING_PICK,
          reason: `Picked on batch ${batch.batchNumber}`,
          ...(ctx !== undefined ? { ctx } : {}),
        });
        picked += 1;
      } catch (err) {
        // One parcel that moved on underneath must not strand the walk.
        this.logger.warn(
          { batchId, orderId, err: (err as Error).message },
          'Batch mark-picked skipped a parcel',
        );
        skipped.push({
          shipmentNumber: ship.shipmentNumber,
          reason: (err as Error).message.slice(0, 120),
        });
      }
    }

    // COMPLETED only when the whole walk landed. A batch with a strict
    // parcel still on it has work left, and saying otherwise would hide
    // it from whoever has to finish it.
    if (skipped.length === 0) {
      await this.prisma.client.pickBatch.updateMany({
        where: { id: batchId, status: PickBatchStatus.PRINTED },
        data: { status: PickBatchStatus.COMPLETED },
      });
    }

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'warehouse.pick_batch.marked_picked',
      entityType: 'pick_batch',
      entityId: batchId,
      severity: 'MEDIUM',
      metadata: {
        batchNumber: batch.batchNumber,
        picked,
        skipped: skipped.length,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    return { batchNumber: batch.batchNumber, picked, skipped };
  }

  /** Does this order carry any serialised line? */
  private async isStrict(orderId: string): Promise<boolean> {
    const active = await this.reservations.listActiveForOrderWithLocations(orderId);
    for (const r of active) {
      const mode = await this.modes.resolveForVariant(r.sellerId, r.variantId);
      if (mode === InventoryMode.STRICT) return true;
    }
    return false;
  }

  /** Abandon a batch that was never printed — the parcels go back. */
  async cancel(batchId: string, staffId: string, ctx?: ClientContext): Promise<void> {
    const claimed = await this.prisma.client.pickBatch.updateMany({
      where: { id: batchId, status: PickBatchStatus.DRAFT },
      data: { status: PickBatchStatus.CANCELLED },
    });
    if (claimed.count === 0) {
      throw new ConflictException({
        code: 'BATCH_NOT_DRAFT',
        message: 'Only a batch that has not been printed can be cancelled',
      });
    }
    // Release the parcels so they reappear in the picking queue. No
    // stock is released: nothing was allocated for a DRAFT batch.
    await this.prisma.client.shipment.updateMany({
      where: { pickBatchId: batchId },
      data: { pickBatchId: null },
    });
    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'warehouse.pick_batch.cancelled',
      entityType: 'pick_batch',
      entityId: batchId,
      severity: 'MEDIUM',
      metadata: {
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });
  }

  /** Past batches, newest first, searchable by batch number, order
   *  number or AWB — the three things somebody holding a sheet knows. */
  async list(opts: {
    search?: string | undefined;
    status?: PickBatchStatus | undefined;
    limit?: number | undefined;
  }): Promise<PickBatchView[]> {
    const search = opts.search?.trim() ?? '';
    const where: Prisma.PickBatchWhereInput = {
      ...(opts.status !== undefined ? { status: opts.status } : {}),
      ...(search === ''
        ? {}
        : {
            OR: [
              { batchNumber: { contains: search, mode: 'insensitive' } },
              {
                shipments: { some: { shipmentNumber: { contains: search, mode: 'insensitive' } } },
              },
              { shipments: { some: { awbNumber: { contains: search, mode: 'insensitive' } } } },
              {
                shipments: {
                  some: {
                    orderShipments: {
                      some: {
                        order: { orderNumber: { contains: search, mode: 'insensitive' } },
                      },
                    },
                  },
                },
              },
            ],
          }),
    };

    const rows = await this.prisma.client.pickBatch.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.limit ?? 50, 200),
      select: PICK_BATCH_SELECT,
    });
    return rows.map((r) => toView(r));
  }

  async getById(batchId: string): Promise<PickBatchView> {
    const row = await this.prisma.client.pickBatch.findUnique({
      where: { id: batchId },
      select: PICK_BATCH_SELECT,
    });
    if (row === null) {
      throw new BadRequestException({ code: 'BATCH_NOT_FOUND', message: 'No such batch' });
    }
    return toView(row);
  }

  // ---------- internal ----------

  private async viewFromTx(tx: Prisma.TransactionClient, id: string): Promise<PickBatchView> {
    const row = await tx.pickBatch.findUniqueOrThrow({ where: { id }, select: PICK_BATCH_SELECT });
    return toView(row);
  }

  /**
   * One row per VARIANT, ordered by shelf.
   *
   * Consolidating is the entire point: the expensive part of picking is
   * walking, and a list ordered by order number sends somebody up the
   * same aisle four times.
   */
  private async buildLines(
    shipments: ReadonlyArray<{ id: string; shipmentNumber: string }>,
    orderIds: readonly string[],
  ): Promise<{ lines: PickListLine[]; strictMode: boolean; totalUnits: number }> {
    const byShipment = new Map(shipments.map((s) => [s.id, s.shipmentNumber]));

    const reservations = await this.prisma.client.stockReservation.findMany({
      where: { orderId: { in: [...orderIds] }, status: 'ACTIVE' },
      select: {
        qtyReserved: true,
        variantId: true,
        sellerId: true,
        binId: true,
        orderId: true,
        bin: { select: { code: true, zone: { select: { name: true } } } },
        variant: {
          select: {
            skuCode: true,
            barcode: true,
            variantLabel: true,
            product: { select: { name: true } },
          },
        },
      },
    });

    // Which parcel each order belongs to, for the small "for" line.
    const shipmentByOrder = new Map<string, string>();
    const links = await this.prisma.client.orderShipment.findMany({
      where: { orderId: { in: [...orderIds] }, shipmentId: { in: [...byShipment.keys()] } },
      select: { orderId: true, shipmentId: true },
    });
    for (const l of links) {
      shipmentByOrder.set(l.orderId, byShipment.get(l.shipmentId) ?? '');
    }

    // STRICT anywhere in the batch means the whole sheet is strict: a
    // sheet that shows barcodes for some lines and not others invites
    // scanning the SKU where a unit serial was required.
    const modePairs = await Promise.all(
      [...new Set(reservations.map((r) => `${r.sellerId}|${r.variantId}`))].map(async (key) => {
        const [sellerId, variantId] = key.split('|');
        return this.modes.resolveForVariant(sellerId ?? '', variantId ?? '');
      }),
    );
    const strictMode = modePairs.some((m) => m === InventoryMode.STRICT);

    const grouped = new Map<string, PickListLine & { forSet: Set<string> }>();
    let totalUnits = 0;
    for (const r of reservations) {
      totalUnits += r.qtyReserved;
      // Keyed on variant AND bin: the same SKU in two bins is two walks,
      // so it must be two rows.
      const key = `${r.variantId}|${r.binId ?? 'unallocated'}`;
      const existing = grouped.get(key);
      const forShipment = shipmentByOrder.get(r.orderId) ?? '';
      if (existing !== undefined) {
        existing.forSet.add(forShipment);
        grouped.set(key, {
          ...existing,
          quantity: existing.quantity + r.qtyReserved,
        });
        continue;
      }
      grouped.set(key, {
        skuCode: r.variant?.skuCode ?? '—',
        productName: r.variant?.product?.name ?? '—',
        variantName: r.variant?.variantLabel ?? null,
        quantity: r.qtyReserved,
        // An unallocated line still prints, saying so — a blank where a
        // shelf should be is the most useful thing on the sheet.
        binCode: r.bin?.code ?? 'NOT ALLOCATED',
        zoneName: r.bin?.zone?.name ?? null,
        barcode: strictMode ? null : (r.variant?.barcode ?? null),
        forShipments: [],
        forSet: new Set(forShipment === '' ? [] : [forShipment]),
      });
    }

    const lines = [...grouped.values()]
      .map((l) => ({ ...l, forShipments: [...l.forSet].sort() }))
      .sort((a, b) => a.binCode.localeCompare(b.binCode) || a.skuCode.localeCompare(b.skuCode))
      .map(({ forSet: _forSet, ...line }) => line);

    return { lines, strictMode, totalUnits };
  }
}

const PICK_BATCH_SELECT = {
  id: true,
  batchNumber: true,
  status: true,
  warehouseId: true,
  createdAt: true,
  printedAt: true,
  warehouse: { select: { name: true } },
  createdBy: { select: { emailDisplay: true, email: true } },
  printedBy: { select: { emailDisplay: true, email: true } },
  shipments: {
    select: {
      id: true,
      shipmentNumber: true,
      awbNumber: true,
      orderShipments: { select: { order: { select: { orderNumber: true } } }, take: 1 },
    },
  },
} as const;

type PickBatchRow = Prisma.PickBatchGetPayload<{ select: typeof PICK_BATCH_SELECT }>;

function toView(r: PickBatchRow): PickBatchView {
  return {
    id: r.id,
    batchNumber: r.batchNumber,
    status: r.status,
    warehouseId: r.warehouseId,
    warehouseName: r.warehouse?.name ?? '—',
    shipmentCount: r.shipments.length,
    totalUnits: 0,
    createdAtIso: r.createdAt.toISOString(),
    createdByName: r.createdBy?.emailDisplay ?? r.createdBy?.email ?? null,
    printedAtIso: r.printedAt?.toISOString() ?? null,
    printedByName: r.printedBy?.emailDisplay ?? r.printedBy?.email ?? null,
    shipments: r.shipments.map((s) => ({
      shipmentId: s.id,
      shipmentNumber: s.shipmentNumber,
      orderNumber: s.orderShipments[0]?.order?.orderNumber ?? '—',
      awbNumber: s.awbNumber,
    })),
  };
}
