'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';

/**
 * RS-3 — a seller's reseller catalogue: the default price list and each
 * store's terms. Writes need `stores.pricing`; the reads also open to
 * `stores.manage`. The seller id is the token's, server-side.
 */

export interface PriceTerms {
  readonly transferPriceInr: string;
  readonly minRetailInr: string | null;
  readonly maxRetailInr: string | null;
  readonly suggestedRetailInr: string | null;
}

export interface PriceListRow {
  readonly variantId: string;
  readonly productId: string;
  readonly productName: string;
  readonly skuCode: string;
  readonly variantLabel: string | null;
  readonly thumbnailUrl: string | null;
  readonly onHand: number;
  readonly available: number;
  readonly price: PriceTerms | null;
  readonly enabledInStores: number;
}

export interface PriceListView {
  readonly rows: readonly PriceListRow[];
  readonly truncated: boolean;
}

export type StockMode = 'SHARED' | 'SET_ASIDE';

export type NotSellableReason = 'NOT_ENABLED' | 'NO_TRANSFER_PRICE' | 'VARIANT_NOT_RESELLABLE';

export interface StoreTermsRow {
  readonly variantId: string;
  readonly productName: string;
  readonly skuCode: string;
  readonly variantLabel: string | null;
  readonly thumbnailUrl: string | null;
  readonly resellable: boolean;
  readonly defaultPrice: PriceTerms | null;
  readonly override: PriceTerms | null;
  readonly effective: PriceTerms | null;
  readonly priceSource: 'OVERRIDE' | 'DEFAULT' | null;
  readonly enabled: boolean;
  readonly stockMode: StockMode;
  readonly setAsideQty: number | null;
  readonly hiddenPercent: number;
  readonly overlayTitle: string | null;
  readonly overlayDescription: string | null;
  readonly overlayImages: ReadonlyArray<{ readonly id: string; readonly url: string | null }>;
  readonly onHand: number;
  readonly realAvailable: number;
  readonly otherStoresSetAside: number;
  readonly freeToSetAside: number;
  readonly visibleQty: number;
  readonly sellable: boolean;
  readonly notSellableReason: NotSellableReason | null;
}

export interface StoreTermsView {
  readonly storeId: string;
  readonly storeName: string;
  readonly storeStatus: string | null;
  readonly rows: readonly StoreTermsRow[];
  readonly truncated: boolean;
  readonly recentShrinks: ReadonlyArray<{
    readonly id: string;
    readonly variantId: string;
    readonly skuCode: string | null;
    readonly fromQty: number;
    readonly toQty: number;
    readonly onHand: number;
    readonly createdAt: string;
  }>;
}

export interface SaveStoreTermsInput {
  readonly enabled: boolean;
  readonly priceOverride: PriceTerms | null;
  readonly stockMode: StockMode;
  readonly setAsideQty: number | null;
  readonly hiddenPercent: number;
  readonly overlayTitle: string | null;
  readonly overlayDescription: string | null;
}

interface OverlayPresign {
  readonly storageKey: string;
  readonly uploadUrl: string;
  readonly maxSizeBytes: number;
}

const PRICE_LIST = ['seller-reseller-price-list'] as const;
const TERMS = ['seller-reseller-store-terms'] as const;

export function useResellerPriceList(): UseQueryResult<PriceListView> {
  const client = useApiClient();
  return useQuery({
    queryKey: PRICE_LIST,
    queryFn: () => client.request<PriceListView>('/api/seller/reseller-price-list'),
  });
}

export function useSetResellerDefaultPrice(): UseMutationResult<
  PriceTerms,
  Error,
  { variantId: string; body: PriceTerms }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ variantId, body }) =>
      client.request<PriceTerms>(`/api/seller/reseller-price-list/${variantId}`, {
        method: 'PUT',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PRICE_LIST });
      void qc.invalidateQueries({ queryKey: TERMS });
    },
  });
}

export function useRemoveResellerDefaultPrice(): UseMutationResult<
  void,
  Error,
  { variantId: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ variantId }) =>
      client.request<void>(`/api/seller/reseller-price-list/${variantId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PRICE_LIST });
      void qc.invalidateQueries({ queryKey: TERMS });
    },
  });
}

export function useResellerStoreTerms(storeId: string): UseQueryResult<StoreTermsView> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...TERMS, storeId],
    queryFn: () =>
      client.request<StoreTermsView>(`/api/seller/reseller-stores/${storeId}/catalogue`),
  });
}

export function useSaveResellerStoreTerms(): UseMutationResult<
  StoreTermsView,
  Error,
  { storeId: string; variantId: string; body: SaveStoreTermsInput }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, variantId, body }) =>
      client.request<StoreTermsView>(
        `/api/seller/reseller-stores/${storeId}/catalogue/${variantId}`,
        { method: 'PUT', body },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TERMS });
      void qc.invalidateQueries({ queryKey: PRICE_LIST });
    },
  });
}

/**
 * Presign → PUT straight to Spaces → register. The PUT is a raw fetch to
 * the presigned URL (storage, not our API); the register goes back
 * through the proxy.
 */
export function useUploadResellerOverlayImage(): UseMutationResult<
  StoreTermsView,
  Error,
  { storeId: string; variantId: string; file: File }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ storeId, variantId, file }) => {
      const presign = await client.request<OverlayPresign>(
        `/api/seller/reseller-stores/${storeId}/catalogue/${variantId}/images/presign`,
        { method: 'POST', body: { mimeType: file.type } },
      );
      if (file.size > presign.maxSizeBytes) {
        throw new Error('That picture is larger than 2 MB. Choose a smaller one.');
      }
      const put = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!put.ok) throw new Error(`The upload failed (${put.status}). Try again.`);
      return client.request<StoreTermsView>(
        `/api/seller/reseller-stores/${storeId}/catalogue/${variantId}/images`,
        { method: 'POST', body: { storageKey: presign.storageKey, mimeType: file.type } },
      );
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: TERMS }),
  });
}

export function useRemoveResellerOverlayImage(): UseMutationResult<
  StoreTermsView,
  Error,
  { storeId: string; variantId: string; imageId: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, variantId, imageId }) =>
      client.request<StoreTermsView>(
        `/api/seller/reseller-stores/${storeId}/catalogue/${variantId}/images/${imageId}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: TERMS }),
  });
}
