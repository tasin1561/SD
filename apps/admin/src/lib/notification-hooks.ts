'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';

export interface FeedItem {
  id: string;
  title: string | null;
  body: string;
  topic: string;
  createdAt: string;
  readAt: string | null;
  orderId: string | null;
}

export interface FeedPage {
  items: FeedItem[];
  unreadCount: number;
  nextCursor: string | null;
}

export interface SubscriptionView {
  topic: string;
  mode: 'SUBSCRIBED' | 'MUTED';
  mutedChannels: string[];
}

const BASE = '/api/admin/notifications';

/**
 * The unread count for the bell.
 *
 * Polled rather than pushed: a websocket for a number that changes a
 * few times an hour is a connection to keep alive, reconnect and
 * authorise for no gain. Refetches on focus, which is when somebody
 * actually looks.
 */
export function useUnreadCount(): UseQueryResult<{ unread: number }, Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-notifications', 'unread'],
    queryFn: () => client.request<{ unread: number }>(`${BASE}/unread-count`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useNotificationFeed(cursor?: string): UseQueryResult<FeedPage, Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-notifications', 'feed', cursor ?? null],
    queryFn: () =>
      client.request<FeedPage>(cursor === undefined ? BASE : `${BASE}?cursor=${cursor}`),
  });
}

export function useMarkNotificationRead(): UseMutationResult<unknown, Error, string> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => client.request(`${BASE}/${id}/read`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-notifications'] });
    },
  });
}

export function useMarkAllNotificationsRead(): UseMutationResult<unknown, Error, void> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.request(`${BASE}/read-all`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-notifications'] });
    },
  });
}

export function useNotificationSubscriptions(): UseQueryResult<SubscriptionView[], Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-notifications', 'subscriptions'],
    queryFn: () => client.request<SubscriptionView[]>(`${BASE}/subscriptions`),
  });
}

export function useSetNotificationSubscription(): UseMutationResult<
  SubscriptionView,
  Error,
  { topic: string; mode: 'SUBSCRIBED' | 'MUTED'; mutedChannels?: string[] }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<SubscriptionView>(`${BASE}/subscriptions`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-notifications', 'subscriptions'] });
    },
  });
}

export function useClearNotificationSubscription(): UseMutationResult<unknown, Error, string> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (topic) =>
      client.request(`${BASE}/subscriptions/${encodeURIComponent(topic)}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-notifications', 'subscriptions'] });
    },
  });
}

// ── Broadcasts ───────────────────────────────────────────────────────

export interface AudienceSelector {
  kind: string;
  sellerId?: string;
  roleKey?: string;
  userId?: string;
  staffId?: string;
  permission?: string;
  topic?: string;
}

export interface BroadcastPreview {
  recipientCount: number;
  channels: string[];
  /** A handful of names, so "4,300 people" is checkable. */
  sample: string[];
}

export interface BroadcastRow {
  id: string;
  title: string;
  category: string;
  channels: string[];
  status: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  finishedAt: string | null;
}

export function useBroadcastPreview(): UseMutationResult<
  BroadcastPreview,
  Error,
  { audience: AudienceSelector[]; category: string; channels: string[] }
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<BroadcastPreview>(`${BASE}/broadcasts/preview`, { method: 'POST', body }),
  });
}

export function useSendBroadcast(): UseMutationResult<
  { broadcastId: string; recipientCount: number; delivered: number },
  Error,
  {
    audience: AudienceSelector[];
    category: string;
    channels: string[];
    title: string;
    body: string;
    expectedRecipientCount: number;
  }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<{ broadcastId: string; recipientCount: number; delivered: number }>(
        `${BASE}/broadcasts`,
        { method: 'POST', body },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-notifications'] });
    },
  });
}

export function useBroadcasts(): UseQueryResult<BroadcastRow[], Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-notifications', 'broadcasts'],
    queryFn: () => client.request<BroadcastRow[]>(`${BASE}/broadcasts`),
  });
}
