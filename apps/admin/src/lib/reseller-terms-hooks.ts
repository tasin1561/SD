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
 * RS-4 for staff: a reseller store's terms (read-only — they are the
 * seller's to publish and the store's to accept), and the per-seller
 * credit-after-confirmation switch (`reseller.credit_after_confirmation.enable`
 * to change; readable with `reseller.stores.view`).
 */

export interface AdminTermsShare {
  readonly feeType: string;
  readonly label: string;
  readonly storePercent: string;
  readonly sellerPercent: string;
  readonly words: string;
}

export interface AdminTermsTiming {
  readonly trigger: string;
  readonly label: string;
  readonly days: number;
  readonly words: string;
}

export interface AdminTermsVersion {
  readonly id: string;
  readonly version: number;
  readonly publishedAt: string;
  readonly publishedBy: string;
  readonly note: string | null;
  readonly shares: readonly AdminTermsShare[];
  readonly storeCredit: AdminTermsTiming;
  readonly sellerCredit: AdminTermsTiming;
  readonly usesAfterConfirmation: boolean;
  readonly acceptance: {
    readonly acceptedAt: string;
    readonly acceptedByName: string;
    readonly ipAddress: string | null;
  } | null;
}

export interface AdminStoreTerms {
  readonly storeId: string;
  readonly storeName: string;
  readonly sellerCompanyName: string;
  readonly current: AdminTermsVersion | null;
  readonly currentAccepted: boolean;
  readonly history: readonly AdminTermsVersion[];
  readonly afterConfirmationEnabled: boolean;
  readonly needsRevision: string | null;
  readonly examples: ReadonlyArray<{
    readonly feeType: string;
    readonly label: string;
    readonly basis: string;
    readonly feeInr: string;
    readonly storeInr: string;
    readonly sellerInr: string;
  }>;
  readonly rounding: string;
}

export interface CreditAfterConfirmationStatus {
  readonly sellerId: string;
  readonly enabled: boolean;
  readonly source: 'SELLER_OVERRIDE' | 'SYSTEM_DEFAULT' | 'UNREADABLE';
  readonly flaggedStores: ReadonlyArray<{
    readonly storeId: string;
    readonly storeName: string;
    readonly version: number;
  }>;
}

export function useAdminResellerStoreTerms(storeId: string): UseQueryResult<AdminStoreTerms> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-reseller-store-terms', storeId],
    queryFn: () => client.request<AdminStoreTerms>(`/api/admin/reseller-stores/${storeId}/terms`),
  });
}

const CAC = ['admin-credit-after-confirmation'] as const;

export function useCreditAfterConfirmation(
  sellerId: string,
  enabled: boolean,
): UseQueryResult<CreditAfterConfirmationStatus> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...CAC, sellerId],
    queryFn: () =>
      client.request<CreditAfterConfirmationStatus>(
        `/api/admin/sellers/${sellerId}/reseller-credit-after-confirmation`,
      ),
    enabled,
  });
}

export function useSetCreditAfterConfirmation(
  sellerId: string,
): UseMutationResult<CreditAfterConfirmationStatus, Error, { enabled: boolean; reason: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<CreditAfterConfirmationStatus>(
        `/api/admin/sellers/${sellerId}/reseller-credit-after-confirmation`,
        { method: 'PUT', body },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...CAC, sellerId] }),
  });
}
