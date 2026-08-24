'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';

export interface ActiveRestrictionView {
  readonly id: string;
  readonly blockedCapabilities: readonly string[];
  readonly clearAtBalanceInr: string;
  readonly balanceInr: string;
  readonly shortfallInr: string;
  readonly reason: string;
  readonly createdAt: string;
}

export function useSellerRestriction(
  sellerId: string,
): UseQueryResult<ActiveRestrictionView | null> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-seller-restriction', sellerId],
    queryFn: () =>
      client.request<ActiveRestrictionView | null>(`/api/admin/sellers/${sellerId}/restriction`),
  });
}

export function useApplyRestriction(
  sellerId: string,
): UseMutationResult<
  { id: string },
  Error,
  { capabilities: string[]; clearAtBalanceInr: string; reason: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<{ id: string }>(`/api/admin/sellers/${sellerId}/restriction`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-seller-restriction', sellerId] });
    },
  });
}

export function useLiftRestriction(
  sellerId: string,
): UseMutationResult<{ lifted: true }, Error, { restrictionId: string; reason: string }> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ restrictionId, reason }) =>
      client.request<{ lifted: true }>(
        `/api/admin/sellers/${sellerId}/restriction/${restrictionId}/lift`,
        { method: 'POST', body: { reason } },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-seller-restriction', sellerId] });
    },
  });
}
