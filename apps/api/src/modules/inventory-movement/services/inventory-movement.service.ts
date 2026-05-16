import { Injectable } from '@nestjs/common';
import {
  ActorType,
  Prisma,
  StockMovementReasonCode,
  StockMovementType,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import type {
  ListAdminMovementsQueryDto,
  ListSellerMovementsQueryDto,
} from '../dto/list-movements.dto';

export interface MovementView {
  id: string;
  createdAt: Date;
  sellerId: string;
  variantId: string;
  skuCode: string | null;
  variantLabel: string | null;
  warehouseId: string;
  binId: string | null;
  batchId: string | null;
  type: StockMovementType;
  qtyChange: number;
  qtyBefore: number;
  qtyAfter: number;
  actorType: ActorType;
  actorId: string | null;
  reason: string | null;
  reasonCode: StockMovementReasonCode | null;
  orderId: string | null;
  orderItemId: string | null;
  shipmentId: string | null;
  adjustmentId: string | null;
  transferGroupId: string | null;
  fromBinId: string | null;
  toBinId: string | null;
  metadata: Prisma.JsonValue;
}

export interface MovementListResult {
  items: MovementView[];
  total: number;
  page: number;
  pageSize: number;
}

const MOVEMENT_SELECT = {
  id: true,
  createdAt: true,
  sellerId: true,
  variantId: true,
  warehouseId: true,
  binId: true,
  batchId: true,
  type: true,
  qtyChange: true,
  qtyBefore: true,
  qtyAfter: true,
  actorType: true,
  actorId: true,
  reason: true,
  reasonCode: true,
  orderId: true,
  orderItemId: true,
  shipmentId: true,
  adjustmentId: true,
  transferGroupId: true,
  fromBinId: true,
  toBinId: true,
  metadata: true,
} as const;

/**
 * READ-ONLY view over stock_movements (the append-only TimescaleDB
 * hypertable). This module NEVER writes — StockMutationService is the only
 * writer (INV-1) and movements are immutable (INV-3 / schema). Variant
 * sku/label is enriched via CatalogReadService (no direct product_variants
 * query — CLAUDE MUST #13), batched per page (no N+1).
 */
@Injectable()
export class InventoryMovementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogReadService,
  ) {}

  async listForSeller(
    sellerId: string,
    query: ListSellerMovementsQueryDto,
  ): Promise<MovementListResult> {
    return this.list({ ...this.commonWhere(query), sellerId }, query);
  }

  async listForAdmin(query: ListAdminMovementsQueryDto): Promise<MovementListResult> {
    const where: Prisma.StockMovementWhereInput = this.commonWhere(query);
    if (query.sellerId) where.sellerId = query.sellerId;
    if (query.binId) where.binId = query.binId;
    if (query.orderId) where.orderId = query.orderId;
    if (query.adjustmentId) where.adjustmentId = query.adjustmentId;
    return this.list(where, query);
  }

  // ---------- internal ----------

  private commonWhere(
    q: ListSellerMovementsQueryDto,
  ): Prisma.StockMovementWhereInput {
    const where: Prisma.StockMovementWhereInput = {};
    if (q.variantId) where.variantId = q.variantId;
    if (q.warehouseId) where.warehouseId = q.warehouseId;
    if (q.batchId) where.batchId = q.batchId;
    if (q.type) where.type = q.type;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) where.createdAt.gte = new Date(q.from);
      if (q.to) where.createdAt.lte = new Date(q.to);
    }
    return where;
  }

  private async list(
    where: Prisma.StockMovementWhereInput,
    q: ListSellerMovementsQueryDto,
  ): Promise<MovementListResult> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const [rows, total] = await Promise.all([
      this.prisma.client.stockMovement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: pageSize,
        skip: (page - 1) * pageSize,
        select: MOVEMENT_SELECT,
      }),
      this.prisma.client.stockMovement.count({ where }),
    ]);

    const variantIds = [...new Set(rows.map((r) => r.variantId))];
    const meta = await this.catalog.getVariantsByIds(variantIds);

    const items: MovementView[] = rows.map((r) => {
      const m = meta.get(r.variantId);
      return {
        ...r,
        skuCode: m?.skuCode ?? null,
        variantLabel: m?.variantLabel ?? null,
      };
    });
    return { items, total, page, pageSize };
  }
}
