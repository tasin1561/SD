'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import type { CallQueueStatus } from '@skydrop/db';

/**
 * Supervisor views over the call centre: the queue itself and the
 * agents working it.
 *
 * `/call-center` is the AGENT station — pull the next order, log an
 * attempt. Neither of these two endpoints had a screen, so a supervisor
 * could not see the queue at all, could not move a stuck entry off an
 * absent agent, and could not tell who was actually taking calls.
 */

interface Paginated<T> {
  items: readonly T[];
  total: number;
  page: number;
  pageSize: number;
}

function qs(query: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ───────── Queue ─────────

export interface CallQueueRow {
  id: string;
  orderId: string;
  status: CallQueueStatus;
  assignedAgentId: string | null;
  assignedAt: string | null;
  availableAt: string;
  /** Times PULLED into a station — claims, not conversations. */
  scheduledAttempts: number;
  /** Calls actually logged against this entry. */
  attemptsLogged: number;
  /** Of those, the ones the NDR cap is judged on (CC-5's 6 of 9). */
  attemptsCounting: number;
  maxAttempts: number;
  createdAt: string;
  order: { orderNumber: string; sellerId: string; status: string } | null;
  /** Resolved server-side — staff carry no name, so this is their
   *  display email. Null when unassigned. */
  agent: { id: string; name: string } | null;
}

export interface CallQueueStats {
  byStatus: Record<string, number>;
  openTotal: number;
  assignedByAgent: ReadonlyArray<{ agentId: string; count: number }>;
}

export function useCallQueue(query: {
  status?: string;
  sellerId?: string;
  agentId?: string;
  page?: number;
  pageSize?: number;
}): UseQueryResult<Paginated<CallQueueRow>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-call-queue', 'list', query],
    queryFn: () => client.request<Paginated<CallQueueRow>>(`/api/admin/call-queue${qs(query)}`),
  });
}

export function useCallQueueStats(): UseQueryResult<CallQueueStats> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-call-queue', 'stats'],
    queryFn: () => client.request<CallQueueStats>('/api/admin/call-queue/stats'),
  });
}

/**
 * Move WHEN a queued call becomes callable.
 *
 * Timing only — it never touches the attempt count, because this is
 * about scheduling, not about pretending a call was or was not made.
 */
export interface AdminReattemptRequest {
  id: string;
  orderId: string;
  orderNumber: string | null;
  sellerId: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  decisionNote: string | null;
  decidedAt: string | null;
  /** Extra calls this approval granted, above the seller's cap. */
  extraAttempts: number;
  orderStatusAtRequest: string;
  createdAt: string;
}

/** Sellers asking to ring a customer who declined. */
export function useReattemptRequests(
  status?: string,
): UseQueryResult<readonly AdminReattemptRequest[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-reattempt-requests', status ?? 'ALL'],
    queryFn: () =>
      client.request<readonly AdminReattemptRequest[]>(
        `/api/admin/reattempt-requests${status === undefined ? '' : `?status=${status}`}`,
      ),
  });
}

/**
 * Approve (order returns to the call queue) or decline (it stays
 * rejected). One hook for both, because they are the same decision with
 * opposite answers and splitting them invites one to drift.
 */
export function useDecideReattempt(): UseMutationResult<
  AdminReattemptRequest,
  Error,
  { requestId: string; approve: boolean; note: string; extraAttempts?: number }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, approve, note, extraAttempts }) =>
      client.request<AdminReattemptRequest>(
        `/api/admin/reattempt-requests/${requestId}/${approve ? 'approve' : 'reject'}`,
        // extraAttempts only means anything on an approval; the reject
        // endpoint ignores it and the DTO leaves it optional.
        { method: 'POST', body: approve ? { note, extraAttempts } : { note } },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-reattempt-requests'] });
      void qc.invalidateQueries({ queryKey: ['admin-call-queue'] });
      void qc.invalidateQueries({ queryKey: ['admin-orders'] });
    },
  });
}

export function useRescheduleQueueEntry(): UseMutationResult<
  { id: string; availableAt: string; status: string },
  Error,
  { entryId: string; availableAt: string; reason: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, availableAt, reason }) =>
      client.request<{ id: string; availableAt: string; status: string }>(
        `/api/admin/call-queue/${entryId}/reschedule`,
        { method: 'POST', body: { availableAt, reason } },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-call-queue'] });
    },
  });
}

export function useReassignQueueEntry(): UseMutationResult<
  { id: string; assignedAgentId: string; status: string },
  Error,
  { entryId: string; toAgentId: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, toAgentId }) =>
      client.request<{ id: string; assignedAgentId: string; status: string }>(
        `/api/admin/call-queue/${entryId}/reassign`,
        { method: 'POST', body: { toAgentId } },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-call-queue'] });
      void qc.invalidateQueries({ queryKey: ['admin-agents'] });
    },
  });
}

export function useBulkDequeue(): UseMutationResult<
  { sellerId: string; dequeuedOrders: number },
  Error,
  { sellerId: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<{ sellerId: string; dequeuedOrders: number }>(
        '/api/admin/call-queue/bulk-dequeue',
        { method: 'POST', body },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-call-queue'] }),
  });
}

// ───────── Agents ─────────

export interface AgentSettingsView {
  agentId: string;
  maxActiveCalls: number;
  isAvailable: boolean;
  workingHoursStart: string;
  workingHoursEnd: string;
  workingDays: readonly number[];
  timezone: string;
  languages: readonly string[];
  canHandleHighRisk: boolean;
  canHandleHighValue: boolean;
}

export interface AgentMetrics {
  agentId: string;
  totalAttempts: number;
  byOutcome: Record<string, number>;
  confirmedCount: number;
  currentAssigned: number;
  /** What became of the time this agent spent HOLDING orders — a
   *  dropped hold logs no attempt, so it is invisible in the counts
   *  above by construction. */
  holds: {
    holdsCompleted: number;
    holdsDropped: number;
    dropsByReason: Record<string, number>;
    avgSecondsToOutcome: number | null;
    longestDroppedSeconds: number | null;
  };
}

export interface AgentListRow {
  agentId: string;
  email: string;
  settings: AgentSettingsView;
  activeAssigned: number;
}

export function useAgents(): UseQueryResult<readonly AgentListRow[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-agents', 'list'],
    queryFn: () => client.request<readonly AgentListRow[]>('/api/admin/agents'),
  });
}

export function useAgentMetrics(agentId: string | null): UseQueryResult<AgentMetrics> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-agents', 'metrics', agentId],
    enabled: agentId !== null,
    queryFn: () => client.request<AgentMetrics>(`/api/admin/agents/${agentId ?? ''}/metrics`),
  });
}

export function useUpdateAgentSettings(): UseMutationResult<
  AgentSettingsView,
  Error,
  { agentId: string; body: Partial<Omit<AgentSettingsView, 'agentId'>> }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, body }) =>
      client.request<AgentSettingsView>(`/api/admin/agents/${agentId}/settings`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-agents'] }),
  });
}
