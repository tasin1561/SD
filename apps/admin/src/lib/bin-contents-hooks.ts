'use client';

import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import { usePermission } from './use-permission';

/**
 * What each bin holds — `GET /admin/bin-contents` (every warehouse, every
 * bin, its lines inline and capped) and `GET /admin/bin-contents/:binId`
 * (one bin, paged). Both `warehouse.view`, like the bins list itself.
 *
 * Keys live under `admin-warehouses` so creating or removing a bin — which
 * invalidates that prefix — refreshes what the page shows.
 */

export interface BinStockLine {
  readonly stockLevelId: string;
  readonly sellerId: string;
  readonly sellerName: string | null;
  readonly variantId: string;
  readonly productName: string | null;
  readonly thumbnailUrl: string | null;
  readonly skuCode: string | null;
  readonly variantLabel: string | null;
  readonly batchId: string;
  readonly batchCode: string;
  readonly batchExpiresAt: string | null;
  readonly qtyOnHand: number;
  /** Phase-2: already allocated to a pick on this bin. */
  readonly qtyReserved: number;
}

export interface BinWithLines {
  readonly id: string;
  readonly code: string;
  readonly type: string;
  readonly zoneCode: string | null;
  readonly pickable: boolean;
  readonly unitsOnHand: number;
  readonly unitsReserved: number;
  readonly skuCount: number;
  readonly lineCount: number;
  readonly lines: readonly BinStockLine[];
  readonly linesNotShown: number;
}

export interface WarehouseWithBins {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly binTrackingEnabled: boolean;
  readonly fulfilsOrders: boolean;
  readonly bins: readonly BinWithLines[];
}

export interface BinOverview {
  readonly warehouses: readonly WarehouseWithBins[];
  readonly linesPerBin: number;
}

export interface BinContentsPage {
  readonly bin: Omit<BinWithLines, 'lines' | 'linesNotShown'> & {
    readonly warehouseId: string;
    readonly warehouseCode: string;
    readonly warehouseName: string;
  };
  readonly items: ReadonlyArray<BinStockLine & { readonly lastMovementAt: string | null }>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export function useBinOverview(): UseQueryResult<BinOverview> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-warehouses', 'bin-contents', 'overview'],
    queryFn: () => client.request<BinOverview>('/api/admin/bin-contents'),
  });
}

export function useBinContents(
  binId: string,
  page: number,
  pageSize: number,
): UseQueryResult<BinContentsPage> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-warehouses', 'bin-contents', binId, page, pageSize],
    queryFn: () =>
      client.request<BinContentsPage>(
        `/api/admin/bin-contents/${binId}?page=${page}&pageSize=${pageSize}`,
      ),
    placeholderData: keepPreviousData,
  });
}

export interface BinOption {
  readonly id: string;
  readonly code: string;
  readonly type: string;
}

/**
 * The bins of one warehouse, for a filter. Self-gating on `warehouse.view`
 * so a page gated on something else (the movement ledger is
 * `inventory.view`) never fires a request its viewer may not make.
 */
export function useBinOptions(warehouseId: string): UseQueryResult<readonly BinOption[]> {
  const client = useApiClient();
  const canRead = usePermission('warehouse.view');
  return useQuery({
    enabled: canRead && warehouseId !== '',
    queryKey: ['admin-warehouses', 'bins', warehouseId],
    staleTime: 60_000,
    queryFn: () =>
      client.request<readonly BinOption[]>(`/api/admin/warehouses/${warehouseId}/bins`),
  });
}
