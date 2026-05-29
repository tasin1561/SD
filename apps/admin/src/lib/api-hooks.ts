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
  AdminCancelOrderRequest,
  ApiClient,
  ComputeOrderChargesResponse,
  ForceMutationRequest,
  ForceMutationResult,
  ListOrdersQuery,
  OrderChargeView,
  ListSellersQuery,
  OrderListResponse,
  OrderView,
  ReleaseReservationsRequest,
  ReleaseReservationsResult,
  SellerInvitationListItem,
  SellerListResponse,
  SystemSettingFull,
  SystemSettingsCategoryGroup,
  TransitionStatusResult,
  UpdateSellerStatusRequest,
  UpdateSellerStatusResponse,
  UpdateSystemSettingRequest,
} from '@skydrop/api-client';

/**
 * Thin TanStack Query wrappers over `ApiClient.request<T>(path)`.
 * Keep the api-client itself feature-agnostic (FE-5); endpoint
 * knowledge lives at the consuming-app boundary.
 *
 * Query-key convention: `[domain, op, ...args]`. Mutations invalidate
 * the appropriate domain prefix on success.
 */

// ───────── Admin sellers / invitations ─────────

export function useSellersList(
  query: ListSellersQuery,
): UseQueryResult<SellerListResponse> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-sellers', 'list', query],
    queryFn: () => fetchSellers(client, query),
  });
}

async function fetchSellers(
  client: ApiClient,
  query: ListSellersQuery,
): Promise<SellerListResponse> {
  const sp = new URLSearchParams();
  if (query.status) sp.set('status', query.status);
  if (query.search) sp.set('search', query.search);
  if (query.page) sp.set('page', String(query.page));
  if (query.pageSize) sp.set('pageSize', String(query.pageSize));
  const qs = sp.toString();
  return client.request<SellerListResponse>(
    `/api/admin/sellers${qs ? `?${qs}` : ''}`,
  );
}

// The detail payload type from /admin/sellers/:id is broad (includes
// addresses + recent audit + notes + onboarding); types live with the
// server. For now we use `unknown` and let the page narrow what it
// renders — the M12 docs commit will tighten this in line with the
// actual API shape via a `SellerDetailView` shared type when warranted.
export interface SellerDetailLite {
  readonly id: string;
  readonly email: string;
  readonly emailDisplay: string;
  readonly companyName: string;
  readonly contactPersonName: string;
  readonly phone: string;
  readonly whatsapp: string | null;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  readonly approvedAt: string | null;
  readonly displayCurrency: string;
  readonly displayLanguage: string;
  readonly countryCode: string;
  readonly emailVerifiedAt: string | null;
  readonly createdAt: string;
}

export function useSellerDetail(id: string): UseQueryResult<SellerDetailLite> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-sellers', 'detail', id],
    queryFn: () => client.request<SellerDetailLite>(`/api/admin/sellers/${id}`),
    enabled: Boolean(id),
  });
}

export function useUpdateSellerStatus(
  sellerId: string,
): UseMutationResult<UpdateSellerStatusResponse, Error, UpdateSellerStatusRequest> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<UpdateSellerStatusResponse>(
        `/api/admin/sellers/${sellerId}/status`,
        { method: 'PATCH', body },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-sellers'] });
    },
  });
}

export function useInvitationsList(): UseQueryResult<{
  readonly items: readonly SellerInvitationListItem[];
  readonly total: number;
}> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-invitations', 'list'],
    queryFn: () =>
      client.request<{
        items: SellerInvitationListItem[];
        total: number;
      }>(`/api/admin/seller-invitations`),
  });
}

export function useCreateInvitation(): UseMutationResult<
  SellerInvitationListItem,
  Error,
  { email: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<SellerInvitationListItem>(`/api/admin/seller-invitations`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-invitations'] });
    },
  });
}

export function useResendInvitation(): UseMutationResult<
  SellerInvitationListItem,
  Error,
  { id: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<SellerInvitationListItem>(
        `/api/admin/seller-invitations/${id}/resend`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-invitations'] });
    },
  });
}

export function useDeleteInvitation(): UseMutationResult<void, Error, { id: string }> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<void>(`/api/admin/seller-invitations/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-invitations'] });
    },
  });
}

// ───────── Admin orders ─────────

export function useOrdersList(query: ListOrdersQuery): UseQueryResult<OrderListResponse> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-orders', 'list', query],
    queryFn: () => fetchOrders(client, query),
  });
}

async function fetchOrders(
  client: ApiClient,
  query: ListOrdersQuery,
): Promise<OrderListResponse> {
  const sp = new URLSearchParams();
  if (query.status) sp.set('status', query.status);
  if (query.source) sp.set('source', query.source);
  if (query.search) sp.set('search', query.search);
  if (query.sellerId) sp.set('sellerId', query.sellerId);
  if (query.page) sp.set('page', String(query.page));
  if (query.pageSize) sp.set('pageSize', String(query.pageSize));
  const qs = sp.toString();
  return client.request<OrderListResponse>(`/api/admin/orders${qs ? `?${qs}` : ''}`);
}

export function useOrderDetail(id: string): UseQueryResult<OrderView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-orders', 'detail', id],
    queryFn: () => client.request<OrderView>(`/api/admin/orders/${id}`),
    enabled: Boolean(id),
  });
}

export function useCancelOrder(
  orderId: string,
): UseMutationResult<TransitionStatusResult, Error, AdminCancelOrderRequest> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<TransitionStatusResult>(`/api/admin/orders/${orderId}/cancel`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
    },
  });
}

export function useForceMutation(
  orderId: string,
): UseMutationResult<ForceMutationResult, Error, ForceMutationRequest> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<ForceMutationResult>(`/api/admin/orders/${orderId}/force-mutation`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
    },
  });
}

export function useReleaseReservations(
  orderId: string,
): UseMutationResult<ReleaseReservationsResult, Error, ReleaseReservationsRequest> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<ReleaseReservationsResult>(
        `/api/admin/orders/${orderId}/release-reservations`,
        { method: 'POST', body },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
    },
  });
}

// ───────── Admin system settings (Module 14) ─────────

export function useSystemSettingsList(): UseQueryResult<
  readonly SystemSettingsCategoryGroup[]
> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-system-settings', 'list'],
    queryFn: () =>
      client.request<readonly SystemSettingsCategoryGroup[]>(
        '/api/admin/system-settings',
      ),
  });
}

export function useSystemSetting(key: string): UseQueryResult<SystemSettingFull> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-system-settings', 'detail', key],
    queryFn: () =>
      client.request<SystemSettingFull>(
        `/api/admin/system-settings/${encodeURIComponent(key)}`,
      ),
    enabled: Boolean(key),
  });
}

export function useUpdateSystemSetting(
  key: string,
): UseMutationResult<SystemSettingFull, Error, UpdateSystemSettingRequest> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<SystemSettingFull>(
        `/api/admin/system-settings/${encodeURIComponent(key)}`,
        { method: 'PATCH', body },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-system-settings'] });
    },
  });
}

// ───────── Admin order charges (Module 17) ─────────

export function useOrderCharges(
  orderId: string,
): UseQueryResult<readonly OrderChargeView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-order-charges', orderId],
    queryFn: () =>
      client.request<readonly OrderChargeView[]>(
        `/api/admin/orders/${orderId}/charges`,
      ),
    enabled: Boolean(orderId),
  });
}

export function useComputeOrderCharges(
  orderId: string,
): UseMutationResult<ComputeOrderChargesResponse, Error, void> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      client.request<ComputeOrderChargesResponse>(
        `/api/admin/orders/${orderId}/charges/compute`,
        { method: 'POST', body: {} },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-order-charges', orderId] });
    },
  });
}
