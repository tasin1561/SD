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
 * Skydrop's analysis across reseller stores (RS-9). Fraud flags and
 * disputes need `reseller.stores.view`; the float needs
 * `money.treasury.view`; pausing a store needs `reseller.stores.pause`.
 */

export interface FraudThresholds {
  readonly windowDays: number;
  readonly minOrders: number;
  readonly cancelRatePct: number;
  readonly returnRatePct: number;
  readonly ndrRatePct: number;
  readonly ordersPerHour: number;
  readonly retailMarkupPct: number;
  readonly sharedPhoneStores: number;
}

export interface FraudFlag {
  readonly rule: string;
  readonly storeId: string;
  readonly storeName: string;
  readonly sellerId: string;
  readonly sellerName: string;
  readonly severity: 'MEDIUM' | 'HIGH';
  readonly value: string;
  readonly threshold: string;
  readonly reason: string;
}

export interface FraudReport {
  readonly asOf: string;
  readonly windowFrom: string;
  readonly thresholds: FraudThresholds;
  readonly storesChecked: number;
  readonly flags: readonly FraudFlag[];
}

export interface DisputesOverview {
  readonly lookbackDays: number;
  readonly open: number;
  readonly settled: number;
  readonly byStatus: ReadonlyArray<{ readonly status: string; readonly count: number }>;
  readonly byType: ReadonlyArray<{ readonly type: string; readonly count: number }>;
  readonly byStore: ReadonlyArray<{
    readonly storeId: string;
    readonly storeName: string;
    readonly sellerName: string;
    readonly open: number;
    readonly total: number;
  }>;
  readonly openTickets: ReadonlyArray<{
    readonly id: string;
    readonly ticketNumber: string;
    readonly ticketType: string;
    readonly status: string;
    readonly subject: string;
    readonly orderNumber: string;
    readonly storeName: string;
    readonly sellerName: string;
    readonly createdAt: string;
  }>;
}

export interface ResellerFloat {
  readonly sellers: ReadonlyArray<{
    readonly sellerId: string;
    readonly sellerName: string;
    readonly sellerWalletInr: string;
    readonly storesWalletInr: string;
    readonly groupInr: string;
    readonly instantPayAdvanceInr: string;
    readonly instantPayAdvanceOrders: number;
    readonly stores: ReadonlyArray<{
      readonly storeId: string;
      readonly storeName: string;
      readonly status: string | null;
      readonly balanceInr: string;
      readonly negativeLimitInr: string;
      readonly creditedBeforePayoutInr: string;
      readonly creditedBeforePayoutOrders: number;
    }>;
  }>;
  readonly totals: {
    readonly storesWalletInr: string;
    readonly storesNegativeInr: string;
    readonly creditedBeforePayoutInr: string;
    readonly instantPayAdvanceInr: string;
  };
}

const KEY = ['admin-reseller-analysis'] as const;

export function useResellerFraudFlags(): UseQueryResult<FraudReport> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'fraud'],
    queryFn: () => client.request<FraudReport>('/api/admin/reseller-analysis/fraud-flags'),
  });
}

export function useResellerDisputes(): UseQueryResult<DisputesOverview> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'disputes'],
    queryFn: () => client.request<DisputesOverview>('/api/admin/reseller-analysis/disputes'),
  });
}

export function useResellerFloat(enabled: boolean): UseQueryResult<ResellerFloat> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'float'],
    enabled,
    // money.treasury.view — gated in the page with usePermission.
    queryFn: () => client.request<ResellerFloat>('/api/admin/reseller-analysis/float'),
  });
}

export function usePauseResellerStore(): UseMutationResult<
  unknown,
  Error,
  { readonly storeId: string; readonly reason: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, reason }) =>
      client.request<unknown>(`/api/admin/reseller-analysis/stores/${storeId}/pause`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ['admin-reseller-stores'] });
    },
  });
}
