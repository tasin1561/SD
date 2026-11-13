import { Injectable, NotFoundException } from '@nestjs/common';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import { StockAvailabilityService } from '../../inventory-shared/stock-availability.service';
import { WarehouseResolverService } from '../../inventory-shared/warehouse-resolver.service';
import { SellerStockService } from './seller-stock.service';

/** One SKU's stock position, as the client's Inventory page frames it. */
export interface AssistantStockSummary {
  readonly sku: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly status: string;
  /** On hand in the warehouses that ship orders. */
  readonly qtyOnHand: number;
  /** Held for orders that have not shipped yet. */
  readonly qtyReserved: number;
  /** INV-3: what can be promised to a customer right now (live, never the display cache). */
  readonly qtyAvailable: number;
  /** Really the client's, but not sellable yet: still in Bangladesh intake or in transit. */
  readonly qtyInTransit: number;
  readonly lowStockThreshold: number | null;
  readonly isLowStock: boolean;
}

/**
 * What the assistant may read about one SKU's stock.
 *
 * NO STOCK TABLE IS QUERIED HERE. The SKU is resolved to a variant through
 * `CatalogReadService.getVariantBySku(sellerId, sku)` (MUST 13) — the
 * seller id is part of that lookup, so another client's SKU is the same
 * `null` as one that does not exist. The availability scalar is
 * `StockAvailabilityService.compute()` (INV-3) summed over the warehouses
 * that fulfil orders (CNS-2, through `WarehouseResolverService`), a live
 * read rather than the 5-minute display cache. The remaining figures come
 * from `SellerStockService.byVariant`, the very call the Inventory page's
 * detail route makes.
 *
 * Read-only: nothing here writes, reserves or adjusts anything (INV-1).
 */
@Injectable()
export class SellerStockAssistantReadService {
  constructor(
    private readonly catalog: CatalogReadService,
    private readonly availability: StockAvailabilityService,
    private readonly warehouses: WarehouseResolverService,
    private readonly stock: SellerStockService,
  ) {}

  async forSeller(sellerId: string, sku: string): Promise<AssistantStockSummary | null> {
    const variant = await this.catalog.getVariantBySku(sellerId, sku.trim());
    if (variant === null) return null;

    const fulfilling = await this.warehouses.fulfillingWarehouseIds();
    const live = await Promise.all(
      fulfilling.map((warehouseId) =>
        this.availability.compute({ sellerId, variantId: variant.variantId, warehouseId }),
      ),
    );
    const qtyAvailable = live.reduce((a, b) => a + b, 0);

    let agg: Awaited<ReturnType<SellerStockService['byVariant']>> | null = null;
    try {
      agg = await this.stock.byVariant(sellerId, variant.variantId);
    } catch (e) {
      // A variant with no footprint anywhere is a real SKU with nothing in
      // stock, not a missing one.
      if (!(e instanceof NotFoundException)) throw e;
    }
    const threshold = agg?.lowStockThreshold ?? variant.lowStockThreshold ?? null;
    return {
      sku: variant.skuCode,
      productName: variant.productName,
      variantLabel: variant.variantLabel,
      status: String(variant.status),
      qtyOnHand: agg?.qtyOnHand ?? 0,
      qtyReserved: agg?.qtyReserved ?? 0,
      qtyAvailable,
      qtyInTransit: agg?.qtyInTransit ?? 0,
      lowStockThreshold: threshold,
      isLowStock: threshold !== null && qtyAvailable < threshold,
    };
  }
}
