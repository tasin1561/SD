'use client';

import type {
  JourneyEntryView,
  JourneyMilestoneView,
  JourneyParcelView,
} from '@skydrop/ui/components';
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
  CustomerDeliveryFeeView,
  ApiClient,
  CreateSellerProductRequest,
  CreateSellerVariantRequest,
  ListSellerOrdersQuery,
  ListSellerProductsQuery,
  ListSellerStockQuery,
  OrderChargeView,
  OrderListResponse,
  OrderView,
  PresignVariantImageRequest,
  PresignVariantImageResponse,
  RegisterVariantImageRequest,
  SellerProductListResponse,
  SellerProductView,
  SellerStockListResponse,
  SellerStockSummary,
  SellerVariantImageView,
  SellerVariantSearchHit,
  SellerVariantView,
  UpdateSellerProductRequest,
  UpdateSellerVariantRequest,
} from '@skydrop/api-client';
import { can } from '@/lib/page-access';
import { useSellerIdentity } from '@skydrop/auth/client';

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
  opts?: { readonly enabled?: boolean },
): UseQueryResult<OrderListResponse> {
  const client = useApiClient();
  return useQuery({
    enabled: opts?.enabled ?? true,
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

export interface ReattemptRequestView {
  readonly id: string;
  readonly orderId: string;
  readonly orderNumber: string | null;
  readonly reason: string;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED';
  readonly decisionNote: string | null;
  readonly decidedAt: string | null;
  readonly createdAt: string;
}

/**
 * Ask for one more call on a declined order. A request, not a right —
 * an admin decides, and only then does the order return to the queue.
 */
export function useRequestReattempt(): UseMutationResult<
  ReattemptRequestView,
  Error,
  { orderId: string; reason: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, reason }) =>
      client.request<ReattemptRequestView>(`/api/seller/orders/${orderId}/reattempt-request`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: () => {
      // Covers both the detail and the ['seller-orders','reattempt',id]
      // list below, which is what makes the banner appear without a
      // reload.
      void qc.invalidateQueries({ queryKey: ['seller-orders'] });
    },
  });
}

/**
 * This order's re-attempt requests, and whether another may be raised.
 *
 * `canRequest` comes from the SERVER: which statuses qualify is a
 * per-seller setting now, and a client guessing from the status would
 * offer a button the server refuses (FE-2).
 */
export function useOrderReattemptRequests(
  orderId: string,
  opts?: { readonly enabled?: boolean },
): UseQueryResult<{ requests: readonly ReattemptRequestView[]; canRequest: boolean }> {
  const client = useApiClient();
  return useQuery({
    enabled: opts?.enabled ?? true,
    queryKey: ['seller-orders', 'reattempt', orderId],
    queryFn: () =>
      client.request<{ requests: readonly ReattemptRequestView[]; canRequest: boolean }>(
        `/api/seller/orders/${orderId}/reattempt-requests`,
      ),
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
  /** The landmark. Required — the seller form asks for it, and the API
   *  refuses a create without one. */
  readonly recipientAddressLine2: string;
  readonly recipientLandmark?: string;
  /** Optional now: Delhivery routes on the PIN and resolves the locality
   *  itself, so the seller form no longer asks. */
  readonly recipientCity?: string;
  readonly recipientStateProvince?: string;
  readonly recipientPostalCode: string;
  readonly recipientCountryCode?: string;
  readonly paymentMode: 'COD' | 'PREPAID';
  readonly codAmountInr?: number;
  /** The three figures the collectable amount is built from. */
  readonly advanceAmountInr?: number;
  readonly deliveryFeeInr?: number;
  readonly discountInr?: number;
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
    /** Where this seller last sent to this number — the "use these
     *  details" fill on the new-order form. Seller-scoped by
     *  construction; null if they have never ordered from you. */
    readonly lastKnownRecipient: {
      readonly name: string;
      readonly addressLine1: string;
      readonly addressLine2: string | null;
      readonly landmark: string | null;
      readonly postalCode: string;
      readonly fromOrderNumber: string;
      readonly placedAt: string;
    } | null;
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
  const canReadPending = can(useSellerIdentity(), 'orders.pending.manage');
  return useQuery({
    // Self-gating: this is a COUNT shown beside the order list, and the
    // order list is open to anyone with `orders.view` — including a
    // viewer, who cannot read the draft queue at all. Without this the
    // orders page 403s on a query nobody asked for.
    enabled: canReadPending,
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
  opts?: { readonly enabled?: boolean },
): UseQueryResult<SellerProductListResponse> {
  const client = useApiClient();
  return useQuery({
    enabled: opts?.enabled ?? true,
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

/**
 * Create a product. Invalidates the whole `seller-catalog` prefix so the
 * list, and any variant query under it, refetch together — a new product
 * that does not appear in the list reads as the save having failed.
 */
export function useCreateProduct(): UseMutationResult<
  SellerProductView,
  Error,
  CreateSellerProductRequest
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<SellerProductView>('/api/seller/products', { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-catalog'] });
    },
  });
}

/** Create a variant under a product. The SKU is unique per seller and
 *  immutable once set, so a duplicate comes back from the server and is
 *  surfaced verbatim (FE-2) rather than guessed at here. */
/**
 * The product id is a MUTATION VARIABLE, not a hook argument.
 *
 * Bound at render it was a trap: the create-product form does not know
 * the id until its own first call returns, so it passed `''` and the
 * POST went to `/seller/products//variants`. Setting the id in state
 * right before calling does not help — the mutation in that closure was
 * already built with the old value, so the FIRST save of every new
 * product failed and only a second attempt worked.
 *
 * Taking the id per call removes the shape that allowed it.
 */
export function useCreateVariant(): UseMutationResult<
  SellerVariantView,
  Error,
  { productId: string; body: CreateSellerVariantRequest }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, body }) =>
      client.request<SellerVariantView>(`/api/seller/products/${productId}/variants`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-catalog'] });
    },
  });
}

/**
 * Retiring a product or variant.
 *
 * ARCHIVED blocks new uses — no new orders, no stock receiving — while
 * leaving every historical reference intact (M4 catalog rule 7). That is
 * why this is the normal way to stop selling something, and deleting is
 * not offered here: a soft-delete hides the row from read paths, which
 * is a bigger hammer than "we no longer sell this" and is recoverable
 * only by staff.
 *
 * Both endpoints shipped with M4 and had no caller, so a seller could
 * add to their catalogue and never take anything out of it.
 *
 * Archiving a PRODUCT cascades to its variants; unarchiving does NOT
 * bring them back, because which variants a seller wants live again is a
 * decision, not something to infer. The UI says so rather than letting
 * it be discovered.
 */
export function useArchiveProduct(
  productId: string,
): UseMutationResult<SellerProductView, Error, { archived: boolean }> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ archived }) =>
      client.request<SellerProductView>(
        `/api/seller/products/${productId}/${archived ? 'archive' : 'unarchive'}`,
        { method: 'POST', body: {} },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-catalog'] });
    },
  });
}

export function useArchiveVariant(
  productId: string,
  variantId: string,
): UseMutationResult<SellerVariantView, Error, { archived: boolean }> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ archived }) =>
      client.request<SellerVariantView>(
        `/api/seller/products/${productId}/variants/${variantId}/${archived ? 'archive' : 'unarchive'}`,
        { method: 'POST', body: {} },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-catalog'] });
    },
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

/**
 * Type-ahead over this seller's variants.
 *
 * `enabled` is the caller's, so a closed picker fetches nothing. The
 * query key carries the term, so React Query caches per term and typing
 * backwards is instant.
 */
/**
 * Star or unstar a variant.
 *
 * Invalidates the whole `variant-search` prefix rather than one key: the
 * star changes the ORDER of every result set, not just the row tapped,
 * so patching one cached list would leave the others sorted wrongly.
 */
export function useSetVariantFavourite(): UseMutationResult<
  { isFavourite: boolean },
  Error,
  { variantId: string; isFavourite: boolean }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ variantId, isFavourite }) =>
      client.request<{ isFavourite: boolean }>(`/api/seller/variants/${variantId}/favourite`, {
        method: 'PUT',
        body: { isFavourite },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-catalog', 'variant-search'] });
    },
  });
}

export function useVariantSearch(
  search: string,
  opts?: { readonly enabled?: boolean },
): UseQueryResult<SellerVariantSearchHit[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-catalog', 'variant-search', search],
    enabled: opts?.enabled ?? true,
    queryFn: () =>
      client.request<SellerVariantSearchHit[]>(
        `/api/seller/variants?search=${encodeURIComponent(search)}&limit=20`,
      ),
  });
}

/**
 * The delivery fee pre-filled on a new order. Autofill only — it is not
 * what Skydrop charges the seller, and it stays editable per order.
 */
export function useCustomerDeliveryFee(): UseQueryResult<CustomerDeliveryFeeView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-order-defaults', 'customer-delivery-fee'],
    queryFn: () =>
      client.request<CustomerDeliveryFeeView>('/api/seller/order-defaults/customer-delivery-fee'),
  });
}

export function useSetCustomerDeliveryFee(): UseMutationResult<
  CustomerDeliveryFeeView,
  Error,
  { amountInr: number }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<CustomerDeliveryFeeView>('/api/seller/order-defaults/customer-delivery-fee', {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-order-defaults'] });
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

// ───────── Seller low-stock alert thresholds ─────────

export interface SellerAlertConfigView {
  readonly defaultLowStockThreshold: number | null;
}

/**
 * `null` CLEARS the default, which switches low-stock alerting off
 * entirely for variants with no threshold of their own. The key must be
 * PRESENT either way — the DTO's `@IsDefined` under `@ValidateIf` accepts
 * null and rejects undefined, so omitting it is a 400 rather than a no-op.
 */
export interface SetDefaultThresholdBody {
  readonly defaultLowStockThreshold: number | null;
}

export function useStockAlertConfig(): UseQueryResult<SellerAlertConfigView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-stock', 'alert-config'],
    queryFn: () => client.request<SellerAlertConfigView>('/api/seller/stock/alert-config'),
  });
}

export function useSetDefaultStockThreshold(): UseMutationResult<
  SellerAlertConfigView,
  Error,
  SetDefaultThresholdBody
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<SellerAlertConfigView>('/api/seller/stock/alert-config/default', {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      // `isLowStock` on every cached stock row is DERIVED from this
      // number, so the whole list is stale the moment it lands.
      void queryClient.invalidateQueries({ queryKey: ['seller-stock'] });
    },
  });
}

// ───────── Per-variant stock config (R4 mode + low-stock threshold) ─────────

export type SellerInventoryMode = 'NORMAL' | 'STRICT';

export interface VariantInventoryModeView {
  readonly variantId: string;
  readonly productId: string;
  /** The variant's OWN value. null means "inherit the seller default". */
  readonly inventoryMode: SellerInventoryMode | null;
  /** What pick, pack and receiving actually enforce today. */
  readonly effectiveInventoryMode: SellerInventoryMode;
  readonly inherited: boolean;
}

/**
 * `null` CLEARS the override so the SKU inherits the seller default — it
 * is NOT a synonym for NORMAL. The key must be PRESENT either way: the
 * DTO's `@IsDefined` under `@ValidateIf` accepts null and rejects
 * undefined, so omitting it is a 400 rather than a no-op.
 */
export interface SetVariantInventoryModeBody {
  readonly inventoryMode: SellerInventoryMode | null;
}

export interface VariantThresholdView {
  readonly variantId: string;
  readonly productId: string;
  readonly lowStockThreshold: number | null;
}

/** Same clear-vs-omit contract as the mode above. */
export interface SetVariantThresholdBody {
  readonly lowStockThreshold: number | null;
}

export interface VariantStockRow {
  readonly variantId: string;
  readonly productId: string;
  readonly skuCode: string;
  readonly variantLabel: string | null;
  readonly qtyOnHand: number;
  readonly qtyReserved: number;
  readonly qtyAvailable: number;
  /** On hand somewhere it cannot be sold from — Dhaka, or in transit. */
  readonly qtyInTransit: number;
  readonly lowStockThreshold: number | null;
  readonly isLowStock: boolean;
  readonly warehouseCount: number;
}

/**
 * Stock for ONE SKU, aggregated across warehouses.
 *
 * This is also the only read that returns a variant's own
 * `lowStockThreshold` — the variant detail projection does not carry it,
 * so without this the threshold control would be a box you type into
 * without being able to see what is currently set.
 */
export function useVariantStock(variantId: string): UseQueryResult<VariantStockRow> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-stock', 'by-variant', variantId],
    enabled: variantId !== '',
    queryFn: () => client.request<VariantStockRow>(`/api/seller/stock/by-variant/${variantId}`),
  });
}

export function useVariantInventoryMode(
  productId: string,
  variantId: string,
): UseQueryResult<VariantInventoryModeView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-catalog', 'variant', variantId, 'inventory-mode'],
    enabled: productId !== '' && variantId !== '',
    queryFn: () =>
      client.request<VariantInventoryModeView>(
        `/api/seller/products/${productId}/variants/${variantId}/inventory-mode`,
      ),
  });
}

export function useSetVariantThreshold(
  productId: string,
  variantId: string,
): UseMutationResult<VariantThresholdView, Error, SetVariantThresholdBody> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<VariantThresholdView>(
        `/api/seller/products/${productId}/variants/${variantId}/threshold`,
        { method: 'PATCH', body },
      ),
    onSuccess: () => {
      // isLowStock on every cached row is derived from the threshold.
      void queryClient.invalidateQueries({ queryKey: ['seller-stock'] });
      void queryClient.invalidateQueries({ queryKey: ['seller-catalog'] });
    },
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

/**
 * A bank-change request as it rides along on the profile read.
 *
 * Bank details are where a seller's money is sent, so a change to an
 * account that ALREADY exists does not take effect on save — it becomes
 * a request an admin approves or rejects, and withdrawals keep going to the
 * old account meanwhile. A first add has nothing to redirect, so it
 * writes straight through and no request is created.
 *
 * APPROVED never appears here: an approved request has been applied, so
 * the live fields on the profile are the answer.
 *
 * `proposed.bankAccountNumber` is MASKED (last four) exactly like the
 * live one — the plaintext is encrypted at rest and no seller-facing
 * read ever returns it.
 *
 * Declared here rather than on `SellerProfileView` because
 * `@skydrop/api-client` is owned by another change this cycle; fold it
 * into that interface when the package next changes hands.
 */
export type SellerBankChangeStatus = 'PENDING' | 'REJECTED';

export interface SellerBankChangeProposedView {
  readonly bankName: string;
  readonly bankBranchName: string;
  readonly bankAccountName: string;
  readonly bankAccountNumber: string;
  readonly bankRoutingNumber: string;
  readonly bankSwiftCode: string;
}

export interface SellerBankChangeView {
  readonly id: string;
  readonly status: SellerBankChangeStatus;
  readonly submittedAt: string;
  readonly decidedAt: string | null;
  /** Why an admin rejected it. Null while pending. */
  readonly decisionReason: string | null;
  readonly proposed: SellerBankChangeProposedView;
}

export type SellerProfileWithBankChange = SellerProfileView & {
  readonly latestBankChange: SellerBankChangeView | null;
};

export function useSellerProfile(opts?: {
  readonly enabled?: boolean;
}): UseQueryResult<SellerProfileWithBankChange> {
  const client = useApiClient();
  return useQuery({
    enabled: opts?.enabled ?? true,
    queryKey: ['seller-profile'],
    queryFn: () => client.request<SellerProfileWithBankChange>('/api/seller/profile'),
  });
}

export function useUpdateSellerProfile(): UseMutationResult<
  SellerProfileWithBankChange,
  Error,
  UpdateSellerProfileRequest
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<SellerProfileWithBankChange>('/api/seller/profile', {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-profile'] });
    },
  });
}

export function useUpdateSellerBankDetails(): UseMutationResult<
  SellerProfileWithBankChange,
  Error,
  UpdateSellerBankDetailsRequest
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<SellerProfileWithBankChange>('/api/seller/profile/bank-details', {
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

export interface MoneyInFlight {
  readonly inTransit: { readonly count: number; readonly codInr: string };
  readonly processing: { readonly count: number; readonly codInr: string };
}

/**
 * What is still coming: COD on orders confirmed but not delivered, and
 * COD on orders delivered but not yet credited. Gross — our fees and
 * the withheld GST are still inside both figures.
 */
export function useMoneyInFlight(opts?: {
  readonly enabled?: boolean;
}): UseQueryResult<MoneyInFlight> {
  const client = useApiClient();
  return useQuery({
    enabled: opts?.enabled ?? true,
    queryKey: ['seller-orders', 'money-in-flight'],
    queryFn: () => client.request<MoneyInFlight>('/api/seller/orders/money-in-flight'),
  });
}

export function useWalletBalances(opts?: {
  readonly enabled?: boolean;
}): UseQueryResult<WalletBalancesResponse> {
  const client = useApiClient();
  return useQuery({
    // Gateable because the dashboard shows this to everyone who lands,
    // and a VIEWER without `wallet.view` would otherwise be served their
    // own home page with a refusal on it.
    enabled: opts?.enabled ?? true,
    queryKey: ['seller-wallet', 'balances'],
    queryFn: () => client.request<WalletBalancesResponse>('/api/seller/wallet'),
  });
}

/**
 * Putting money IN.
 *
 * WAL-2: submitting is a CLAIM, not a payment. Nothing is credited until
 * a human has matched it against the bank statement, which is why this
 * flow ends at "submitted" and the balance does not move.
 *
 * These endpoints have existed since the wallet shipped and had no
 * caller, so COD was the only way a balance could ever rise while order
 * charges, RTO fees and freight all debited it.
 */
export interface PlatformBankAccountView {
  readonly id: string;
  readonly label: string;
  readonly bankName: string;
  readonly accountName: string;
  readonly accountNumber: string;
  readonly branchCode: string | null;
  readonly branchName: string | null;
  readonly district: string | null;
  readonly routingNumber: string | null;
  /**
   * This account's currency to INR. Server-computed so the figure the
   * seller is shown before paying is the same one that will be credited
   * — two independent conversions eventually disagree, and the one they
   * were shown is the one they will quote back. Null if unresolvable.
   */
  readonly rateToInr: string | null;
  readonly currency: string;
  readonly instructions: string | null;
}

export interface TopupRequestView {
  readonly id: string;
  readonly bankLabel: string;
  /** The account they actually paid into, for checking against a statement. */
  readonly bankName: string;
  readonly bankAccountName: string;
  readonly bankAccountNumber: string;
  readonly bankBranchName: string | null;
  readonly sellerCompanyName: string | null;
  readonly reviewedByEmail: string | null;
  readonly currency: string;
  readonly amount: string;
  readonly transactionRef: string | null;
  readonly hasProof: boolean;
  readonly status: string;
  readonly reviewNote: string | null;
  readonly reviewedAt: string | null;
  readonly createdAt: string;
}

export interface TopupPresignResult {
  readonly uploadUrl: string;
  readonly spacesKey: string;
  readonly expiresInSeconds: number;
}

export interface SubmitTopupInput {
  readonly bankAccountId: string;
  readonly amount: number;
  readonly transactionRef?: string;
  readonly proofSpacesKey?: string;
  readonly proofMimeType?: string;
}

export interface TopupBankAccountsResponse {
  readonly accounts: readonly PlatformBankAccountView[];
  /** For showing the taka equivalent of a rupee amount. Null if unknown. */
  readonly inrToBdt: string | null;
}

export interface TrackedShipmentRow {
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly awbNumber: string | null;
  readonly courierCode: string;
  readonly status: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly recipientName: string;
  readonly recipientCity: string;
  readonly lastScanAt: string | null;
  readonly lastScanStatus: string | null;
  readonly lastScanDescription: string | null;
  readonly lastScanLocation: string | null;
  readonly failedAttempts: number;
  readonly createdAt: string;
}

export interface TrackedShipmentDetail extends TrackedShipmentRow {
  readonly events: ReadonlyArray<{
    id: string;
    eventAt: string;
    status: string;
    description: string | null;
    location: string | null;
    source: string;
  }>;
  readonly attempts: ReadonlyArray<{
    id: string;
    attemptNumber: number;
    attemptedAt: string;
    outcome: string;
    failureReason: string | null;
    failureNotes: string | null;
    nextAttemptScheduledAt: string | null;
  }>;
}

export function useTrackedShipments(query: {
  status?: string;
  search?: string;
}): UseQueryResult<{ items: TrackedShipmentRow[] }> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-tracking', 'list', query],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (query.status !== undefined && query.status !== '') sp.set('status', query.status);
      if (query.search !== undefined && query.search !== '') sp.set('search', query.search);
      const qs = sp.toString();
      return client.request<{ items: TrackedShipmentRow[] }>(
        `/api/seller/tracking${qs === '' ? '' : `?${qs}`}`,
      );
    },
  });
}

export function useTrackedShipment(shipmentId: string): UseQueryResult<TrackedShipmentDetail> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-tracking', shipmentId],
    queryFn: () => client.request<TrackedShipmentDetail>(`/api/seller/tracking/${shipmentId}`),
  });
}

/** Every parcel on one order — so the seller never needs the AWB. */
export function useOrderTracking(
  orderId: string,
): UseQueryResult<{ items: TrackedShipmentDetail[] }> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-tracking', 'order', orderId],
    queryFn: () =>
      client.request<{ items: TrackedShipmentDetail[] }>(`/api/seller/tracking/order/${orderId}`),
  });
}

export function useTopupBankAccounts(): UseQueryResult<TopupBankAccountsResponse> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-wallet', 'topup-banks'],
    queryFn: () =>
      client.request<TopupBankAccountsResponse>('/api/seller/wallet/topups/bank-accounts'),
  });
}

/**
 * A short-lived link to the receipt the seller uploaded.
 *
 * Fetched on demand rather than listed with every row: the URL is a
 * presigned Spaces link with a 15-minute life, so minting one per row on
 * every page load hands out links nobody asked for and most of which
 * expire unused.
 */
export function useTopupProofUrl(): UseMutationResult<{ url: string }, Error, string> {
  const client = useApiClient();
  return useMutation({
    mutationFn: (topupId) =>
      client.request<{ url: string }>(`/api/seller/wallet/topups/${topupId}/proof-url`),
  });
}

export function useTopupRequests(): UseQueryResult<readonly TopupRequestView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-wallet', 'topups'],
    queryFn: () => client.request<readonly TopupRequestView[]>('/api/seller/wallet/topups'),
  });
}

export function usePresignTopupProof(): UseMutationResult<
  TopupPresignResult,
  Error,
  { mimeType: string }
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<TopupPresignResult>('/api/seller/wallet/topups/proof-upload', {
        method: 'POST',
        body,
      }),
  });
}

export function useSubmitTopup(): UseMutationResult<TopupRequestView, Error, SubmitTopupInput> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<TopupRequestView>('/api/seller/wallet/topups', { method: 'POST', body }),
    onSuccess: () => {
      // The list, not the balance — WAL-2 means nothing was credited.
      void queryClient.invalidateQueries({ queryKey: ['seller-wallet', 'topups'] });
    },
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

/** Takes a role ROW id, so a role the company invented can be assigned. */
export function useUpdateTeamMemberRole(): UseMutationResult<
  { id: string; roleId: string; roleName: string },
  Error,
  { id: string; roleId: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, roleId }) =>
      client.request<{ id: string; roleId: string; roleName: string }>(
        `/api/seller/team/members/${id}/role`,
        { method: 'PATCH', body: { roleId } },
      ),
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

// ───────── Withdrawal schedule — the two wallet terms a seller owns ─────────

export interface WithdrawalScheduleView {
  readonly autoEnabled: boolean;
  readonly hourLocal: number;
  readonly timezone: string;
  readonly isOwnValue: boolean;
  /** What the seller wants left behind after an automatic withdrawal. */
  readonly keepBalanceInr: string;
  /** Skydrop's floor. Theirs may sit above it, never below. */
  readonly platformMinimumInr: string;
}

export function useWithdrawalSchedule(enabled = true): UseQueryResult<WithdrawalScheduleView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-withdrawal-schedule'],
    queryFn: () => client.request<WithdrawalScheduleView>('/api/seller/wallet/withdrawal-schedule'),
    enabled,
  });
}

export function useSetWithdrawalSchedule(): UseMutationResult<
  WithdrawalScheduleView,
  Error,
  { autoEnabled?: boolean; hourLocal?: number; keepBalanceInr?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<WithdrawalScheduleView>('/api/seller/wallet/withdrawal-schedule', {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['seller-withdrawal-schedule'] });
      // The terms list shows the same two values, so it must not keep
      // showing the old ones beside the control that just changed them.
      void qc.invalidateQueries({ queryKey: ['seller-wallet', 'terms'] });
    },
  });
}

export interface OrderJourneyView {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly orderStatus: string;
  readonly milestones: readonly JourneyMilestoneView[];
  readonly parcels: readonly JourneyParcelView[];
  readonly timeline: readonly JourneyEntryView[];
}

/**
 * Milestones, parcel facts and the merged Skydrop + courier history.
 *
 * One request rather than three: the ladder, the weights and the
 * timeline are all derived from the same read, and splitting them would
 * make the page assemble a story out of three round trips that can
 * disagree about how far the parcel has got.
 */
export function useOrderJourney(id: string): UseQueryResult<OrderJourneyView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-orders', 'journey', id],
    queryFn: () => client.request<OrderJourneyView>(`/api/seller/orders/${id}/journey`),
    enabled: Boolean(id),
  });
}

export interface ReturnRequestResult {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: string;
  readonly alreadyRequested: boolean;
}

/**
 * Ask for a delivered parcel to come back.
 *
 * The goods travel the RTO path home and the second-delivery fee is
 * charged when they ARRIVE, not here — a request is not a return.
 */
export function useRequestReturn(
  orderId: string,
): UseMutationResult<ReturnRequestResult, Error, { reason: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reason }) =>
      client.request<ReturnRequestResult>(`/api/seller/orders/${orderId}/return`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: () => {
      // The order has moved and its journey has a new rung.
      void qc.invalidateQueries({ queryKey: ['seller-orders'] });
    },
  });
}
