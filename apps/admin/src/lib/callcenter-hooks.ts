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
  scheduledAttempts: number;
  createdAt: string;
  order: { orderNumber: string; sellerId: string; status: string } | null;
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
