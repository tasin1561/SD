'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import type { AddressType, CategoryProposalStatus, GoodsReceiptStatus } from '@skydrop/db';

/**
 * Seller-side surfaces that had endpoints and no screens: the seller's
 * own addresses, their customers, inbound goods receipts, and category
 * proposals.
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

// ───────── Addresses ─────────

export interface AddressView {
  id: string;
  label: string | null;
  type: AddressType;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  stateProvince: string;
  postalCode: string;
  countryCode: string;
  isDefault: boolean;
}

export interface AddressInput {
  type: AddressType;
  label?: string;
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  countryCode?: string;
}

export function useAddresses(): UseQueryResult<readonly AddressView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-addresses'],
    queryFn: () => client.request<readonly AddressView[]>('/seller/addresses'),
  });
}

export function useCreateAddress(): UseMutationResult<AddressView, Error, AddressInput> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<AddressView>('/seller/addresses', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seller-addresses'] }),
  });
}

export function useUpdateAddress(): UseMutationResult<
  AddressView,
  Error,
  { id: string; body: Partial<AddressInput> }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) =>
      client.request<AddressView>(`/seller/addresses/${id}`, { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seller-addresses'] }),
  });
}

export function useDeleteAddress(): UseMutationResult<unknown, Error, { id: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<unknown>(`/seller/addresses/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seller-addresses'] }),
  });
}

export function useSetDefaultAddress(): UseMutationResult<AddressView, Error, { id: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<AddressView>(`/seller/addresses/${id}/set-default`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seller-addresses'] }),
  });
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
    queryFn: () => client.request<Paginated<CustomerView>>(`/seller/customers${qs(query)}`),
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
  expectedSkus: number | null;
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
      client.request<Paginated<GoodsReceiptView>>(`/seller/goods-receipts${qs(query)}`),
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
      client.request<GoodsReceiptView>('/seller/goods-receipts', { method: 'POST', body }),
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
      client.request<GoodsReceiptView>(`/seller/goods-receipts/${id}/cancel`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seller-goods-receipts'] }),
  });
}

// ───────── Category proposals ─────────

export interface ProposalView {
  id: string;
  proposedName: string;
  proposedSlug: string;
  proposedParentId: string | null;
  rationale: string;
  status: CategoryProposalStatus;
  decisionNote: string | null;
  resultingCategoryId: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export function useProposals(query: {
  status?: string;
  page?: number;
  pageSize?: number;
}): UseQueryResult<Paginated<ProposalView>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-proposals', query],
    queryFn: () =>
      client.request<Paginated<ProposalView>>(`/seller/category-proposals${qs(query)}`),
  });
}

export function useCreateProposal(): UseMutationResult<
  ProposalView,
  Error,
  { proposedName: string; proposedSlug: string; rationale: string; proposedParentId?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<ProposalView>('/seller/category-proposals', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seller-proposals'] }),
  });
}

export function useWithdrawProposal(): UseMutationResult<ProposalView, Error, { id: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<ProposalView>(`/seller/category-proposals/${id}/withdraw`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seller-proposals'] }),
  });
}

// ───────── Category browse (read-only) ─────────

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  status: string;
  defaultGstRate: number | null;
  defaultHsCode: string | null;
  children?: readonly CategoryNode[];
}

export function useCategoryTree(): UseQueryResult<readonly CategoryNode[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-categories', 'tree'],
    // The tree is near-static and shared by every seller.
    staleTime: 10 * 60_000,
    queryFn: () => client.request<readonly CategoryNode[]>('/seller/categories/tree'),
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
    queryFn: () => client.request<readonly CsvMappingView[]>('/seller/csv-mappings'),
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
      client.request<CsvMappingView>('/seller/csv-mappings', { method: 'POST', body }),
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
      client.request<CsvMappingView>(`/seller/csv-mappings/${id}`, { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seller-csv-mappings'] }),
  });
}

export function useDeleteCsvMapping(): UseMutationResult<unknown, Error, { id: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<unknown>(`/seller/csv-mappings/${id}`, { method: 'DELETE' }),
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
  return useQuery({
    queryKey: ['seller-recipient-addresses', query],
    enabled: query.customerId !== undefined && query.customerId !== '',
    queryFn: () =>
      client.request<readonly CachedAddressView[]>(`/seller/recipient-addresses${qs(query)}`),
  });
}

// ───────── What a category will require of your variants ─────────

export interface EffectiveAttribute {
  attributeKey: string;
  displayLabel: string;
  valueType: string;
  allowedValues: readonly string[];
  isRequired: boolean;
  displayOrder: number;
  sourceCategoryId: string;
}

/**
 * The RESOLVED set — this category's own definitions plus everything
 * inherited from its ancestors. That is the set a variant is actually
 * validated against, which is why the seller-facing endpoint returns
 * only the effective view and not the raw per-category rows.
 */
export function useCategoryAttributes(
  categoryId: string | null,
): UseQueryResult<readonly EffectiveAttribute[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-categories', 'attributes', categoryId],
    enabled: categoryId !== null,
    staleTime: 5 * 60_000,
    queryFn: () =>
      client.request<readonly EffectiveAttribute[]>(
        `/seller/categories/${categoryId ?? ''}/attributes`,
      ),
  });
}
