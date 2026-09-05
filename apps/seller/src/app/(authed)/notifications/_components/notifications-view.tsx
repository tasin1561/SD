'use client';

import { useEffect, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Button, Card, CardBody, PageHeader, Section } from '@skydrop/ui/components';
import {
  useClearNotificationSubscription,
  useMarkAllNotificationsRead,
  useDismissAllNotifications,
  useDismissNotification,
  useMarkNotificationRead,
  useMarkNotificationUnread,
  useNotificationFeed,
  useNotificationSubscriptions,
  useNotificationTopics,
  type TopicDef,
  useSetNotificationSubscription,
} from '@/lib/notification-hooks';
import { serverVerdict } from '@/lib/server-verdict';

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
  const subs = useNotificationSubscriptions();
  const setSub = useSetNotificationSubscription();
  const clearSub = useClearNotificationSubscription();
  const [error, setError] = useState<string | null>(null);
  const topics = useNotificationTopics();

  // A topic with no row follows its default, which is ON. Only an
  // explicit MUTED row switches something off.
  const muted = new Set((subs.data ?? []).filter((s) => s.mode === 'MUTED').map((s) => s.topic));
  const grouped = (topics.data ?? []).reduce<Record<string, TopicDef[]>>((acc, t) => {
    (acc[t.group] ??= []).push(t);
    return acc;
  }, {});

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
    <Section>
      <PageHeader
        title="Notifications"
        subtitle="Everything sent to you, and what you have chosen to silence."
        action={
          <div className="flex items-center gap-2">
            {(feed.data?.unreadCount ?? 0) > 0 && (
              <Button variant="secondary" onClick={() => markAll.mutate()}>
                Mark all read
              </Button>
            )}
            {items.length > 0 && (
              <Button variant="ghost" onClick={() => dismissAll.mutate()}>
                Clear all
              </Button>
            )}
          </div>
        }
      />

      {error !== null && (
        <Card>
          <CardBody>
            <p className="text-status-failed-fg text-sm">{error}</p>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody>
          {feed.isLoading ? (
            <p className="text-text-muted text-sm">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-text-muted text-sm">
              Nothing yet. Anything needing you will appear here.
            </p>
          ) : (
            <ul className="divide-border-subtle divide-y">
              {items.map((n) => {
                const open = expanded === n.id;
                return (
                  <li key={n.id} id={n.id} className="py-3">
                    <div className="flex items-start justify-between gap-3">
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
                        className="min-w-0 flex-1 text-left"
                        aria-expanded={open}
                        onClick={() => {
                          setExpanded(open ? null : n.id);
                          if (!open && n.readAt === null) markRead.mutate(n.id);
                        }}
                      >
                        {n.title !== null && (
                          <div
                            className={
                              n.readAt === null ? 'text-sm font-semibold' : 'text-sm font-medium'
                            }
                          >
                            {n.readAt === null && (
                              <span
                                aria-hidden
                                className="bg-accent mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
                              />
                            )}
                            {n.title}
                          </div>
                        )}
                        <div
                          className={
                            open
                              ? 'text-text-muted mt-0.5 whitespace-pre-line text-sm'
                              : 'text-text-muted mt-0.5 line-clamp-2 whitespace-pre-line text-sm'
                          }
                        >
                          {n.body}
                        </div>
                        <div className="text-text-faint mt-1 text-xs tabular-nums">
                          {new Date(n.createdAt).toLocaleString()} · {n.topic}
                          {!open && ' · click to read'}
                        </div>
                      </button>

                      <div className="flex shrink-0 items-center gap-1">
                        {n.readAt === null ? (
                          <Button size="sm" variant="ghost" onClick={() => markRead.mutate(n.id)}>
                            Mark read
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => markUnread.mutate(n.id)}>
                            Mark unread
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Delete this notification"
                          onClick={() => dismiss.mutate(n.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {feed.data?.nextCursor != null && (
            <div className="mt-3">
              <Button variant="ghost" onClick={() => setCursor(feed.data?.nextCursor ?? undefined)}>
                Older
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h2 className="text-sm font-semibold">What reaches you</h2>
          <p className="text-text-muted mt-0.5 text-xs">
            Switch off anything you would rather not see here. Messages about your account and
            credentials are not listed — they only ever go to your email, and cannot be silenced.
          </p>
          <p className="text-text-faint mt-1 text-xs">
            These are YOUR choices, for YOUR inbox. What the company as a whole is emailed about is
            set separately, in{' '}
            <Link className="underline underline-offset-2" href="/settings/notifications">
              Settings → Notifications
            </Link>
            .
          </p>

          {topics.isLoading ? (
            <p className="text-text-muted mt-3 text-sm">Loading…</p>
          ) : (
            Object.entries(grouped).map(([group, defs]) => (
              <div key={group} className="mt-4">
                <h3 className="text-text-faint text-xs font-medium uppercase tracking-wide">
                  {group}
                </h3>
                <ul className="divide-border-subtle mt-1 divide-y">
                  {defs.map((d) => {
                    const on = !muted.has(d.topic);
                    return (
                      <li key={d.topic} className="flex items-start justify-between gap-4 py-2.5">
                        <div className="min-w-0">
                          <div className="text-sm">{d.label}</div>
                          <div className="text-text-muted text-xs">{d.description}</div>
                        </div>
                        <label className="flex shrink-0 items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={on}
                            aria-label={`Notify me about: ${d.label}`}
                            onChange={() => {
                              setError(null);
                              if (on) {
                                setSub.mutate(
                                  { topic: d.topic, mode: 'MUTED' },
                                  { onError: (e) => setError(serverVerdict(e)) },
                                );
                              } else {
                                clearSub.mutate(d.topic, {
                                  onError: (e) => setError(serverVerdict(e)),
                                });
                              }
                            }}
                          />
                          <span className="text-text-faint">{on ? 'On' : 'Off'}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </CardBody>
      </Card>
    </Section>
  );
}
