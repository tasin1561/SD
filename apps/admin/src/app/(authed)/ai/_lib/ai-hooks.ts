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

export interface BillingRow {
  readonly period: string;
  readonly total: UsageBucket;
  readonly assistant: {
    readonly total: UsageBucket;
    readonly portals: Record<PortalKey, UsageBucket>;
  };
  readonly monitor: UsageBucket;
}
export interface BillingBudget {
  readonly assistantBudgetUsd: string;
  readonly monitorBudgetUsd: string;
  readonly assistantUsedPct: number | null;
  readonly monitorUsedPct: number | null;
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
  readonly portals: Record<PortalKey, number>;
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

export interface ConversationListItem {
  readonly id: string;
  readonly portal: PortalKey;
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
