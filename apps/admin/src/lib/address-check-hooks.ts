'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import type { AddressCheckResult } from '@skydrop/ui/app/address-check';

/** One place, so the re-check can put its answer straight into the read. */
const storedKey = (orderId: string): readonly unknown[] => ['admin', 'address-check', orderId];

/**
 * Staff's READ-ONLY view of the stored address check for an order.
 * A 404 means "this order has no check" — normal, so it resolves to
 * `null` rather than an error, and is never retried.
 */
export function useOrderAddressCheck(orderId: string): UseQueryResult<AddressCheckResult | null> {
  const client = useApiClient();
  return useQuery({
    queryKey: storedKey(orderId),
    retry: false,
    queryFn: async (): Promise<AddressCheckResult | null> => {
      try {
        return await client.request<AddressCheckResult>(
          `/api/admin/orders/${orderId}/address-check`,
        );
      } catch (e) {
        if ((e as { status?: number } | null)?.status === 404) return null;
        throw e;
      }
    },
  });
}

/**
 * Ask again about an address that was just EDITED, and replace the
 * stored verdict with the answer.
 *
 * Only ever called AFTER the edit has been saved, so a failure here
 * costs the verdict and nothing else: the answer goes straight into the
 * read's cache on success, and on failure the caller shows the server's
 * own words and re-reads the row (which the server has by then marked
 * unavailable, because a score about the address before the edit must
 * not keep standing).
 */
export function useRecheckOrderAddress(): UseMutationResult<
  AddressCheckResult,
  Error,
  { orderId: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId }) =>
      client.request<AddressCheckResult>(`/api/admin/orders/${orderId}/address-check/recheck`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: (data, { orderId }) => {
      queryClient.setQueryData(storedKey(orderId), data);
    },
  });
}
