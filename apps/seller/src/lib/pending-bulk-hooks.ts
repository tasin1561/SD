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
  BulkFixApplyRequest,
  BulkFixApplyResult,
  BulkFixSummary,
  PendingCompactRow,
} from '@skydrop/api-client';

/**
 * Pending orders, list-first: the compact line per row, the "same problem,
 * same bad value" groups, and applying one fix to a whole group.
 *
 * Every key starts with `seller-orders-pending`, the key the single-row
 * hooks already invalidate, so fixing, importing or discarding ONE row also
 * re-reads the table and the groups — nothing here can go stale behind it.
 */
const ROOT = '/api/seller/orders-pending';
const KEY = 'seller-orders-pending';

export function usePendingCompact(): UseQueryResult<readonly PendingCompactRow[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: [KEY, 'compact'],
    queryFn: () => client.request<readonly PendingCompactRow[]>(`${ROOT}/compact`),
  });
}

export function useBulkFixSummary(): UseQueryResult<BulkFixSummary> {
  const client = useApiClient();
  return useQuery({
    queryKey: [KEY, 'bulk-fix'],
    queryFn: () => client.request<BulkFixSummary>(`${ROOT}/bulk-fix`),
  });
}

export function useApplyBulkFix(): UseMutationResult<
  BulkFixApplyResult,
  Error,
  BulkFixApplyRequest
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<BulkFixApplyResult>(`${ROOT}/bulk-fix/apply`, { method: 'POST', body }),
    onSuccess: (_res, body) => {
      void qc.invalidateQueries({ queryKey: [KEY] });
      // "Apply and import" places orders: the order list and its counts moved.
      if (body.importAfterFix === true) void qc.invalidateQueries({ queryKey: ['seller-orders'] });
    },
  });
}
