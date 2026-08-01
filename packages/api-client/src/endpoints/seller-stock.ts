/**
 * Seller stock — cross-warehouse aggregated view.
 *
 * Backend: apps/api SellerStockService.list() + .summary().
 * Mirrors AggregatedVariantStock + AggregatedStockList + AggregatedStockSummary.
 */
import type { VariantStatus } from '@skydrop/db';

export interface SellerStockRow {
  readonly variantId: string;
  readonly productId: string;
  readonly skuCode: string;
  readonly variantLabel: string | null;
  readonly status: VariantStatus;
  readonly qtyOnHand: number;
  readonly qtyReserved: number;
  readonly qtyAvailable: number;
  readonly lowStockThreshold: number | null;
  readonly isLowStock: boolean;
  readonly warehouseCount: number;
}

export interface SellerStockListResponse {
  readonly items: ReadonlyArray<SellerStockRow>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface SellerStockSummary {
  readonly totalSkus: number;
  readonly totalQtyOnHand: number;
  readonly totalQtyReserved: number;
  readonly totalQtyAvailable: number;
  readonly lowStockSkus: number;
}

export interface ListSellerStockQuery {
  readonly status?: VariantStatus;
  readonly page?: number;
  readonly pageSize?: number;
}
