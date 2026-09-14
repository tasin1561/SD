'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';

/**
 * RS-3 — the store's own catalogue. `/api/store/catalogue` is scoped by
 * the token server-side, so no store id appears in the path.
 */

export interface StoreCatalogueItem {
  readonly variantId: string;
  readonly skuCode: string;
  readonly title: string;
  readonly variantLabel: string | null;
  readonly description: string | null;
  readonly imageUrls: readonly string[];
  readonly transferPriceInr: string;
  readonly minRetailInr: string | null;
  readonly maxRetailInr: string | null;
  readonly suggestedRetailInr: string | null;
  readonly availableQty: number;
}

export interface StoreCatalogueView {
  readonly items: readonly StoreCatalogueItem[];
}

export function useStoreCatalogue(enabled = true): UseQueryResult<StoreCatalogueView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['store-catalogue'],
    queryFn: () => client.request<StoreCatalogueView>('/api/store/catalogue'),
    enabled,
  });
}
