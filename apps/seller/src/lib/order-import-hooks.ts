'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import type { BulkUploadStatus } from '@skydrop/db';

/**
 * The single order-CSV import, addressed by id.
 *
 * `GET /seller/order-imports/:id` returns exactly the shape a row of
 * `GET /seller/order-imports` carries (`BulkOrderUploadView` on both),
 * so this buys nothing the list does not already deliver for the ten
 * most recent runs — and everything for the eleventh. The import panel
 * fetches `?page=1&pageSize=10` and offers no pagination, so an import
 * from last month is unreachable, and a job somebody is watching has no
 * URL to send anyone.
 *
 * Query-key convention follows the panel's (`api-hooks` house style,
 * `[domain, op, ...args]`): the detail sits UNDER the list's key, so
 * the panel's existing `invalidateQueries(['seller-csv-uploads',
 * 'orders'])` after queuing an import refreshes this too without the
 * panel knowing this screen exists.
 */
export interface OrderImportView {
  readonly id: string;
  readonly fileName: string;
  readonly status: BulkUploadStatus;
  readonly rowCount: number;
  readonly ordersCreated: number;
  readonly rowsFailed: number;
  readonly rowsSkipped: number;
  readonly errorReportKey: string | null;
  /** ISO strings on the wire — the server types these as `Date`. */
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
}

/**
 * Is the worker still going to touch this row?
 *
 * `BulkUploadStatus` has exactly two non-terminal values — PENDING (the
 * job is queued) and PROCESSING (the worker has it). Everything else is
 * final. This is a set rather than a string comparison at each call
 * site because polling that stops early looks identical to an import
 * that has stalled.
 */
export function isOrderImportRunning(status: BulkUploadStatus): boolean {
  return status === 'PENDING' || status === 'PROCESSING';
}

export function useOrderImport(id: string): UseQueryResult<OrderImportView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-csv-uploads', 'orders', 'detail', id],
    queryFn: () => client.request<OrderImportView>(`/api/seller/order-imports/${id}`),
    // A row processor works through the file a row at a time, so the
    // interesting numbers move while somebody is looking at them. Stop
    // once the status is terminal — a finished import never changes
    // again, and polling it forever is a request per five seconds per
    // open tab.
    refetchInterval: (q) =>
      q.state.data !== undefined && isOrderImportRunning(q.state.data.status) ? 5_000 : false,
  });
}
