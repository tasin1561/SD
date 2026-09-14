import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import type { PnlReportView } from './ops-hooks';

/**
 * The carry-forward P&L (PNL-CF-1): months frozen at close, and the
 * changes to them found later, carried into the month then open.
 */

export type PnlMonthStatus = 'CLOSED' | 'OPEN' | 'AWAITING_CLOSE';
export type PnlCloseKindView = 'AUTO' | 'MANUAL' | 'BACKFILL';

export interface PnlMonthListItemView {
  readonly month: string;
  readonly name: string;
  readonly status: PnlMonthStatus;
  readonly closedAt: string | null;
  readonly closedBy: string | null;
  readonly closeKind: PnlCloseKindView | null;
  readonly frozenNetInr: string | null;
  readonly carriedInNetInr: string;
  readonly carriedInCount: number;
  readonly laterChangesNetInr: string;
  readonly laterChangesCount: number;
}

export interface CarriedLineView {
  readonly lineKey: string;
  readonly name: string;
  readonly revenueInr: string;
  readonly costInr: string;
  readonly netInr: string;
  readonly count: number;
}

export interface CarriedGroupView {
  readonly originMonth: string;
  readonly landedMonth: string;
  readonly name: string;
  readonly revenueInr: string;
  readonly costInr: string;
  readonly netInr: string;
  readonly count: number;
  readonly lines: readonly CarriedLineView[];
}

export interface PnlMonthView {
  readonly month: string;
  readonly name: string;
  readonly status: PnlMonthStatus;
  readonly window: { readonly from: string; readonly to: string };
  readonly report: PnlReportView;
  readonly closed: {
    readonly at: string;
    readonly by: string | null;
    readonly kind: PnlCloseKindView;
    readonly reason: string | null;
    readonly nightlyJobs: unknown;
  } | null;
  readonly carriedIn: readonly CarriedGroupView[];
  readonly laterChanges: readonly CarriedGroupView[];
  readonly totals: {
    readonly ownNetInr: string;
    readonly carriedInNetInr: string;
    readonly netInr: string;
  };
}

export interface FrozenRowView {
  readonly refKey: string;
  readonly ref: string;
  readonly subRef: string | null;
  readonly at: string;
  readonly revenueInr: string | null;
  readonly costInr: string | null;
}

export interface CarryForwardRowView {
  readonly id: string;
  readonly originMonth: string;
  readonly landedMonth: string;
  readonly lineKey: string;
  readonly lineName: string;
  readonly refKey: string;
  readonly ref: string;
  readonly subRef: string | null;
  readonly at: string;
  readonly present: boolean;
  readonly revenueDeltaInr: string;
  readonly costDeltaInr: string;
  readonly netInr: string;
  readonly revenueBeforeInr: string | null;
  readonly revenueAfterInr: string | null;
  readonly costBeforeInr: string | null;
  readonly costAfterInr: string | null;
  readonly reason: string;
  readonly detectedAt: string;
}

export interface CarryForwardFilter {
  readonly landedIn?: string;
  readonly origin?: string;
  readonly line?: string;
}

export interface NightlyGateView {
  readonly since: string;
  readonly passed: boolean;
  readonly jobs: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly status: 'OK' | 'NOT_RUN' | 'FAILED' | 'PARTIAL' | 'SWITCHED_OFF';
    readonly ranAt: string | null;
    readonly detail: string;
  }>;
}

export interface CloseResultView {
  readonly month: string;
  readonly alreadyClosed: boolean;
  readonly closedAt: string;
  readonly netInr: string;
  readonly rows: number;
  readonly carriedIn: number;
}

export interface BackfillResultView {
  readonly dryRun: boolean;
  readonly throughMonth: string;
  readonly firstActivityMonth: string | null;
  readonly months: ReadonlyArray<{
    readonly month: string;
    readonly action: 'ALREADY_CLOSED' | 'WOULD_CLOSE' | 'CLOSED' | 'SKIPPED' | 'FAILED';
    readonly netInr: string | null;
    readonly complete: boolean | null;
    readonly note: string | null;
  }>;
}

const KEY = 'admin-pnl-periods';

export function usePnlPeriods(): UseQueryResult<{
  currentMonth: string;
  months: readonly PnlMonthListItemView[];
}> {
  const client = useApiClient();
  return useQuery({
    queryKey: [KEY, 'list'],
    queryFn: () =>
      client.request<{ currentMonth: string; months: readonly PnlMonthListItemView[] }>(
        '/api/admin/treasury/pnl-periods',
      ),
  });
}

export function usePnlMonth(month: string | null): UseQueryResult<PnlMonthView> {
  const client = useApiClient();
  const m = month === null ? '' : month;
  return useQuery({
    queryKey: [KEY, 'month', month],
    enabled: month !== null,
    queryFn: () => client.request<PnlMonthView>(`/api/admin/treasury/pnl-periods/${m}`),
  });
}

export function usePnlFrozenRows(
  month: string,
  line: string,
): UseQueryResult<{ rows: readonly FrozenRowView[]; truncated: boolean }> {
  const client = useApiClient();
  return useQuery({
    queryKey: [KEY, 'frozen-rows', month, line],
    queryFn: () =>
      client.request<{ rows: readonly FrozenRowView[]; truncated: boolean }>(
        `/api/admin/treasury/pnl-periods/${month}/lines/${line}/rows`,
      ),
  });
}

export function usePnlCarryForwardRows(
  filter: CarryForwardFilter,
): UseQueryResult<{ rows: readonly CarryForwardRowView[]; truncated: boolean }> {
  const client = useApiClient();
  const sp = new URLSearchParams();
  if (filter.landedIn !== undefined) sp.set('landedIn', filter.landedIn);
  if (filter.origin !== undefined) sp.set('origin', filter.origin);
  if (filter.line !== undefined) sp.set('line', filter.line);
  const qs = sp.toString();
  return useQuery({
    queryKey: [KEY, 'carry-forwards', filter],
    queryFn: () =>
      client.request<{ rows: readonly CarryForwardRowView[]; truncated: boolean }>(
        `/api/admin/treasury/pnl-carry-forwards?${qs}`,
      ),
  });
}

export function usePnlNightlyJobs(month: string): UseQueryResult<NightlyGateView> {
  const client = useApiClient();
  return useQuery({
    queryKey: [KEY, 'nightly-jobs', month],
    queryFn: () =>
      client.request<NightlyGateView>(`/api/admin/treasury/pnl-periods/${month}/nightly-jobs`),
  });
}

/** Close a finished month by hand. Final — there is no reopen. */
export function useClosePnlMonth(): UseMutationResult<
  CloseResultView,
  Error,
  { month: string; reason: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ month, reason }) =>
      client.request<CloseResultView>(`/api/admin/treasury/pnl-periods/${month}/close`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [KEY] });
    },
  });
}

/** Close the months that existed before carry-forward — a dry run unless `dryRun` is false. */
export function useBackfillPnlClose(): UseMutationResult<
  BackfillResultView,
  Error,
  { dryRun: boolean; throughMonth?: string; reason?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<BackfillResultView>('/api/admin/treasury/pnl-periods/backfill-close', {
        method: 'POST',
        body,
      }),
    onSuccess: (r) => {
      if (!r.dryRun) void qc.invalidateQueries({ queryKey: [KEY] });
    },
  });
}
