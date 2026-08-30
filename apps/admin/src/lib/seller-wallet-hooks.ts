'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';

export interface SellerWalletRow {
  readonly sellerId: string;
  readonly companyName: string;
  readonly email: string;
  readonly status: string;
  readonly balanceInr: string;
  readonly pendingWithdrawalInr: string;
  readonly pendingTopupInr: string;
  readonly updatedAt: string | null;
}

export interface SellerWalletTotals {
  readonly owedToSellersInr: string;
  readonly owedBySellersInr: string;
  readonly netInr: string;
  readonly pendingWithdrawalInr: string;
  readonly pendingTopupInr: string;
  readonly sellersInCredit: number;
  readonly sellersInDebt: number;
}

export interface SellerWalletDetail {
  readonly seller: { id: string; companyName: string; email: string; status: string };
  readonly balanceInr: string;
  readonly withdrawableInr: string;
  readonly minimumBalanceInr: string;
  readonly pendingWithdrawalInr: string;
  readonly pendingTopupInr: string;
  readonly settings: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly hint: string;
    readonly value: string;
    readonly source: string;
  }>;
}

export interface AdminWalletEntry {
  readonly id: string;
  readonly currency: string;
  readonly direction: string;
  readonly amount: string;
  readonly runningBalanceAfter: string;
  readonly linkedOrderId: string | null;
  readonly linkedOrderNumber: string | null;
  /** Set on an INBOUND_FREIGHT debit — freight belongs to a consignment. */
  readonly linkedConsignmentId: string | null;
  readonly linkedConsignmentNumber: string | null;
  readonly reasonCode: string | null;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface WalletReconcileResult {
  readonly checked: number;
  readonly repaired: number;
  readonly drifted: ReadonlyArray<{
    readonly sellerId: string;
    readonly companyName: string;
    readonly currency: string;
    readonly running: string;
    readonly summed: string;
  }>;
}

export function useReconcileSellerWallets(): UseMutationResult<WalletReconcileResult, Error, void> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      client.request<WalletReconcileResult>('/api/admin/seller-wallets/reconcile', {
        method: 'POST',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-seller-wallets'] }),
  });
}

export function useSellerWalletOverview(): UseQueryResult<{
  totals: SellerWalletTotals;
  rows: SellerWalletRow[];
}> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-seller-wallets'],
    queryFn: () =>
      client.request<{ totals: SellerWalletTotals; rows: SellerWalletRow[] }>(
        '/api/admin/seller-wallets',
      ),
  });
}

export function useSellerWalletDetail(sellerId: string): UseQueryResult<SellerWalletDetail> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-seller-wallets', sellerId],
    queryFn: () => client.request<SellerWalletDetail>(`/api/admin/seller-wallets/${sellerId}`),
  });
}

export function useSellerWalletEntries(
  sellerId: string,
): UseQueryResult<{ items: AdminWalletEntry[] }> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-seller-wallets', sellerId, 'entries'],
    queryFn: () =>
      client.request<{ items: AdminWalletEntry[] }>(
        `/api/admin/seller-wallets/${sellerId}/entries`,
      ),
  });
}

export function useSellerWalletTopups(sellerId: string): UseQueryResult<unknown[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-seller-wallets', sellerId, 'topups'],
    queryFn: () => client.request<unknown[]>(`/api/admin/seller-wallets/${sellerId}/topups`),
  });
}

export function useSellerWalletWithdrawals(sellerId: string): UseQueryResult<unknown[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-seller-wallets', sellerId, 'withdrawals'],
    queryFn: () => client.request<unknown[]>(`/api/admin/seller-wallets/${sellerId}/withdrawals`),
  });
}
