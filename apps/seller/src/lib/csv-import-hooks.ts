'use client';

import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import { BulkUploadStatus } from '@skydrop/db';

/**
 * Catalog CSV imports, read through `/seller/csv-imports`.
 *
 * The import panel polls the LIST and shows the most recent ten while a
 * job runs. That answers "is it finished"; it cannot answer "what
 * happened to the file I sent last month" — the eleventh import falls
 * off the end and `GET /seller/csv-imports/:id` had no caller at all, so
 * there was nowhere for an older one to be opened.
 */

/**
 * One import, verbatim `BulkUploadView` from
 * apps/api/src/modules/catalog-csv-import/services/csv-import.service.ts,
 * with the three Date fields as the ISO strings JSON makes of them.
 *
 * The list and the detail are built from the same server-side
 * `toView()`, so both hooks below share this type — a second copy of a
 * fourteen-field shape is a second thing to forget when a counter is
 * added.
 */
export interface CsvImportView {
  readonly id: string;
  readonly fileName: string;
  readonly status: BulkUploadStatus;
  readonly rowCount: number | null;
  readonly productsCreated: number;
  readonly productsUpdated: number;
  readonly variantsCreated: number;
  readonly variantsUpdated: number;
  readonly rowsFailed: number;
  readonly rowsSkipped: number;
  readonly errorReportKey: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
}

export interface CsvImportPage {
  readonly items: readonly CsvImportView[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * The prefix the import panel already invalidates after queuing a job
 * (`['seller-csv-uploads', 'catalog']`). Both keys below sit UNDER it,
 * so a freshly queued import appears in this history without the panel
 * needing to know this screen exists.
 */
const CSV_IMPORTS_KEY = ['seller-csv-uploads', 'catalog'] as const;

/** Matches the panel's poll cadence — two screens refreshing the same
 *  job at different rates would disagree about its status on screen. */
const POLL_MS = 5_000;

/**
 * Is the worker still holding this file?
 *
 * F2-exhaustive over `BulkUploadStatus`, so a seventh value fails to
 * compile here rather than silently reading as finished — a poll that
 * stops early leaves a running import looking stalled forever, which is
 * exactly what the panel's own check does today (it tests for `RUNNING`
 * and `QUEUED`, neither of which this enum has, and misses `PROCESSING`,
 * which it does).
 */
export function isImportInFlight(status: BulkUploadStatus): boolean {
  switch (status) {
    case BulkUploadStatus.PENDING:
    case BulkUploadStatus.PROCESSING:
      return true;
    case BulkUploadStatus.COMPLETED:
    case BulkUploadStatus.COMPLETED_WITH_ERRORS:
    case BulkUploadStatus.FAILED:
    case BulkUploadStatus.CANCELLED:
      return false;
  }
}

/** Every import this seller has ever sent, newest first. */
export function useCsvImports(page: number, pageSize: number): UseQueryResult<CsvImportPage> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...CSV_IMPORTS_KEY, 'page', page, pageSize],
    queryFn: () =>
      client.request<CsvImportPage>(`/api/seller/csv-imports?page=${page}&pageSize=${pageSize}`),
    refetchInterval: (q) =>
      (q.state.data?.items ?? []).some((i) => isImportInFlight(i.status)) ? POLL_MS : false,
  });
}

/**
 * One import.
 *
 * An id belonging to another seller is a 404, not a 403 — `getUpload`
 * scopes the lookup by sellerId — so a wrong id and a foreign one get
 * the same `UPLOAD_NOT_FOUND` treatment, and the page shows the server's
 * words either way.
 */
export function useCsvImport(id: string): UseQueryResult<CsvImportView> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...CSV_IMPORTS_KEY, 'detail', id],
    queryFn: () => client.request<CsvImportView>(`/api/seller/csv-imports/${id}`),
    refetchInterval: (q) => {
      const data = q.state.data;
      return data !== undefined && isImportInFlight(data.status) ? POLL_MS : false;
    },
  });
}

/**
 * Download the error-report CSV for a partially-failed import.
 *
 * Goes through the ApiClient rather than a bare `fetch`, because
 * `SellerJwtGuard` reads the Authorization header and nothing else — a
 * cookie-credentialed fetch is a 401 no matter how the browser is
 * logged in. The response is `text/csv`, and the client's JSON parse
 * falls back to the raw text, so the body arrives as the CSV itself.
 */
export function useErrorReportDownload(): UseMutationResult<
  void,
  Error,
  { id: string; fileName: string }
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: async ({ id, fileName }): Promise<void> => {
      const body = await client.request<unknown>(`/api/seller/csv-imports/${id}/error-report`);
      if (typeof body !== 'string') {
        throw new Error('The error report came back in a shape we could not save.');
      }
      const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName.replace(/\.csv$/i, '')}-errors.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  });
}
