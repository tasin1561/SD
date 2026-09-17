'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { OrderStatus } from '@skydrop/db';
import type { ResellerOrderMoneyView } from '@skydrop/api-client';
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
  /** Which tasks the order's stage leaves room for. Cosmetic — the server still decides. */
  readonly stages: {
    readonly cancel: boolean;
    readonly deliveryActions: boolean;
    readonly addressCorrection: boolean;
  };
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
  readonly description: string | null;
  readonly subscribedEvents: readonly string[];
  readonly isActive: boolean;
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
  readonly consecutiveFailureCount: number;
  readonly autoDisabledAt: string | null;
  readonly autoDisabledReason: string | null;
  readonly createdAt: string;
}

/** One event code the outbound dispatcher can send, with what it means. */
export interface StoreWebhookEvent {
  readonly code: string;
  readonly description: string;
}

export interface UpdateStoreWebhookInput {
  readonly id: string;
  readonly url?: string;
  readonly name?: string;
  readonly description?: string;
  readonly subscribedEvents?: readonly string[];
  readonly isActive?: boolean;
}

/**
 * Exported because more than one file now writes something that changes
 * an order: the call-cap answer (`review-hooks`) rejects the order or
 * puts it back in the call queue, so it has to be able to say "the
 * orders you are holding are stale" without restating the key here and
 * there. A restated key drifts, and a drifted key reads as a screen that
 * never updates.
 */
export const STORE_ORDERS_KEY = ['store-orders'] as const;
const ORDERS = STORE_ORDERS_KEY;
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

/**
 * RS-6 phase 3c — what this order earns the store and pays the seller,
 * and when. The server answers with the store's own wallet lines only.
 */
export function useStoreOrderMoney(id: string): UseQueryResult<ResellerOrderMoneyView> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...ORDERS, 'money', id],
    queryFn: () => client.request<ResellerOrderMoneyView>(`/api/store/orders/${id}/money`),
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

/**
 * What came of a cancel (2026-09-17): cancelled now, or sent to Seller
 * staff because the seller approves this store's cancels first. The REPLY
 * says which — never the policy read when the page loaded.
 */
export type StoreCancelOutcome =
  | { readonly applied: true; readonly order: StoreOrderView; readonly request: null }
  | { readonly applied: false; readonly order: null; readonly request: StoreOrderRequestView };

export function useCancelStoreOrder(): UseMutationResult<
  StoreCancelOutcome,
  Error,
  { readonly id: string; readonly note?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }) =>
      client.request<StoreCancelOutcome>(`/api/store/orders/${id}/cancel`, {
        method: 'POST',
        body: note === undefined || note === '' ? {} : { note },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ORDERS }),
  });
}

/** 2026-09-16 — what this store may ask for about a live order. */
export type StoreActionMode = 'OFF' | 'ASK_SELLER' | 'DIRECT';

/** The seven capabilities the seller sets for this store. */
export type StoreActionCapability =
  | 'recall'
  | 'addressFix'
  | 'cancel'
  | 'callCapDecision'
  | 'chaseSkydrop'
  | 'reattempt'
  | 'sendBack';

export type StoreActionPolicy = Readonly<Record<StoreActionCapability, StoreActionMode>>;

/**
 * 2026-09-17 — what the seller lets this store do about its orders, and
 * how, for all seven capabilities. Read to decide what to OFFER — hidden
 * when OFF, "ask the seller" when held, direct otherwise. Cosmetic (FE-2):
 * every action still refuses by name on the server.
 */
export function useStoreActionPolicy(
  options: { readonly enabled?: boolean } = {},
): UseQueryResult<StoreActionPolicy> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['store-action-policy'],
    queryFn: () => client.request<StoreActionPolicy>('/api/store/action-policy'),
    enabled: options.enabled ?? true,
  });
}

/**
 * 2026-09-17 — a cancel, a call-cap answer or an issue for Skydrop this
 * store sent Seller staff to approve, and what became of it.
 */
export interface StoreOrderRequestView {
  readonly id: string;
  readonly orderId: string;
  readonly kind: 'CANCEL' | 'CALL_CAP_DECISION' | 'RAISE_ISSUE';
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED' | 'EXPIRED';
  readonly label: string;
  readonly note: string | null;
  readonly issueSubject: string | null;
  readonly decisionNote: string | null;
  readonly executedAt: string | null;
  readonly executionRef: string | null;
  readonly failureReason: string | null;
  readonly expiredAt: string | null;
  readonly createdAt: string;
}

export function useStoreOrderRequests(
  orderId: string,
): UseQueryResult<readonly StoreOrderRequestView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...ORDERS, 'requests', orderId],
    queryFn: () =>
      client.request<readonly StoreOrderRequestView[]>(`/api/store/orders/${orderId}/requests`),
    enabled: orderId !== '',
  });
}
export type StoreActionKind = 'RECALL' | 'REATTEMPT' | 'RTO';

export interface StoreActionRequest {
  readonly id: string;
  readonly action: StoreActionKind;
  readonly reason: string;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED' | 'EXPIRED';
  readonly decisionNote: string | null;
  readonly decidedAt: string | null;
  readonly executedAt: string | null;
  readonly executionError: string | null;
  readonly createdAt: string;
}

export interface StoreOrderActions {
  readonly items: readonly StoreActionRequest[];
  /** The seller's policy for this store, per capability. */
  readonly allowed: Readonly<Record<string, StoreActionMode>>;
}

export function useStoreOrderActions(orderId: string): UseQueryResult<StoreOrderActions> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...ORDERS, 'actions', orderId],
    queryFn: () => client.request<StoreOrderActions>(`/api/store/orders/${orderId}/actions`),
    enabled: orderId !== '',
  });
}

export function useRequestStoreAction(): UseMutationResult<
  { readonly request: StoreActionRequest; readonly awaitingSeller: boolean },
  Error,
  { readonly orderId: string; readonly action: StoreActionKind; readonly reason: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, action, reason }) =>
      client.request<{ request: StoreActionRequest; awaitingSeller: boolean }>(
        `/api/store/orders/${orderId}/actions`,
        { method: 'POST', body: { action, reason } },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ORDERS }),
  });
}

/**
 * 2026-09-16 — correcting where this store's own parcel is going.
 *
 * WHAT a correction does is the seller's `addressFix` policy, and the
 * SERVER decides it, not this file: DIRECT writes the new details onto
 * the order there and then, ASK_SELLER holds them until seller staff
 * answer, OFF refuses by name. Which of the two happened is the
 * `applied` flag on the reply — never inferred here from the mode we
 * happened to read when the page loaded, because seller staff may have
 * changed it since.
 */
export type AddressField =
  | 'recipientName'
  | 'recipientPhoneE164'
  | 'recipientAltPhoneE164'
  | 'recipientEmail'
  | 'recipientAddressLine1'
  | 'recipientAddressLine2'
  | 'recipientLandmark'
  | 'recipientCity'
  | 'recipientStateProvince'
  | 'recipientPostalCode';

/** Only the fields a correction proposes — never the whole block. */
export type AddressChangeFields = Partial<Record<AddressField, string>>;

export interface AddressChangeRequestView {
  readonly id: string;
  readonly orderId: string;
  readonly status:
    | 'PENDING'
    | 'APPROVED'
    | 'REJECTED'
    | 'APPLIED'
    | 'FAILED'
    | 'EXPIRED'
    | 'SUPERSEDED';
  readonly reason: string;
  readonly fields: AddressChangeFields;
  /** What seller staff said when they answered. */
  readonly decisionNote: string | null;
  readonly sellerDecidedAt: string | null;
  readonly appliedAt: string | null;
  /** Why an approved correction could not be written onto the order. */
  readonly failureReason: string | null;
  readonly createdAt: string;
}

export interface StoreAddressChanges {
  readonly items: readonly AddressChangeRequestView[];
  /** The seller's `addressFix` policy for this store, as it stands now. */
  readonly mode: StoreActionMode;
}

/** What this store has asked to correct on one of its own orders. */
export function useStoreAddressChanges(orderId: string): UseQueryResult<StoreAddressChanges> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...ORDERS, 'address-changes', orderId],
    queryFn: () =>
      client.request<StoreAddressChanges>(`/api/store/orders/${orderId}/address-changes`),
    enabled: orderId !== '',
  });
}

/**
 * The reply to a correction, and both halves matter to whoever is
 * watching: `applied: true` carries the order as it now reads;
 * `applied: false` carries the held request, and means the parcel is
 * STILL going to the old address.
 */
export type EditStoreRecipientResult =
  | { readonly applied: true; readonly order: StoreOrderView; readonly request: null }
  | { readonly applied: false; readonly order: null; readonly request: AddressChangeRequestView };

export function useEditStoreRecipient(): UseMutationResult<
  EditStoreRecipientResult,
  Error,
  {
    readonly orderId: string;
    /** Only what actually changed — the rest of the block is left alone. */
    readonly fields: AddressChangeFields;
    /** Required when the seller set corrections to “ask me first”. */
    readonly reason?: string;
  }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, fields, reason }) =>
      client.request<EditStoreRecipientResult>(`/api/store/orders/${orderId}/recipient`, {
        method: 'PATCH',
        body: { ...fields, ...(reason === undefined || reason === '' ? {} : { reason }) },
      }),
    // The order itself may have changed (DIRECT) or not (held), and the
    // history behind it has either way — one key covers both.
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

export function useStoreCustomer(id: string): UseQueryResult<StoreCustomer> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...CUSTOMERS, 'detail', id],
    queryFn: () => client.request<StoreCustomer>(`/api/store/customers/${id}`),
    enabled: id !== '',
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
  { readonly name: string; readonly expiresInDays?: number }
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
  {
    readonly url: string;
    readonly name?: string;
    readonly description?: string;
    readonly subscribedEvents: readonly string[];
  }
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

/** The event codes a webhook may subscribe to — the API refuses any other. */
export function useStoreWebhookEvents(): UseQueryResult<readonly StoreWebhookEvent[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...WEBHOOKS, 'events'],
    queryFn: () =>
      client.request<readonly StoreWebhookEvent[]>('/api/store/webhook-endpoints/events'),
    staleTime: 60 * 60 * 1000,
  });
}

/** Change an endpoint's URL, name, events — or switch it back on after failures. */
export function useUpdateStoreWebhook(): UseMutationResult<
  StoreWebhook,
  Error,
  UpdateStoreWebhookInput
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) =>
      client.request<StoreWebhook>(`/api/store/webhook-endpoints/${id}`, {
        method: 'PATCH',
        body,
      }),
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
