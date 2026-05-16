import { Injectable, NotFoundException } from '@nestjs/common';
import { VariantStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { StockReadService } from './stock-read.service';
import type { CachedVariantStock } from './stock-cache.service';

export interface AggregatedVariantStock extends CachedVariantStock {
  /** How many warehouses contribute a stock footprint for this variant. */
  warehouseCount: number;
}

export interface AggregatedStockList {
  items: AggregatedVariantStock[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AggregatedStockSummary {
  totalSkus: number;
  totalQtyOnHand: number;
  totalQtyReserved: number;
  totalQtyAvailable: number;
  lowStockSkus: number;
}

/**
 * Seller-facing aggregation ACROSS warehouses. The inner StockReadService
 * is strictly per-warehouse (locked decision #6); this is the sanctioned
 * place that fans out over the seller's warehouses and merges, so the
 * controller stays thin. All reads are display reads (cache-backed inside
 * StockReadService).
 *
 * Note: isLowStock here is recomputed against the SUMMED cross-warehouse
 * availability (the seller's whole-network picture). Operational low-stock
 * ALERTING (StockAlertService) is deliberately per-(seller,variant,
 * warehouse) — a different, intentional grain.
 */
@Injectable()
export class SellerStockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockRead: StockReadService,
  ) {}

  async list(
    sellerId: string,
    opts: { categoryId?: string; status?: VariantStatus; page?: number; pageSize?: number },
  ): Promise<AggregatedStockList> {
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 20;
    const merged = await this.merged(sellerId, {
      categoryId: opts.categoryId,
      status: opts.status,
    });
    const rows = [...merged.values()].sort((a, b) => a.skuCode.localeCompare(b.skuCode));
    const items = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    return { items, total: rows.length, page, pageSize };
  }

  async summary(sellerId: string): Promise<AggregatedStockSummary> {
    const merged = await this.merged(sellerId, {});
    const rows = [...merged.values()];
    return {
      totalSkus: rows.length,
      totalQtyOnHand: rows.reduce((s, v) => s + v.qtyOnHand, 0),
      totalQtyReserved: rows.reduce((s, v) => s + v.qtyReserved, 0),
      totalQtyAvailable: rows.reduce((s, v) => s + v.qtyAvailable, 0),
      lowStockSkus: rows.filter((v) => v.isLowStock).length,
    };
  }

  async byVariant(sellerId: string, variantId: string): Promise<AggregatedVariantStock> {
    const merged = await this.merged(sellerId, {});
    const hit = merged.get(variantId);
    if (hit) return hit;
    // No footprint anywhere — fall back to a zeroed view if it's the
    // seller's variant (any warehouse will resolve catalog metadata),
    // else 404.
    const whId = await this.firstWarehouseId();
    const zero = whId
      ? await this.stockRead.getVariantStockForDisplay(sellerId, variantId, whId)
      : null;
    if (!zero) {
      throw new NotFoundException({
        code: 'VARIANT_STOCK_NOT_FOUND',
        message: 'No stock record for this variant',
      });
    }
    return { ...zero, warehouseCount: 0 };
  }

  // ---------- internal ----------

  private async merged(
    sellerId: string,
    opts: { categoryId?: string | undefined; status?: VariantStatus | undefined },
  ): Promise<Map<string, AggregatedVariantStock>> {
    const warehouseIds = await this.warehouseIds();
    const out = new Map<string, AggregatedVariantStock>();
    for (const whId of warehouseIds) {
      const rows = await this.stockRead.getDisplayVariants(sellerId, whId, opts);
      for (const r of rows) {
        const acc = out.get(r.variantId);
        if (!acc) {
          out.set(r.variantId, { ...r, warehouseCount: 1 });
        } else {
          acc.qtyOnHand += r.qtyOnHand;
          acc.qtyReserved += r.qtyReserved;
          acc.qtyAvailable += r.qtyAvailable;
          acc.warehouseCount += 1;
        }
      }
    }
    // Recompute isLowStock against the SUMMED availability (threshold is a
    // per-variant constant, identical across warehouses).
    for (const v of out.values()) {
      v.isLowStock = v.lowStockThreshold !== null && v.qtyAvailable < v.lowStockThreshold;
    }
    return out;
  }

  private async warehouseIds(): Promise<string[]> {
    const rows = await this.prisma.client.warehouse.findMany({
      where: { deletedAt: null },
      select: { id: true },
      orderBy: { code: 'asc' },
    });
    return rows.map((r) => r.id);
  }

  private async firstWarehouseId(): Promise<string | null> {
    const ids = await this.warehouseIds();
    return ids[0] ?? null;
  }
}
