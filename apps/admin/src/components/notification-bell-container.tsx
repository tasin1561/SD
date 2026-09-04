'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { NotificationBell } from '@skydrop/ui/components';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationFeed,
  useUnreadCount,
} from '@/lib/notification-hooks';

/**
 * The bell in the top bar.
 *
 * The list is only fetched when the panel opens: the count is what
 * every page needs and it is one small query, while the items are what
 * one person looks at occasionally.
 */
export function NotificationBellContainer(): ReactElement {
  const unread = useUnreadCount();
  const feed = useNotificationFeed();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  return (
    <NotificationBell
      unread={unread.data?.unread ?? 0}
      items={feed.data?.items ?? []}
      loading={feed.isLoading}
      onOpen={() => void feed.refetch()}
      onMarkRead={(id) => markRead.mutate(id)}
      onMarkAllRead={() => markAll.mutate()}
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
