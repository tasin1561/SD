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
 * The seller's terms for THIS store (RS-4). Read needs `terms.view`,
 * accepting needs `terms.accept`; the store is the token's, so no store id
 * appears in any path. Every sentence and figure is the API's.
 */

export interface StoreTermsShare {
  readonly feeType: string;
  readonly label: string;
  readonly storePercent: string;
  readonly sellerPercent: string;
  readonly words: string;
}

export interface StoreTermsTiming {
  readonly trigger: string;
  readonly label: string;
  readonly days: number;
  readonly words: string;
}

export interface StoreTermsVersion {
  readonly id: string;
  readonly version: number;
  readonly publishedAt: string;
  readonly note: string | null;
  readonly shares: readonly StoreTermsShare[];
  readonly storeCredit: StoreTermsTiming;
  readonly sellerCredit: StoreTermsTiming;
  readonly acceptance: {
    readonly acceptedAt: string;
    readonly acceptedByName: string;
    readonly ipAddress: string | null;
  } | null;
}

export interface StoreTermsExample {
  readonly feeType: string;
  readonly label: string;
  readonly basis: string;
  readonly feeInr: string;
  readonly storeInr: string;
  readonly sellerInr: string;
}

export interface StoreTermsView {
  readonly storeId: string;
  readonly storeName: string;
  readonly sellerCompanyName: string;
  readonly current: StoreTermsVersion | null;
  readonly currentAccepted: boolean;
  readonly history: readonly StoreTermsVersion[];
  readonly needsRevision: string | null;
  readonly examples: readonly StoreTermsExample[];
  readonly rounding: string;
}

const TERMS = ['store-terms'] as const;

export function useStoreTerms(enabled = true): UseQueryResult<StoreTermsView> {
  const client = useApiClient();
  return useQuery({
    queryKey: TERMS,
    queryFn: () => client.request<StoreTermsView>('/api/store/terms'),
    enabled,
  });
}

export function useAcceptTerms(): UseMutationResult<StoreTermsView, Error, { versionId: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ versionId }) =>
      client.request<StoreTermsView>(`/api/store/terms/${versionId}/accept`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: TERMS }),
  });
}
