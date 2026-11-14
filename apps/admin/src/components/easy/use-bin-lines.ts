'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import type { BinContentsPage } from '@/lib/bin-contents-hooks';

/**
 * What is on one shelf, for the batch list on the stock forms. The same
 * read the bin page makes (`GET /admin/bin-contents/:binId`), asked only
 * once a shelf is chosen. A typed id that is not a shelf simply fails, and
 * the form then shows its typed batch field, so there is no retry.
 */
export function useBinLines(binId: string, enabled: boolean): UseQueryResult<BinContentsPage> {
  const client = useApiClient();
  return useQuery({
    enabled: enabled && binId !== '',
    queryKey: ['admin-warehouses', 'bin-contents', binId, 1, 100],
    staleTime: 30_000,
    retry: false,
    queryFn: () =>
      client.request<BinContentsPage>(`/api/admin/bin-contents/${binId}?page=1&pageSize=100`),
  });
}
