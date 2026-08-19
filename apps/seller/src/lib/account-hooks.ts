'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import type { ConsignmentRoute, ConsignmentStatus, GoodsReceiptStatus } from '@skydrop/db';
import type {
  CancelConsignmentResult,
  ConsignmentEventView,
  ConsignmentListResult,
  ConsignmentView,
  DeclareConsignmentBody,
} from '@skydrop/api-client';
import { can } from '@/lib/page-access';
import { useSellerIdentity } from '@skydrop/auth/client';

/**
 * Seller-side surfaces that had endpoints and no screens: the seller's
 * own addresses, their customers, and inbound goods receipts.
 */

interface Paginated<T> {
  items: readonly T[];
  total: number;
  page: number;
  pageSize: number;
}

function qs(query: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ───────── Customers ─────────

export interface CustomerView {
  id: string;
  phoneE164: string;
  name: string | null;
  email: string | null;
  totalOrdersCount: number;
  successfulOrdersCount: number;
  rtoCount: number;
  refusedCount: number;
  fakeOrdersCount: number;
  riskLevel: string | null;
  riskNotes: string | null;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
}

export function useCustomers(query: {
  search?: string;
  page?: number;
  pageSize?: number;
}): UseQueryResult<Paginated<CustomerView>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-customers', query],
    queryFn: () => client.request<Paginated<CustomerView>>(`/api/seller/customers${qs(query)}`),
  });
}

/**
 * The detail endpoint returns more than the list projection — the three
 * fields below are editable and the list never carried them.
 */
export interface CustomerDetail extends CustomerView {
  altPhoneE164: string | null;
  preferredLanguage: string | null;
  createdAt: string;
}

export function useCustomer(id: string): UseQueryResult<CustomerDetail> {
  const client = useApiClient();
  const mayRead = can(useSellerIdentity(), 'customers.view');
  return useQuery({
    queryKey: ['seller-customer', id],
    enabled: mayRead && id !== '',
    queryFn: () => client.request<CustomerDetail>(`/api/seller/customers/${id}`),
  });
}

/**
 * The five editable fields and nothing else. `phoneE164` is absent by
 * construction (ORD-7 — a customer IS their phone number per seller),
 * and the API runs forbidNonWhitelisted, so a sixth key 400s the call.
 *
 * `null` CLEARS a field; an omitted key leaves it alone. `''` is not the
 * same thing — it would fail `@IsEmail` rather than erase a wrong address.
 */
export interface UpdateCustomerBody {
  name?: string | null;
  email?: string | null;
  altPhoneE164?: string | null;
  riskNotes?: string | null;
  preferredLanguage?: string | null;
}

export function useUpdateCustomer(): UseMutationResult<
  CustomerDetail,
  Error,
  { id: string; body: UpdateCustomerBody }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) =>
      client.request<CustomerDetail>(`/api/seller/customers/${id}`, { method: 'PATCH', body }),
    onSuccess: (_r, { id }) => {
      void qc.invalidateQueries({ queryKey: ['seller-customer', id] });
      void qc.invalidateQueries({ queryKey: ['seller-customers'] });
    },
  });
}

/** Soft delete — 204, no body. History survives; the row leaves read paths. */
export function useDeleteCustomer(): UseMutationResult<void, Error, { id: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<void>(`/api/seller/customers/${id}`, { method: 'DELETE' }),
    onSuccess: (_r, { id }) => {
      qc.removeQueries({ queryKey: ['seller-customer', id] });
      void qc.invalidateQueries({ queryKey: ['seller-customers'] });
    },
  });
}

// ───────── Inbound goods receipts ─────────

export interface GoodsReceiptView {
  id: string;
  receiptNumber: string;
  warehouseId: string;
  status: GoodsReceiptStatus;
  expectedArrivalAt: string | null;
  sellerReference: string | null;
  /**
   * The lines, as the API has always sent them.
   *
   * There used to be an `expectedSkus: number | null` here instead, and
   * nothing produced it — the API never had such a field, so the column
   * that read it printed "—" for every consignment ever announced. The
   * count is `lines.length`, and the lines carry the SKU and product
   * name besides.
   */
  lines: readonly GoodsReceiptLineView[];
  receivedAt: string | null;
  hasDiscrepancies: boolean;
  discrepancyNotes: string | null;
  createdAt: string;
}

export function useGoodsReceipts(query: {
  status?: string;
  page?: number;
  pageSize?: number;
}): UseQueryResult<Paginated<GoodsReceiptView>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-goods-receipts', query],
    queryFn: () =>
      client.request<Paginated<GoodsReceiptView>>(`/api/seller/goods-receipts${qs(query)}`),
  });
}

export interface DeclareReceiptLine {
  variantId: string;
  expectedQty: number;
  unitCostInr?: number;
  manufacturedAt?: string;
  expiresAt?: string;
}

export function useCreateGoodsReceipt(): UseMutationResult<
  GoodsReceiptView,
  Error,
  {
    lines: readonly DeclareReceiptLine[];
    warehouseId?: string;
    expectedArrivalAt?: string;
    sellerReference?: string;
  }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<GoodsReceiptView>('/api/seller/goods-receipts', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seller-goods-receipts'] }),
  });
}

export function useCancelGoodsReceipt(): UseMutationResult<
  GoodsReceiptView,
  Error,
  { id: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<GoodsReceiptView>(`/api/seller/goods-receipts/${id}/cancel`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seller-goods-receipts'] }),
  });
}

/**
 * A line as the server RETURNS it. Wider than what may be sent back:
 * `id`, `receivedQty`, `damagedQty`, `batchId`, `putawayBinId` and the
 * `variant` object are display-only, and echoing any of them into a
 * PATCH is a 400 on the whole request under forbidNonWhitelisted.
 */
export interface GoodsReceiptLineView {
  id: string;
  variantId: string;
  batchId: string | null;
  expectedQty: number;
  receivedQty: number;
  damagedQty: number;
  unitCostInr: string | null;
  manufacturedAt: string | null;
  expiresAt: string | null;
  putawayBinId: string | null;
  variant: {
    skuCode: string;
    variantLabel: string | null;
    product: { name: string };
  };
}

export interface GoodsReceiptDetailView extends GoodsReceiptView {
  lines: readonly GoodsReceiptLineView[];
}

/**
 * A correction is edited against a FRESH read rather than the row the
 * list already has. The list page may have sat open while the warehouse
 * started receiving, and editing a stale copy is how a quantity that was
 * already counted gets put back.
 */
export function useGoodsReceipt(id: string): UseQueryResult<GoodsReceiptDetailView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-goods-receipt', id],
    enabled: id !== '',
    queryFn: () => client.request<GoodsReceiptDetailView>(`/api/seller/goods-receipts/${id}`),
  });
}

/**
 * Mirrors `UpdateGoodsReceiptDto` exactly. `null` clears a field —
 * `@IsOptional()` skips null and the service maps falsy to null, whereas
 * `''` would fail `@IsDateString`.
 *
 * `lines` is a FULL REPLACE (the service deletes then recreates), so a
 * line resent without its `expiresAt` silently loses FEFO data. The form
 * carries every date even when untouched.
 */
export interface UpdateGoodsReceiptBody {
  expectedArrivalAt?: string | null;
  sellerReference?: string | null;
  lines?: readonly DeclareReceiptLine[];
}

export function useUpdateGoodsReceipt(): UseMutationResult<
  GoodsReceiptView,
  Error,
  { id: string; body: UpdateGoodsReceiptBody }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) =>
      client.request<GoodsReceiptView>(`/api/seller/goods-receipts/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: (_r, { id }) => {
      void qc.invalidateQueries({ queryKey: ['seller-goods-receipts'] });
      void qc.invalidateQueries({ queryKey: ['seller-goods-receipt', id] });
      // A receipt is also a consignment LEG, and the consignment page is
      // where a seller corrects one. Without this the page it was
      // corrected from keeps showing the quantity that was just changed.
      void qc.invalidateQueries({ queryKey: ['seller-consignments'] });
      void qc.invalidateQueries({ queryKey: ['seller-consignment'] });
    },
  });
}

// ───────── Two-leg consignments ─────────

/**
 * A consignment is the JOURNEY, not the arrival.
 *
 * The goods-receipt hooks above are one stop with one count. A
 * consignment is up to two of those under one number — counted in Dhaka,
 * flown, counted again in India — which is why the seller gets a
 * timeline instead of a status word. See docs/consignment-two-leg.md.
 */
export function useConsignments(query: {
  status?: ConsignmentStatus | '';
  route?: ConsignmentRoute | '';
  page?: number;
  pageSize?: number;
}): UseQueryResult<ConsignmentListResult> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-consignments', query],
    queryFn: () => client.request<ConsignmentListResult>(`/api/seller/consignments${qs(query)}`),
  });
}

export function useConsignment(id: string): UseQueryResult<ConsignmentView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-consignment', id],
    enabled: id !== '',
    queryFn: () => client.request<ConsignmentView>(`/api/seller/consignments/${id}`),
  });
}

/**
 * The timeline, oldest first — the server orders it and filters it to
 * what a seller may see, so this hook keeps the order it is given.
 */
export function useConsignmentEvents(id: string): UseQueryResult<readonly ConsignmentEventView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-consignment-events', id],
    enabled: id !== '',
    queryFn: () =>
      client.request<readonly ConsignmentEventView[]>(`/api/seller/consignments/${id}/events`),
  });
}

export function useDeclareConsignment(): UseMutationResult<
  ConsignmentView,
  Error,
  DeclareConsignmentBody
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<ConsignmentView>('/api/seller/consignments', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seller-consignments'] }),
  });
}

/**
 * Cancelling sends the goods back. The window closes at dispatch, and
 * the server is the one that says so — `CONSIGNMENT_ALREADY_DISPATCHED`
 * comes back verbatim rather than being guessed at here.
 *
 * Every consignment query is invalidated on success, the timeline
 * included: the cancellation is itself an event on it.
 */
export function useCancelConsignment(): UseMutationResult<
  CancelConsignmentResult,
  Error,
  { id: string; reason: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }) =>
      client.request<CancelConsignmentResult>(`/api/seller/consignments/${id}/cancel`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: (_r, { id }) => {
      void qc.invalidateQueries({ queryKey: ['seller-consignments'] });
      void qc.invalidateQueries({ queryKey: ['seller-consignment', id] });
      void qc.invalidateQueries({ queryKey: ['seller-consignment-events', id] });
    },
  });
}

// ───────── Saved CSV column mappings ─────────

export interface CsvMappingView {
  id: string;
  name: string;
  importType: string;
  columnMap: Record<string, string>;
  isDefault: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export function useCsvMappings(): UseQueryResult<readonly CsvMappingView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-csv-mappings'],
    queryFn: () => client.request<readonly CsvMappingView[]>('/api/seller/csv-mappings'),
  });
}

export function useCreateCsvMapping(): UseMutationResult<
  CsvMappingView,
  Error,
  { name: string; columnMap: Record<string, string>; isDefault?: boolean }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<CsvMappingView>('/api/seller/csv-mappings', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seller-csv-mappings'] }),
  });
}

export function useUpdateCsvMapping(): UseMutationResult<
  CsvMappingView,
  Error,
  { id: string; body: { name?: string; columnMap?: Record<string, string>; isDefault?: boolean } }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) =>
      client.request<CsvMappingView>(`/api/seller/csv-mappings/${id}`, { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seller-csv-mappings'] }),
  });
}

export function useDeleteCsvMapping(): UseMutationResult<unknown, Error, { id: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<unknown>(`/api/seller/csv-mappings/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seller-csv-mappings'] }),
  });
}

// ───────── Delivery history per address ─────────

export interface CachedAddressView {
  id: string;
  customerId: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  stateProvince: string;
  postalCode: string;
  seenCount: number;
  rtoCountAtAddress: number;
  successfulCountAtAddress: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export function useRecipientAddresses(query: {
  customerId?: string;
}): UseQueryResult<readonly CachedAddressView[]> {
  const client = useApiClient();
  const canRead = can(useSellerIdentity(), 'recipient_addresses.manage');
  return useQuery({
    queryKey: ['seller-recipient-addresses', query],
    enabled: canRead && query.customerId !== undefined && query.customerId !== '',
    queryFn: () =>
      client.request<readonly CachedAddressView[]>(`/api/seller/recipient-addresses${qs(query)}`),
  });
}
