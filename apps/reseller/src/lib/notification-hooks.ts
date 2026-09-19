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
  /**
   * False for a topic that cannot be silenced at all. The flag comes
   * from the SERVER (`IMMUTABLE_TOPICS`) rather than being guessed here,
   * so a second list cannot drift from the one that actually refuses.
   */
  mutable?: boolean;
  immutableReason?: string | null;
  /** Which of the store's own categories it belongs to. */
  storeCategory?: string;
}

export interface SubscriptionView {
  topic: string;
  mode: 'SUBSCRIBED' | 'MUTED';
  mutedChannels: string[];
}

/** One row of the STORE's own half — what everybody here is told. */
export interface StoreCategoryView {
  category: string;
  emailEnabled: boolean;
  inAppEnabled: boolean;
  mutable: boolean;
  topics: string[];
  lockedTopics: string[];
  set: boolean;
}

const FEED_KEY = 'store-notifications';
const BASE = '/api/store/notifications';
const PREFS = '/api/store/notification-preferences';

/**
 * The unread count for the bell.
 *
 * Polled rather than pushed, for the same reason the seller's is: a
 * websocket for a number that changes a few times an hour is a
 * connection to keep alive, reconnect and authorise for no gain.
 * Refetches on focus, which is when somebody actually looks.
 */
export function useUnreadCount(): UseQueryResult<{ unread: number }, Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: [FEED_KEY, 'unread'],
    queryFn: () => client.request<{ unread: number }>(`${BASE}/unread-count`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useNotificationFeed(cursor?: string): UseQueryResult<FeedPage, Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: [FEED_KEY, 'feed', cursor ?? null],
    queryFn: () =>
      client.request<FeedPage>(cursor === undefined ? BASE : `${BASE}?cursor=${cursor}`),
  });
}

/**
 * The topics a person here can choose about, with names.
 *
 * Read from the SERVER's declared catalogue (NOTIF-17) rather than from
 * a list in this app: a topic on the settings page the dispatcher never
 * looks up reads as a switch somebody flicked that did nothing.
 */
export function useNotificationTopics(): UseQueryResult<TopicDef[], Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['store-notification-topics'],
    queryFn: () => client.request<TopicDef[]>(`${BASE}/topics`),
    staleTime: 60 * 60_000,
  });
}

export function useMarkNotificationRead(): UseMutationResult<unknown, Error, string> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => client.request(`${BASE}/${id}/read`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [FEED_KEY] });
    },
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

export function useMarkAllNotificationsRead(): UseMutationResult<unknown, Error, void> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.request(`${BASE}/read-all`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [FEED_KEY] });
    },
  });
}

/**
 * Clear one from this person's inbox.
 *
 * Called "delete" on screen because that is what it does FOR THEM, but
 * the row survives (NOTIF-21): `notification_logs` is the ledger the
 * dedup gate reads, and removing a row would let a re-emit of the same
 * event send again.
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
    queryKey: [FEED_KEY, 'subscriptions'],
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
      void qc.invalidateQueries({ queryKey: [FEED_KEY, 'subscriptions'] });
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
      void qc.invalidateQueries({ queryKey: [FEED_KEY, 'subscriptions'] });
    },
  });
}

/* ── The STORE's own half ─────────────────────────────────────────── */

export function useStoreNotificationCategories(
  enabled: boolean,
): UseQueryResult<StoreCategoryView[], Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['store-notification-categories'],
    queryFn: () => client.request<StoreCategoryView[]>(PREFS),
    // Asked only by somebody who may read it — the shell renders this
    // page for everybody, and an unconditional call would 403 for the
    // roles that cannot see the store profile.
    enabled,
  });
}

export function useSetStoreNotificationCategory(): UseMutationResult<
  StoreCategoryView,
  Error,
  { category: string; emailEnabled: boolean; inAppEnabled: boolean }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => client.request<StoreCategoryView>(PREFS, { method: 'PUT', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['store-notification-categories'] });
    },
  });
}
