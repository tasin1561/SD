'use client';

import { useMemo, type ReactElement } from 'react';
import Link from 'next/link';
import { NotificationBell } from '@skydrop/ui/components';
import {
  useDismissNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationFeed,
  useNotificationTopics,
  useUnreadCount,
} from '@/lib/notification-hooks';

/**
 * The bell in the top bar — the SAME `NotificationBell` the other four
 * consoles use (FE-7: one piece of chrome, not five).
 *
 * The list is fetched only when the panel opens: the COUNT is what every
 * page needs and it is one small query, while the items are what one
 * person looks at occasionally.
 *
 * `preferencesHref` is deliberately NOT passed, so the panel shows no
 * settings link: this portal has no notification-settings page, and a
 * link to one that does not exist is worse than no link.
 *
 * The topic CATALOGUE gives the panel its tabs and row names (NOTIF-17).
 * Resolved here rather than in the component, because the catalogue is
 * data and `@skydrop/ui` fetches nothing.
 */
export function NotificationBellContainer(): ReactElement {
  const unread = useUnreadCount();
  const feed = useNotificationFeed();
  const topics = useNotificationTopics();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const dismiss = useDismissNotification();

  const byTopic = useMemo(() => {
    const m = new Map<string, { group: string; label: string }>();
    for (const t of topics.data ?? []) m.set(t.topic, { group: t.group, label: t.label });
    return m;
  }, [topics.data]);

  return (
    <NotificationBell
      unread={unread.data?.unread ?? 0}
      items={feed.data?.items ?? []}
      loading={feed.isLoading}
      onOpen={() => void feed.refetch()}
      onMarkRead={(id) => markRead.mutate(id)}
      onMarkAllRead={() => markAll.mutate()}
      onDismiss={(id) => dismiss.mutate(id)}
      groupOf={(topic) => byTopic.get(topic)?.group ?? null}
      labelOf={(topic) => byTopic.get(topic)?.label ?? null}
      viewAllHref="/notifications"
      Link={({ href, className, children, onClick }) => (
        // Spread rather than pass-through: under
        // exactOptionalPropertyTypes an explicit `undefined` is not the
        // same as an absent prop, and next/link types these as required
        // when present.
        <Link
          href={href}
          {...(className === undefined ? {} : { className })}
          {...(onClick === undefined ? {} : { onClick })}
        >
          {children}
        </Link>
      )}
    />
  );
}
