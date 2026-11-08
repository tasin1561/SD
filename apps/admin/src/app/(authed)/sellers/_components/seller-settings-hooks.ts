'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';

/**
 * The per-client settings mechanism (SET-1): list, override, clear. Shared
 * by the generic table and the phone-confirmation panel so there is ONE
 * way to write a client's override, not two.
 *
 * The attribution fields are optional: they say who last wrote the shared
 * override row (admin and client write the same one, last writer wins) and
 * when. A response without them renders as "not recorded", never guessed.
 */
export interface ResolvedSetting {
  key: string;
  valueType: string;
  value: unknown;
  source: 'SELLER_OVERRIDE' | 'SYSTEM_DEFAULT';
  systemDefault: unknown;
  /** When the override row was last written. Absent on a default. */
  updatedAt?: string | null;
  /** Staff member who last wrote it; null/absent when not a staff write. */
  setByStaffId?: string | null;
  /** Set when the client wrote it themselves. */
  setBySellerId?: string | null;
}

export function useSellerSettings(sellerId: string): UseQueryResult<readonly ResolvedSetting[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-seller-settings', sellerId],
    queryFn: () =>
      client.request<readonly ResolvedSetting[]>(`/api/admin/sellers/${sellerId}/settings`),
  });
}

export function useSetOverride(
  sellerId: string,
): UseMutationResult<
  unknown,
  Error,
  { key: string; valueType: string; value: unknown; note?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, ...body }) =>
      client.request<unknown>(`/api/admin/sellers/${sellerId}/settings/${key}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-seller-settings', sellerId] }),
  });
}

export function useClearOverride(
  sellerId: string,
): UseMutationResult<unknown, Error, { key: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key }) =>
      client.request<unknown>(`/api/admin/sellers/${sellerId}/settings/${key}`, {
        method: 'DELETE',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-seller-settings', sellerId] }),
  });
}
