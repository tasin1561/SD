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
  WalletEntryDirection,
  WithdrawalRequestStatus,
} from '@skydrop/db';

/**
 * The store's OWN wallet (RS-6). Every path is `/api/store/wallet*` —
 * scoped server-side by the token, so no store id appears in any URL here.
 */

export type WalletManager = 'SELLER' | 'SKYDROP';

export interface StoreWalletSummary {
  readonly storeId: string;
  readonly storeName: string;
  readonly displayName: string | null;
  readonly sellerId: string;
  readonly sellerCompanyName: string;
  readonly walletManagedBy: WalletManager | null;
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
  readonly shareOf: WalletEntryDirection | null;
  readonly linkedOrderId: string | null;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface StoreWalletLedger {
  readonly items: readonly StoreWalletEntryView[];
  readonly nextCursor: string | null;
}

export interface StoreBankAccountView {
  readonly id: string;
  readonly label: string;
  readonly bankName: string;
  readonly accountName: string;
  readonly accountNumber: string;
  readonly branchCode: string | null;
  readonly branchName: string | null;
  readonly instructions: string | null;
}

export interface StoreTopupView {
  readonly id: string;
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

export interface StoreWithdrawalView {
  readonly id: string;
  readonly amountInr: string;
  readonly status: WithdrawalRequestStatus;
  readonly payeeName: string;
  readonly payeeAccountNumber: string;
  readonly payeeIfsc: string;
  readonly payeeBankName: string;
  readonly rejectionReason: string | null;
  readonly bankReference: string | null;
  readonly paidAt: string | null;
  readonly createdAt: string;
}

export interface SubmitTopupInput {
  readonly bankAccountId: string;
  readonly amountInr: string;
  readonly transactionRef?: string;
  readonly proof?: File;
  /** IDEM-1 — minted when the form opens, reused on a retry. */
  readonly idempotencyKey: string;
}

export interface RequestWithdrawalInput {
  readonly amountInr: string;
  readonly payeeName: string;
  readonly payeeAccountNumber: string;
  readonly payeeIfsc: string;
  readonly payeeBankName: string;
  readonly note?: string;
  /** IDEM-1 — minted when the form opens, reused on a retry. */
  readonly idempotencyKey: string;
}

/** How many ledger rows one page asks for. */
export const LEDGER_PAGE_SIZE = 50;

const KEY = ['store-wallet'] as const;

export function useStoreWallet(enabled = true): UseQueryResult<StoreWalletSummary> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'summary'],
    queryFn: () => client.request<StoreWalletSummary>('/api/store/wallet'),
    enabled,
  });
}

/**
 * The ledger, newest first, a page at a time: each older page asks for
 * the entries before the last one already shown (`before`), so nothing is
 * silently cut off at a fixed limit.
 */
export function useStoreWalletEntries(
  enabled = true,
): UseInfiniteQueryResult<InfiniteData<StoreWalletLedger>> {
  const client = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEY, 'entries'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      client.request<StoreWalletLedger>(
        `/api/store/wallet/entries?limit=${LEDGER_PAGE_SIZE}${
          pageParam === null ? '' : `&before=${encodeURIComponent(pageParam)}`
        }`,
      ),
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

export function useStoreBankAccounts(
  enabled = true,
): UseQueryResult<readonly StoreBankAccountView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'bank-accounts'],
    queryFn: () =>
      client.request<readonly StoreBankAccountView[]>('/api/store/wallet/bank-accounts'),
    enabled,
  });
}

export function useStoreTopups(enabled = true): UseQueryResult<readonly StoreTopupView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'topups'],
    queryFn: () => client.request<readonly StoreTopupView[]>('/api/store/wallet/topups'),
    enabled,
  });
}

export function useStoreWithdrawals(
  enabled = true,
): UseQueryResult<readonly StoreWithdrawalView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'withdrawals'],
    queryFn: () => client.request<readonly StoreWithdrawalView[]>('/api/store/wallet/withdrawals'),
    enabled,
  });
}

interface ProofPresign {
  readonly uploadUrl: string;
  readonly spacesKey: string;
}

/**
 * Presign → PUT the proof straight to Spaces → submit the claim with its
 * key. The PUT is a raw fetch to the presigned URL (storage, not our API).
 */
export function useSubmitStoreTopup(): UseMutationResult<StoreTopupView, Error, SubmitTopupInput> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      let proof: { proofSpacesKey: string; proofMimeType: string } | null = null;
      if (input.proof !== undefined) {
        const presign = await client.request<ProofPresign>(
          '/api/store/wallet/topups/proof-upload',
          {
            method: 'POST',
            body: { mimeType: input.proof.type },
          },
        );
        const put = await fetch(presign.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': input.proof.type },
          body: input.proof,
        });
        if (!put.ok) throw new Error(`The upload failed (${put.status}). Try again.`);
        proof = { proofSpacesKey: presign.spacesKey, proofMimeType: input.proof.type };
      }
      return client.request<StoreTopupView>('/api/store/wallet/topups', {
        method: 'POST',
        body: {
          bankAccountId: input.bankAccountId,
          amountInr: input.amountInr,
          idempotencyKey: input.idempotencyKey,
          ...(input.transactionRef === undefined || input.transactionRef === ''
            ? {}
            : { transactionRef: input.transactionRef }),
          ...(proof === null ? {} : proof),
        },
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRequestStoreWithdrawal(): UseMutationResult<
  StoreWithdrawalView,
  Error,
  RequestWithdrawalInput
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<StoreWithdrawalView>('/api/store/wallet/withdrawals', {
        method: 'POST',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useStoreTopupProof(): UseMutationResult<
  { url: string },
  Error,
  { topupId: string }
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({ topupId }) =>
      client.request<{ url: string }>(`/api/store/wallet/topups/${topupId}/proof`),
  });
}
