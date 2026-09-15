'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { ResellerStoreStatusValue } from '@skydrop/api-client';
import { useApiClient } from '@skydrop/auth/client';

/**
 * The seller's reports on their reseller stores (RS-8 / RS-9). Reads need
 * `stores.reports`; setting a store's auto-pause rule needs
 * `stores.manage`. A seller sees a store's scorecard and balance — never
 * its expenses or P&L, which the API does not offer the seller at all.
 */

export interface Scorecard {
  readonly placed: number;
  readonly confirmed: number;
  readonly decided: number;
  readonly confirmationRatePct: string | null;
  readonly calledOff: number;
  readonly cancelRatePct: string | null;
  readonly delivered: number;
  readonly returned: number;
  readonly lost: number;
  readonly deliveryRatePct: string | null;
  readonly returnRatePct: string | null;
  readonly open: number;
  readonly unitsDelivered: number;
  readonly transferDeliveredInr: string;
  readonly retailDeliveredInr: string;
  readonly marginInr: string;
  readonly marginCoverage: { readonly linesWithCost: number; readonly lines: number };
}

export interface AutoPauseRule {
  readonly storeId: string;
  readonly enabled: boolean;
  readonly returnRatePercent: string;
  readonly minDecidedOrders: number;
  readonly windowDays: number;
  readonly lastEvaluatedAt: string | null;
  readonly lastPausedAt: string | null;
}

export interface StoreScoreRow {
  readonly storeId: string;
  readonly name: string;
  readonly displayName: string | null;
  readonly status: ResellerStoreStatusValue | null;
  readonly balanceInr: string;
  readonly scorecard: Scorecard;
  readonly sellerNetInr: string;
  readonly costOfGoodsInr: string;
  readonly profitInr: string;
  readonly autoPause: AutoPauseRule | null;
}

export interface SellerScorecards {
  readonly from: string;
  readonly to: string;
  readonly stores: readonly StoreScoreRow[];
  readonly ranking: ReadonlyArray<{
    readonly rank: number;
    readonly storeId: string;
    readonly name: string;
    readonly profitInr: string;
    readonly costCoverage: { readonly linesWithCost: number; readonly lines: number };
  }>;
}

export interface TransferRevenueReport {
  readonly from: string;
  readonly to: string;
  readonly stores: ReadonlyArray<{
    readonly storeId: string;
    readonly name: string;
    readonly creditsInr: string;
    readonly debitsInr: string;
    readonly netInr: string;
    readonly rows: ReadonlyArray<{
      readonly id: string;
      readonly orderNumber: string;
      readonly direction: string;
      readonly at: string;
      readonly amountInr: string;
    }>;
  }>;
  readonly totals: {
    readonly creditsInr: string;
    readonly debitsInr: string;
    readonly netInr: string;
  };
  readonly deliveredTransfer: ReadonlyArray<{
    readonly storeId: string;
    readonly name: string;
    readonly orders: number;
    readonly transferInr: string;
  }>;
}

export interface StockForecast {
  readonly asOf: string;
  readonly windowDays: number;
  readonly reorderDays: number;
  readonly rows: ReadonlyArray<{
    readonly variantId: string;
    readonly skuCode: string;
    readonly label: string | null;
    /** The product's name, and a short-lived thumbnail (null when none). */
    readonly productName: string;
    readonly imageUrl: string | null;
    readonly onHand: number;
    readonly available: number;
    readonly unitsSold: number;
    readonly dailyRate: string;
    readonly daysOfStock: string | null;
    readonly reorder: boolean;
  }>;
}

export interface ReportWindow {
  readonly from: string;
  readonly to: string;
}

const qs = (w: ReportWindow): string => new URLSearchParams({ from: w.from, to: w.to }).toString();
const KEY = ['seller-reseller-reports'] as const;

export function useResellerScorecards(w: ReportWindow): UseQueryResult<SellerScorecards> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'scorecards', w.from, w.to],
    queryFn: () =>
      client.request<SellerScorecards>(`/api/seller/reseller-reports/scorecards?${qs(w)}`),
  });
}

export function useResellerTransferRevenue(w: ReportWindow): UseQueryResult<TransferRevenueReport> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'transfer-revenue', w.from, w.to],
    queryFn: () =>
      client.request<TransferRevenueReport>(
        `/api/seller/reseller-reports/transfer-revenue?${qs(w)}`,
      ),
  });
}

export function useResellerStockForecast(): UseQueryResult<StockForecast> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'stock-forecast'],
    queryFn: () => client.request<StockForecast>('/api/seller/reseller-reports/stock-forecast'),
  });
}

export interface AutoPauseInput {
  readonly storeId: string;
  readonly enabled: boolean;
  readonly returnRatePercent: string;
  readonly minDecidedOrders: number;
  readonly windowDays: number;
}

export function useSetAutoPause(): UseMutationResult<AutoPauseRule, Error, AutoPauseInput> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, ...body }) =>
      client.request<AutoPauseRule>(`/api/seller/reseller-reports/stores/${storeId}/auto-pause`, {
        method: 'PUT',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
}
