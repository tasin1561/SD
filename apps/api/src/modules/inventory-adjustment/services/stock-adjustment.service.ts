import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  AdjustmentStatus,
  AdjustmentType,
  NotificationRecipientType,
  Prisma,
  StockMovementType,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EnvService } from '../../../config/env.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import { WarehouseResolverService } from '../../inventory-shared/warehouse-resolver.service';
import { StockMutationService } from '../../inventory-shared/stock-mutation.service';
import { StockAlertService } from '../../inventory-stock/services/stock-alert.service';
import { StockCacheService } from '../../inventory-stock/services/stock-cache.service';
import { EmailQueue } from '../../email/queue/email.queue';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import type {
  AdjustmentLineDto,
  CreateStockAdjustmentDto,
  ListStockAdjustmentsQueryDto,
} from '../dto/stock-adjustment.dto';

const THRESHOLD_SETTING_KEY = 'ops.stock_adjustment_approval_threshold_inr';
const DEFAULT_THRESHOLD = new Prisma.Decimal(50_000);
const EMAIL_EXECUTED = 'seller.stock_adjustment_executed.email';

const ADJUSTMENT_INCLUDE = {
  lines: {
    select: {
      id: true,
      variantId: true,
      binId: true,
      batchId: true,
      qtyChange: true,
      unitCostInr: true,
    },
  },
} as const;

export type StockAdjustmentView = Prisma.StockAdjustmentGetPayload<{
  include: typeof ADJUSTMENT_INCLUDE;
}>;

interface ResolvedLine extends AdjustmentLineDto {
  resolvedUnitCost: Prisma.Decimal;
}

/**
 * Manual stock adjustments with a threshold-gated approval workflow
 * (locked decision #11, INV-7/INV-8).
 *
 *  - initiate(): validates lines, resolves each line's unit cost
 *    (line → batch fallback; null at both is a per-line error), computes
 *    a signed totalValueImpactInr, snapshots approverThresholdInr from
 *    system_settings. |impact| < threshold → auto-execute in ONE tx;
 *    otherwise persist PENDING (lines hold the intended change) and await
 *    approval (commit 20 wires approve/reject + the executor worker).
 *  - executeAdjustment(): the shared apply path — every line posts an
 *    ADJUSTMENT_INCREASE/DECREASE movement through the sole writer
 *    (StockMutationService) with the adjustment's reasonCode (INV-7),
 *    flips status EXECUTED, audits, enqueues the seller email — all in
 *    one runWithRetry transaction. Cache invalidation + alert evaluation
 *    happen AFTER commit (INV-5). Used by both auto-execute and the
 *    commit-20 executor worker.
 */
@Injectable()
export class StockAdjustmentService {
  private readonly logger = new Logger(StockAdjustmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly audit: AuditLogService,
    private readonly catalog: CatalogReadService,
    private readonly warehouses: WarehouseResolverService,
    private readonly mutation: StockMutationService,
    private readonly alerts: StockAlertService,
    private readonly cache: StockCacheService,
    private readonly email: EmailQueue,
  ) {}

  async initiate(
    staffId: string,
    input: CreateStockAdjustmentDto,
    ctx: ClientContext,
  ): Promise<StockAdjustmentView> {
    const warehouseId = await this.warehouses.resolveWarehouseId(input.warehouseId);
    const adjType =
      input.type === 'INCREASE' ? AdjustmentType.INCREASE : AdjustmentType.DECREASE;

    const resolved = await this.validateAndResolveLines(
      input.sellerId,
      warehouseId,
      input.type,
      input.lines,
    );
    const totalValueImpact = resolved.reduce(
      (acc, l) => acc.add(l.resolvedUnitCost.mul(l.qtyChange)),
      new Prisma.Decimal(0),
    );
    const threshold = await this.resolveThreshold();
    const requiresApproval = totalValueImpact.abs().gte(threshold);

    const adjustment = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.stockAdjustment.create({
        data: {
          sellerId: input.sellerId,
          warehouseId,
          type: adjType,
          reasonCode: input.reasonCode,
          description: input.description ?? null,
          initiatedById: staffId,
          initiatedAt: new Date(),
          status: AdjustmentStatus.PENDING,
          approverThresholdInr: threshold,
          totalValueImpactInr: totalValueImpact,
          photoSpacesKeys: input.photoSpacesKeys ?? [],
          lines: {
            create: resolved.map((l) => ({
              variantId: l.variantId,
              binId: l.binId,
              batchId: l.batchId,
              qtyChange: l.qtyChange,
              unitCostInr: l.resolvedUnitCost,
            })),
          },
        },
        include: ADJUSTMENT_INCLUDE,
      });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'inventory.stock_adjustment.initiated',
          entityType: 'stock_adjustment',
          entityId: row.id,
          metadata: {
            sellerId: input.sellerId,
            warehouseId,
            type: adjType,
            totalValueImpactInr: totalValueImpact.toString(),
            approverThresholdInr: threshold.toString(),
            requiresApproval,
            ...this.ctxMeta(ctx),
          },
        },
        tx,
      );
      return row;
    });

    if (requiresApproval) {
      this.logger.log(
        { adjustmentId: adjustment.id, impact: totalValueImpact.toString() },
        'Adjustment exceeds threshold — PENDING approval',
      );
      return adjustment;
    }
    // Below threshold → auto-execute immediately.
    return this.executeAdjustment(adjustment.id, {
      type: ActorType.STAFF,
      id: staffId,
    });
  }

  /**
   * Applies every line through StockMutationService and flips the
   * adjustment EXECUTED — all in one runWithRetry tx (INV-1/5/6/7/8).
   * Partial failure rolls the WHOLE tx back; the adjustment is left in
   * its prior status for a safe retry. Shared by auto-execute and the
   * commit-20 executor worker.
   */
  async executeAdjustment(
    adjustmentId: string,
    actor: { type: ActorType; id?: string | null },
  ): Promise<StockAdjustmentView> {
    const { view, sellerId, warehouseId, variantIds } =
      await this.mutation.runWithRetry(async (tx) => {
        const adj = await tx.stockAdjustment.findUniqueOrThrow({
          where: { id: adjustmentId },
          include: ADJUSTMENT_INCLUDE,
        });
        if (
          adj.status !== AdjustmentStatus.PENDING &&
          adj.status !== AdjustmentStatus.APPROVED
        ) {
          throw new BadRequestException({
            code: 'ADJUSTMENT_NOT_EXECUTABLE',
            message: `Adjustment is ${adj.status}; only PENDING/APPROVED execute`,
          });
        }
        const variants: string[] = [];
        for (const line of adj.lines) {
          if (!line.batchId) {
            throw new BadRequestException({
              code: 'ADJUSTMENT_LINE_BATCH_REQUIRED',
              message: `Adjustment line ${line.id} has no batch; cannot locate stock level`,
            });
          }
          await this.mutation.apply(tx, {
            sellerId: adj.sellerId,
            variantId: line.variantId,
            warehouseId: adj.warehouseId,
            binId: line.binId,
            batchId: line.batchId,
            qtyChange: line.qtyChange,
            type:
              line.qtyChange > 0
                ? StockMovementType.ADJUSTMENT_INCREASE
                : StockMovementType.ADJUSTMENT_DECREASE,
            actorType: actor.type,
            actorId: actor.id ?? null,
            reason: adj.description ?? `Adjustment ${adj.id}`,
            reasonCode: adj.reasonCode,
            adjustmentId: adj.id,
          });
          variants.push(line.variantId);
        }
        const row = await tx.stockAdjustment.update({
          where: { id: adjustmentId },
          data: { status: AdjustmentStatus.EXECUTED },
          include: ADJUSTMENT_INCLUDE,
        });
        await this.audit.log(
          {
            actorType: actor.type,
            actorId: actor.id ?? null,
            action: 'inventory.stock_adjustment.executed',
            entityType: 'stock_adjustment',
            entityId: adjustmentId,
            metadata: {
              sellerId: adj.sellerId,
              warehouseId: adj.warehouseId,
              lineCount: adj.lines.length,
            },
          },
          tx,
        );
        await this.enqueueExecutedEmail(tx, adj.sellerId, {
          adjustment_id: adj.id,
          adjustment_type: adj.type,
          reason_code: adj.reasonCode,
          warehouse_name: await this.warehouseName(tx, adj.warehouseId),
          value_impact_inr: (adj.totalValueImpactInr ?? new Prisma.Decimal(0)).toString(),
        });
        return {
          view: row,
          sellerId: adj.sellerId,
          warehouseId: adj.warehouseId,
          variantIds: [...new Set(variants)],
        };
      });

    await this.cache.invalidate(sellerId, warehouseId);
    for (const variantId of variantIds) {
      await this.alerts.evaluate(sellerId, variantId, warehouseId);
    }
    return view;
  }

  async list(
    query: ListStockAdjustmentsQueryDto,
  ): Promise<{ items: StockAdjustmentView[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.StockAdjustmentWhereInput = { deletedAt: null };
    if (query.sellerId) where.sellerId = query.sellerId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.status) where.status = query.status;
    const [items, total] = await Promise.all([
      this.prisma.client.stockAdjustment.findMany({
        where,
        orderBy: { initiatedAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
        include: ADJUSTMENT_INCLUDE,
      }),
      this.prisma.client.stockAdjustment.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(id: string): Promise<StockAdjustmentView> {
    const row = await this.prisma.client.stockAdjustment.findFirst({
      where: { id, deletedAt: null },
      include: ADJUSTMENT_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'ADJUSTMENT_NOT_FOUND',
        message: 'Stock adjustment not found',
      });
    }
    return row;
  }

  // ---------- internal ----------

  private async validateAndResolveLines(
    sellerId: string,
    warehouseId: string,
    type: 'INCREASE' | 'DECREASE',
    lines: AdjustmentLineDto[],
  ): Promise<ResolvedLine[]> {
    const variantIds = [...new Set(lines.map((l) => l.variantId))];
    const variants = await this.catalog.getVariantsByIds(variantIds);
    const resolved: ResolvedLine[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      const l = lines[i] as AdjustmentLineDto;
      if (!Number.isInteger(l.qtyChange) || l.qtyChange === 0) {
        throw new BadRequestException({
          code: 'ADJUSTMENT_LINE_INVALID_QTY',
          message: `Line ${i}: qtyChange must be a non-zero integer`,
        });
      }
      if (type === 'INCREASE' && l.qtyChange < 0) {
        throw new BadRequestException({
          code: 'ADJUSTMENT_SIGN_MISMATCH',
          message: `Line ${i}: INCREASE requires qtyChange > 0`,
        });
      }
      if (type === 'DECREASE' && l.qtyChange > 0) {
        throw new BadRequestException({
          code: 'ADJUSTMENT_SIGN_MISMATCH',
          message: `Line ${i}: DECREASE requires qtyChange < 0`,
        });
      }
      const v = variants.get(l.variantId);
      if (!v || v.sellerId !== sellerId) {
        throw new BadRequestException({
          code: 'VARIANT_NOT_FOUND',
          message: `Line ${i}: variant ${l.variantId} not found for this seller`,
        });
      }
      const batch = await this.prisma.client.stockBatch.findFirst({
        where: {
          id: l.batchId,
          sellerId,
          variantId: l.variantId,
          warehouseId,
          deletedAt: null,
        },
        select: { unitCostInr: true },
      });
      if (!batch) {
        throw new BadRequestException({
          code: 'ADJUSTMENT_LINE_BATCH_NOT_FOUND',
          message: `Line ${i}: batch ${l.batchId} not found for this seller/variant/warehouse`,
        });
      }
      const resolvedUnitCost =
        l.unitCostInr != null ? new Prisma.Decimal(l.unitCostInr) : batch.unitCostInr;
      if (resolvedUnitCost == null) {
        throw new BadRequestException({
          code: 'ADJUSTMENT_LINE_COST_MISSING',
          message: `Line ${i} (variant ${l.variantId}): no unitCostInr provided and the batch has none — value impact cannot be computed`,
        });
      }
      resolved.push({ ...l, resolvedUnitCost });
    }
    return resolved;
  }

  private async resolveThreshold(): Promise<Prisma.Decimal> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: THRESHOLD_SETTING_KEY },
      select: { valueDecimal: true, valueInt: true },
    });
    if (row?.valueDecimal != null) return row.valueDecimal;
    if (row?.valueInt != null) return new Prisma.Decimal(row.valueInt);
    return DEFAULT_THRESHOLD;
  }

  private async warehouseName(
    tx: Prisma.TransactionClient,
    warehouseId: string,
  ): Promise<string> {
    const wh = await tx.warehouse.findUnique({
      where: { id: warehouseId },
      select: { name: true },
    });
    return wh?.name ?? warehouseId;
  }

  private async enqueueExecutedEmail(
    tx: Prisma.TransactionClient,
    sellerId: string,
    variables: Record<string, string>,
  ): Promise<void> {
    const seller = await tx.seller.findUnique({
      where: { id: sellerId },
      select: { id: true, email: true, companyName: true },
    });
    if (!seller) return;
    await this.email.enqueue({
      templateCode: EMAIL_EXECUTED,
      recipient: {
        type: NotificationRecipientType.SELLER,
        id: seller.id,
        email: seller.email,
      },
      variables: {
        company_name: seller.companyName,
        support_email: this.env.supportEmail,
        ...variables,
      },
      triggerEvent: 'inventory.stock_adjustment.executed',
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
