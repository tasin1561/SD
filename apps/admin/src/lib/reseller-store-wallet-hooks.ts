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
import type {
  StoreWalletEntryDirection,
  TopupRequestStatus,
  WithdrawalRequestStatus,
} from '@skydrop/db';

/**
 * Reseller store wallets from our side (RS-6): any store's ledger, and the
 * two queues a Skydrop-managed store feeds. Reads need `money.view`;
 * accepting a claim `money.topups.review`; approving or rejecting a
 * withdrawal `money.withdrawals.review`; paying one
 * `money.remittances.manage` — the same keys as the seller money queues.
 */

export interface AdminStoreWalletSummary {
  readonly storeId: string;
  readonly storeName: string;
  readonly displayName: string | null;
  readonly sellerId: string;
  readonly sellerCompanyName: string;
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

export interface AdminStoreWalletEntry {
  readonly id: string;
  readonly direction: StoreWalletEntryDirection;
  readonly amountInr: string;
  readonly runningBalanceAfterInr: string;
  readonly linkedOrderId: string | null;
  readonly note: string | null;
  readonly actorType: string;
  readonly createdAt: string;
}

export interface AdminStoreWalletLedgerPage {
  readonly items: readonly AdminStoreWalletEntry[];
  readonly nextCursor: string | null;
}

/** One page of the ledger; "Show older" asks for the next one by cursor. */
export const STORE_LEDGER_PAGE_SIZE = 50;

export interface AdminStoreTopup {
  readonly id: string;
  readonly storeId: string;
  readonly storeName: string;
  readonly sellerId: string;
  readonly sellerCompanyName: string;
  readonly bankLabel: string;
  readonly bankName: string;
  readonly bankAccountNumber: string;
  readonly amountInr: string;
  readonly transactionRef: string | null;
  readonly hasProof: boolean;
  readonly status: TopupRequestStatus;
  readonly reviewNote: string | null;
  readonly reviewedAt: string | null;
  readonly createdAt: string;
}

export interface AdminStoreWithdrawal {
  readonly id: string;
  readonly storeId: string;
  readonly storeName: string;
  readonly sellerId: string;
  readonly sellerCompanyName: string;
  readonly amountInr: string;
  readonly status: WithdrawalRequestStatus;
  readonly payeeName: string;
  readonly payeeAccountNumber: string;
  readonly payeeIfsc: string;
  readonly payeeBankName: string;
  readonly note: string | null;
  readonly rejectionReason: string | null;
  readonly paidFromLabel: string | null;
  readonly bankReference: string | null;
  readonly paidAt: string | null;
  readonly createdAt: string;
}

const KEY = ['admin-store-wallets'] as const;

export function useAdminStoreWallet(
  storeId: string,
  enabled: boolean,
): UseQueryResult<AdminStoreWalletSummary> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'store', storeId],
    queryFn: () =>
      client.request<AdminStoreWalletSummary>(
        `/api/admin/reseller-store-wallets/stores/${storeId}`,
      ),
    enabled,
  });
}

export function useAdminStoreWalletEntries(
  storeId: string,
  enabled: boolean,
): UseInfiniteQueryResult<InfiniteData<AdminStoreWalletLedgerPage>> {
  const client = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEY, 'store', storeId, 'entries'],
    queryFn: ({ pageParam }) =>
      client.request<AdminStoreWalletLedgerPage>(
        `/api/admin/reseller-store-wallets/stores/${storeId}/entries?limit=${STORE_LEDGER_PAGE_SIZE}${
          pageParam === null ? '' : `&before=${encodeURIComponent(pageParam)}`
        }`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

function queueQuery(status: string, storeId: string | null): string {
  const sp = new URLSearchParams({ status });
  if (storeId !== null && storeId !== '') sp.set('storeId', storeId);
  return sp.toString();
}

export function useAdminStoreTopups(
  status: string,
  storeId: string | null = null,
): UseQueryResult<readonly AdminStoreTopup[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'topups', status, storeId],
    queryFn: () =>
      client.request<readonly AdminStoreTopup[]>(
        `/api/admin/reseller-store-wallets/topups?${queueQuery(status, storeId)}`,
      ),
  });
}

export function useAdminStoreWithdrawals(
  status: string,
  storeId: string | null = null,
): UseQueryResult<readonly AdminStoreWithdrawal[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'withdrawals', status, storeId],
    queryFn: () =>
      client.request<readonly AdminStoreWithdrawal[]>(
        `/api/admin/reseller-store-wallets/withdrawals?${queueQuery(status, storeId)}`,
      ),
  });
}

function useInvalidate(): () => void {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: KEY });
}

export function useAcceptStoreTopup(): UseMutationResult<
  AdminStoreTopup,
  Error,
  { topupId: string; note?: string }
> {
  const client = useApiClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ topupId, ...body }) =>
      client.request<AdminStoreTopup>(
        `/api/admin/reseller-store-wallets/topups/${topupId}/accept`,
        {
          method: 'POST',
          body,
        },
      ),
    onSuccess: invalidate,
  });
}

export function useRejectStoreTopup(): UseMutationResult<
  AdminStoreTopup,
  Error,
  { topupId: string; reason: string }
> {
  const client = useApiClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ topupId, reason }) =>
      client.request<AdminStoreTopup>(
        `/api/admin/reseller-store-wallets/topups/${topupId}/reject`,
        {
          method: 'POST',
          body: { reason },
        },
      ),
    onSuccess: invalidate,
  });
}

export function useStoreTopupProofUrl(): UseMutationResult<
  { url: string },
  Error,
  { topupId: string }
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({ topupId }) =>
      client.request<{ url: string }>(`/api/admin/reseller-store-wallets/topups/${topupId}/proof`),
  });
}

export function useApproveStoreWithdrawal(): UseMutationResult<
  AdminStoreWithdrawal,
  Error,
  { requestId: string }
> {
  const client = useApiClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ requestId }) =>
      client.request<AdminStoreWithdrawal>(
        `/api/admin/reseller-store-wallets/withdrawals/${requestId}/approve`,
        { method: 'POST' },
      ),
    onSuccess: invalidate,
  });
}

export function useRejectStoreWithdrawal(): UseMutationResult<
  AdminStoreWithdrawal,
  Error,
  { requestId: string; reason: string }
> {
  const client = useApiClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ requestId, reason }) =>
      client.request<AdminStoreWithdrawal>(
        `/api/admin/reseller-store-wallets/withdrawals/${requestId}/reject`,
        { method: 'POST', body: { reason } },
      ),
    onSuccess: invalidate,
  });
}

export function usePayStoreWithdrawal(): UseMutationResult<
  AdminStoreWithdrawal,
  Error,
  {
    requestId: string;
    paidFromAccountId: string;
    bankReference: string;
    paidAt: string;
    idempotencyKey: string;
  }
> {
  const client = useApiClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ requestId, ...body }) =>
      client.request<AdminStoreWithdrawal>(
        `/api/admin/reseller-store-wallets/withdrawals/${requestId}/pay`,
        { method: 'POST', body },
      ),
    onSuccess: invalidate,
  });
}
