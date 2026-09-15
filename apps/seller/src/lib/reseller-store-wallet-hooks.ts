'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import type { StoreWalletEntryDirection } from '@skydrop/db';

/**
 * A reseller store's wallet, from the seller's side (RS-6). Every endpoint
 * needs `stores.wallet` and carries the seller id from the token
 * server-side; the store id in the path is checked against it.
 */

export interface StoreWalletSummary {
  readonly storeId: string;
  readonly walletManagedBy: 'SELLER' | 'SKYDROP' | null;
  readonly balanceInr: string;
  readonly withdrawableInr: string | null;
  readonly negativeLimit: {
    readonly ownInr: string;
    readonly capInr: string;
    readonly effectiveInr: string;
  };
  readonly pendingTopups: { readonly count: number; readonly amountInr: string };
  readonly pendingWithdrawals: { readonly count: number; readonly amountInr: string };
}

export interface StoreWalletEntryView {
  readonly id: string;
  readonly direction: StoreWalletEntryDirection;
  readonly amountInr: string;
  readonly runningBalanceAfterInr: string;
  /** The order this movement is about (a credit, a fee share), when there is one. */
  readonly linkedOrderId: string | null;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface StoreWalletLedger {
  readonly items: readonly StoreWalletEntryView[];
  readonly nextCursor: string | null;
}

export interface StoreMoveResult {
  readonly storeEntryId: string;
  readonly replayed: boolean;
  readonly storeBalanceAfterInr: string;
}

const key = (storeId: string) => ['seller-store-wallet', storeId] as const;

export function useResellerStoreWallet(
  storeId: string,
  enabled: boolean,
): UseQueryResult<StoreWalletSummary> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...key(storeId), 'summary'],
    queryFn: () =>
      client.request<StoreWalletSummary>(`/api/seller/reseller-stores/${storeId}/wallet`),
    enabled,
  });
}

/** How many ledger rows one page asks for; "Show older" asks for the next page. */
export const STORE_LEDGER_PAGE_SIZE = 50;

/**
 * The store's ledger, newest first, one page at a time. The API pages with
 * `before=<entry id>` and answers `nextCursor` (null when there is nothing
 * older) — a hard-coded `limit=100` used to hide everything past the
 * hundredth movement with no way to reach it.
 */
export function useResellerStoreWalletEntries(
  storeId: string,
  enabled: boolean,
): UseInfiniteQueryResult<InfiniteData<StoreWalletLedger, string | null>> {
  const client = useApiClient();
  return useInfiniteQuery({
    queryKey: [...key(storeId), 'entries'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      client.request<StoreWalletLedger>(
        `/api/seller/reseller-stores/${storeId}/wallet/entries?limit=${STORE_LEDGER_PAGE_SIZE}` +
          (pageParam === null ? '' : `&before=${encodeURIComponent(pageParam)}`),
      ),
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

export function useTopUpResellerStore(): UseMutationResult<
  StoreMoveResult,
  Error,
  { storeId: string; amountInr: string; note?: string; idempotencyKey: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, ...body }) =>
      client.request<StoreMoveResult>(`/api/seller/reseller-stores/${storeId}/wallet/top-up`, {
        method: 'POST',
        body,
      }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: key(v.storeId) });
      // The seller's own wallet fell by the same amount.
      void qc.invalidateQueries({ queryKey: ['wallet'] });
    },
  });
}

export function useRecordResellerStorePayout(): UseMutationResult<
  StoreMoveResult,
  Error,
  { storeId: string; amountInr: string; note: string; idempotencyKey: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, ...body }) =>
      client.request<StoreMoveResult>(`/api/seller/reseller-stores/${storeId}/wallet/payouts`, {
        method: 'POST',
        body,
      }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: key(v.storeId) });
      void qc.invalidateQueries({ queryKey: ['wallet'] });
    },
  });
}

export function useSetResellerStoreNegativeLimit(): UseMutationResult<
  StoreWalletSummary['negativeLimit'],
  Error,
  { storeId: string; negativeLimitInr: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, negativeLimitInr }) =>
      client.request<StoreWalletSummary['negativeLimit']>(
        `/api/seller/reseller-stores/${storeId}/wallet/negative-limit`,
        { method: 'PATCH', body: { negativeLimitInr } },
      ),
    onSuccess: (_d, v) => void qc.invalidateQueries({ queryKey: key(v.storeId) }),
  });
}
