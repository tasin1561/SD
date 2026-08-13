'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import type {
  AdjustmentStatus,
  CycleCountStatus,
  CycleCountType,
  AdjustmentType,
  StockMovementType,
} from '@skydrop/db';

/**
 * Admin inventory operations: adjustments, cycle counts, the movement
 * ledger, and inter-warehouse transfers.
 *
 * These four endpoints existed since M5 with no UI at all. The
 * adjustment one mattered most: INV-8 routes any adjustment above the
 * value threshold to APPROVED-by-a-human, and with nothing to approve
 * from, above-threshold stock could not be corrected by anyone.
 */

interface Paginated<T> {
  items: readonly T[];
  total: number;
  page: number;
  pageSize: number;
}

function qs(query: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ───────── Stock adjustments (INV-7 / INV-8) ─────────

export interface AdjustmentLineView {
  id: string;
  variantId: string;
  binId: string | null;
  batchId: string | null;
  qtyChange: number;
  unitCostInr: string | null;
}

export interface StockAdjustmentView {
  id: string;
  sellerId: string;
  warehouseId: string;
  type: AdjustmentType;
  reasonCode: string | null;
  description: string | null;
  status: AdjustmentStatus;
  initiatedById: string | null;
  initiatedAt: string;
  approverThresholdInr: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  totalValueImpactInr: string | null;
  photoSpacesKeys: readonly string[];
  lines: readonly AdjustmentLineView[];
}

export function useAdjustmentsList(query: {
  status?: string;
  sellerId?: string;
  warehouseId?: string;
  page?: number;
  pageSize?: number;
}): UseQueryResult<Paginated<StockAdjustmentView>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-adjustments', 'list', query],
    queryFn: () =>
      client.request<Paginated<StockAdjustmentView>>(`/api/admin/stock-adjustments${qs(query)}`),
  });
}

/**
 * Raising a stock correction.
 *
 * INV-8: below the value threshold this executes immediately; above it,
 * it lands PENDING and waits for a second person. The approval queue has
 * existed since M5 with a reader and no writer — so above-threshold
 * stock could not be corrected through any interface, and
 * `inventory.adjustments.create` was a permission nobody could exercise.
 *
 * A line is per (variant, bin, batch) because that is the grain stock is
 * actually held at; an adjustment that named only a variant could not be
 * applied to anything.
 */
export interface AdjustmentLineInput {
  readonly variantId: string;
  readonly binId: string;
  readonly batchId: string;
  /** Signed: negative removes. The type field says which way, and the
   *  server checks the two agree rather than inferring one from the
   *  other. */
  readonly qtyChange: number;
}

export function useCreateAdjustment(): UseMutationResult<
  StockAdjustmentView,
  Error,
  {
    sellerId: string;
    warehouseId?: string;
    type: 'INCREASE' | 'DECREASE';
    reasonCode: string;
    description?: string;
    lines: AdjustmentLineInput[];
  }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<StockAdjustmentView>('/api/admin/stock-adjustments', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-adjustments'] });
      // Below-threshold adjustments apply on the spot, so on-hand moved.
      void queryClient.invalidateQueries({ queryKey: ['admin-inventory'] });
    },
  });
}

export function useAdjustment(id: string | null): UseQueryResult<StockAdjustmentView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-adjustments', 'detail', id],
    enabled: id !== null,
    queryFn: () => client.request<StockAdjustmentView>(`/api/admin/stock-adjustments/${id ?? ''}`),
  });
}

export function useApproveAdjustment(): UseMutationResult<
  StockAdjustmentView,
  Error,
  { id: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<StockAdjustmentView>(`/api/admin/stock-adjustments/${id}/approve`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-adjustments'] });
      // Approval enqueues the executor, which applies real movements —
      // any stock or ledger view on screen is stale from here.
      void qc.invalidateQueries({ queryKey: ['admin-movements'] });
    },
  });
}

export function useRejectAdjustment(): UseMutationResult<
  StockAdjustmentView,
  Error,
  { id: string; reason: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }) =>
      client.request<StockAdjustmentView>(`/api/admin/stock-adjustments/${id}/reject`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-adjustments'] }),
  });
}

// ───────── Cycle counts ─────────

export interface CycleCountItemView {
  id: string;
  variantId: string;
  binId: string | null;
  batchId: string | null;
  systemQty: number;
  countedQty: number;
  notes: string | null;
  adjustmentId: string | null;
}

export interface CycleCountView {
  id: string;
  warehouseId: string;
  zoneId: string | null;
  countType: CycleCountType;
  countDate: string;
  status: CycleCountStatus;
  startedAt: string | null;
  completedAt: string | null;
  totalBinsCounted: number | null;
  totalSkusCounted: number | null;
  discrepancyCount: number | null;
  totalDiscrepancyValueInr: string | null;
  items: readonly CycleCountItemView[];
}

export function useCycleCountsList(query: {
  warehouseId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): UseQueryResult<Paginated<CycleCountView>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-cycle-counts', 'list', query],
    queryFn: () => client.request<Paginated<CycleCountView>>(`/api/admin/cycle-counts${qs(query)}`),
  });
}

export function useCycleCount(id: string | null): UseQueryResult<CycleCountView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-cycle-counts', 'detail', id],
    enabled: id !== null,
    queryFn: () => client.request<CycleCountView>(`/api/admin/cycle-counts/${id ?? ''}`),
  });
}

export function useCreateCycleCount(): UseMutationResult<
  CycleCountView,
  Error,
  { warehouseId: string; countType: string; countDate: string; zoneId?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<CycleCountView>('/api/admin/cycle-counts', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-cycle-counts'] }),
  });
}

export function useStartCycleCount(): UseMutationResult<CycleCountView, Error, { id: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<CycleCountView>(`/api/admin/cycle-counts/${id}/start`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-cycle-counts'] }),
  });
}

export function useRecordCycleCountItems(): UseMutationResult<
  CycleCountView,
  Error,
  {
    id: string;
    items: ReadonlyArray<{
      variantId: string;
      binId?: string;
      batchId?: string;
      countedQty: number;
      notes?: string;
    }>;
  }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, items }) =>
      client.request<CycleCountView>(`/api/admin/cycle-counts/${id}/items`, {
        method: 'POST',
        body: { items },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-cycle-counts'] }),
  });
}

export function useCompleteCycleCount(): UseMutationResult<CycleCountView, Error, { id: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<CycleCountView>(`/api/admin/cycle-counts/${id}/complete`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-cycle-counts'] });
      // Completing raises adjustments for the discrepancies.
      void qc.invalidateQueries({ queryKey: ['admin-adjustments'] });
    },
  });
}

// ───────── Movement ledger ─────────

export interface StockMovementView {
  id: string;
  createdAt: string;
  sellerId: string;
  variantId: string;
  warehouseId: string;
  binId: string | null;
  batchId: string | null;
  type: StockMovementType;
  qtyChange: number;
  qtyAfter: number | null;
  reasonCode: string | null;
  orderId: string | null;
  shipmentId: string | null;
  adjustmentId: string | null;
  performedByStaffId: string | null;
}

export function useMovementsList(query: {
  sellerId?: string;
  variantId?: string;
  warehouseId?: string;
  type?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}): UseQueryResult<Paginated<StockMovementView>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-movements', 'list', query],
    queryFn: () =>
      client.request<Paginated<StockMovementView>>(`/api/admin/stock-movements${qs(query)}`),
  });
}

// ───────── Inter-warehouse transfer ─────────

export function useCreateTransfer(): UseMutationResult<
  unknown,
  Error,
  {
    sellerId: string;
    variantId: string;
    qty: number;
    sourceWarehouseId: string;
    sourceBinId: string;
    sourceBatchId: string;
    destWarehouseId: string;
    destBinId: string;
    destBatchId: string;
    reason?: string;
  }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<unknown>('/api/admin/stock-transfers', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-movements'] }),
  });
}
