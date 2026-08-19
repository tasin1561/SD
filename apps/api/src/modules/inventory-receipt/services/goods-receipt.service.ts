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
  ConsignmentEventType,
  ConsignmentLeg,
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
import { BinPolicyService } from '../../inventory-shared/bin-policy.service';
import { ConsignmentEventService } from '../../consignment-core/services/consignment-event.service';
import { ConsignmentStatusService } from '../../consignment-core/services/consignment-status.service';
import { TransitArrivalService } from './transit-arrival.service';
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
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { deriveThumbnailKey } from '../../catalog-image/image-key';

const EMAIL_COMPLETED = 'seller.goods_receipt_completed.email';
const EMAIL_CONSIGNMENT_BD_RECEIVED = 'seller.consignment_bd_received.email';
const EMAIL_CONSIGNMENT_ARRIVED = 'seller.consignment_arrived.email';
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
      // The batch and bin BY CODE. Both are stamped at completion and
      // both were rendered as uuids, which tells a person at a bench
      // nothing about which shelf the goods went on.
      batch: { select: { batchCode: true } },
      putawayBin: { select: { code: true } },
    },
  },
  // Seller display for the admin list — operator picks a receipt
  // from a queue and needs to know whose parcel this is.
  seller: {
    select: { id: true, companyName: true, email: true },
  },
  // The warehouse and the receiver BY NAME. Both were reachable through
  // relations and neither was selected, so the screen printed their
  // uuids — the same "a uuid is not an answer" mistake the line rows
  // used to make. StaffUser has no display name, so the email is the
  // human-readable handle it does have.
  warehouse: {
    select: { id: true, code: true, name: true },
  },
  receivedBy: {
    select: { id: true, email: true, emailDisplay: true },
  },
} as const;

export type GoodsReceiptView = Prisma.GoodsReceiptGetPayload<{
  include: typeof RECEIPT_VIEW_INCLUDE;
}>;

/**
 * R4 — the detail view a receiving screen renders. Same rows as
 * `GoodsReceiptView` plus the per-line inventory mode, because
 * `complete` demands `serialsByLineId` for a STRICT line and refuses the
 * receipt without it; the list view deliberately does NOT carry this
 * (one settings read per receipt on a paginated list, to answer a
 * question the list never asks).
 */
export type GoodsReceiptDetailView = Omit<GoodsReceiptView, 'lines'> & {
  lines: Array<
    GoodsReceiptView['lines'][number] & { primaryImageUrl: string | null } & {
      inventoryMode: InventoryMode;
    }
  >;
};

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
    private readonly binPolicy: BinPolicyService,
    // Receiving a leg we dispatched to ourselves moves stock out of
    // TRANSIT rather than creating it — see TransitArrivalService.
    private readonly transitArrival: TransitArrivalService,
    // R3 primitive (consignment-core): this module may NOT import the
    // consignment module — that module imports this one.
    private readonly consignmentEvents: ConsignmentEventService,
    private readonly consignmentStatus: ConsignmentStatusService,
    private readonly cache: StockCacheService,
    private readonly email: EmailQueue,
    private readonly env: EnvService,
    // For the per-line thumbnail on the receiving screen; objects are
    // private, so URLs are minted per request.
    private readonly spaces: SpacesService,
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

  /**
   * The admin detail read, enriched with each line's effective inventory
   * mode. Kept separate from `getForAdmin` so the ten internal callers
   * that use it as a load-and-guard helper do not each pay a settings
   * read for a field they never look at.
   */
  async getDetailForAdmin(id: string): Promise<GoodsReceiptDetailView> {
    const receipt = await this.getForAdmin(id);
    const modes = await this.lineModes(receipt);
    const images = await this.lineImages(receipt);
    return {
      ...receipt,
      lines: receipt.lines.map((l) => ({
        ...l,
        primaryImageUrl: images.get(l.variantId) ?? null,
        inventoryMode: modes.get(l.variantId) ?? InventoryMode.NORMAL,
      })),
    };
  }

  /**
   * A picture per line, for the receiving screen.
   *
   * Somebody is standing at a bench with a carton open, matching what is
   * in front of them against what was declared. A SKU string is a poor
   * way to do that and a photograph is the obvious one.
   *
   * One query for the whole receipt, and FAIL-OPEN like `lineModes`: a
   * storage hiccup must not stop a parcel being booked in, so a failure
   * means no thumbnails rather than no screen.
   */
  private async lineImages(receipt: GoodsReceiptView): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (receipt.lines.length === 0) return out;
    try {
      const images = await this.prisma.client.productImage.findMany({
        where: { variantId: { in: receipt.lines.map((l) => l.variantId) }, deletedAt: null },
        orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }, { createdAt: 'asc' }],
        select: { variantId: true, spacesKey: true, thumbnailUrl: true },
      });
      for (const img of images) {
        if (out.has(img.variantId)) continue;
        const key =
          (img.thumbnailUrl !== null ? deriveThumbnailKey(img.spacesKey) : null) ?? img.spacesKey;
        out.set(img.variantId, await this.spaces.presignGetUrl(key));
      }
    } catch (err) {
      this.logger.warn(
        { receiptId: receipt.id, err: (err as Error).message },
        'Goods-receipt line images unavailable; rendering without them (fail-open)',
      );
    }
    return out;
  }

  /** FAIL-OPEN to NORMAL (UNIT-2): an unreadable mode must not stop a
   *  parcel being booked in. `writeStockAndComplete` re-resolves and is
   *  the authority; this is what the screen renders. */
  private async lineModes(receipt: GoodsReceiptView): Promise<Map<string, InventoryMode>> {
    try {
      return await this.modes.resolveForVariants(
        receipt.sellerId,
        receipt.lines.map((l) => l.variantId),
      );
    } catch (err) {
      this.logger.warn(
        { receiptId: receipt.id, err: (err as Error).message },
        'Inventory-mode resolution failed on goods-receipt detail; reporting NORMAL (fail-open)',
      );
      return new Map();
    }
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
      notedLocation?: string;
      manufacturedAt?: string;
      expiresAt?: string;
      unitCostInr?: number;
    }>,
    ctx: ClientContext,
  ): Promise<GoodsReceiptView> {
    const receipt = await this.getForAdmin(id);
    this.assertStatus(receipt.status, [GoodsReceiptStatus.ARRIVING], 'record lines for');

    const lineIds = new Set(receipt.lines.map((l) => l.id));
    const resolvedBins = new Map<string, string>();
    for (const l of lines) {
      if (!lineIds.has(l.lineId)) {
        throw new BadRequestException({
          code: 'RECEIPT_LINE_NOT_FOUND',
          message: `Line ${l.lineId} is not part of this receipt`,
        });
      }
      // BinPolicyService is the ONE reader of the tracking flag. When
      // the warehouse is not tracking locations the agent's choice is
      // ignored entirely rather than defaulted — honouring it would
      // silently bin half a building nobody decided to bin.
      const resolved = await this.binPolicy.resolvePutawayBin(
        receipt.warehouseId,
        l.putawayBinId,
        undefined,
      );
      resolvedBins.set(l.lineId, resolved.binId);
      // Validate whenever a real choice was made — in either mode. The
      // FLOOR fallback is ours and needs no checking.
      if (l.putawayBinId) {
        await this.assertPutawayBin(receipt.warehouseId, resolved.binId);
      }
    }

    return this.prisma.client.$transaction(async (tx) => {
      for (const l of lines) {
        await tx.goodsReceiptLine.update({
          where: { id: l.lineId },
          data: {
            receivedQty: l.receivedQty,
            damagedQty: l.damagedQty ?? 0,
            putawayBinId: resolvedBins.get(l.lineId) ?? null,
            ...(l.notedLocation !== undefined ? { notedLocation: l.notedLocation || null } : {}),
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
   * ARRIVING -> COMPLETED. Always.
   *
   * This used to route a variance to a blocking DISCREPANCY status and
   * write NO stock, waiting for a human. That gate earned its keep only
   * where the stock in question would become sellable — and under two-leg
   * consignments it mostly does not. Nothing in Bangladesh is sellable
   * from Bangladesh, so holding a whole consignment there over a two-unit
   * variance stranded it in a warehouse waiting on an email. And at the
   * Indian end, "India is the final count" means the count decides: a
   * shortfall against what Bangladesh counted is OURS to chase with the
   * forwarder, and leaving the seller's stock unsellable on a Bangalore
   * shelf while we do that is backwards.
   *
   * So a variance is now a NUMBER ON A LINE, not a state. It is recorded
   * (`hasDiscrepancies` + `discrepancyNotes`), the seller is told, and
   * the goods carry on. Counts move in BOTH directions — more can arrive
   * than was declared — and neither direction blocks.
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
    const variances = this.detectDiscrepancies(receipt);
    return this.writeStockAndComplete(staffId, id, null, ctx, serialsByLineId, variances);
  }

  private async writeStockAndComplete(
    staffId: string,
    id: string,
    completionNote: string | null,
    ctx: ClientContext,
    serialsByLineId?: Readonly<Record<string, readonly string[]>>,
    variances: ReadonlyArray<{
      variantId: string;
      expectedQty: number;
      receivedQty: number;
      damagedQty: number;
    }> = [],
  ): Promise<GoodsReceiptView> {
    const now = new Date();
    // R4: resolve the receipt's SKU modes + the serial prefix ONCE,
    // outside the retryable tx (they're read-only settings/catalog reads,
    // and re-reading them per attempt buys nothing).
    const { modeByVariantId, serialPrefix } = await this.resolveUnitContext(id);

    const { view, affectedVariantIds, sellerId, warehouseId, unitsRegistered, consignmentId } =
      await this.mutation.runWithRetry(async (tx) => {
        const receipt = await tx.goodsReceipt.findUniqueOrThrow({
          where: { id },
          include: RECEIPT_VIEW_INCLUDE,
        });
        const variantIds: string[] = [];
        const transitVariance: Array<{
          lineId: string;
          variantId: string;
          moved: number;
          lost: number;
          surplus: number;
          lostSerials: readonly string[];
        }> = [];
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
          const strict = modeByVariantId.get(line.variantId) === InventoryMode.STRICT;

          // An ARRIVAL of stock we dispatched to ourselves. The goods
          // already exist, parked in this warehouse's TRANSIT bin since
          // dispatch, against a batch that travelled with them. Posting
          // RECEIVING here would double them — and the second copy would
          // be the sellable one.
          if (receipt.dispatchedAt !== null && line.batchId !== null) {
            const transitBinId = await this.binPolicy.transitBinId(receipt.warehouseId, tx);
            const arrival = await this.transitArrival.writeArrivalLine(tx, {
              sellerId: receipt.sellerId,
              variantId: line.variantId,
              warehouseId: receipt.warehouseId,
              goodsReceiptLineId: line.id,
              batchId: line.batchId,
              transitBinId,
              putawayBinId: line.putawayBinId,
              receivedQty: line.receivedQty,
              staffId,
              receiptNumber: receipt.receiptNumber,
              strict,
            });
            transitVariance.push({
              lineId: line.id,
              variantId: line.variantId,
              ...arrival,
            });
            // A strict SURPLUS is the one case "nothing blocks" cannot
            // hold on its own: units with no serial cannot be picked
            // (UNIT-2 needs exactly `quantity` serials). So they get
            // labelled where they surfaced — the one-station rule is
            // about where the WORK happens, not a ban on ever printing
            // elsewhere.
            if (strict && arrival.surplus > 0) {
              const registered = await this.units.registerUnits(tx, {
                sellerId: receipt.sellerId,
                variantId: line.variantId,
                warehouseId: receipt.warehouseId,
                binId: line.putawayBinId,
                batchId: line.batchId,
                goodsReceiptLineId: line.id,
                quantity: arrival.surplus,
                serialPrefix,
                actorType: ActorType.STAFF,
                actorId: staffId,
                note: `Unlabelled surplus found at arrival ${receipt.receiptNumber}`,
              });
              unitCount += registered.length;
            }
            variantIds.push(line.variantId);
            totalReceived += line.receivedQty;
            continue;
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
          if (strict) {
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

        // A variance is a RECORDED NUMBER, not a blocking state. Counts
        // move in both directions — a line can arrive over as easily as
        // under — and the note says which, in both cases.
        const notes = [
          variances.length > 0 ? this.formatDiscrepancyNotes(variances) : null,
          transitVariance.some((v) => v.lost > 0 || v.surplus > 0)
            ? this.formatTransitNotes(transitVariance)
            : null,
          completionNote,
          receipt.discrepancyNotes,
        ]
          .filter((n): n is string => n !== null && n.length > 0)
          .join('\n');

        const row = await tx.goodsReceipt.update({
          where: { id },
          data: {
            status: GoodsReceiptStatus.COMPLETED,
            hasDiscrepancies:
              variances.length > 0 || transitVariance.some((v) => v.lost > 0 || v.surplus > 0),
            receivedAt: now,
            receivedById: staffId,
            ...(notes.length > 0 ? { discrepancyNotes: notes } : {}),
          },
          include: RECEIPT_VIEW_INCLUDE,
        });

        // The consignment's timeline and its derived status, written in
        // the SAME tx as the count. Reached through the R3 primitive
        // (consignment-core) because the consignment module imports this
        // one and the reverse call would close a cycle.
        if (typeof receipt.consignmentId === 'string') {
          await this.consignmentEvents.append(
            {
              consignmentId: receipt.consignmentId,
              type:
                receipt.leg === ConsignmentLeg.BD_INTAKE
                  ? ConsignmentEventType.BD_RECEIVED
                  : ConsignmentEventType.IN_RECEIVED,
              description: `Counted ${totalReceived} units across ${receipt.lines.length} products`,
              data: {
                receiptId: receipt.id,
                receiptNumber: receipt.receiptNumber,
                totalReceived,
                declaredVariance: variances,
                transitVariance: transitVariance.map((v) => ({
                  variantId: v.variantId,
                  lost: v.lost,
                  surplus: v.surplus,
                  lostSerials: v.lostSerials,
                })),
              },
              actorType: ActorType.STAFF,
              actorId: staffId,
            },
            tx,
          );
        }
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
        const warehouseName = await this.warehouseName(tx, receipt.warehouseId);
        if (typeof receipt.consignmentId === 'string') {
          // A consignment leg gets the milestone mail for the stop it
          // actually is. "Your goods reached Dhaka but cannot be sold
          // yet" and "your goods landed and are now sellable" are
          // different facts, and the generic receipt mail said neither.
          const consignment = await tx.consignment.findUnique({
            where: { id: receipt.consignmentId },
            select: { consignmentNumber: true },
          });
          await this.enqueueReceiptEmail(
            tx,
            receipt.leg === ConsignmentLeg.BD_INTAKE
              ? EMAIL_CONSIGNMENT_BD_RECEIVED
              : EMAIL_CONSIGNMENT_ARRIVED,
            receipt.sellerId,
            {
              consignment_number: consignment?.consignmentNumber ?? receipt.receiptNumber,
              warehouse_name: warehouseName,
              total_received: totalReceived,
              line_count: receipt.lines.length,
              // Told, not asked — the variance needs no decision from the
              // seller and nothing waits on their reply. Empty when the
              // count matched, so the sentence simply is not there.
              variance_note: notes.length > 0 ? `Note: ${notes}` : '',
              app_url: this.env.sellerAppUrl,
            },
          );
        } else {
          await this.enqueueReceiptEmail(tx, EMAIL_COMPLETED, receipt.sellerId, {
            receipt_number: receipt.receiptNumber,
            warehouse_name: warehouseName,
            total_received: totalReceived,
            line_count: receipt.lines.length,
            app_url: this.env.sellerAppUrl,
          });
          if (notes.length > 0) {
            await this.enqueueReceiptEmail(tx, EMAIL_DISCREPANCY, receipt.sellerId, {
              receipt_number: receipt.receiptNumber,
              warehouse_name: warehouseName,
              discrepancy_notes: notes,
              support_email: this.env.supportEmail,
            });
          }
        }
        return {
          view: row,
          affectedVariantIds: [...new Set(variantIds)],
          sellerId: receipt.sellerId,
          warehouseId: receipt.warehouseId,
          unitsRegistered: unitCount,
          consignmentId: receipt.consignmentId,
        };
      });

    // The consignment's status is DERIVED from its legs and from where
    // its stock physically sits, so it must be recomputed AFTER the
    // movements commit — inside the tx it would read the pre-transfer
    // levels and land on the previous answer.
    if (typeof consignmentId === 'string') {
      await this.consignmentStatus.recompute(consignmentId);
    }

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

  /** Plain prose, both directions. "3 short" and "2 over" are different
   *  facts and the note says which. */
  private formatTransitNotes(rows: ReadonlyArray<{ lost: number; surplus: number }>): string {
    const lost = rows.reduce((n, r) => n + r.lost, 0);
    const surplus = rows.reduce((n, r) => n + r.surplus, 0);
    const parts: string[] = [];
    if (lost > 0) parts.push(`${lost} unit(s) dispatched from Bangladesh did not arrive`);
    if (surplus > 0) parts.push(`${surplus} unit(s) arrived that were not dispatched`);
    return parts.join('; ');
  }

  private formatDiscrepancyNotes(
    d: ReadonlyArray<{
      variantId: string;
      expectedQty: number;
      receivedQty: number;
      damagedQty: number;
    }>,
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

  /**
   * PUBLIC so a caller that writes a parent row before declaring the leg
   * can validate FIRST. `ConsignmentService.declare` creates the
   * consignment in its own committed transaction and then calls
   * `declare()`; without this, a bad variant id would leave an orphan
   * consignment with no leg — a row the panel cannot render and nobody
   * can act on.
   */
  async assertVariants(sellerId: string, lines: DeclareReceiptLineDto[]): Promise<void> {
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
