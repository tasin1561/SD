import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, GoodsReceiptStatus, Prisma, VariantStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import { WarehouseResolverService } from '../../inventory-shared/warehouse-resolver.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import type {
  DeclareGoodsReceiptDto,
  DeclareReceiptLineDto,
  ListGoodsReceiptsQueryDto,
  UpdateGoodsReceiptDto,
} from '../dto/goods-receipt.dto';

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
    },
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly catalog: CatalogReadService,
    private readonly warehouses: WarehouseResolverService,
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
        data.expectedArrivalAt = input.expectedArrivalAt
          ? new Date(input.expectedArrivalAt)
          : null;
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

  // ---------------- shared internals (used by commits 17/18 too) ----------------

  assertStatus(
    actual: GoodsReceiptStatus,
    allowed: GoodsReceiptStatus[],
    action: string,
  ): void {
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

  private async assertVariants(
    sellerId: string,
    lines: DeclareReceiptLineDto[],
  ): Promise<void> {
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

  private ctxMeta(ctx: ClientContext): Record<string, unknown> {
    return {
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    };
  }
}
