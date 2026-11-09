'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import type { AddressCheckResult } from '@skydrop/ui/app/address-check';

/**
 * Staff's READ-ONLY view of the stored address check for an order.
 * A 404 means "this order has no check" — normal, so it resolves to
 * `null` rather than an error, and is never retried.
 */
export function useOrderAddressCheck(orderId: string): UseQueryResult<AddressCheckResult | null> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin', 'address-check', orderId],
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
