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
  ApiClient,
  ListSellerOrdersQuery,
  OrderListResponse,
  OrderView,
  SellerOrderEventView,
} from '@skydrop/api-client';

/**
 * Seller-side TanStack Query wrappers — mirror apps/admin/src/lib/api-hooks
 * with seller endpoints. Query-key convention: `[domain, op, ...args]`;
 * mutations invalidate the appropriate domain prefix.
 *
 * The api-client itself stays feature-agnostic (FE-5); endpoint
 * knowledge lives at the consuming-app boundary.
 */

// ───────── Seller orders ─────────

export function useOrdersList(
  query: ListSellerOrdersQuery,
): UseQueryResult<OrderListResponse> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-orders', 'list', query],
    queryFn: () => fetchOrders(client, query),
  });
}

async function fetchOrders(
  client: ApiClient,
  query: ListSellerOrdersQuery,
): Promise<OrderListResponse> {
  const sp = new URLSearchParams();
  if (query.status) sp.set('status', query.status);
  if (query.search) sp.set('search', query.search);
  if (query.page) sp.set('page', String(query.page));
  if (query.pageSize) sp.set('pageSize', String(query.pageSize));
  const qs = sp.toString();
  return client.request<OrderListResponse>(
    `/api/seller/orders${qs ? `?${qs}` : ''}`,
  );
}

export function useOrderDetail(id: string): UseQueryResult<OrderView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-orders', 'detail', id],
    queryFn: () => client.request<OrderView>(`/api/seller/orders/${id}`),
    enabled: Boolean(id),
  });
}

export function useOrderEvents(
  id: string,
): UseQueryResult<readonly SellerOrderEventView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-orders', 'events', id],
    queryFn: () =>
      client.request<readonly SellerOrderEventView[]>(
        `/api/seller/orders/${id}/events`,
      ),
    enabled: Boolean(id),
  });
}

/** Pre-reservation cancel (DRAFT / PENDING_CONFIRMATION). The server
 *  matrix enforces the allowed source states; the UI surfaces server
 *  rejection verbatim (FE-2). */
export function useCancelOrder(
  orderId: string,
): UseMutationResult<OrderView, Error, { cancellationReason?: string; note?: string }> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<OrderView>(`/api/seller/orders/${orderId}/cancel`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-orders'] });
    },
  });
}
