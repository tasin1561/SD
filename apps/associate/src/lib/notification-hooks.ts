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
 * ASSOC-1 capability 6 — "get notified everyday about delivered + return
 * + NDR". The API builds that digest as an IN-APP message and nothing
 * else, following NOTIF-23 (a message with an inbox behind it is not
 * also emailed). NOTIF-23's premise is that an inbox EXISTS, and until
 * this landed the associate had none — so the one notification the owner
 * actually asked for was being delivered somewhere nobody could read it.
 * That is what this closes.
 *
 * Every path is the store identity's own inbox (`/api/store/notifications`),
 * addressed by the id on the TOKEN. Self-service (NOTIF-11): never behind
 * a grantable permission, which is why `/notifications` is absent from
 * `PAGE_PERMISSIONS`.
 *
 * ── NO SUBSCRIPTIONS AND NO CATEGORY PREFERENCES HERE ───────────────
 * The store's own portal has both halves — a person's per-topic silences
 * and the COMPANY's per-category email switches. Neither is ported: the
 * digest topic is silenceable through the store portal, and a settings
 * screen holding one switch is a screen nobody visits. A hook with no
 * screen behind it is also exactly what `check-frontend-routes.py`
 * reports as dead, so the absence is checked rather than assumed.
 */

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

const FEED_KEY = 'my-notifications';
const BASE = '/api/store/notifications';

/**
 * The unread count for the bell.
 *
 * Polled rather than pushed: a websocket for a number that changes a few
 * times a day is a connection to keep alive, reconnect and authorise for
 * no gain. Refetches on focus, which is when somebody actually looks.
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
 * The topics, with names, from the SERVER's declared catalogue
 * (NOTIF-17). Read rather than pattern-matched off the topic string,
 * which is how a second and disagreeing taxonomy starts.
 */
export function useNotificationTopics(): UseQueryResult<TopicDef[], Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['my-notification-topics'],
    queryFn: () => client.request<TopicDef[]>(`${BASE}/topics`),
    staleTime: 60 * 60_000,
  });
}

export function useMarkNotificationRead(): UseMutationResult<unknown, Error, string> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => client.request(`${BASE}/${id}/read`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [FEED_KEY] }),
  });
}

/**
 * The mirror of marking read, and it exists for the reason an email
 * client has it: having READ something and having DEALT with it are
 * different, and un-reading is the only way to say "come back to this".
 */
export function useMarkNotificationUnread(): UseMutationResult<unknown, Error, string> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => client.request(`${BASE}/${id}/unread`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [FEED_KEY] }),
  });
}

export function useMarkAllNotificationsRead(): UseMutationResult<unknown, Error, void> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.request(`${BASE}/read-all`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [FEED_KEY] }),
  });
}

/**
 * Clear one from this person's inbox.
 *
 * Called "clear" on screen because that is what it does FOR THEM, and
 * NOT called delete because it is not one (NOTIF-21): the row survives,
 * since `notification_logs` is the ledger the NOTIF-2 dedup gate reads
 * and removing a row would let a re-emit of the same event send again —
 * silently, because a second send looks exactly like a first.
 */
export function useDismissNotification(): UseMutationResult<unknown, Error, string> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => client.request(`${BASE}/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [FEED_KEY] }),
  });
}

export function useDismissAllNotifications(): UseMutationResult<unknown, Error, void> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.request(BASE, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [FEED_KEY] }),
  });
}
