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

export interface TopicDef {
  topic: string;
  label: string;
  description: string;
  group: string;
}

export interface SubscriptionView {
  topic: string;
  mode: 'SUBSCRIBED' | 'MUTED';
  mutedChannels: string[];
}

const FEED_KEY = 'seller-notifications';

const BASE = '/api/seller/notifications';

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
    queryKey: ['seller-notifications', 'unread'],
    queryFn: () => client.request<{ unread: number }>(`${BASE}/unread-count`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useNotificationFeed(cursor?: string): UseQueryResult<FeedPage, Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-notifications', 'feed', cursor ?? null],
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
      void qc.invalidateQueries({ queryKey: ['seller-notifications'] });
    },
  });
}

export function useMarkAllNotificationsRead(): UseMutationResult<unknown, Error, void> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.request(`${BASE}/read-all`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['seller-notifications'] });
    },
  });
}

/**
 * The topics that can be chosen about, with names.
 *
 * Silencing something used to mean typing its code into a box. Nobody
 * knows the codes, so in practice nothing was mutable.
 */
export function useNotificationTopics(): UseQueryResult<TopicDef[], Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['notification-topics'],
    queryFn: () => client.request<TopicDef[]>(`${BASE}/topics`),
    staleTime: 60 * 60_000,
  });
}

export function useMarkNotificationUnread(): UseMutationResult<unknown, Error, string> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => client.request(`${BASE}/${id}/unread`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [FEED_KEY] });
    },
  });
}

/**
 * Clear one from this person's inbox.
 *
 * Called "delete" on screen because that is what it does FOR THEM, but
 * the row survives: notification_logs is the ledger the dedup gate
 * reads, and removing a row would let a re-emit of the same event send
 * again.
 */
export function useDismissNotification(): UseMutationResult<unknown, Error, string> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => client.request(`${BASE}/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [FEED_KEY] });
    },
  });
}

export function useDismissAllNotifications(): UseMutationResult<unknown, Error, void> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.request(BASE, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [FEED_KEY] });
    },
  });
}

export function useNotificationSubscriptions(): UseQueryResult<SubscriptionView[], Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-notifications', 'subscriptions'],
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
      void qc.invalidateQueries({ queryKey: ['seller-notifications', 'subscriptions'] });
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
      void qc.invalidateQueries({ queryKey: ['seller-notifications', 'subscriptions'] });
    },
  });
}
