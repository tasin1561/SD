'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Button, Card, CardBody, PageHeader, Section, StatusBadge } from '@skydrop/ui/components';
import { usePermission } from '@/lib/use-permission';
import {
  useClearNotificationSubscription,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
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
  // Cosmetic only (FE-2) — the server gates the broadcast endpoints.
  const canBroadcast = usePermission('notifications.broadcast');

  const items = feed.data?.items ?? [];

  return (
    <Section>
      <PageHeader
        title="Notifications"
        subtitle="Everything sent to you, and what you have chosen to silence."
        action={
          <div className="flex items-center gap-2">
            {canBroadcast && (
              <Link
                className="text-accent text-sm underline-offset-2 hover:underline"
                href="/notifications/broadcasts"
              >
                Send a broadcast
              </Link>
            )}
            {(feed.data?.unreadCount ?? 0) > 0 && (
              <Button variant="secondary" onClick={() => markAll.mutate()}>
                Mark all read
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
              {items.map((n) => (
                <li key={n.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    {n.title !== null && <div className="text-sm font-medium">{n.title}</div>}
                    <div className="text-text-muted whitespace-pre-line text-sm">{n.body}</div>
                    <div className="text-text-faint mt-1 text-xs tabular-nums">
                      {new Date(n.createdAt).toLocaleString()} · {n.topic}
                    </div>
                  </div>
                  {n.readAt === null ? (
                    <Button size="sm" variant="ghost" onClick={() => markRead.mutate(n.id)}>
                      Mark read
                    </Button>
                  ) : (
                    <StatusBadge kind="delivered" label="read" />
                  )}
                </li>
              ))}
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
