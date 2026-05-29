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
  ListSellerProductsQuery,
  OrderListResponse,
  OrderView,
  PresignVariantImageRequest,
  PresignVariantImageResponse,
  RegisterVariantImageRequest,
  SellerOrderEventView,
  SellerProductListResponse,
  SellerProductView,
  SellerVariantImageView,
  SellerVariantView,
  UpdateSellerProductRequest,
  UpdateSellerVariantRequest,
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

// ───────── Seller catalog (products + variants + images) ─────────

export function useProductsList(
  query: ListSellerProductsQuery,
): UseQueryResult<SellerProductListResponse> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-catalog', 'products', 'list', query],
    queryFn: () => fetchProducts(client, query),
  });
}

async function fetchProducts(
  client: ApiClient,
  query: ListSellerProductsQuery,
): Promise<SellerProductListResponse> {
  const sp = new URLSearchParams();
  if (query.status) sp.set('status', query.status);
  if (query.categoryId) sp.set('categoryId', query.categoryId);
  if (query.search) sp.set('search', query.search);
  if (query.page) sp.set('page', String(query.page));
  if (query.pageSize) sp.set('pageSize', String(query.pageSize));
  const qs = sp.toString();
  return client.request<SellerProductListResponse>(
    `/api/seller/products${qs ? `?${qs}` : ''}`,
  );
}

export function useProductDetail(id: string): UseQueryResult<SellerProductView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-catalog', 'products', 'detail', id],
    queryFn: () => client.request<SellerProductView>(`/api/seller/products/${id}`),
    enabled: Boolean(id),
  });
}

export function useUpdateProduct(
  productId: string,
): UseMutationResult<SellerProductView, Error, UpdateSellerProductRequest> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<SellerProductView>(`/api/seller/products/${productId}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-catalog'] });
    },
  });
}

export function useProductVariants(
  productId: string,
): UseQueryResult<readonly SellerVariantView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-catalog', 'variants', 'list', productId],
    queryFn: () =>
      client.request<readonly SellerVariantView[]>(
        `/api/seller/products/${productId}/variants`,
      ),
    enabled: Boolean(productId),
  });
}

export function useVariantDetail(
  productId: string,
  variantId: string,
): UseQueryResult<SellerVariantView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-catalog', 'variants', 'detail', productId, variantId],
    queryFn: () =>
      client.request<SellerVariantView>(
        `/api/seller/products/${productId}/variants/${variantId}`,
      ),
    enabled: Boolean(productId && variantId),
  });
}

export function useUpdateVariant(
  productId: string,
  variantId: string,
): UseMutationResult<SellerVariantView, Error, UpdateSellerVariantRequest> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<SellerVariantView>(
        `/api/seller/products/${productId}/variants/${variantId}`,
        { method: 'PATCH', body },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-catalog'] });
    },
  });
}

// ── Images ──

export function useVariantImages(
  variantId: string,
): UseQueryResult<readonly SellerVariantImageView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-catalog', 'images', 'list', variantId],
    queryFn: () =>
      client.request<readonly SellerVariantImageView[]>(
        `/api/seller/images?variantId=${variantId}`,
      ),
    enabled: Boolean(variantId),
  });
}

export function usePresignImage(): UseMutationResult<
  PresignVariantImageResponse,
  Error,
  PresignVariantImageRequest
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<PresignVariantImageResponse>(`/api/seller/images/presign`, {
        method: 'POST',
        body,
      }),
  });
}

export function useRegisterImage(): UseMutationResult<
  SellerVariantImageView,
  Error,
  RegisterVariantImageRequest
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<SellerVariantImageView>(`/api/seller/images`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-catalog', 'images'] });
    },
  });
}

export function useDeleteImage(): UseMutationResult<void, Error, string> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (imageId) =>
      client.request<void>(`/api/seller/images/${imageId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-catalog', 'images'] });
    },
  });
}
