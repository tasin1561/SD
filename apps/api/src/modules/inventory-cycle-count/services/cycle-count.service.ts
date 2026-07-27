import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  AdjustmentStatus,
  AdjustmentType,
  CycleCountStatus,
  Prisma,
  StockMovementReasonCode,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { WarehouseResolverService } from '../../inventory-shared/warehouse-resolver.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import type {
  ListCycleCountsQueryDto,
  RecordCountItemDto,
  ScheduleCycleCountDto,
} from '../dto/cycle-count.dto';

const THRESHOLD_SETTING_KEY = 'ops.stock_adjustment_approval_threshold_inr';
const DEFAULT_THRESHOLD = new Prisma.Decimal(50_000);

const CYCLE_COUNT_INCLUDE = {
  items: {
    select: {
      id: true,
      variantId: true,
      binId: true,
      batchId: true,
      systemQty: true,
      countedQty: true,
      notes: true,
      adjustmentId: true,
    },
  },
} as const;

export type CycleCountView = Prisma.CycleCountGetPayload<{
  include: typeof CYCLE_COUNT_INCLUDE;
}>;

/**
 * Admin-only physical-count reconciliation (locked decision #5).
 * schedule → start → record items (systemQty snapshotted at record time)
 * → complete. Completion generates ONE single-line CYCLE_COUNT
 * StockAdjustment per discrepancy, each PENDING for admin approval — it
 * does NOT write stock itself (stock changes only when those adjustments
 * are approved + executed via the commit-19/20 executor path).
 */
@Injectable()
export class CycleCountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly warehouses: WarehouseResolverService,
  ) {}

  async schedule(
    staffId: string,
    input: ScheduleCycleCountDto,
    ctx: ClientContext,
  ): Promise<CycleCountView> {
    const warehouseId = await this.warehouses.resolveWarehouseId(input.warehouseId);
    if (input.zoneId) {
      const zone = await this.prisma.client.warehouseZone.findFirst({
        where: { id: input.zoneId, warehouseId, deletedAt: null },
        select: { id: true },
      });
      if (!zone) {
        throw new BadRequestException({
          code: 'ZONE_NOT_FOUND',
          message: 'Zone not found in the target warehouse',
        });
      }
    }
    return this.prisma.client.$transaction(async (tx) => {
      const row = await tx.cycleCount.create({
        data: {
          warehouseId,
          zoneId: input.zoneId ?? null,
          countType: input.countType,
          countDate: new Date(input.countDate),
          initiatedById: staffId,
          status: CycleCountStatus.SCHEDULED,
        },
        include: CYCLE_COUNT_INCLUDE,
      });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'inventory.cycle_count.scheduled',
          entityType: 'cycle_count',
          entityId: row.id,
          metadata: {
            warehouseId,
            zoneId: input.zoneId,
            countType: input.countType,
            ...this.ctxMeta(ctx),
          },
        },
        tx,
      );
      return row;
    });
  }

  async list(
    query: ListCycleCountsQueryDto,
  ): Promise<{ items: CycleCountView[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.CycleCountWhereInput = { deletedAt: null };
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.status) where.status = query.status;
    const [items, total] = await Promise.all([
      this.prisma.client.cycleCount.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
        include: CYCLE_COUNT_INCLUDE,
      }),
      this.prisma.client.cycleCount.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(id: string): Promise<CycleCountView> {
    const row = await this.prisma.client.cycleCount.findFirst({
      where: { id, deletedAt: null },
      include: CYCLE_COUNT_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'CYCLE_COUNT_NOT_FOUND',
        message: 'Cycle count not found',
      });
    }
    return row;
  }

  async start(staffId: string, id: string, ctx: ClientContext): Promise<CycleCountView> {
    const existing = await this.get(id);
    this.assertStatus(existing.status, [CycleCountStatus.SCHEDULED], 'start');
    return this.prisma.client.$transaction(async (tx) => {
      const row = await tx.cycleCount.update({
        where: { id },
        data: { status: CycleCountStatus.IN_PROGRESS, startedAt: new Date() },
        include: CYCLE_COUNT_INCLUDE,
      });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'inventory.cycle_count.started',
          entityType: 'cycle_count',
          entityId: id,
          metadata: this.ctxMeta(ctx),
        },
        tx,
      );
      return row;
    });
  }

  /** IN_PROGRESS only. systemQty is snapshotted from the live stock level
   *  AT RECORD TIME. Iterative + idempotent per (variant,bin,batch). */
  async recordItems(
    staffId: string,
    id: string,
    items: RecordCountItemDto[],
    ctx: ClientContext,
  ): Promise<CycleCountView> {
    const cc = await this.get(id);
    this.assertStatus(cc.status, [CycleCountStatus.IN_PROGRESS], 'record items for');

    for (const it of items) {
      const batch = await this.prisma.client.stockBatch.findFirst({
        where: {
          id: it.batchId,
          variantId: it.variantId,
          warehouseId: cc.warehouseId,
          deletedAt: null,
        },
        select: { sellerId: true },
      });
      if (!batch) {
        throw new BadRequestException({
          code: 'CYCLE_COUNT_BATCH_NOT_FOUND',
          message: `Batch ${it.batchId} not found for variant ${it.variantId} in this warehouse`,
        });
      }
      const level = await this.prisma.client.stockLevel.findUnique({
        where: {
          sellerId_variantId_warehouseId_binId_batchId: {
            sellerId: batch.sellerId,
            variantId: it.variantId,
            warehouseId: cc.warehouseId,
            binId: it.binId,
            batchId: it.batchId,
          },
        },
        select: { qtyOnHand: true },
      });
      const systemQty = level?.qtyOnHand ?? 0;

      const existing = await this.prisma.client.cycleCountItem.findFirst({
        where: { cycleCountId: id, variantId: it.variantId, binId: it.binId, batchId: it.batchId },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.client.cycleCountItem.update({
          where: { id: existing.id },
          data: {
            systemQty,
            countedQty: it.countedQty,
            countedById: staffId,
            countedAt: new Date(),
            notes: it.notes ?? null,
          },
        });
      } else {
        await this.prisma.client.cycleCountItem.create({
          data: {
            cycleCountId: id,
            variantId: it.variantId,
            binId: it.binId,
            batchId: it.batchId,
            systemQty,
            countedQty: it.countedQty,
            countedById: staffId,
            countedAt: new Date(),
            notes: it.notes ?? null,
          },
        });
      }
    }
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'inventory.cycle_count.items_recorded',
      entityType: 'cycle_count',
      entityId: id,
      metadata: { recordedCount: items.length, ...this.ctxMeta(ctx) },
    });
    return this.get(id);
  }

  /**
   * IN_PROGRESS -> COMPLETED. For every item whose countedQty != systemQty
   * generate ONE single-line CYCLE_COUNT StockAdjustment (PENDING, reason
   * COUNTING_ERROR, qtyChange = counted - system), link it back onto the
   * cycle_count_item, and roll up the summary stats — all in one tx. NO
   * stock is written here; the drafts go through the normal adjustment
   * approve -> executor path.
   */
  async complete(staffId: string, id: string, ctx: ClientContext): Promise<CycleCountView> {
    const cc = await this.get(id);
    this.assertStatus(cc.status, [CycleCountStatus.IN_PROGRESS], 'complete');
    const threshold = await this.resolveThreshold();

    return this.prisma.client.$transaction(async (tx) => {
      const bins = new Set<string>();
      const skus = new Set<string>();
      let discrepancyCount = 0;
      let totalDiscrepancyValue = new Prisma.Decimal(0);

      for (const item of cc.items) {
        bins.add(item.binId);
        skus.add(item.variantId);
        const delta = item.countedQty - item.systemQty;
        if (delta === 0) continue;

        const batchId = item.batchId;
        if (!batchId) {
          throw new BadRequestException({
            code: 'CYCLE_COUNT_BATCH_REQUIRED',
            message: `Cycle-count item ${item.id} has no batch; cannot generate a reconciliation adjustment`,
          });
        }
        const batch = await tx.stockBatch.findFirst({
          where: { id: batchId, deletedAt: null },
          select: { sellerId: true, unitCostInr: true },
        });
        if (!batch) {
          throw new BadRequestException({
            code: 'CYCLE_COUNT_BATCH_NOT_FOUND',
            message: `Cycle-count item ${item.id} has no resolvable batch; cannot reconcile`,
          });
        }
        const unitCost = batch.unitCostInr;
        const valueImpact = unitCost ? unitCost.mul(delta) : new Prisma.Decimal(0);

        const adjustment = await tx.stockAdjustment.create({
          data: {
            sellerId: batch.sellerId,
            warehouseId: cc.warehouseId,
            type: AdjustmentType.CYCLE_COUNT,
            reasonCode: StockMovementReasonCode.COUNTING_ERROR,
            description: `Cycle count ${cc.id} reconciliation`,
            initiatedById: staffId,
            initiatedAt: new Date(),
            status: AdjustmentStatus.PENDING,
            approverThresholdInr: threshold,
            totalValueImpactInr: valueImpact,
            lines: {
              create: [
                {
                  variantId: item.variantId,
                  binId: item.binId,
                  batchId,
                  qtyChange: delta,
                  unitCostInr: unitCost,
                },
              ],
            },
          },
          select: { id: true },
        });
        await tx.cycleCountItem.update({
          where: { id: item.id },
          data: { adjustmentId: adjustment.id },
        });
        discrepancyCount += 1;
        totalDiscrepancyValue = totalDiscrepancyValue.add(valueImpact.abs());
      }

      const row = await tx.cycleCount.update({
        where: { id },
        data: {
          status: CycleCountStatus.COMPLETED,
          completedAt: new Date(),
          totalBinsCounted: bins.size,
          totalSkusCounted: skus.size,
          discrepancyCount,
          totalDiscrepancyValueInr: totalDiscrepancyValue,
        },
        include: CYCLE_COUNT_INCLUDE,
      });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'inventory.cycle_count.completed',
          entityType: 'cycle_count',
          entityId: id,
          metadata: {
            discrepancyCount,
            totalDiscrepancyValueInr: totalDiscrepancyValue.toString(),
            draftAdjustments: discrepancyCount,
            ...this.ctxMeta(ctx),
          },
        },
        tx,
      );
      return row;
    });
  }

  // ---------- internal ----------

  private assertStatus(
    actual: CycleCountStatus,
    allowed: CycleCountStatus[],
    action: string,
  ): void {
    if (!allowed.includes(actual)) {
      throw new ConflictException({
        code: 'INVALID_CYCLE_COUNT_STATUS',
        message: `Cannot ${action} a cycle count in status ${actual}`,
      });
    }
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

  private ctxMeta(ctx: ClientContext): Record<string, unknown> {
    return {
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    };
  }
}
