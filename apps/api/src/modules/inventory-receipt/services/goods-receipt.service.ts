import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  BinType,
  GoodsReceiptStatus,
  InventoryMode,
  Prisma,
  VariantStatus,
} from '@skydrop/db';
import { NotificationRecipientType, StockMovementType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import { WarehouseResolverService } from '../../inventory-shared/warehouse-resolver.service';
import { StockMutationService } from '../../inventory-shared/stock-mutation.service';
import { StockUnitService } from '../../inventory-shared/stock-unit.service';
import { InventoryModeService } from '../../inventory-shared/inventory-mode.service';
import { StockAlertService } from '../../inventory-shared/stock-alert.service';
import { StockCacheService } from '../../inventory-shared/stock-cache.service';
import { EmailQueue } from '../../email/queue/email.queue';
import { EnvService } from '../../../config/env.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import type {
  DeclareGoodsReceiptDto,
  DeclareReceiptLineDto,
  ListGoodsReceiptsQueryDto,
  UpdateGoodsReceiptDto,
} from '../dto/goods-receipt.dto';
import type { DiscrepancyResolutionMode } from '../dto/resolve-discrepancy.dto';

const EMAIL_COMPLETED = 'seller.goods_receipt_completed.email';
const EMAIL_DISCREPANCY = 'seller.goods_receipt_discrepancy.email';

const RECEIPT_VIEW_INCLUDE = {
  lines: {
    select: {
      id: true,
      variantId: true,
      batchId: true,
      expectedQty: true,
      receivedQty: true,
      damagedQty: true,
      unitCostInr: true,
      manufacturedAt: true,
      expiresAt: true,
      putawayBinId: true,
      // Enriched in M0-follow-up for the admin/seller goods-receipt
      // UIs — operator needs the SKU + product name (not just the
      // variantId UUID) to verify against the physical parcel.
      variant: {
        select: {
          skuCode: true,
          variantLabel: true,
          product: { select: { name: true } },
        },
      },
    },
  },
  // Seller display for the admin list — operator picks a receipt
  // from a queue and needs to know whose parcel this is.
  seller: {
    select: { id: true, companyName: true, email: true },
  },
} as const;

export type GoodsReceiptView = Prisma.GoodsReceiptGetPayload<{
  include: typeof RECEIPT_VIEW_INCLUDE;
}>;

const MAX_RECEIPT_NUMBER_ATTEMPTS = 5;

/**
 * Goods receipts — seller declares expected stock, the warehouse later
 * records what actually arrived (locked decision #13). This file owns the
 * seller-facing declaration lifecycle (PENDING). Admin recording
 * (commit 17) and the stock-writing completion / discrepancy resolution
 * (commit 18) extend this service.
 */
@Injectable()
export class GoodsReceiptService {
  private readonly logger = new Logger(GoodsReceiptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly catalog: CatalogReadService,
    private readonly warehouses: WarehouseResolverService,
    private readonly mutation: StockMutationService,
    private readonly units: StockUnitService,
    private readonly modes: InventoryModeService,
    private readonly alerts: StockAlertService,
    private readonly cache: StockCacheService,
    private readonly email: EmailQueue,
    private readonly env: EnvService,
  ) {}

  // ---------------- seller declaration ----------------

  async declare(
    sellerId: string,
    input: DeclareGoodsReceiptDto,
    ctx: ClientContext,
  ): Promise<GoodsReceiptView> {
    const warehouseId = await this.warehouses.resolveWarehouseId(input.warehouseId);
    await this.assertVariants(sellerId, input.lines);

    const created = await this.createWithReceiptNumber(async (tx, receiptNumber) => {
      const receipt = await tx.goodsReceipt.create({
        data: {
          sellerId,
          warehouseId,
          receiptNumber,
          status: GoodsReceiptStatus.PENDING,
          expectedArrivalAt: input.expectedArrivalAt ? new Date(input.expectedArrivalAt) : null,
          sellerReference: input.sellerReference ?? null,
          lines: { create: input.lines.map((l) => this.lineCreate(l)) },
        },
        include: RECEIPT_VIEW_INCLUDE,
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'inventory.goods_receipt.declared',
          entityType: 'goods_receipt',
          entityId: receipt.id,
          metadata: {
            receiptNumber,
            warehouseId,
            lineCount: input.lines.length,
            ...this.ctxMeta(ctx),
          },
        },
        tx,
      );
      return receipt;
    });
    return created;
  }

  async list(
    sellerId: string,
    query: ListGoodsReceiptsQueryDto,
  ): Promise<{ items: GoodsReceiptView[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.GoodsReceiptWhereInput = { sellerId, deletedAt: null };
    if (query.status) where.status = query.status;
    const [items, total] = await Promise.all([
      this.prisma.client.goodsReceipt.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
        include: RECEIPT_VIEW_INCLUDE,
      }),
      this.prisma.client.goodsReceipt.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async getForSeller(sellerId: string, id: string): Promise<GoodsReceiptView> {
    const row = await this.prisma.client.goodsReceipt.findFirst({
      where: { id, sellerId, deletedAt: null },
      include: RECEIPT_VIEW_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'GOODS_RECEIPT_NOT_FOUND',
        message: 'Goods receipt not found',
      });
    }
    return row;
  }

  /** PENDING-only edit. */
  async update(
    sellerId: string,
    id: string,
    input: UpdateGoodsReceiptDto,
    ctx: ClientContext,
  ): Promise<GoodsReceiptView> {
    const existing = await this.getForSeller(sellerId, id);
    this.assertStatus(existing.status, [GoodsReceiptStatus.PENDING], 'edit');
    if (input.lines) await this.assertVariants(sellerId, input.lines);

    return this.prisma.client.$transaction(async (tx) => {
      const data: Prisma.GoodsReceiptUpdateInput = {};
      if (input.expectedArrivalAt !== undefined) {
        data.expectedArrivalAt = input.expectedArrivalAt ? new Date(input.expectedArrivalAt) : null;
      }
      if (input.sellerReference !== undefined) {
        data.sellerReference = input.sellerReference;
      }
      if (input.lines) {
        // Full replace — only valid while PENDING (no stock implications).
        await tx.goodsReceiptLine.deleteMany({ where: { receiptId: id } });
        data.lines = { create: input.lines.map((l) => this.lineCreate(l)) };
      }
      const row = await tx.goodsReceipt.update({
        where: { id },
        data,
        include: RECEIPT_VIEW_INCLUDE,
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'inventory.goods_receipt.updated',
          entityType: 'goods_receipt',
          entityId: id,
          metadata: { linesReplaced: Boolean(input.lines), ...this.ctxMeta(ctx) },
        },
        tx,
      );
      return row;
    });
  }

  async cancel(sellerId: string, id: string, ctx: ClientContext): Promise<GoodsReceiptView> {
    const existing = await this.getForSeller(sellerId, id);
    this.assertStatus(existing.status, [GoodsReceiptStatus.PENDING], 'cancel');
    return this.prisma.client.$transaction(async (tx) => {
      const row = await tx.goodsReceipt.update({
        where: { id },
        data: { status: GoodsReceiptStatus.CANCELLED },
        include: RECEIPT_VIEW_INCLUDE,
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'inventory.goods_receipt.cancelled',
          entityType: 'goods_receipt',
          entityId: id,
          metadata: this.ctxMeta(ctx),
        },
        tx,
      );
      return row;
    });
  }

  // ---------------- admin recording ----------------

  async listForAdmin(query: {
    sellerId?: string;
    warehouseId?: string;
    status?: GoodsReceiptStatus;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: GoodsReceiptView[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.GoodsReceiptWhereInput = { deletedAt: null };
    if (query.sellerId) where.sellerId = query.sellerId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.status) where.status = query.status;
    const [items, total] = await Promise.all([
      this.prisma.client.goodsReceipt.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
        include: RECEIPT_VIEW_INCLUDE,
      }),
      this.prisma.client.goodsReceipt.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async getForAdmin(id: string): Promise<GoodsReceiptView> {
    const row = await this.prisma.client.goodsReceipt.findFirst({
      where: { id, deletedAt: null },
      include: RECEIPT_VIEW_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'GOODS_RECEIPT_NOT_FOUND',
        message: 'Goods receipt not found',
      });
    }
    return row;
  }

  /** PENDING -> ARRIVING; records who is receiving. */
  async startReceiving(staffId: string, id: string, ctx: ClientContext): Promise<GoodsReceiptView> {
    const existing = await this.getForAdmin(id);
    this.assertStatus(existing.status, [GoodsReceiptStatus.PENDING], 'start receiving');
    return this.prisma.client.$transaction(async (tx) => {
      const row = await tx.goodsReceipt.update({
        where: { id },
        data: { status: GoodsReceiptStatus.ARRIVING, receivedById: staffId },
        include: RECEIPT_VIEW_INCLUDE,
      });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'inventory.goods_receipt.receiving_started',
          entityType: 'goods_receipt',
          entityId: id,
          metadata: this.ctxMeta(ctx),
        },
        tx,
      );
      return row;
    });
  }

  /**
   * Records ACTUAL counts on lines while ARRIVING. Iterative (call
   * repeatedly). No stock is written here — completion (commit 18) turns
   * recorded actuals into batches + movements + levels atomically.
   */
  async recordLines(
    staffId: string,
    id: string,
    lines: Array<{
      lineId: string;
      receivedQty: number;
      damagedQty?: number;
      putawayBinId?: string;
      manufacturedAt?: string;
      expiresAt?: string;
      unitCostInr?: number;
    }>,
    ctx: ClientContext,
  ): Promise<GoodsReceiptView> {
    const receipt = await this.getForAdmin(id);
    this.assertStatus(receipt.status, [GoodsReceiptStatus.ARRIVING], 'record lines for');

    const lineIds = new Set(receipt.lines.map((l) => l.id));
    for (const l of lines) {
      if (!lineIds.has(l.lineId)) {
        throw new BadRequestException({
          code: 'RECEIPT_LINE_NOT_FOUND',
          message: `Line ${l.lineId} is not part of this receipt`,
        });
      }
      if (l.receivedQty > 0 && !l.putawayBinId) {
        throw new BadRequestException({
          code: 'PUTAWAY_BIN_REQUIRED',
          message: `Line ${l.lineId} received ${l.receivedQty} units but has no putaway bin`,
        });
      }
      if (l.putawayBinId) {
        await this.assertPutawayBin(receipt.warehouseId, l.putawayBinId);
      }
    }

    return this.prisma.client.$transaction(async (tx) => {
      for (const l of lines) {
        await tx.goodsReceiptLine.update({
          where: { id: l.lineId },
          data: {
            receivedQty: l.receivedQty,
            damagedQty: l.damagedQty ?? 0,
            putawayBinId: l.putawayBinId ?? null,
            ...(l.manufacturedAt !== undefined
              ? { manufacturedAt: l.manufacturedAt ? new Date(l.manufacturedAt) : null }
              : {}),
            ...(l.expiresAt !== undefined
              ? { expiresAt: l.expiresAt ? new Date(l.expiresAt) : null }
              : {}),
            ...(l.unitCostInr !== undefined
              ? { unitCostInr: l.unitCostInr != null ? new Prisma.Decimal(l.unitCostInr) : null }
              : {}),
          },
        });
      }
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'inventory.goods_receipt.lines_recorded',
          entityType: 'goods_receipt',
          entityId: id,
          metadata: { recordedLineCount: lines.length, ...this.ctxMeta(ctx) },
        },
        tx,
      );
      return tx.goodsReceipt.findUniqueOrThrow({
        where: { id },
        include: RECEIPT_VIEW_INCLUDE,
      });
    });
  }

  // ---------------- completion + discrepancy resolution ----------------

  /**
   * ARRIVING -> COMPLETED or DISCREPANCY.
   *  - any line with receivedQty != expectedQty OR damagedQty > 0 ->
   *    DISCREPANCY, NO stock written (blocks stock from becoming
   *    available until resolved — locked decision #10).
   *  - otherwise the stock-writing completion runs.
   */
  async complete(
    staffId: string,
    id: string,
    ctx: ClientContext,
    /**
     * R4 — supplier-printed serials the receiver scanned, keyed by
     * goods-receipt-line id. Only consulted for STRICT-mode SKUs. Any
     * line left out (or short) gets Skydrop-generated serials to print,
     * so a strict SKU is never blocked at intake by a supplier that
     * doesn't serialize.
     */
    serialsByLineId?: Readonly<Record<string, readonly string[]>>,
  ): Promise<GoodsReceiptView> {
    const receipt = await this.getForAdmin(id);
    this.assertStatus(receipt.status, [GoodsReceiptStatus.ARRIVING], 'complete');

    const discrepancies = this.detectDiscrepancies(receipt);
    if (discrepancies.length > 0) {
      const notes = this.formatDiscrepancyNotes(discrepancies);
      const updated = await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.goodsReceipt.update({
          where: { id },
          data: {
            status: GoodsReceiptStatus.DISCREPANCY,
            hasDiscrepancies: true,
            discrepancyNotes: notes,
          },
          include: RECEIPT_VIEW_INCLUDE,
        });
        await this.audit.log(
          {
            actorType: ActorType.STAFF,
            staffUserId: staffId,
            action: 'inventory.goods_receipt.discrepancy',
            entityType: 'goods_receipt',
            entityId: id,
            metadata: { discrepancies, ...this.ctxMeta(ctx) },
          },
          tx,
        );
        await this.enqueueReceiptEmail(tx, EMAIL_DISCREPANCY, receipt.sellerId, {
          receipt_number: receipt.receiptNumber,
          warehouse_name: await this.warehouseName(tx, receipt.warehouseId),
          discrepancy_notes: notes,
          support_email: this.env.supportEmail,
        });
        return row;
      });
      return updated;
    }

    return this.writeStockAndComplete(staffId, id, null, ctx, serialsByLineId);
  }

  /** DISCREPANCY -> COMPLETED. CORRECT applies corrected actuals first;
   *  FORCE_COMPLETE accepts the recorded counts and stamps a permanent
   *  note. Both then write stock for the (now-authoritative) received
   *  quantities. */
  async resolveDiscrepancy(
    staffId: string,
    id: string,
    input: {
      mode: DiscrepancyResolutionMode;
      note?: string;
      lines?: Array<{
        lineId: string;
        receivedQty: number;
        damagedQty?: number;
        putawayBinId?: string;
        manufacturedAt?: string;
        expiresAt?: string;
        unitCostInr?: number;
      }>;
    },
    ctx: ClientContext,
  ): Promise<GoodsReceiptView> {
    const receipt = await this.getForAdmin(id);
    this.assertStatus(receipt.status, [GoodsReceiptStatus.DISCREPANCY], 'resolve');

    if (input.mode === 'FORCE_COMPLETE') {
      if (!input.note || input.note.trim().length === 0) {
        throw new BadRequestException({
          code: 'FORCE_COMPLETE_NOTE_REQUIRED',
          message: 'A note recording the accepted shortage is required to force-complete',
        });
      }
      const permanentNote = `[FORCE-COMPLETED by staff ${staffId}] ${input.note.trim()} | accepted: ${this.formatDiscrepancyNotes(
        this.detectDiscrepancies(receipt),
      )}`;
      return this.writeStockAndComplete(staffId, id, permanentNote, ctx);
    }

    // CORRECT: apply corrected actuals, then complete on the corrected qtys.
    const correctionLines = input.lines ?? [];
    if (correctionLines.length === 0) {
      throw new BadRequestException({
        code: 'CORRECTION_LINES_REQUIRED',
        message: 'CORRECT mode requires the corrected line actuals',
      });
    }
    const lineIds = new Set(receipt.lines.map((l) => l.id));
    for (const l of correctionLines) {
      if (!lineIds.has(l.lineId)) {
        throw new BadRequestException({
          code: 'RECEIPT_LINE_NOT_FOUND',
          message: `Line ${l.lineId} is not part of this receipt`,
        });
      }
      if (l.receivedQty > 0 && !l.putawayBinId) {
        throw new BadRequestException({
          code: 'PUTAWAY_BIN_REQUIRED',
          message: `Line ${l.lineId} received ${l.receivedQty} units but has no putaway bin`,
        });
      }
      if (l.putawayBinId) await this.assertPutawayBin(receipt.warehouseId, l.putawayBinId);
    }
    await this.prisma.client.$transaction(async (tx) => {
      for (const l of correctionLines) {
        await tx.goodsReceiptLine.update({
          where: { id: l.lineId },
          data: {
            receivedQty: l.receivedQty,
            damagedQty: l.damagedQty ?? 0,
            putawayBinId: l.putawayBinId ?? null,
            ...(l.manufacturedAt !== undefined
              ? { manufacturedAt: l.manufacturedAt ? new Date(l.manufacturedAt) : null }
              : {}),
            ...(l.expiresAt !== undefined
              ? { expiresAt: l.expiresAt ? new Date(l.expiresAt) : null }
              : {}),
            ...(l.unitCostInr !== undefined
              ? { unitCostInr: l.unitCostInr != null ? new Prisma.Decimal(l.unitCostInr) : null }
              : {}),
          },
        });
      }
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'inventory.goods_receipt.discrepancy_corrected',
          entityType: 'goods_receipt',
          entityId: id,
          metadata: { correctedLineCount: correctionLines.length, ...this.ctxMeta(ctx) },
        },
        tx,
      );
    });
    const note = input.note?.trim()
      ? `[CORRECTED by staff ${staffId}] ${input.note.trim()}`
      : `[CORRECTED by staff ${staffId}]`;
    return this.writeStockAndComplete(staffId, id, note, ctx);
  }

  /**
   * THE inventory data-integrity flow. For every received line: create a
   * StockBatch and post a +qty RECEIVING movement through the sole writer
   * (StockMutationService) — batches + movements + stock_levels + receipt
   * status + audit + the completion email ALL in one transaction, retried
   * as a whole on a stock_levels.version clash (INV-1/5/6). Cache
   * invalidation + alert evaluation happen AFTER commit (INV-5).
   *
   * damagedQty is recorded but NOT stocked in Phase 1A (write-off / return
   * handling is Module 8 / Phase 2 — see phase-1a-debt).
   */
  private async writeStockAndComplete(
    staffId: string,
    id: string,
    completionNote: string | null,
    ctx: ClientContext,
    serialsByLineId?: Readonly<Record<string, readonly string[]>>,
  ): Promise<GoodsReceiptView> {
    const now = new Date();
    // R4: resolve the receipt's SKU modes + the serial prefix ONCE,
    // outside the retryable tx (they're read-only settings/catalog reads,
    // and re-reading them per attempt buys nothing).
    const { modeByVariantId, serialPrefix } = await this.resolveUnitContext(id);

    const { view, affectedVariantIds, sellerId, warehouseId, unitsRegistered } =
      await this.mutation.runWithRetry(async (tx) => {
        const receipt = await tx.goodsReceipt.findUniqueOrThrow({
          where: { id },
          include: RECEIPT_VIEW_INCLUDE,
        });
        const variantIds: string[] = [];
        let totalReceived = 0;
        let unitCount = 0;

        for (const [i, line] of receipt.lines.entries()) {
          if (line.receivedQty <= 0) continue;
          if (!line.putawayBinId) {
            throw new BadRequestException({
              code: 'PUTAWAY_BIN_REQUIRED',
              message: `Line ${line.id} has ${line.receivedQty} units but no putaway bin`,
            });
          }
          const batch = await tx.stockBatch.create({
            data: {
              sellerId: receipt.sellerId,
              variantId: line.variantId,
              warehouseId: receipt.warehouseId,
              batchCode: `${receipt.receiptNumber}-L${i + 1}`,
              manufacturedAt: line.manufacturedAt,
              expiresAt: line.expiresAt,
              unitCostInr: line.unitCostInr,
              initialQty: line.receivedQty,
              receivedAt: now,
              receivedById: staffId,
              receivingNoteId: receipt.id,
            },
            select: { id: true },
          });
          await this.mutation.apply(tx, {
            sellerId: receipt.sellerId,
            variantId: line.variantId,
            warehouseId: receipt.warehouseId,
            binId: line.putawayBinId,
            batchId: batch.id,
            qtyChange: line.receivedQty,
            type: StockMovementType.RECEIVING,
            actorType: ActorType.STAFF,
            actorId: staffId,
            reason: `Goods receipt ${receipt.receiptNumber}`,
          });
          await tx.goodsReceiptLine.update({
            where: { id: line.id },
            data: { batchId: batch.id },
          });

          // R4: a STRICT-mode SKU gets one stock_unit row per physical
          // unit, registered in THIS tx alongside the aggregate RECEIVING
          // movement — so units and qtyOnHand can never disagree because
          // one of the two writes was lost.
          if (modeByVariantId.get(line.variantId) === InventoryMode.STRICT) {
            const supplied = serialsByLineId?.[line.id];
            const registered = await this.units.registerUnits(tx, {
              sellerId: receipt.sellerId,
              variantId: line.variantId,
              warehouseId: receipt.warehouseId,
              binId: line.putawayBinId,
              batchId: batch.id,
              goodsReceiptLineId: line.id,
              quantity: line.receivedQty,
              ...(supplied === undefined ? {} : { serials: supplied }),
              serialPrefix,
              actorType: ActorType.STAFF,
              actorId: staffId,
              note: `Goods receipt ${receipt.receiptNumber}`,
            });
            unitCount += registered.length;
          }

          variantIds.push(line.variantId);
          totalReceived += line.receivedQty;
        }

        const row = await tx.goodsReceipt.update({
          where: { id },
          data: {
            status: GoodsReceiptStatus.COMPLETED,
            hasDiscrepancies: false,
            receivedAt: now,
            receivedById: staffId,
            ...(completionNote
              ? {
                  discrepancyNotes: receipt.discrepancyNotes
                    ? `${receipt.discrepancyNotes}\n${completionNote}`
                    : completionNote,
                }
              : {}),
          },
          include: RECEIPT_VIEW_INCLUDE,
        });
        await this.audit.log(
          {
            actorType: ActorType.STAFF,
            staffUserId: staffId,
            action: 'inventory.goods_receipt.completed',
            entityType: 'goods_receipt',
            entityId: id,
            metadata: {
              totalReceived,
              lineCount: receipt.lines.length,
              serializedUnits: unitCount,
              note: completionNote,
              ...this.ctxMeta(ctx),
            },
          },
          tx,
        );
        await this.enqueueReceiptEmail(tx, EMAIL_COMPLETED, receipt.sellerId, {
          receipt_number: receipt.receiptNumber,
          warehouse_name: await this.warehouseName(tx, receipt.warehouseId),
          total_received: totalReceived,
          line_count: receipt.lines.length,
          app_url: this.env.sellerAppUrl,
        });
        return {
          view: row,
          affectedVariantIds: [...new Set(variantIds)],
          sellerId: receipt.sellerId,
          warehouseId: receipt.warehouseId,
          unitsRegistered: unitCount,
        };
      });

    // INV-5: cache invalidation + alert evaluation AFTER commit.
    await this.cache.invalidate(sellerId, warehouseId);
    for (const variantId of affectedVariantIds) {
      await this.alerts.evaluate(sellerId, variantId, warehouseId);
    }
    if (unitsRegistered > 0) {
      this.logger.log(
        { receiptId: id, unitsRegistered },
        'R4: serialized units registered at receipt — labels ready to print',
      );
    }
    return view;
  }

  /**
   * R4 — which of this receipt's SKUs are STRICT, plus the serial prefix
   * to print. Read-only; resolved before the retryable stock tx opens.
   */
  private async resolveUnitContext(receiptId: string): Promise<{
    modeByVariantId: Map<string, InventoryMode>;
    serialPrefix: string;
  }> {
    const receipt = await this.prisma.client.goodsReceipt.findUniqueOrThrow({
      where: { id: receiptId },
      select: { sellerId: true, lines: { select: { variantId: true } } },
    });
    const [modeByVariantId, serialPrefix] = await Promise.all([
      this.modes.resolveForVariants(
        receipt.sellerId,
        receipt.lines.map((l) => l.variantId),
      ),
      this.modes.serialPrefixFor(receipt.sellerId),
    ]);
    return { modeByVariantId, serialPrefix };
  }

  private detectDiscrepancies(receipt: GoodsReceiptView): Array<{
    lineId: string;
    variantId: string;
    expectedQty: number;
    receivedQty: number;
    damagedQty: number;
  }> {
    return receipt.lines
      .filter((l) => l.receivedQty !== l.expectedQty || l.damagedQty > 0)
      .map((l) => ({
        lineId: l.id,
        variantId: l.variantId,
        expectedQty: l.expectedQty,
        receivedQty: l.receivedQty,
        damagedQty: l.damagedQty,
      }));
  }

  private formatDiscrepancyNotes(
    d: Array<{ variantId: string; expectedQty: number; receivedQty: number; damagedQty: number }>,
  ): string {
    return d
      .map(
        (x) =>
          `variant ${x.variantId}: expected ${x.expectedQty}, received ${x.receivedQty}, damaged ${x.damagedQty}`,
      )
      .join('; ');
  }

  private async warehouseName(tx: Prisma.TransactionClient, warehouseId: string): Promise<string> {
    const wh = await tx.warehouse.findUnique({
      where: { id: warehouseId },
      select: { name: true },
    });
    return wh?.name ?? warehouseId;
  }

  private async enqueueReceiptEmail(
    tx: Prisma.TransactionClient,
    templateCode: string,
    sellerId: string,
    variables: Record<string, string | number>,
  ): Promise<void> {
    const seller = await tx.seller.findUnique({
      where: { id: sellerId },
      select: { id: true, email: true, companyName: true },
    });
    if (!seller) return;
    await this.email.enqueue({
      templateCode,
      recipient: {
        type: NotificationRecipientType.SELLER,
        id: seller.id,
        email: seller.email,
      },
      variables: { company_name: seller.companyName, ...variables },
      triggerEvent: 'inventory.goods_receipt',
    });
  }

  // ---------------- shared internals (used by commits 17/18 too) ----------------

  assertStatus(actual: GoodsReceiptStatus, allowed: GoodsReceiptStatus[], action: string): void {
    if (!allowed.includes(actual)) {
      throw new ConflictException({
        code: 'INVALID_RECEIPT_STATUS',
        message: `Cannot ${action} a goods receipt in status ${actual}`,
      });
    }
  }

  private lineCreate(l: DeclareReceiptLineDto): Prisma.GoodsReceiptLineCreateWithoutReceiptInput {
    return {
      variant: { connect: { id: l.variantId } },
      expectedQty: l.expectedQty,
      unitCostInr: l.unitCostInr != null ? new Prisma.Decimal(l.unitCostInr) : null,
      manufacturedAt: l.manufacturedAt ? new Date(l.manufacturedAt) : null,
      expiresAt: l.expiresAt ? new Date(l.expiresAt) : null,
    };
  }

  private async assertVariants(sellerId: string, lines: DeclareReceiptLineDto[]): Promise<void> {
    const ids = [...new Set(lines.map((l) => l.variantId))];
    const map = await this.catalog.getVariantsByIds(ids);
    for (const id of ids) {
      const v = map.get(id);
      if (!v || v.sellerId !== sellerId) {
        throw new BadRequestException({
          code: 'VARIANT_NOT_FOUND',
          message: `Variant ${id} not found for this seller`,
        });
      }
      // CLAUDE catalog rule #8: ARCHIVED blocks new stock receiving.
      if (v.status === VariantStatus.ARCHIVED) {
        throw new BadRequestException({
          code: 'VARIANT_ARCHIVED',
          message: `Variant ${id} is archived and cannot receive stock`,
        });
      }
    }
  }

  /** Generates GR-YYYY-MM-NNNN; retries on the unique collision (count is
   *  inherently racy without a sequence — Prisma-only, no raw SQL). */
  private async createWithReceiptNumber(
    fn: (tx: Prisma.TransactionClient, receiptNumber: string) => Promise<GoodsReceiptView>,
  ): Promise<GoodsReceiptView> {
    for (let attempt = 1; attempt <= MAX_RECEIPT_NUMBER_ATTEMPTS; attempt += 1) {
      const now = new Date();
      const yyyy = now.getUTCFullYear();
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
      const prefix = `GR-${yyyy}-${mm}-`;
      const count = await this.prisma.client.goodsReceipt.count({
        where: { receiptNumber: { startsWith: prefix } },
      });
      const receiptNumber = `${prefix}${String(count + 1).padStart(4, '0')}`;
      try {
        return await this.prisma.client.$transaction((tx) => fn(tx, receiptNumber));
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          attempt < MAX_RECEIPT_NUMBER_ATTEMPTS
        ) {
          continue; // collided — recompute and retry
        }
        throw err;
      }
    }
    throw new ConflictException({
      code: 'RECEIPT_NUMBER_CONFLICT',
      message: 'Could not allocate a unique receipt number; retry',
    });
  }

  /** Putaway must target a real, live bin in the receipt's warehouse that
   *  is not a hold/damaged/quarantine bin (good stock only). */
  private async assertPutawayBin(warehouseId: string, binId: string): Promise<void> {
    const bin = await this.prisma.client.warehouseBin.findFirst({
      where: {
        id: binId,
        warehouseId,
        deletedAt: null,
        type: { notIn: [BinType.RTO_HOLD, BinType.DAMAGED, BinType.QUARANTINE] },
      },
      select: { id: true },
    });
    if (!bin) {
      throw new BadRequestException({
        code: 'INVALID_PUTAWAY_BIN',
        message: 'Putaway bin must be a non-hold bin in the receipt warehouse',
      });
    }
  }

  private ctxMeta(ctx: ClientContext): Record<string, unknown> {
    return {
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    };
  }
}
