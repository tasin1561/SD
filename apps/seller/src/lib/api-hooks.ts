'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseInfiniteQueryResult,
  type InfiniteData,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import type {
  ApiClient,
  ListSellerOrdersQuery,
  ListSellerProductsQuery,
  ListSellerStockQuery,
  OrderChargeView,
  OrderListResponse,
  OrderView,
  PresignVariantImageRequest,
  PresignVariantImageResponse,
  RegisterVariantImageRequest,
  SellerOrderEventView,
  SellerProductListResponse,
  SellerProductView,
  SellerStockListResponse,
  SellerStockSummary,
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

export function useOrdersList(query: ListSellerOrdersQuery): UseQueryResult<OrderListResponse> {
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
  return client.request<OrderListResponse>(`/api/seller/orders${qs ? `?${qs}` : ''}`);
}

export function useOrderDetail(id: string): UseQueryResult<OrderView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-orders', 'detail', id],
    queryFn: () => client.request<OrderView>(`/api/seller/orders/${id}`),
    enabled: Boolean(id),
  });
}

export function useOrderEvents(id: string): UseQueryResult<readonly SellerOrderEventView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-orders', 'events', id],
    queryFn: () =>
      client.request<readonly SellerOrderEventView[]>(`/api/seller/orders/${id}/events`),
    enabled: Boolean(id),
  });
}

export function useOrderCharges(id: string): UseQueryResult<readonly OrderChargeView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-orders', 'charges', id],
    queryFn: () => client.request<readonly OrderChargeView[]>(`/api/seller/orders/${id}/charges`),
    enabled: Boolean(id),
  });
}

/**
 * Manual order create — POST /seller/orders. Surface area mirrors the
 * server-side CreateOrderDto; the only thing the page assembles is a
 * single-line items array (a future multi-line UI hangs off the same
 * mutation).
 */
export interface CreateOrderItemInput {
  readonly variantId: string;
  readonly quantity: number;
  readonly unitPriceInr?: number;
}

export interface CreateOrderInput {
  readonly sellerOrderRef?: string;
  readonly recipientName: string;
  readonly recipientPhoneE164: string;
  readonly recipientAltPhoneE164?: string;
  readonly recipientEmail?: string;
  readonly recipientAddressLine1: string;
  readonly recipientAddressLine2?: string;
  readonly recipientLandmark?: string;
  readonly recipientCity: string;
  readonly recipientStateProvince: string;
  readonly recipientPostalCode: string;
  readonly recipientCountryCode?: string;
  readonly paymentMode: 'COD' | 'PREPAID';
  readonly codAmountInr?: number;
  readonly declaredValueInr?: number;
  readonly totalWeightGrams?: number;
  readonly preferredLanguage?: 'en' | 'hi';
  readonly sellerNotes?: string;
  readonly items: readonly CreateOrderItemInput[];
  /** Place it anyway despite an unpacked order to the same customer. */
  readonly acknowledgeDuplicate?: boolean;
}

/**
 * What we know about a phone number before shipping to it.
 *
 * The counts span every seller — refusal risk belongs to the CUSTOMER,
 * not to the seller-customer pair — while `yours` is only ever this
 * seller's. Nobody learns who else sells to this person.
 */
export interface CustomerReputation {
  readonly phoneE164: string;
  readonly platform: {
    readonly totalOrders: number;
    readonly delivered: number;
    readonly returned: number;
    readonly refusedOnCall: number;
    readonly returnRatePercent: string | null;
    readonly firstOrderAt: string | null;
    readonly lastOrderAt: string | null;
  };
  readonly yours: {
    readonly totalOrders: number;
    readonly delivered: number;
    readonly returned: number;
    readonly recentOrders: ReadonlyArray<CustomerOrderSummary>;
    readonly openOrders: ReadonlyArray<CustomerOrderSummary>;
  };
  readonly riskLevel: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';
  readonly riskNotes: string | null;
  readonly customerName: string | null;
}

export interface CustomerOrderSummary {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: string;
  readonly placedAt: string;
  readonly valueInr: string | null;
  readonly itemCount: number;
}

/**
 * Fires as the seller types, once the number is a complete E.164.
 *
 * `enabled` on that check rather than a debounce alone: a half-typed
 * number is not a miss, it is an incomplete question, and asking it
 * would render a confident "no history" for a customer who has one.
 */
export function useCustomerLookup(phoneE164: string): UseQueryResult<CustomerReputation> {
  const client = useApiClient();
  const complete = /^\+[1-9]\d{7,14}$/.test(phoneE164.trim());
  return useQuery({
    queryKey: ['seller-customer-lookup', phoneE164.trim()],
    enabled: complete,
    staleTime: 30_000,
    queryFn: () =>
      client.request<CustomerReputation>(
        `/api/seller/orders/customer-lookup?phoneE164=${encodeURIComponent(phoneE164.trim())}`,
      ),
  });
}

/**
 * CSV rows that could not import on their own — a queue, not a report.
 */
export interface StagedRowProblem {
  readonly field: string;
  readonly reason: string;
}

export interface StagedRow {
  readonly id: string;
  readonly uploadId: string;
  readonly rowNumber: number;
  readonly status: 'NEEDS_INPUT' | 'DUPLICATE_SUSPECTED' | 'IMPORTED' | 'DISCARDED';
  readonly data: Record<string, unknown>;
  readonly problems: ReadonlyArray<StagedRowProblem>;
  readonly duplicateOf: ReadonlyArray<CustomerOrderSummary> | null;
  readonly resolvedOrderId: string | null;
  readonly createdAt: string;
}

export function usePendingRows(): UseQueryResult<ReadonlyArray<StagedRow>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-orders-pending'],
    queryFn: () => client.request<ReadonlyArray<StagedRow>>('/api/seller/orders-pending'),
  });
}

export function usePatchPendingRow(): UseMutationResult<
  StagedRow,
  Error,
  { rowId: string; data: Record<string, unknown> }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rowId, data }) =>
      client.request<StagedRow>(`/api/seller/orders-pending/${rowId}`, {
        method: 'POST',
        body: { data },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seller-orders-pending'] }),
  });
}

export function useImportPendingRow(): UseMutationResult<{ orderId: string }, Error, string> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rowId) =>
      client.request<{ orderId: string }>(`/api/seller/orders-pending/${rowId}/import`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['seller-orders-pending'] });
      void qc.invalidateQueries({ queryKey: ['seller-orders'] });
    },
  });
}

export function useDiscardPendingRow(): UseMutationResult<StagedRow, Error, string> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rowId) =>
      client.request<StagedRow>(`/api/seller/orders-pending/${rowId}/discard`, {
        method: 'POST',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seller-orders-pending'] }),
  });
}

export function useCreateOrder(): UseMutationResult<OrderView, Error, CreateOrderInput> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<OrderView>(`/api/seller/orders`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-orders'] });
    },
  });
}

export function useSubmitOrder(): UseMutationResult<OrderView, Error, { id: string }> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<OrderView>(`/api/seller/orders/${id}/submit`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-orders'] });
    },
  });
}

/**
 * PATCH /seller/orders/:id — DRAFT full edit / PENDING_CONFIRMATION
 * corrections (see UpdateOrderDto on the server). Every field is
 * optional; only-provided keys are touched. `items` triggers a full
 * line-replace and is DRAFT-only (server enforces).
 */
export type UpdateOrderInput = Partial<CreateOrderInput> & {
  readonly internalNotes?: string;
  readonly packageType?: 'STANDARD' | 'FRAGILE' | 'DOCUMENT';
  readonly isUrgent?: boolean;
};

export function useUpdateOrder(
  orderId: string,
): UseMutationResult<OrderView, Error, UpdateOrderInput> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<OrderView>(`/api/seller/orders/${orderId}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-orders'] });
    },
  });
}

/** DELETE /seller/orders/:id — DRAFT-only soft-delete. */
export function useDiscardDraftOrder(orderId: string): UseMutationResult<void, Error, void> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await client.request<void>(`/api/seller/orders/${orderId}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-orders'] });
    },
  });
}

/** Call an order off. Allowed until the parcel is packed; the server's
 *  matrix is the authority on that and on giving back any delivery fee
 *  already taken, and its rejection is surfaced verbatim (FE-2). */
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
      // Prefix invalidation: ['seller-orders'] covers the list AND
      // ['seller-orders','detail',id].
      void queryClient.invalidateQueries({ queryKey: ['seller-orders'] });
      // The refund lands in the same moment — a stale balance beside a
      // cancelled order reads as the money not having come back.
      void queryClient.invalidateQueries({ queryKey: ['seller-wallet'] });
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
  if (query.search) sp.set('search', query.search);
  if (query.page) sp.set('page', String(query.page));
  if (query.pageSize) sp.set('pageSize', String(query.pageSize));
  const qs = sp.toString();
  return client.request<SellerProductListResponse>(`/api/seller/products${qs ? `?${qs}` : ''}`);
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
      client.request<readonly SellerVariantView[]>(`/api/seller/products/${productId}/variants`),
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
      client.request<SellerVariantView>(`/api/seller/products/${productId}/variants/${variantId}`),
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
      client.request<SellerVariantView>(`/api/seller/products/${productId}/variants/${variantId}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-catalog'] });
    },
  });
}

// ── Images ──
//
// These four hooks all pointed at `/api/seller/images*`, which does not
// exist — the controller is `seller/variants/:variantId/images`. Every
// call 404'd, so listing, uploading and deleting a variant image had
// never worked. The bodies were wrong too: `variantId`, `filename` and
// `contentType` are not fields the API accepts, and it runs
// `forbidNonWhitelisted`, so even against the right URL they were 400s.

export function useVariantImages(
  variantId: string,
): UseQueryResult<readonly SellerVariantImageView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-catalog', 'images', 'list', variantId],
    queryFn: () =>
      client.request<readonly SellerVariantImageView[]>(`/api/seller/variants/${variantId}/images`),
    enabled: Boolean(variantId),
  });
}

export function usePresignImage(): UseMutationResult<
  PresignVariantImageResponse,
  Error,
  { variantId: string; body: PresignVariantImageRequest }
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({ variantId, body }) =>
      client.request<PresignVariantImageResponse>(
        `/api/seller/variants/${variantId}/images/presign`,
        { method: 'POST', body },
      ),
  });
}

export function useRegisterImage(): UseMutationResult<
  SellerVariantImageView,
  Error,
  { variantId: string; body: RegisterVariantImageRequest }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ variantId, body }) =>
      client.request<SellerVariantImageView>(`/api/seller/variants/${variantId}/images`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-catalog', 'images'] });
    },
  });
}

export function useDeleteImage(): UseMutationResult<
  void,
  Error,
  { variantId: string; imageId: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ variantId, imageId }) =>
      client.request<void>(`/api/seller/variants/${variantId}/images/${imageId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-catalog', 'images'] });
    },
  });
}

// ───────── Seller stock (read-only, cross-warehouse aggregate) ─────────

export function useStockList(query: ListSellerStockQuery): UseQueryResult<SellerStockListResponse> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-stock', 'list', query],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (query.status) sp.set('status', query.status);
      if (query.page) sp.set('page', String(query.page));
      if (query.pageSize) sp.set('pageSize', String(query.pageSize));
      const qs = sp.toString();
      return client.request<SellerStockListResponse>(`/api/seller/stock${qs ? `?${qs}` : ''}`);
    },
  });
}

export function useStockSummary(): UseQueryResult<SellerStockSummary> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-stock', 'summary'],
    queryFn: () => client.request<SellerStockSummary>(`/api/seller/stock/summary`),
  });
}

// ───────── Seller webhooks (outbound) ─────────

import type {
  WebhookEndpointView,
  WebhookEndpointWithSecret,
  CreateWebhookEndpointRequest,
  UpdateWebhookEndpointRequest,
} from '@skydrop/api-client';

export function useWebhookEndpointsList(): UseQueryResult<ReadonlyArray<WebhookEndpointView>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-webhooks', 'list'],
    queryFn: () =>
      client.request<ReadonlyArray<WebhookEndpointView>>(`/api/seller/webhook-endpoints`),
  });
}

export function useWebhookEndpointDetail(id: string): UseQueryResult<WebhookEndpointView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-webhooks', 'detail', id],
    queryFn: () => client.request<WebhookEndpointView>(`/api/seller/webhook-endpoints/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateWebhookEndpoint(): UseMutationResult<
  WebhookEndpointWithSecret,
  Error,
  CreateWebhookEndpointRequest
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<WebhookEndpointWithSecret>(`/api/seller/webhook-endpoints`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-webhooks'] });
    },
  });
}

export function useUpdateWebhookEndpoint(
  id: string,
): UseMutationResult<WebhookEndpointView, Error, UpdateWebhookEndpointRequest> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<WebhookEndpointView>(`/api/seller/webhook-endpoints/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-webhooks'] });
    },
  });
}

export function useRotateWebhookSecret(
  id: string,
): UseMutationResult<WebhookEndpointWithSecret, Error, void> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      client.request<WebhookEndpointWithSecret>(
        `/api/seller/webhook-endpoints/${id}/rotate-secret`,
        { method: 'POST', body: {} },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-webhooks'] });
    },
  });
}

export function useDeleteWebhookEndpoint(): UseMutationResult<void, Error, string> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      await client.request<void>(`/api/seller/webhook-endpoints/${id}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-webhooks'] });
    },
  });
}

// ───────── Seller profile + bank details ─────────

import type {
  SellerProfileView,
  UpdateSellerBankDetailsRequest,
  UpdateSellerProfileRequest,
} from '@skydrop/api-client';

export function useSellerProfile(): UseQueryResult<SellerProfileView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-profile'],
    queryFn: () => client.request<SellerProfileView>('/api/seller/profile'),
  });
}

export function useUpdateSellerProfile(): UseMutationResult<
  SellerProfileView,
  Error,
  UpdateSellerProfileRequest
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<SellerProfileView>('/api/seller/profile', {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-profile'] });
    },
  });
}

export function useUpdateSellerBankDetails(): UseMutationResult<
  SellerProfileView,
  Error,
  UpdateSellerBankDetailsRequest
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<SellerProfileView>('/api/seller/profile/bank-details', {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-profile'] });
    },
  });
}

// ───────── Seller wallet (M21 ledger reads) ─────────

import type { WalletBalancesResponse, WalletEntriesPage } from '@skydrop/api-client';

export function useWalletBalances(): UseQueryResult<WalletBalancesResponse> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-wallet', 'balances'],
    queryFn: () => client.request<WalletBalancesResponse>('/api/seller/wallet'),
  });
}

export function useWalletEntries(currency?: 'INR' | 'BDT'): UseQueryResult<WalletEntriesPage> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-wallet', 'entries', currency ?? 'all'],
    queryFn: () =>
      client.request<WalletEntriesPage>(
        `/api/seller/wallet/entries${currency ? `?currency=${currency}` : ''}`,
      ),
  });
}

// ───────── Seller wallet — infinite-scroll variant (cursor-based) ─────────

export function useInfiniteWalletEntries(
  currency?: 'INR' | 'BDT',
): UseInfiniteQueryResult<InfiniteData<WalletEntriesPage>, Error> {
  const client = useApiClient();
  return useInfiniteQuery<
    WalletEntriesPage,
    Error,
    InfiniteData<WalletEntriesPage>,
    ReadonlyArray<unknown>,
    string | null
  >({
    queryKey: ['seller-wallet', 'entries-infinite', currency ?? 'all'],
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams();
      if (currency) sp.set('currency', currency);
      if (pageParam) sp.set('cursor', pageParam);
      const qs = sp.toString();
      return client.request<WalletEntriesPage>(`/api/seller/wallet/entries${qs ? `?${qs}` : ''}`);
    },
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

// ───────── Seller logo upload ─────────

import type {
  LogoView,
  PresignLogoRequest,
  PresignLogoResponse,
  RegisterLogoRequest,
} from '@skydrop/api-client';

export function usePresignLogo(): UseMutationResult<
  PresignLogoResponse,
  Error,
  PresignLogoRequest
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<PresignLogoResponse>('/api/seller/profile/logo/presign', {
        method: 'POST',
        body,
      }),
  });
}

export function useRegisterLogo(): UseMutationResult<LogoView, Error, RegisterLogoRequest> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<LogoView>('/api/seller/profile/logo/register', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-profile'] });
    },
  });
}

export function useRemoveLogo(): UseMutationResult<LogoView, Error, void> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      client.request<LogoView>('/api/seller/profile/logo', {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-profile'] });
    },
  });
}

// ───────── Seller invoices (Phase 1B GST PDF) ─────────

import type { SellerInvoiceView, GenerateInvoiceResponse } from '@skydrop/api-client';

export function useOrderInvoice(orderId: string): UseQueryResult<SellerInvoiceView | null> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-invoice', orderId],
    queryFn: async () => {
      try {
        return await client.request<SellerInvoiceView>(`/api/seller/orders/${orderId}/invoice`);
      } catch (e) {
        // 404 is the "no invoice yet" path — return null instead of
        // surfacing as a query error.
        const err = e as { status?: number };
        if (err.status === 404) return null;
        throw e;
      }
    },
    enabled: Boolean(orderId),
    // Don't auto-refetch the invoice constantly; once it's there it's there.
    staleTime: 30_000,
  });
}

export function useGenerateInvoice(
  orderId: string,
): UseMutationResult<GenerateInvoiceResponse, Error, void> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      client.request<GenerateInvoiceResponse>(`/api/seller/orders/${orderId}/invoice`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-invoice', orderId] });
    },
  });
}

// ───────── Seller notification preferences ─────────

import type {
  NotificationPreferenceView,
  UpdateNotificationPreferenceRequest,
} from '@skydrop/api-client';

export function useNotificationPreferences(): UseQueryResult<NotificationPreferenceView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-notification-preferences'],
    queryFn: () =>
      client.request<NotificationPreferenceView[]>('/api/seller/notification-preferences'),
  });
}

export function useUpdateNotificationPreference(): UseMutationResult<
  NotificationPreferenceView,
  Error,
  { category: string; body: UpdateNotificationPreferenceRequest }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ category, body }) =>
      client.request<NotificationPreferenceView>(
        `/api/seller/notification-preferences/${category}`,
        { method: 'PATCH', body },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['seller-notification-preferences'],
      });
    },
  });
}

// ───────── Seller API keys ─────────

import type {
  SellerApiKeyView,
  CreatedSellerApiKey,
  CreateSellerApiKeyRequest,
} from '@skydrop/api-client';

export function useApiKeysList(): UseQueryResult<SellerApiKeyView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-api-keys'],
    queryFn: () => client.request<SellerApiKeyView[]>('/api/seller/api-keys'),
  });
}

export function useCreateApiKey(): UseMutationResult<
  CreatedSellerApiKey,
  Error,
  CreateSellerApiKeyRequest
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<CreatedSellerApiKey>('/api/seller/api-keys', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-api-keys'] });
    },
  });
}

export function useRevokeApiKey(): UseMutationResult<void, Error, { id: string }> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }) => {
      await client.request<void>(`/api/seller/api-keys/${id}/revoke`, {
        method: 'POST',
        body: {},
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-api-keys'] });
    },
  });
}

// ───────── Seller team (RBAC) ─────────

import type {
  TeamInvitationListItem,
  CreatedTeamInvitation,
  CreateTeamInvitationRequest,
  TeamMemberRow,
} from '@skydrop/api-client';

export function useTeamInvitationsList(): UseQueryResult<{
  items: TeamInvitationListItem[];
  total: number;
}> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-team', 'invitations'],
    queryFn: () =>
      client.request<{ items: TeamInvitationListItem[]; total: number }>(
        '/api/seller/team/invitations',
      ),
  });
}

export function useCreateTeamInvitation(): UseMutationResult<
  CreatedTeamInvitation,
  Error,
  CreateTeamInvitationRequest
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<CreatedTeamInvitation>('/api/seller/team/invitations', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-team'] });
    },
  });
}

export function useResendTeamInvitation(): UseMutationResult<
  CreatedTeamInvitation,
  Error,
  { id: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<CreatedTeamInvitation>(`/api/seller/team/invitations/${id}/resend`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-team'] });
    },
  });
}

export function useRevokeTeamInvitation(): UseMutationResult<void, Error, { id: string }> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }) => {
      await client.request<void>(`/api/seller/team/invitations/${id}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-team'] });
    },
  });
}

export function useTeamMembersList(): UseQueryResult<TeamMemberRow[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-team', 'members'],
    queryFn: () => client.request<TeamMemberRow[]>('/api/seller/team/members'),
  });
}

export function useUpdateTeamMemberRole(): UseMutationResult<
  { id: string; role: string },
  Error,
  { id: string; role: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }) =>
      client.request<{ id: string; role: string }>(`/api/seller/team/members/${id}/role`, {
        method: 'PATCH',
        body: { role },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-team'] });
    },
  });
}

export function useDeactivateTeamMember(): UseMutationResult<void, Error, { id: string }> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }) => {
      await client.request<void>(`/api/seller/team/members/${id}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-team'] });
    },
  });
}
