import { Injectable, Logger } from '@nestjs/common';
import { VariantStatus } from '@skydrop/db';
import { RedisService } from '../../infrastructure/redis/redis.service';

/* ============================================================================
 * INV-2 — CACHE IS READS-ONLY FOR DISPLAYS. MUTATION PATHS READ LIVE FROM DB.
 * ----------------------------------------------------------------------------
 * Nothing in a stock-changing path (reserve / allocate / decrement / mutate /
 * adjust / receive) may consult this cache to make a decision. Those paths
 * MUST call StockReadService.getVariantStockLive() (no cache) and the
 * version-guarded StockMutationService. This cache exists ONLY to serve
 * seller-facing *display* reads (StockReadService.*ForDisplay / *Summary).
 *
 * A stale cache here can never corrupt stock: it can only show a seller a
 * slightly out-of-date number for up to the TTL. Invalidation
 * (invalidate(sellerId, warehouseId)) runs AFTER the mutation transaction
 * commits, never inside it (INV-5) — see phase-1a-debt for the non-
 * transactional-invalidation note.
 * ========================================================================== */

const DETAIL_PREFIX = 'inventory:stock:detail:';
const AGG_PREFIX = 'inventory:stock:agg:';
const CACHE_TTL_SECONDS = 5 * 60;

/** One variant's rolled-up position within a single (seller, warehouse). */
export interface CachedVariantStock {
  variantId: string;
  productId: string;
  categoryId: string | null;
  skuCode: string;
  variantLabel: string | null;
  status: VariantStatus;
  qtyOnHand: number;
  /** Sum of ACTIVE reservations (phase-1 floating + phase-2 allocated). */
  qtyReserved: number;
  /** INV-3: qtyOnHand − qtyReserved(active). Never stored in the DB. */
  qtyAvailable: number;
  /** Effective threshold (variant → seller default → null). */
  lowStockThreshold: number | null;
  isLowStock: boolean;
}

export interface CachedStockDetail {
  sellerId: string;
  warehouseId: string;
  generatedAt: string;
  variants: CachedVariantStock[];
}

export interface CachedStockAggregate {
  sellerId: string;
  warehouseId: string;
  generatedAt: string;
  totalSkus: number;
  totalQtyOnHand: number;
  totalQtyReserved: number;
  totalQtyAvailable: number;
  lowStockSkus: number;
}

/**
 * Best-effort Redis cache for seller-facing stock displays, keyed by
 * (sellerId, warehouseId). Same resilience contract as the attribute
 * cache: a failed get/set degrades to a DB read, never an error.
 */
@Injectable()
export class StockCacheService {
  private readonly logger = new Logger(StockCacheService.name);

  constructor(private readonly redis: RedisService) {}

  private detailKey(sellerId: string, warehouseId: string): string {
    return `${DETAIL_PREFIX}${sellerId}:${warehouseId}`;
  }

  private aggKey(sellerId: string, warehouseId: string): string {
    return `${AGG_PREFIX}${sellerId}:${warehouseId}`;
  }

  async getDetail(sellerId: string, warehouseId: string): Promise<CachedStockDetail | null> {
    return this.safeGet<CachedStockDetail>(this.detailKey(sellerId, warehouseId));
  }

  async setDetail(value: CachedStockDetail): Promise<void> {
    await this.safeSet(this.detailKey(value.sellerId, value.warehouseId), value);
  }

  async getAggregate(sellerId: string, warehouseId: string): Promise<CachedStockAggregate | null> {
    return this.safeGet<CachedStockAggregate>(this.aggKey(sellerId, warehouseId));
  }

  async setAggregate(value: CachedStockAggregate): Promise<void> {
    await this.safeSet(this.aggKey(value.sellerId, value.warehouseId), value);
  }

  /**
   * Clears BOTH the detail and aggregate snapshots for the affected
   * (sellerId, warehouseId). Called from mutation flows AFTER tx.commit().
   * Best-effort: a failed DEL just means entries serve stale until TTL.
   */
  async invalidate(sellerId: string, warehouseId: string): Promise<void> {
    const keys = [this.detailKey(sellerId, warehouseId), this.aggKey(sellerId, warehouseId)];
    try {
      await this.redis.client.del(...keys);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), sellerId, warehouseId },
        'Stock cache invalidation DEL failed; entries serve stale until TTL',
      );
    }
  }

  // ---------- internal ----------

  private async safeGet<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), key },
        'Stock cache read failed; resolving from DB',
      );
      return null;
    }
  }

  private async safeSet(key: string, value: unknown): Promise<void> {
    try {
      await this.redis.client.set(key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), key },
        'Stock cache write failed; continuing without cache',
      );
    }
  }
}
