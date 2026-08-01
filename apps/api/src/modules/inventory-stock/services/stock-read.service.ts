import { Injectable } from '@nestjs/common';
import { VariantStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import {
  StockCacheService,
  type CachedStockAggregate,
  type CachedStockDetail,
  type CachedVariantStock,
} from '../../inventory-shared/stock-cache.service';

/**
 * Live (uncached) stock position for a single (seller, variant, warehouse).
 * INV-3: qtyAvailable is COMPUTED, never stored — qtyOnHand minus ACTIVE
 * reservations (phase-1 floating + phase-2 allocated, counted uniformly).
 */
export interface LiveVariantStock {
  sellerId: string;
  variantId: string;
  warehouseId: string;
  qtyOnHand: number;
  qtyReservedActive: number;
  qtyAvailable: number;
}

export interface StockListResult {
  items: CachedVariantStock[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * The two-path stock read surface (INV-2).
 *
 *  - getVariantStockLive(...)      — NO cache. The ONLY method mutation
 *    paths (reserve / allocate / decrement) may call. Pure DB aggregate.
 *  - *ForDisplay / *Summary        — cache-backed (StockCacheService),
 *    seller-facing reads only. A stale display number is harmless; a stale
 *    decision is not — hence the hard naming split.
 *
 * Catalog metadata (sku/label/status) and the raw per-variant
 * threshold come exclusively via CatalogReadService — inventory never
 * queries product_variants directly (CLAUDE MUST #13). The seller-default
 * threshold fallback is inventory's own logic (reads `sellers`, allowed).
 *
 * ── SANCTIONED CROSS-MODULE API (Module 6 / Module 8) ──────────────────
 *
 * getVariantStockLive(sellerId, variantId, warehouseId): LiveVariantStock
 *   INV-2 LIVE PATH — bypasses the cache, pure DB aggregate. This is the
 *   ONLY read a mutation/decision path may use (Module 6 stock checks at
 *   order confirm, reservation, allocation). qtyAvailable is COMPUTED
 *   (INV-3): SUM(stock_levels.qtyOnHand) − SUM(ACTIVE reservations,
 *   phase-1 + phase-2). Never returns a stale number.
 *
 * getVariantStockForDisplay / listStockForDisplay / getSummaryForDisplay
 *   INV-2 DISPLAY PATH — StockCacheService-backed (5-min TTL). Seller-
 *   facing reads ONLY. A stale display number is harmless; a stale
 *   *decision* is not — callers on a mutation path MUST use the *Live
 *   method. The naming split (*ForDisplay/*Summary vs *Live) IS the
 *   enforced contract.
 * ───────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class StockReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: StockCacheService,
    private readonly catalog: CatalogReadService,
  ) {}

  /** INV-2: the live path. No cache — safe for mutation decisions. */
  async getVariantStockLive(
    sellerId: string,
    variantId: string,
    warehouseId: string,
  ): Promise<LiveVariantStock> {
    const [onHand, reserved] = await Promise.all([
      this.prisma.client.stockLevel.aggregate({
        where: { sellerId, variantId, warehouseId },
        _sum: { qtyOnHand: true },
      }),
      this.prisma.client.stockReservation.aggregate({
        where: { sellerId, variantId, warehouseId, status: 'ACTIVE' },
        _sum: { qtyReserved: true },
      }),
    ]);
    const qtyOnHand = onHand._sum.qtyOnHand ?? 0;
    const qtyReservedActive = reserved._sum.qtyReserved ?? 0;
    return {
      sellerId,
      variantId,
      warehouseId,
      qtyOnHand,
      qtyReservedActive,
      qtyAvailable: qtyOnHand - qtyReservedActive,
    };
  }

  /** Cached single-variant display view, or null if the variant has no
   *  stock footprint and is not a catalog variant of this seller. */
  async getVariantStockForDisplay(
    sellerId: string,
    variantId: string,
    warehouseId: string,
  ): Promise<CachedVariantStock | null> {
    const detail = await this.getOrBuildDetail(sellerId, warehouseId);
    const hit = detail.variants.find((v) => v.variantId === variantId);
    if (hit) return hit;

    // No stock footprint: surface a zeroed view if it's genuinely this
    // seller's variant, else null (→ 404 at the controller).
    const resolved = await this.catalog.getVariantById(variantId);
    if (!resolved || resolved.sellerId !== sellerId) return null;
    const sellerDefault = await this.sellerDefaultThreshold(sellerId);
    const threshold = resolved.lowStockThreshold ?? sellerDefault ?? null;
    return {
      variantId,
      productId: resolved.productId,
      skuCode: resolved.skuCode,
      variantLabel: resolved.variantLabel,
      status: resolved.status,
      qtyOnHand: 0,
      qtyReserved: 0,
      qtyAvailable: 0,
      lowStockThreshold: threshold,
      isLowStock: threshold !== null && 0 < threshold,
    };
  }

  /**
   * Full filtered+sorted display rows for ONE (seller, warehouse) — no
   * pagination. The cross-warehouse aggregator (SellerStockService) merges
   * these; listStockForDisplay paginates them for the single-warehouse case.
   */
  async getDisplayVariants(
    sellerId: string,
    warehouseId: string,
    opts: { status?: VariantStatus | undefined } = {},
  ): Promise<CachedVariantStock[]> {
    const detail = await this.getOrBuildDetail(sellerId, warehouseId);
    let rows = detail.variants;
    if (opts.status) rows = rows.filter((v) => v.status === opts.status);
    return [...rows].sort((a, b) => a.skuCode.localeCompare(b.skuCode));
  }

  async listStockForDisplay(
    sellerId: string,
    warehouseId: string,
    opts: {
      status?: VariantStatus;
      page?: number;
      pageSize?: number;
    },
  ): Promise<StockListResult> {
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 20;
    const rows = await this.getDisplayVariants(sellerId, warehouseId, { status: opts.status });
    const total = rows.length;
    const items = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    return { items, total, page, pageSize };
  }

  async getSummaryForDisplay(sellerId: string, warehouseId: string): Promise<CachedStockAggregate> {
    const cached = await this.cache.getAggregate(sellerId, warehouseId);
    if (cached) return cached;
    const { aggregate } = await this.buildAndCache(sellerId, warehouseId);
    return aggregate;
  }

  // ---------- internal ----------

  private async getOrBuildDetail(
    sellerId: string,
    warehouseId: string,
  ): Promise<CachedStockDetail> {
    const cached = await this.cache.getDetail(sellerId, warehouseId);
    if (cached) return cached;
    const { detail } = await this.buildAndCache(sellerId, warehouseId);
    return detail;
  }

  /**
   * Builds the canonical (seller, warehouse) snapshot from the DB and
   * caches BOTH the detail and aggregate. The single heavy query path —
   * everything seller-facing flows through this.
   */
  private async buildAndCache(
    sellerId: string,
    warehouseId: string,
  ): Promise<{ detail: CachedStockDetail; aggregate: CachedStockAggregate }> {
    const [levels, reservations, sellerDefault] = await Promise.all([
      this.prisma.client.stockLevel.groupBy({
        by: ['variantId'],
        where: { sellerId, warehouseId },
        _sum: { qtyOnHand: true },
      }),
      this.prisma.client.stockReservation.groupBy({
        by: ['variantId'],
        where: { sellerId, warehouseId, status: 'ACTIVE' },
        _sum: { qtyReserved: true },
      }),
      this.sellerDefaultThreshold(sellerId),
    ]);

    const onHandByVariant = new Map<string, number>();
    for (const l of levels) onHandByVariant.set(l.variantId, l._sum.qtyOnHand ?? 0);
    const reservedByVariant = new Map<string, number>();
    for (const r of reservations) reservedByVariant.set(r.variantId, r._sum.qtyReserved ?? 0);

    const variantIds = [...new Set([...onHandByVariant.keys(), ...reservedByVariant.keys()])];
    const resolved = await this.catalog.getVariantsByIds(variantIds);

    const variants: CachedVariantStock[] = [];
    for (const variantId of variantIds) {
      const meta = resolved.get(variantId);
      if (!meta) continue; // catalog soft-deleted — not a seller display row
      const qtyOnHand = onHandByVariant.get(variantId) ?? 0;
      const qtyReserved = reservedByVariant.get(variantId) ?? 0;
      const qtyAvailable = qtyOnHand - qtyReserved;
      const threshold = meta.lowStockThreshold ?? sellerDefault ?? null;
      variants.push({
        variantId,
        productId: meta.productId,
        skuCode: meta.skuCode,
        variantLabel: meta.variantLabel,
        status: meta.status,
        qtyOnHand,
        qtyReserved,
        qtyAvailable,
        lowStockThreshold: threshold,
        isLowStock: threshold !== null && qtyAvailable < threshold,
      });
    }

    const generatedAt = new Date().toISOString();
    const detail: CachedStockDetail = { sellerId, warehouseId, generatedAt, variants };
    const aggregate: CachedStockAggregate = {
      sellerId,
      warehouseId,
      generatedAt,
      totalSkus: variants.length,
      totalQtyOnHand: variants.reduce((s, v) => s + v.qtyOnHand, 0),
      totalQtyReserved: variants.reduce((s, v) => s + v.qtyReserved, 0),
      totalQtyAvailable: variants.reduce((s, v) => s + v.qtyAvailable, 0),
      lowStockSkus: variants.filter((v) => v.isLowStock).length,
    };
    await Promise.all([this.cache.setDetail(detail), this.cache.setAggregate(aggregate)]);
    return { detail, aggregate };
  }

  private async sellerDefaultThreshold(sellerId: string): Promise<number | null> {
    const seller = await this.prisma.client.seller.findUnique({
      where: { id: sellerId },
      select: { defaultLowStockThreshold: true },
    });
    return seller?.defaultLowStockThreshold ?? null;
  }
}
