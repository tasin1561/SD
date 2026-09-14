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
 * A reseller store's TERMS (RS-4) — who pays which Skydrop fee on the
 * store's orders, and when each side is credited.
 *
 * Reading needs `stores.manage` or `stores.pricing`; publishing needs
 * `stores.pricing`. Every figure and sentence comes from the API — the
 * worked example is the server's fee-split arithmetic, never recomputed
 * here, so the screen and the orders cannot disagree by a paisa.
 */

export type CreditTrigger = 'ON_PAYOUT' | 'AFTER_DELIVERY' | 'INSTANT' | 'AFTER_CONFIRMATION';
export type FeeType =
  | 'DELIVERY_FEE'
  | 'RETURN_FEE'
  | 'CUSTOMER_RETURN_FEE'
  | 'COD_FEE'
  | 'COD_TAX'
  | 'INSTANT_PAY_FEE';

export type PercentField =
  | 'deliveryFeeStorePercent'
  | 'returnFeeStorePercent'
  | 'customerReturnFeeStorePercent'
  | 'codFeeStorePercent'
  | 'codTaxStorePercent'
  | 'instantPayFeeStorePercent';

/** The six shares in the order the API lists them. Labels are form copy only. */
export const FEE_FIELDS: ReadonlyArray<{
  readonly feeType: FeeType;
  readonly field: PercentField;
  readonly label: string;
}> = [
  { feeType: 'DELIVERY_FEE', field: 'deliveryFeeStorePercent', label: 'Delivery fee' },
  { feeType: 'RETURN_FEE', field: 'returnFeeStorePercent', label: 'Return fee' },
  {
    feeType: 'CUSTOMER_RETURN_FEE',
    field: 'customerReturnFeeStorePercent',
    label: 'Customer return fee',
  },
  { feeType: 'COD_FEE', field: 'codFeeStorePercent', label: 'COD fee' },
  { feeType: 'COD_TAX', field: 'codTaxStorePercent', label: 'COD tax' },
  { feeType: 'INSTANT_PAY_FEE', field: 'instantPayFeeStorePercent', label: 'Instant Pay fee' },
];

export const CREDIT_TRIGGERS: ReadonlyArray<{
  readonly value: CreditTrigger;
  readonly label: string;
}> = [
  { value: 'ON_PAYOUT', label: 'When the courier pays us (+ days)' },
  { value: 'AFTER_DELIVERY', label: 'Days after delivery' },
  { value: 'INSTANT', label: 'Instant, at delivery (Instant Pay fee applies)' },
  { value: 'AFTER_CONFIRMATION', label: 'Days after confirmation' },
];

export interface TermsShare {
  readonly feeType: FeeType;
  readonly label: string;
  readonly storePercent: string;
  readonly sellerPercent: string;
  readonly words: string;
}

export interface TermsTiming {
  readonly trigger: CreditTrigger;
  readonly label: string;
  readonly days: number;
  readonly words: string;
}

export interface TermsVersion {
  readonly id: string;
  readonly version: number;
  readonly publishedAt: string;
  readonly publishedBy: string;
  readonly note: string | null;
  readonly shares: readonly TermsShare[];
  readonly storeCredit: TermsTiming;
  readonly sellerCredit: TermsTiming;
  readonly usesAfterConfirmation: boolean;
  readonly acceptance: {
    readonly acceptedAt: string;
    readonly acceptedByName: string;
    readonly ipAddress: string | null;
  } | null;
}

export interface FeeExample {
  readonly feeType: FeeType;
  readonly label: string;
  readonly basis: string;
  readonly feeInr: string;
  readonly storeInr: string;
  readonly sellerInr: string;
}

export interface StoreTerms {
  readonly storeId: string;
  readonly storeName: string;
  readonly sellerCompanyName: string;
  readonly storeStatus: string;
  readonly current: TermsVersion | null;
  readonly currentAccepted: boolean;
  readonly history: readonly TermsVersion[];
  readonly afterConfirmationEnabled: boolean;
  readonly needsRevision: string | null;
  readonly examples: readonly FeeExample[];
  readonly rounding: string;
}

export interface TermsPreview {
  readonly shares: readonly TermsShare[];
  readonly examples: readonly FeeExample[];
  readonly storeCredit: TermsTiming | null;
  readonly sellerCredit: TermsTiming | null;
  readonly rounding: string;
}

export type TermsDraft = { readonly [K in PercentField]: string } & {
  readonly storeCreditTrigger: CreditTrigger;
  readonly storeCreditDays: number;
  readonly sellerCreditTrigger: CreditTrigger;
  readonly sellerCreditDays: number;
};

const KEY = ['seller-reseller-store-terms'] as const;

export function useResellerStoreTerms(storeId: string): UseQueryResult<StoreTerms> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, storeId],
    queryFn: () => client.request<StoreTerms>(`/api/seller/reseller-stores/${storeId}/terms`),
  });
}

function draftQuery(draft: TermsDraft): string {
  const qs = new URLSearchParams();
  for (const { field } of FEE_FIELDS) qs.set(field, draft[field].trim());
  qs.set('storeCreditTrigger', draft.storeCreditTrigger);
  qs.set('storeCreditDays', String(draft.storeCreditDays));
  qs.set('sellerCreditTrigger', draft.sellerCreditTrigger);
  qs.set('sellerCreditDays', String(draft.sellerCreditDays));
  return qs.toString();
}

/** The draft worked through the API's arithmetic. Keeps the last good answer while typing. */
export function useTermsPreview(
  storeId: string,
  draft: TermsDraft | null,
): UseQueryResult<TermsPreview> {
  const client = useApiClient();
  const qs = draft === null ? '' : draftQuery(draft);
  return useQuery({
    queryKey: [...KEY, storeId, 'preview', qs],
    queryFn: () =>
      client.request<TermsPreview>(`/api/seller/reseller-stores/${storeId}/terms/preview?${qs}`),
    enabled: draft !== null,
    placeholderData: (previous) => previous,
    retry: false,
  });
}

export function usePublishTerms(
  storeId: string,
): UseMutationResult<
  StoreTerms,
  Error,
  TermsDraft & { note?: string | undefined; basedOnVersion: number }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<StoreTerms>(`/api/seller/reseller-stores/${storeId}/terms`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...KEY, storeId] }),
  });
}
