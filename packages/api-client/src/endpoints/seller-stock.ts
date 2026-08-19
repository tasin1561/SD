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
  /**
   * On hand, really yours, and sellable from nowhere yet — sitting in
   * our Bangladesh intake or in transit between our warehouses.
   * Deliberately NOT part of qtyOnHand or qtyAvailable.
   */
  readonly qtyInTransit: number;
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
  readonly totalQtyInTransit: number;
  readonly lowStockSkus: number;
}

export interface ListSellerStockQuery {
  readonly status?: VariantStatus;
  readonly page?: number;
  readonly pageSize?: number;
}
