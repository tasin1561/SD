import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';

import { usePermission } from './use-permission';

/**
 * Collapsing a warehouse's bins, and restoring the layout afterwards.
 *
 * `BinCollapseService` has had four endpoints and no caller outside the
 * e2e suite since it landed, so one of the most destructive operations
 * in the product could only be performed by somebody with API access —
 * and the backup it takes could only be LISTED the same way, which is
 * the worse half: a restore nobody can see is a restore nobody trusts.
 *
 * Its own hooks file rather than a block in `api-hooks.ts` for the
 * reason the panel gives for being its own route: this is not warehouse
 * housekeeping and it should not be reached by scrolling past
 * housekeeping.
 */

export interface BinLayoutSnapshot {
  readonly id: string;
  readonly reason: string;
  readonly lineCount: number;
  readonly totalQty: number;
  readonly restoredAt: string | null;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface RequestCollapseResult {
  readonly challengeId: string;
  readonly expiresAt: string;
  readonly sentToEmail: string;
  readonly binsAffected: number;
  readonly unitsAffected: number;
}

export interface CollapseResult {
  readonly warehouseId: string;
  readonly snapshotId: string;
  readonly binsCollapsed: number;
  readonly rowsMoved: number;
  readonly unitsMoved: number;
}

export interface RestoreResult {
  readonly snapshotId: string;
  readonly restoredLines: number;
  readonly skippedLines: ReadonlyArray<{ binCode: string; variantId: string; why: string }>;
}

const base = (warehouseId: string): string =>
  `/api/admin/warehouses/${warehouseId}/bin-ops/collapse`;

/**
 * The backups for one warehouse, newest first.
 *
 * Gated in the hook on `warehouse.view` — the endpoint's own gate — so
 * the page can stay behind the narrower `warehouse.bins.collapse`
 * without the list 403ing for somebody who holds the destructive
 * permission but not the ordinary read.
 */
export function useBinSnapshots(
  warehouseId: string,
): UseQueryResult<ReadonlyArray<BinLayoutSnapshot>> {
  const client = useApiClient();
  const canRead = usePermission('warehouse.view');
  return useQuery({
    enabled: canRead && warehouseId !== '',
    queryKey: ['admin-warehouses', 'bin-snapshots', warehouseId],
    queryFn: () =>
      client.request<ReadonlyArray<BinLayoutSnapshot>>(
        `/api/admin/warehouses/${warehouseId}/bin-ops/snapshots`,
      ),
  });
}

/**
 * Step 1: ask what a collapse WOULD do, and get a code emailed.
 *
 * Nothing moves. The counts it returns are the whole point of making
 * this two steps — "merge 47 bins holding 1,203 units" is a decision
 * somebody can take, and "collapse this warehouse" is not.
 */
export function useRequestBinCollapse(
  warehouseId: string,
): UseMutationResult<RequestCollapseResult, Error, { reason: string }> {
  const client = useApiClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<RequestCollapseResult>(`${base(warehouseId)}/request`, {
        method: 'POST',
        body,
      }),
  });
}

/** Step 2: the snapshot is taken, then every bin merges into FLOOR. */
export function useConfirmBinCollapse(
  warehouseId: string,
): UseMutationResult<
  CollapseResult,
  Error,
  { challengeId: string; code: string; typedWarehouseCode: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<CollapseResult>(`${base(warehouseId)}/confirm`, { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-warehouses'] });
      // Every row moved as a paired TRANSFER_OUT/TRANSFER_IN (BIN-4), so
      // the ledger a reader would check next is stale.
      void queryClient.invalidateQueries({ queryKey: ['admin-movements'] });
    },
  });
}

/**
 * Put the layout back, as far as it still can be.
 *
 * Best-effort per line by design: stock sells between the collapse and
 * the restore, so this is a head start and not a rewind. The skipped
 * lines it returns are the honest part and the screen shows every one.
 */
export function useRestoreBinSnapshot(
  warehouseId: string,
): UseMutationResult<RestoreResult, Error, { snapshotId: string }> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ snapshotId }) =>
      client.request<RestoreResult>(
        `/api/admin/warehouses/${warehouseId}/bin-ops/snapshots/${snapshotId}/restore`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-warehouses'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-movements'] });
    },
  });
}
