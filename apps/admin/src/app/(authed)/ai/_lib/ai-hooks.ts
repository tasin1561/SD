'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';

/** The AI control panel's API (`/admin/assistant-panel`). Costs arrive as decimal STRINGS. */
const BASE = '/api/admin/assistant-panel';

export interface UsageBucket {
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: string;
}
export const PORTALS = ['staff', 'seller', 'store', 'associate'] as const;
export type PortalKey = (typeof PORTALS)[number];
/** The tracking-page helper is not a console, so it is not in PORTALS (billing keeps it on its own line). */
export type ConversationPortal = PortalKey | 'public';

export interface BillingRow {
  readonly period: string;
  readonly total: UsageBucket;
  readonly assistant: {
    readonly total: UsageBucket;
    readonly portals: Record<PortalKey, UsageBucket>;
  };
  readonly monitor: UsageBucket;
  /** The public parcel helper's own line. */
  readonly publicParcel: UsageBucket;
}
export interface BillingBudget {
  readonly assistantBudgetUsd: string;
  readonly monitorBudgetUsd: string;
  readonly publicBudgetUsd: string;
  readonly assistantUsedPct: number | null;
  readonly monitorUsedPct: number | null;
  readonly publicUsedPct: number | null;
  readonly projectedCostUsd: string | null;
  readonly projectedPct: number | null;
}
export interface MonthlyBilling {
  readonly timezone: string;
  readonly months: readonly BillingRow[];
  readonly currentBudget: BillingBudget | null;
}
export interface DailyBilling {
  readonly timezone: string;
  readonly month: string;
  readonly days: readonly BillingRow[];
  readonly total: BillingRow | undefined;
  readonly budget: BillingBudget | null;
}

export function useMonthlyBilling(months = 12): UseQueryResult<MonthlyBilling> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['ai-billing-monthly', months],
    queryFn: () => client.request<MonthlyBilling>(`${BASE}/billing/monthly?months=${months}`),
  });
}

export function useDailyBilling(month: string): UseQueryResult<DailyBilling> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['ai-billing-daily', month],
    queryFn: () => client.request<DailyBilling>(`${BASE}/billing/daily?month=${month}`),
  });
}

/** One-off fetch for a CSV button. */
export function useFetchDaily(): (month: string) => Promise<DailyBilling> {
  const client = useApiClient();
  return (month) => client.request<DailyBilling>(`${BASE}/billing/daily?month=${month}`);
}

export interface Dashboard {
  readonly range: { readonly from: string; readonly to: string; readonly timezone: string };
  readonly questions: number;
  readonly questionsPerDay: ReadonlyArray<{ day: string; count: number }>;
  readonly activeUsers: number;
  readonly spend: {
    readonly rangeCostUsd: string;
    readonly requests: number;
    readonly month: BillingRow | null;
    readonly budget: BillingBudget | null;
  };
  readonly cacheHitRate: number | null;
  readonly notices: Record<string, number>;
  readonly errorRate: number | null;
  readonly refusalRate: number | null;
  readonly tools: ReadonlyArray<{ name: string; calls: number; failed: number }>;
  readonly languages: { counts: Record<string, number>; sampled: number };
  readonly portals: Record<ConversationPortal, number>;
  readonly attachments: number;
  readonly proposals: { raised: number; confirmed: number };
  readonly feedback: { up: number; down: number };
}

export function useAiDashboard(from: string, to: string): UseQueryResult<Dashboard> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['ai-dashboard', from, to],
    queryFn: () =>
      client.request<Dashboard>(
        `${BASE}/dashboard?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`,
      ),
  });
}

/** The overnight monitor's score for the latest turn it reviewed. */
export interface MonitorScore {
  readonly conversationId: string;
  readonly answered: 'yes' | 'partly' | 'no';
  readonly correct: 'yes' | 'unsure' | 'no';
  readonly correctReason: string | null;
  readonly link: 'yes' | 'no' | 'not_needed';
  readonly languageMatch: boolean;
  readonly frustration: number;
  readonly hallucination: boolean;
  readonly hallucinationQuote: string | null;
  readonly knowledgeGap: string | null;
  readonly uiConfusion: string | null;
  readonly safety: 'none' | 'data_leak' | 'prompt_injection' | 'abuse';
  readonly safetyQuote: string | null;
  readonly summary: string;
  readonly at: string;
}

export interface ConversationListItem {
  readonly id: string;
  readonly portal: ConversationPortal;
  readonly title: string | null;
  readonly preview: string;
  readonly language: string | null;
  readonly user: string | null;
  readonly account: string | null;
  readonly questions: number;
  readonly attachments: number;
  readonly notices: number;
  readonly up: number;
  readonly down: number;
  readonly anonymised: boolean;
  readonly monitor: MonitorScore | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface ConversationList {
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly items: readonly ConversationListItem[];
}

export function useAiConversations(
  filters: Record<string, string>,
  offset: number,
): UseQueryResult<ConversationList> {
  const client = useApiClient();
  const qs = new URLSearchParams({ ...filters, limit: '25', offset: String(offset) }).toString();
  return useQuery({
    queryKey: ['ai-conversations', qs],
    queryFn: () => client.request<ConversationList>(`${BASE}/conversations?${qs}`),
  });
}

export type ReviewBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; ok: boolean; content: unknown }
  | { type: 'file'; kind: string };

export interface ConversationReview {
  readonly monitor: MonitorScore | null;
  readonly conversation: {
    readonly id: string;
    readonly portal: PortalKey;
    readonly title: string | null;
    readonly user: string | null;
    readonly account: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly anonymised: boolean;
  };
  readonly messages: ReadonlyArray<{
    readonly id: string;
    readonly role: 'user' | 'assistant';
    readonly isQuestion: boolean;
    readonly at: string;
    readonly blocks: readonly ReviewBlock[];
    readonly maskedPhones: number;
    readonly attachmentIds: readonly string[];
    readonly feedback: ReadonlyArray<{ rating: 'up' | 'down'; comment: string | null }>;
  }>;
  readonly attachments: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly mediaType: string;
    readonly name: string;
    readonly bytes: number;
    readonly pages: number | null;
    readonly available: boolean;
  }>;
  readonly notices: ReadonlyArray<{ code: string; at: string }>;
  readonly tools: ReadonlyArray<{
    name: string;
    ok: boolean;
    errorCode: string | null;
    resultBytes: number;
    at: string;
  }>;
}

/** Opening a conversation is AUDITED server-side, so it is fetched once and never refetched in the background. */
export function useOpenConversation(id: string): UseQueryResult<ConversationReview> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['ai-conversation', id],
    queryFn: () => client.request<ConversationReview>(`${BASE}/conversations/${id}`),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}

export function useRevealMessage(
  conversationId: string,
): UseMutationResult<{ id: string; blocks: ReviewBlock[] }, Error, string> {
  const client = useApiClient();
  return useMutation({
    mutationFn: (messageId) =>
      client.request(`${BASE}/conversations/${conversationId}/messages/${messageId}/reveal`, {
        method: 'POST',
      }),
  });
}

export function useAttachmentDownload(
  conversationId: string,
): UseMutationResult<{ url: string }, Error, string> {
  const client = useApiClient();
  return useMutation({
    mutationFn: (attachmentId) =>
      client.request(
        `${BASE}/conversations/${conversationId}/attachments/${attachmentId}/download`,
      ),
  });
}

export type ControlValue = boolean | number | string | null;
export function useAiControls(): UseQueryResult<{ settings: Record<string, ControlValue> }> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['ai-controls'],
    queryFn: () => client.request<{ settings: Record<string, ControlValue> }>(`${BASE}/controls`),
  });
}

export function useSetControl(): UseMutationResult<
  { settings: Record<string, ControlValue> },
  Error,
  { key: string; value: boolean | number | string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }) =>
      client.request(`${BASE}/controls/${key}`, { method: 'PUT', body: { value } }),
    onSuccess: (data) => qc.setQueryData(['ai-controls'], data),
  });
}

// ── overnight monitor ────────────────────────────────────────────────
export interface MonitorTheme {
  readonly label: string;
  readonly count: number;
  readonly conversationIds: readonly string[];
}
export interface MonitorRun {
  readonly id: string;
  readonly trigger: string;
  readonly status:
    | 'collecting'
    | 'submitted'
    | 'done'
    | 'skipped_budget'
    | 'nothing_to_do'
    | 'failed';
  readonly requested: number;
  readonly scored: number;
  readonly errored: number;
  readonly skippedBudget: number;
  readonly note: string | null;
  readonly summary: {
    readonly scored?: number;
    readonly answered?: { yes: number; partly: number; no: number };
    readonly incorrect?: number;
    readonly hallucinations?: number;
    readonly frustrated?: number;
    readonly languageMismatch?: number;
    readonly safetyFlags?: number;
    readonly knowledgeGaps?: number;
    readonly uiConfusions?: number;
    readonly costUsd?: string;
  } | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}
export interface MonitorOverview {
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly budget: {
    readonly capUsd: string;
    readonly spentUsd: string;
    readonly usedPct: number | null;
  };
  readonly runs: readonly MonitorRun[];
  readonly night: {
    readonly runId: string | null;
    readonly themes: ReadonlyArray<MonitorTheme & { kind: 'knowledge_gap' | 'ui_confusion' }>;
  };
  readonly week: {
    readonly knowledgeGaps: readonly MonitorTheme[];
    readonly uiConfusions: readonly MonitorTheme[];
  };
  readonly safetyFlags: number;
}
export interface MonitorFlag extends MonitorScore {
  readonly portal: PortalKey;
}

export function useMonitorOverview(): UseQueryResult<MonitorOverview> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['ai-monitor'],
    queryFn: () => client.request<MonitorOverview>(`${BASE}/monitor`),
    refetchInterval: 60_000,
  });
}

/** Audited server-side on every fetch, so it is not refetched in the background. */
export function useMonitorFlags(
  enabled: boolean,
): UseQueryResult<{ items: readonly MonitorFlag[] }> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['ai-monitor-flags'],
    enabled,
    queryFn: () => client.request<{ items: readonly MonitorFlag[] }>(`${BASE}/monitor/flags`),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}

export function useMonitorRunNow(): UseMutationResult<{ queued: true }, Error, void> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.request(`${BASE}/monitor/run-now`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ai-monitor'] }),
  });
}

// ── recommendations (Haiku drafts, the owner approves) ───────────────
const REC = '/api/admin/assistant-recommendations';

export type RecStatus = 'NEW' | 'APPROVED' | 'REJECTED' | 'LIVE' | 'ROLLED_BACK';
export type RecFilter = 'new' | 'approved' | 'rejected' | 'live' | 'rolled_back';
export type GuideAudience = 'staff' | 'seller' | 'store' | 'associate';

export type KnowledgeChange =
  | {
      readonly target: 'guide';
      readonly audiences: readonly GuideAudience[];
      readonly guideId: string | null;
      readonly title: string;
      readonly summary: string;
      readonly sections: ReadonlyArray<{ heading: string; steps: readonly string[] }>;
    }
  | {
      readonly target: 'glossary';
      readonly audiences: readonly GuideAudience[];
      readonly term: string;
      readonly meaning: string;
      readonly example: string;
    }
  | {
      readonly target: 'prompt_addendum';
      readonly audiences: readonly GuideAudience[];
      readonly text: string;
    };

export interface GateSide {
  readonly status: 'pass' | 'fail' | 'error';
  readonly detail: string;
  readonly answer: string;
  readonly tools: readonly string[];
  readonly retried: boolean;
}
export interface GateCase {
  readonly id: string;
  readonly audience: string;
  readonly language: string;
  readonly kind: string;
  readonly question: string;
  readonly live: GateSide;
  readonly draft: GateSide;
  readonly outcome: 'same_pass' | 'same_fail' | 'improved' | 'regressed';
}
export interface RecCheck {
  readonly id: string;
  readonly status: 'RUNNING' | 'DONE' | 'FAILED';
  readonly passed: boolean | null;
  readonly total: number;
  readonly regressions: number;
  readonly note: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly stale: boolean;
  readonly results?: readonly GateCase[];
}
export interface RecItem {
  readonly id: string;
  readonly kind: 'KNOWLEDGE' | 'SYSTEM';
  readonly status: RecStatus;
  readonly title: string;
  readonly problem: string;
  readonly theme: { kind: 'knowledge_gap' | 'ui_confusion'; label: string };
  readonly evidence: readonly string[];
  readonly knowledge: KnowledgeChange | null;
  readonly diff: { before: string | null; after: string; isEdit: boolean } | null;
  readonly system: { suggestedChange: string; acceptanceCheck: string } | null;
  readonly task: string | null;
  readonly githubIssueUrl: string | null;
  readonly liveVersionId: string | null;
  readonly createdAt: string;
  readonly check: RecCheck | null;
}
export interface RecList {
  readonly liveVersionId: string | null;
  readonly githubAvailable: boolean;
  readonly counts: Record<string, number>;
  readonly items: readonly RecItem[];
}
export interface KnowledgeVersion {
  readonly id: string;
  readonly number: number;
  readonly parentVersionId: string | null;
  readonly recommendationId: string | null;
  readonly createdAt: string;
  readonly live: boolean;
  readonly counts: { guides: number; glossary: number; addenda: number };
  readonly wentLiveAt: string | null;
}
export interface VersionHistory {
  readonly liveVersionId: string | null;
  readonly versions: readonly KnowledgeVersion[];
  readonly changes: ReadonlyArray<{
    id: string;
    action: 'GO_LIVE' | 'ROLLBACK';
    fromVersionId: string | null;
    toVersionId: string | null;
    createdAt: string;
  }>;
}

export function useRecommendations(filter: RecFilter | 'all'): UseQueryResult<RecList> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['ai-recs', filter],
    queryFn: () => client.request<RecList>(`${REC}${filter === 'all' ? '' : `?status=${filter}`}`),
    // While a check is running the table fills in by itself.
    refetchInterval: (q) =>
      q.state.data?.items.some((i) => i.check?.status === 'RUNNING') ? 4000 : false,
  });
}

export function useRecommendation(id: string, enabled: boolean): UseQueryResult<RecItem> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['ai-rec', id],
    enabled,
    queryFn: () => client.request<RecItem>(`${REC}/${id}`),
    refetchInterval: (q) => (q.state.data?.check?.status === 'RUNNING' ? 4000 : false),
  });
}

export function useKnowledgeVersions(): UseQueryResult<VersionHistory> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['ai-versions'],
    queryFn: () => client.request<VersionHistory>(`${REC}/versions`),
  });
}

function useRecAction<TVars, TOut>(
  path: (v: TVars) => string,
  body?: (v: TVars) => unknown,
): UseMutationResult<TOut, Error, TVars> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: TVars) =>
      client.request<TOut>(path(v), {
        method: 'POST',
        ...(body === undefined ? {} : { body: body(v) }),
      }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['ai-recs'] });
      void qc.invalidateQueries({ queryKey: ['ai-rec'] });
      void qc.invalidateQueries({ queryKey: ['ai-versions'] });
    },
  });
}

export const useDraftRecs = (): UseMutationResult<{ queued: true }, Error, void> =>
  useRecAction<void, { queued: true }>(() => `${REC}/draft`);
export const useCheckRec = (): UseMutationResult<{ runId: string }, Error, string> =>
  useRecAction<string, { runId: string }>((id) => `${REC}/${id}/check`);
export const useApproveRec = (): UseMutationResult<{ status: RecStatus }, Error, string> =>
  useRecAction<string, { status: RecStatus }>((id) => `${REC}/${id}/approve`);
export const useRejectRec = (): UseMutationResult<{ status: RecStatus }, Error, string> =>
  useRecAction<string, { status: RecStatus }>((id) => `${REC}/${id}/reject`);
export const useGithubIssue = (): UseMutationResult<{ url: string }, Error, string> =>
  useRecAction<string, { url: string }>((id) => `${REC}/${id}/github-issue`);
export const useRollbackKnowledge = (): UseMutationResult<
  { liveVersionId: string | null },
  Error,
  { versionId: string | null; expectedLive: string | null }
> =>
  useRecAction<
    { versionId: string | null; expectedLive: string | null },
    { liveVersionId: string | null }
  >(
    () => `${REC}/rollback`,
    (v) => v,
  );
