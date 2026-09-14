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
export type PnlLockStateView = 'PROVISIONAL' | 'FINAL';
export type PnlVersionKindView =
  | 'AUTO_FINAL'
  | 'AUTO_PROVISIONAL'
  | 'LOCK_PERMANENTLY'
  | 'GOD_MODE'
  | 'BACKFILL'
  | 'MANUAL';

export interface PnlVersionView {
  readonly version: number;
  readonly kind: PnlVersionKindView;
  readonly lockState: PnlLockStateView;
  readonly createdAt: string;
  readonly by: string | null;
  readonly reason: string | null;
  readonly netBeforeInr: string | null;
  readonly netInr: string;
  readonly current: boolean;
}

export interface PnlMonthListItemView {
  readonly month: string;
  readonly name: string;
  readonly status: PnlMonthStatus;
  readonly lockState: PnlLockStateView | null;
  readonly version: number | null;
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
  readonly lockState: PnlLockStateView | null;
  readonly window: { readonly from: string; readonly to: string };
  readonly shownVersion: number | null;
  readonly report: PnlReportView;
  readonly versions: readonly PnlVersionView[];
  readonly shown: { readonly nightlyJobs: unknown; readonly carriedOut: unknown } | null;
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

/** A month; a closed one at its current version, or `version` read-only. */
export function usePnlMonth(
  month: string | null,
  version: number | null = null,
): UseQueryResult<PnlMonthView> {
  const client = useApiClient();
  const m = month === null ? '' : month;
  const qs = version === null ? '' : `?version=${version}`;
  return useQuery({
    queryKey: [KEY, 'month', month, version],
    enabled: month !== null,
    queryFn: () => client.request<PnlMonthView>(`/api/admin/treasury/pnl-periods/${m}${qs}`),
  });
}

export function usePnlFrozenRows(
  month: string,
  line: string,
  version: number | null = null,
): UseQueryResult<{ rows: readonly FrozenRowView[]; truncated: boolean }> {
  const client = useApiClient();
  const qs = version === null ? '' : `?version=${version}`;
  return useQuery({
    queryKey: [KEY, 'frozen-rows', month, line, version],
    queryFn: () =>
      client.request<{ rows: readonly FrozenRowView[]; truncated: boolean }>(
        `/api/admin/treasury/pnl-periods/${month}/lines/${line}/rows${qs}`,
      ),
  });
}

export interface RelockResultView {
  readonly month: string;
  readonly version: number;
  readonly kind: PnlVersionKindView;
  readonly lockState: PnlLockStateView;
  readonly netBeforeInr: string;
  readonly netInr: string;
  readonly rows: number;
  readonly carriedOutNetInr: string;
  readonly gatePassed: boolean;
}

/** PROVISIONAL → FINAL, re-snapshotted with everything that has arrived. */
export function useLockPnlPermanently(): UseMutationResult<
  RelockResultView,
  Error,
  { month: string; reason: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ month, reason }) =>
      client.request<RelockResultView>(
        `/api/admin/treasury/pnl-periods/${month}/lock-permanently`,
        { method: 'POST', body: { reason } },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [KEY] });
    },
  });
}

/** GOD MODE: re-lock a month as the ledgers say today, less what was already carried forward. */
export function useGodModeRelockPnl(): UseMutationResult<
  RelockResultView,
  Error,
  { month: string; reason: string; confirmMonth: string; acknowledgeRisk: boolean }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ month, ...body }) =>
      client.request<RelockResultView>(`/api/admin/treasury/pnl-periods/${month}/god-mode-relock`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [KEY] });
    },
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
