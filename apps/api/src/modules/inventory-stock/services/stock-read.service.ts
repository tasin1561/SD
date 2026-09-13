import { Injectable } from '@nestjs/common';
import { Prisma, VariantStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NON_PICKABLE_BIN_TYPES } from '../../inventory-shared/bin-policy.service';
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

/** Per-bin totals for the admin bin view (display only). */
export interface BinStockTotals {
  binId: string;
  unitsOnHand: number;
  /** Phase-2 only (INV-4): units allocated to a pick on this bin. */
  unitsReserved: number;
  /** Distinct variants holding anything in the bin. */
  skuCount: number;
  /** stock_levels rows holding anything (variant × batch × seller). */
  lineCount: number;
}

/** One stock_levels row in a bin, batch resolved; names are the caller's job. */
export interface BinStockLineRaw {
  stockLevelId: string;
  binId: string;
  sellerId: string;
  variantId: string;
  batchId: string;
  batchCode: string;
  batchExpiresAt: Date | null;
  qtyOnHand: number;
  qtyReserved: number;
}

/** A level holds something when it has units on hand or phase-2 reserved. */
const HOLDS_SOMETHING: Prisma.StockLevelWhereInput = {
  OR: [{ qtyOnHand: { gt: 0 } }, { qtyReserved: { gt: 0 } }],
};

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

  // ── Per-BIN display reads (admin "what is in this bin") ──────────────
  //
  // DISPLAY path (INV-2 naming): these read stock_levels directly rather
  // than through the cache, because the cache is keyed per seller +
  // warehouse and a bin view cuts across sellers. They are uncached but
  // still display-only — nothing may decide a reservation, allocation or
  // movement from them; that stays on getVariantStockLive /
  // StockAvailabilityService. qtyReserved here is the PHASE-2 counter
  // (INV-4): units already allocated to a pick on THIS bin. Phase-1 holds
  // float with no bin and are deliberately not attributed to any bin.
  //
  // A row counts when it holds anything — on hand OR reserved. A level at
  // zero on both is history, not contents.

  /** Per-bin totals: units on hand, phase-2 reserved, distinct SKUs, rows. */
  async binTotalsForDisplay(
    binIds: readonly string[],
  ): Promise<ReadonlyMap<string, BinStockTotals>> {
    const out = new Map<string, BinStockTotals>();
    if (binIds.length === 0) return out;
    const groups = await this.prisma.client.stockLevel.groupBy({
      by: ['binId', 'variantId'],
      where: { binId: { in: [...binIds] }, ...HOLDS_SOMETHING },
      _sum: { qtyOnHand: true, qtyReserved: true },
      _count: { _all: true },
    });
    for (const g of groups) {
      const prev = out.get(g.binId) ?? {
        binId: g.binId,
        unitsOnHand: 0,
        unitsReserved: 0,
        skuCount: 0,
        lineCount: 0,
      };
      out.set(g.binId, {
        binId: g.binId,
        unitsOnHand: prev.unitsOnHand + (g._sum.qtyOnHand ?? 0),
        unitsReserved: prev.unitsReserved + (g._sum.qtyReserved ?? 0),
        skuCount: prev.skuCount + 1,
        lineCount: prev.lineCount + g._count._all,
      });
    }
    return out;
  }

  /**
   * The stock rows in one or more bins, fullest first within each bin.
   * `take`/`skip` apply across the whole result (bins ordered by id), so a
   * caller wanting a per-bin cap asks one bin at a time.
   */
  async binLinesForDisplay(
    binIds: readonly string[],
    page: { take: number; skip?: number },
  ): Promise<BinStockLineRaw[]> {
    if (binIds.length === 0) return [];
    const rows = await this.prisma.client.stockLevel.findMany({
      where: { binId: { in: [...binIds] }, ...HOLDS_SOMETHING },
      orderBy: [{ binId: 'asc' }, { qtyOnHand: 'desc' }, { id: 'asc' }],
      take: page.take,
      skip: page.skip ?? 0,
      select: {
        id: true,
        binId: true,
        sellerId: true,
        variantId: true,
        batchId: true,
        qtyOnHand: true,
        qtyReserved: true,
        batch: { select: { batchCode: true, expiresAt: true } },
      },
    });
    return rows.map((r) => ({
      stockLevelId: r.id,
      binId: r.binId,
      sellerId: r.sellerId,
      variantId: r.variantId,
      batchId: r.batchId,
      batchCode: r.batch.batchCode,
      batchExpiresAt: r.batch.expiresAt,
      qtyOnHand: r.qtyOnHand,
      qtyReserved: r.qtyReserved,
    }));
  }

  /**
   * When each (variant, batch) last moved in this bin, from the append-only
   * ledger (never `stock_levels.updatedAt`, which a reservation touch also
   * resets). Scoped to the variants on the page so the hypertable scan is
   * bounded by the page, not the bin's whole history. Key: `variant|batch`.
   */
  async binLastMovementForDisplay(
    binId: string,
    variantIds: readonly string[],
  ): Promise<ReadonlyMap<string, Date>> {
    const out = new Map<string, Date>();
    if (variantIds.length === 0) return out;
    const groups = await this.prisma.client.stockMovement.groupBy({
      by: ['variantId', 'batchId'],
      where: { binId, variantId: { in: [...new Set(variantIds)] } },
      _max: { createdAt: true },
    });
    for (const g of groups) {
      if (g.batchId !== null && g._max.createdAt !== null) {
        out.set(`${g.variantId}|${g.batchId}`, g._max.createdAt);
      }
    }
    return out;
  }

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
        where: {
          sellerId,
          warehouseId,
          // BIN-2, in the DISPLAY path. `StockAvailabilityService` was
          // taught this when a return restocked into RTO_HOLD showed as
          // sellable; the cached display beside it never was, so the
          // seller's own inventory page went on counting hold, damaged
          // and quarantine stock as available the whole time.
          //
          // TRANSIT made it visible: 100 units in the air between two of
          // our warehouses read as 100 available to sell, AND as 100 in
          // transit, because two different queries disagreed about
          // whether a bin type matters.
          //
          // Same shared constant as the availability primitive and the
          // pick allocator, so all three cannot drift apart.
          bin: { type: { notIn: [...NON_PICKABLE_BIN_TYPES] }, deletedAt: null },
        },
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
