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
 * The store's OWN reports and expense book (RS-8 / RS-9). Every path is
 * `/api/store/reports*` or `/api/store/expenses*` — scoped server-side by
 * the token, so no store id appears in any URL here.
 */

export type StorePnlSide = 'revenue' | 'cost';

export interface StorePnlRow {
  readonly id: string;
  readonly ref: string;
  readonly subRef: string | null;
  readonly at: string;
  readonly amountInr: string;
  readonly context?: { readonly retailInr: string; readonly transferInr: string };
}

export interface StorePnlLine {
  readonly key: string;
  readonly label: string;
  readonly side: StorePnlSide;
  readonly note: string;
  readonly amountInr: string;
  readonly count: number;
  readonly rows: readonly StorePnlRow[];
}

export interface StorePnlReport {
  readonly from: string;
  readonly to: string;
  readonly lines: readonly StorePnlLine[];
  readonly revenueInr: string;
  readonly costInr: string;
  readonly netInr: string;
  readonly expensesByCategory: ReadonlyArray<{
    readonly category: string;
    readonly label: string;
    readonly amountInr: string;
  }>;
  readonly cash: {
    readonly inInr: string;
    readonly outInr: string;
    readonly byDirection: ReadonlyArray<{
      readonly direction: string;
      readonly amountInr: string;
      readonly count: number;
    }>;
  };
  readonly warnings: readonly string[];
}

export interface StoreCarryView {
  readonly id: string;
  readonly originMonth: string;
  readonly landedMonth: string;
  readonly lineLabel: string;
  readonly ref: string;
  readonly subRef: string | null;
  readonly beforeInr: string | null;
  readonly afterInr: string | null;
  readonly deltaInr: string;
  readonly netEffectInr: string;
  readonly reason: string;
  readonly detectedAt: string;
}

export interface StorePnlMonthSummary {
  readonly month: string;
  readonly status: 'closed' | 'open';
  readonly closedAt: string | null;
  readonly netInr: string;
  readonly carriedInNetInr: string;
  readonly asReportedNetInr: string;
}

export interface StorePnlMonthView extends StorePnlMonthSummary {
  readonly report: StorePnlReport;
  readonly carriedIn: readonly StoreCarryView[];
  readonly carriedOut: readonly StoreCarryView[];
}

export interface StorePosition {
  readonly balanceInr: string;
  readonly owedToStoreInr: string;
  readonly owedByStoreInr: string;
  readonly withdrawableInr: string | null;
  readonly pendingWithdrawals: { readonly count: number; readonly amountInr: string };
  readonly pendingTopups: { readonly count: number; readonly amountInr: string };
  readonly negativeLimit: {
    readonly ownInr: string;
    readonly capInr: string;
    readonly effectiveInr: string;
  };
  readonly walletManagedBy: 'SELLER' | 'SKYDROP' | null;
}

export interface StoreOrderRates {
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
}

export interface StoreAnalysis {
  readonly from: string;
  readonly to: string;
  readonly rates: StoreOrderRates;
  readonly products: ReadonlyArray<{
    readonly variantId: string;
    readonly skuCode: string;
    readonly productName: string;
    readonly unitsDelivered: number;
    readonly unitsReturned: number;
    readonly returnRatePct: string | null;
    readonly retailInr: string;
    readonly transferInr: string;
    readonly grossMarginInr: string;
  }>;
  readonly pincodes: ReadonlyArray<{
    readonly postalCode: string;
    readonly delivered: number;
    readonly returned: number;
    readonly returnRatePct: string | null;
  }>;
  readonly roas: {
    readonly adSpendInr: string;
    readonly deliveredOrders: number;
    readonly deliveredRetailInr: string;
    readonly deliveredMarginInr: string;
    readonly roas: string | null;
    readonly marginRoas: string | null;
  };
}

export interface StoreCashFlow {
  readonly asOf: string;
  readonly rows: ReadonlyArray<{
    readonly orderId: string;
    readonly orderNumber: string;
    readonly status: string;
    readonly trigger: string | null;
    readonly days: number | null;
    readonly expectedOn: string | null;
    readonly bucket: string;
    readonly overdue: boolean;
    readonly expectedInr: string;
  }>;
  readonly weeks: ReadonlyArray<{
    readonly weekStart: string;
    readonly amountInr: string;
    readonly count: number;
  }>;
  readonly waiting: ReadonlyArray<{
    readonly bucket: string;
    readonly label: string;
    readonly amountInr: string;
    readonly count: number;
  }>;
  readonly totalInr: string;
}

export type ExpenseCategory =
  | 'AD_SPEND'
  | 'STAFF'
  | 'SOFTWARE'
  | 'PHOTOGRAPHY'
  | 'PACKAGING'
  | 'CUSTOMER_REFUNDS'
  | 'RENT'
  | 'OTHER';

export const EXPENSE_CATEGORIES: ReadonlyArray<{ value: ExpenseCategory; label: string }> = [
  { value: 'AD_SPEND', label: 'Advertising' },
  { value: 'STAFF', label: 'Staff' },
  { value: 'SOFTWARE', label: 'Software' },
  { value: 'PHOTOGRAPHY', label: 'Photography' },
  { value: 'PACKAGING', label: 'Packaging' },
  { value: 'CUSTOMER_REFUNDS', label: 'Customer refunds' },
  { value: 'RENT', label: 'Rent' },
  { value: 'OTHER', label: 'Other' },
];

export interface StoreExpenseView {
  readonly id: string;
  readonly category: ExpenseCategory;
  readonly categoryLabel: string;
  readonly amountInr: string;
  readonly expenseDate: string;
  readonly description: string;
  readonly reference: string | null;
  readonly createdAt: string;
  readonly deletedAt: string | null;
  readonly deleteReason: string | null;
}

export interface StoreExpenseList {
  readonly items: readonly StoreExpenseView[];
  readonly totalInr: string;
  readonly byCategory: ReadonlyArray<{
    readonly category: ExpenseCategory;
    readonly label: string;
    readonly amountInr: string;
  }>;
}

export interface Window {
  readonly from: string;
  readonly to: string;
}

const qs = (w: Window): string => new URLSearchParams({ from: w.from, to: w.to }).toString();

const KEY = ['store-reports'] as const;

export function useStorePnlMonths(): UseQueryResult<readonly StorePnlMonthSummary[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'months'],
    queryFn: () => client.request<readonly StorePnlMonthSummary[]>('/api/store/reports/pnl/months'),
  });
}

export function useStorePnlMonth(month: string | null): UseQueryResult<StorePnlMonthView> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'month', month],
    enabled: month !== null,
    queryFn: () =>
      client.request<StorePnlMonthView>(`/api/store/reports/pnl/months/${month ?? ''}`),
  });
}

export function useStorePnl(window: Window): UseQueryResult<StorePnlReport> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'pnl', window.from, window.to],
    queryFn: () => client.request<StorePnlReport>(`/api/store/reports/pnl?${qs(window)}`),
  });
}

export function useStorePosition(): UseQueryResult<StorePosition> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'position'],
    queryFn: () => client.request<StorePosition>('/api/store/reports/position'),
  });
}

export function useStoreAnalysis(window: Window): UseQueryResult<StoreAnalysis> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'analysis', window.from, window.to],
    queryFn: () => client.request<StoreAnalysis>(`/api/store/reports/analysis?${qs(window)}`),
  });
}

export function useStoreCashFlow(): UseQueryResult<StoreCashFlow> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'cash-flow'],
    queryFn: () => client.request<StoreCashFlow>('/api/store/reports/cash-flow'),
  });
}

const EXPENSES = ['store-expenses'] as const;

export function useStoreExpenses(window: Window): UseQueryResult<StoreExpenseList> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...EXPENSES, window.from, window.to],
    queryFn: () => client.request<StoreExpenseList>(`/api/store/expenses?${qs(window)}`),
  });
}

export interface RecordExpenseInput {
  readonly category: ExpenseCategory;
  readonly amountInr: string;
  readonly expenseDate: string;
  readonly description: string;
  readonly reference?: string;
  readonly idempotencyKey: string;
}

export function useRecordStoreExpense(): UseMutationResult<
  StoreExpenseView,
  Error,
  RecordExpenseInput
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      client.request<StoreExpenseView>('/api/store/expenses', {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: EXPENSES });
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

export function useRemoveStoreExpense(): UseMutationResult<
  StoreExpenseView,
  Error,
  { readonly id: string; readonly reason: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }) =>
      client.request<StoreExpenseView>(`/api/store/expenses/${id}/remove`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: EXPENSES });
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
}
