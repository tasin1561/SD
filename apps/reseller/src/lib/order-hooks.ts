'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { OrderStatus } from '@skydrop/db';
import { useApiClient } from '@skydrop/auth/client';

/**
 * RS-5 — the store's orders, customers and integrations. Every path is
 * the store's OWN surface (`/api/store/*`, scoped server-side by the
 * token), so no store id appears in any URL here, by construction.
 */

export interface StoreOrderListItem {
  readonly id: string;
  readonly orderNumber: string;
  readonly sellerOrderRef: string | null;
  readonly status: OrderStatus;
  readonly source: string;
  readonly placedAt: string;
  readonly recipientName: string;
  readonly recipientPhoneE164: string;
  readonly recipientCity: string;
  readonly recipientPostalCode: string;
  readonly paymentMode: 'COD' | 'PREPAID';
  readonly codAmountInr: string | null;
  readonly itemCount: number;
}

export interface StoreOrderLine {
  readonly id: string;
  readonly variantId: string;
  readonly skuCode: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly imageUrl: string | null;
  readonly quantity: number;
  readonly transferPriceInr: string | null;
  readonly retailUnitInr: string | null;
  readonly minRetailInr: string | null;
  readonly maxRetailInr: string | null;
  readonly stockMode: 'SHARED' | 'SET_ASIDE' | null;
}

export interface StoreOrderView {
  readonly id: string;
  readonly orderNumber: string;
  readonly sellerOrderRef: string | null;
  readonly status: OrderStatus;
  readonly terminal: boolean;
  readonly source: string;
  readonly placedAt: string;
  readonly confirmedAt: string | null;
  readonly cancelledAt: string | null;
  readonly recipient: {
    readonly name: string;
    readonly phoneE164: string;
    readonly altPhoneE164: string | null;
    readonly email: string | null;
    readonly addressLine1: string;
    readonly addressLine2: string | null;
    readonly landmark: string | null;
    readonly city: string;
    readonly stateProvince: string;
    readonly postalCode: string;
  };
  readonly paymentMode: 'COD' | 'PREPAID';
  readonly codAmountInr: string | null;
  readonly advanceAmountInr: string | null;
  readonly deliveryFeeInr: string | null;
  readonly discountInr: string | null;
  readonly notes: string | null;
  readonly termsVersion: number | null;
  readonly lines: readonly StoreOrderLine[];
  readonly totals: { readonly retailInr: string; readonly transferInr: string };
  readonly shipments: ReadonlyArray<{
    readonly awbNumber: string | null;
    readonly courierCode: string;
    readonly status: string;
  }>;
}

export interface StoreOrderEvent {
  readonly id: string;
  readonly type: string;
  readonly fromStatus: OrderStatus | null;
  readonly toStatus: OrderStatus | null;
  readonly description: string | null;
  readonly createdAt: string;
}

export interface Paged<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface StoreOrdersQuery {
  readonly status?: OrderStatus;
  readonly search?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface CreateStoreOrderInput {
  readonly sellerOrderRef?: string;
  readonly recipientName: string;
  readonly recipientPhoneE164: string;
  readonly recipientAltPhoneE164?: string;
  readonly recipientEmail?: string;
  readonly recipientAddressLine1: string;
  readonly recipientAddressLine2: string;
  readonly recipientCity?: string;
  readonly recipientStateProvince?: string;
  readonly recipientPostalCode: string;
  readonly paymentMode: 'COD';
  readonly codAmountInr?: number;
  readonly deliveryFeeInr?: number;
  readonly discountInr?: number;
  readonly advanceAmountInr?: number;
  readonly notes?: string;
  readonly acknowledgeDuplicate?: boolean;
  readonly items: ReadonlyArray<{
    readonly variantId: string;
    readonly quantity: number;
    readonly retailUnitPriceInr: number;
  }>;
}

export interface StoreCustomer {
  readonly id: string;
  readonly phoneE164: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly altPhoneE164: string | null;
  readonly totalOrdersCount: number;
  readonly lastOrderAt: string | null;
  readonly createdAt: string;
}

export interface StoreApiKey {
  readonly id: string;
  readonly name: string;
  readonly keyPrefix: string;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

export interface StoreWebhook {
  readonly id: string;
  readonly url: string;
  readonly name: string | null;
  readonly subscribedEvents: readonly string[];
  readonly isActive: boolean;
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
  readonly consecutiveFailureCount: number;
  readonly autoDisabledAt: string | null;
  readonly createdAt: string;
}

const ORDERS = ['store-orders'] as const;
const CUSTOMERS = ['store-customers'] as const;
const KEYS = ['store-api-keys'] as const;
const WEBHOOKS = ['store-webhooks'] as const;

function qs(q: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s === '' ? '' : `?${s}`;
}

export function useStoreOrders(query: StoreOrdersQuery): UseQueryResult<Paged<StoreOrderListItem>> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...ORDERS, 'list', query],
    queryFn: () =>
      client.request<Paged<StoreOrderListItem>>(
        `/api/store/orders${qs({ status: query.status, search: query.search, page: query.page, pageSize: query.pageSize })}`,
      ),
  });
}

export function useStoreOrder(id: string): UseQueryResult<StoreOrderView> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...ORDERS, 'detail', id],
    queryFn: () => client.request<StoreOrderView>(`/api/store/orders/${id}`),
    enabled: id !== '',
  });
}

export function useStoreOrderEvents(id: string): UseQueryResult<readonly StoreOrderEvent[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...ORDERS, 'events', id],
    queryFn: () => client.request<readonly StoreOrderEvent[]>(`/api/store/orders/${id}/events`),
    enabled: id !== '',
  });
}

export function useCreateStoreOrder(): UseMutationResult<
  StoreOrderView,
  Error,
  CreateStoreOrderInput
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<StoreOrderView>('/api/store/orders', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ORDERS });
      void qc.invalidateQueries({ queryKey: ['store-catalogue'] });
    },
  });
}

export function useCancelStoreOrder(): UseMutationResult<
  StoreOrderView,
  Error,
  { readonly id: string; readonly note?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }) =>
      client.request<StoreOrderView>(`/api/store/orders/${id}/cancel`, {
        method: 'POST',
        body: note === undefined || note === '' ? {} : { note },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ORDERS }),
  });
}

export function useStoreCustomers(query: {
  readonly search?: string;
  readonly page?: number;
}): UseQueryResult<Paged<StoreCustomer>> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...CUSTOMERS, query],
    queryFn: () =>
      client.request<Paged<StoreCustomer>>(
        `/api/store/customers${qs({ search: query.search, page: query.page, pageSize: 20 })}`,
      ),
  });
}

export function useStoreApiKeys(): UseQueryResult<readonly StoreApiKey[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: KEYS,
    queryFn: () => client.request<readonly StoreApiKey[]>('/api/store/api-keys'),
  });
}

export function useCreateStoreApiKey(): UseMutationResult<
  StoreApiKey & { readonly plaintext: string },
  Error,
  { readonly name: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<StoreApiKey & { readonly plaintext: string }>('/api/store/api-keys', {
        method: 'POST',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEYS }),
  });
}

export function useRevokeStoreApiKey(): UseMutationResult<void, Error, { readonly id: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => client.request<void>(`/api/store/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEYS }),
  });
}

export function useStoreWebhooks(): UseQueryResult<readonly StoreWebhook[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: WEBHOOKS,
    queryFn: () => client.request<readonly StoreWebhook[]>('/api/store/webhook-endpoints'),
  });
}

export function useCreateStoreWebhook(): UseMutationResult<
  StoreWebhook & { readonly secretKey: string },
  Error,
  { readonly url: string; readonly name?: string; readonly subscribedEvents: readonly string[] }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<StoreWebhook & { readonly secretKey: string }>(
        '/api/store/webhook-endpoints',
        { method: 'POST', body },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: WEBHOOKS }),
  });
}

export function useRotateStoreWebhook(): UseMutationResult<
  StoreWebhook & { readonly secretKey: string },
  Error,
  { readonly id: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<StoreWebhook & { readonly secretKey: string }>(
        `/api/store/webhook-endpoints/${id}/rotate-secret`,
        { method: 'POST' },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: WEBHOOKS }),
  });
}

export function useDeleteStoreWebhook(): UseMutationResult<void, Error, { readonly id: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<void>(`/api/store/webhook-endpoints/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: WEBHOOKS }),
  });
}
