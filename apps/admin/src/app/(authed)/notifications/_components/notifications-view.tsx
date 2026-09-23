'use client';

import { useEffect, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { CheckCheck, Mail, MailOpen, Megaphone, Settings2, Trash2 } from 'lucide-react';
import { Button, buttonClassName } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { AcCard, AcHeader, AcPage } from '../../settings/_components/ac-parts';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useMarkAllNotificationsRead,
  useDismissAllNotifications,
  useDismissNotification,
  useMarkNotificationRead,
  useMarkNotificationUnread,
  useNotificationFeed,
} from '@/lib/notification-hooks';

/**
 * Everything that has been sent to this person, and what they have
 * chosen to silence.
 *
 * The two live on one page because they answer each other: the reason
 * somebody comes looking for preferences is usually a notification
 * they have just read and would rather not have.
 */
export function NotificationsView(): ReactElement {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const feed = useNotificationFeed(cursor);
  const markRead = useMarkNotificationRead();
  const markUnread = useMarkNotificationUnread();
  const dismiss = useDismissNotification();
  const dismissAll = useDismissAllNotifications();
  // Which one is open. A notification is short enough that expanding in
  // place beats a route of its own; the bell links here with #<id>, and
  // that is what opens it.
  const [expanded, setExpanded] = useState<string | null>(null);

  const markAll = useMarkAllNotificationsRead();
  // Clearing every notification cannot be taken back, so it asks first.
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  // Cosmetic only (FE-2) — the server gates the broadcast endpoints.
  const canBroadcast = usePermission('notifications.broadcast');

  const items = feed.data?.items ?? [];

  // The bell links here as `#<id>`. Open that one and scroll to it —
  // otherwise arriving from the bell lands you at the top of a list
  // with the thing you clicked somewhere below, which is the same
  // dead end as not linking at all.
  useEffect(() => {
    const id = window.location.hash.replace(/^#/, '');
    if (id === '' || items.length === 0) return;
    if (!items.some((n) => n.id === id)) return;
    setExpanded(id);
    document.getElementById(id)?.scrollIntoView({ block: 'center' });
  }, [items]);

  return (
    <AcPage width="narrow">
      <AcHeader
        title="Notifications"
        subtitle="Everything sent to you, and what you have chosen to silence."
        action={
          <div className="ac-buttons">
            {canBroadcast && (
              <Link className={buttonClassName('ghost', 'md')} href="/notifications/broadcasts">
                <span className="sk-btn__icon" aria-hidden>
                  <Megaphone size={15} />
                </span>
                <span className="sk-btn__label">Send a broadcast</span>
              </Link>
            )}
            {(feed.data?.unreadCount ?? 0) > 0 && (
              <Button
                variant="secondary"
                icon={<CheckCheck size={15} />}
                onClick={() => markAll.mutate()}
              >
                Mark all read
              </Button>
            )}
            {items.length > 0 && (
              <Button
                variant="ghost"
                icon={<Trash2 size={15} />}
                onClick={() => setConfirmClear(true)}
              >
                Clear all
              </Button>
            )}
          </div>
        }
      />

      <AcCard flush>
        {feed.isLoading ? (
          <SkeletonRows rows={4} cols={2} />
        ) : items.length === 0 ? (
          <EmptyState
            bare
            tone="positive"
            title="Nothing yet"
            description="Anything needing you will appear here."
          />
        ) : (
          <ul className="ac-rows">
            {items.map((n) => {
              const open = expanded === n.id;
              return (
                <li
                  key={n.id}
                  id={n.id}
                  className="ac-notif"
                  data-unread={n.readAt === null ? '1' : undefined}
                >
                  {/*
                    The whole row opens it. A notification is a
                    paragraph, not a document — it does not earn a
                    page of its own, and truncating it with no way
                    to read the rest is the thing being fixed here.
                    Opening also marks it read, which is what
                    reading something means.
                  */}
                  <button
                    type="button"
                    className="ac-notif__open"
                    aria-expanded={open}
                    onClick={() => {
                      setExpanded(open ? null : n.id);
                      if (!open && n.readAt === null) markRead.mutate(n.id);
                    }}
                  >
                    {n.title !== null && (
                      <span className="ac-notif__title">
                        {n.readAt === null && <span aria-hidden className="ac-notif__dot" />}
                        {n.title}
                      </span>
                    )}
                    <span className="ac-notif__body" data-clamp={open ? undefined : '1'}>
                      {n.body}
                    </span>
                    <span className="ac-notif__meta">
                      <span className="sk-figure">{new Date(n.createdAt).toLocaleString()}</span> ·{' '}
                      {n.topic}
                      {!open && ' · click to read'}
                    </span>
                  </button>

                  <div className="ac-notif__side">
                    {n.readAt === null ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<MailOpen size={14} />}
                        onClick={() => markRead.mutate(n.id)}
                      >
                        Mark read
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Mail size={14} />}
                        onClick={() => markUnread.mutate(n.id)}
                      >
                        Mark unread
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 size={14} />}
                      aria-label="Delete this notification"
                      onClick={() => dismiss.mutate(n.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {feed.data?.nextCursor != null && (
          <div className="ac-pad">
            <Button variant="ghost" onClick={() => setCursor(feed.data?.nextCursor ?? undefined)}>
              Older
            </Button>
          </div>
        )}
      </AcCard>

      {/*
        The preferences moved to their own page. They are a standing
        decision — set once, changed rarely — and they were sitting
        under a list that is read several times a day, pushing it up the
        screen every time somebody came to check what had happened.
      */}
      <p className="ac-text">
        <Link className="ac-link ac-inline" href="/notifications/settings">
          <Settings2 size={14} aria-hidden />
          Choose what reaches you
        </Link>{' '}
        — switch off anything you would rather not see here.
      </p>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear every notification?"
        entity="Your inbox"
        consequence="Every notification is removed from your inbox, including ones not loaded on this page."
        confirmLabel="Clear all"
        destructive
        error={clearError}
        onConfirm={async () => {
          setClearError(null);
          try {
            await dismissAll.mutateAsync();
          } catch (err) {
            setClearError(serverVerdict(err));
            throw err;
          }
        }}
      />
    </AcPage>
  );
}
