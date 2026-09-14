'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';

/**
 * RS-3 — one reseller store's catalogue terms, READ-ONLY for staff
 * (`reseller.stores.view`). The seller sets them; staff see exactly what
 * the seller sees.
 */

export interface AdminPriceTerms {
  readonly transferPriceInr: string;
  readonly minRetailInr: string | null;
  readonly maxRetailInr: string | null;
  readonly suggestedRetailInr: string | null;
}

export interface AdminStoreTermsRow {
  readonly variantId: string;
  readonly productName: string;
  readonly skuCode: string;
  readonly variantLabel: string | null;
  readonly thumbnailUrl: string | null;
  readonly effective: AdminPriceTerms | null;
  readonly priceSource: 'OVERRIDE' | 'DEFAULT' | null;
  readonly enabled: boolean;
  readonly stockMode: 'SHARED' | 'SET_ASIDE';
  readonly setAsideQty: number | null;
  readonly hiddenPercent: number;
  readonly overlayTitle: string | null;
  readonly realAvailable: number;
  readonly visibleQty: number;
  readonly sellable: boolean;
  readonly notSellableReason: 'NOT_ENABLED' | 'NO_TRANSFER_PRICE' | 'VARIANT_NOT_RESELLABLE' | null;
}

export interface AdminStoreTermsView {
  readonly rows: readonly AdminStoreTermsRow[];
  readonly truncated: boolean;
}

export function useAdminResellerCatalogue(storeId: string): UseQueryResult<AdminStoreTermsView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-reseller-catalogue', storeId],
    queryFn: () =>
      client.request<AdminStoreTermsView>(`/api/admin/reseller-stores/${storeId}/catalogue`),
  });
}
