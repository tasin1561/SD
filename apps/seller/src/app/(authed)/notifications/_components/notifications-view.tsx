'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  Button,
  Card,
  CardBody,
  Input,
  PageHeader,
  Section,
  StatusBadge,
} from '@skydrop/ui/components';
import {
  useClearNotificationSubscription,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationFeed,
  useNotificationSubscriptions,
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

  const items = feed.data?.items ?? [];

  return (
    <Section>
      <PageHeader
        title="Notifications"
        subtitle="Everything sent to you, and what you have chosen to silence."
        action={
          (feed.data?.unreadCount ?? 0) > 0 ? (
            <Button variant="secondary" onClick={() => markAll.mutate()}>
              Mark all read
            </Button>
          ) : undefined
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
          <h2 className="text-sm font-semibold">What you have silenced</h2>
          <p className="text-text-muted mt-0.5 text-xs">
            Anything not listed here follows its default. Messages about your account and
            credentials cannot be silenced — they only ever go to your email.
          </p>
          <p className="text-text-faint mt-1 text-xs">
            These are YOUR choices, for YOUR inbox. What the company as a whole is emailed about is
            set separately, in{' '}
            <Link className="underline underline-offset-2" href="/settings/notifications">
              Settings → Notifications
            </Link>
            .
          </p>
          {(subs.data ?? []).length === 0 ? (
            <p className="text-text-muted mt-3 text-sm">Nothing silenced.</p>
          ) : (
            <ul className="divide-border-subtle mt-2 divide-y">
              {(subs.data ?? []).map((s) => (
                <li key={s.topic} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <div className="font-mono text-xs">{s.topic}</div>
                    <div className="text-text-faint text-xs">
                      {s.mode === 'MUTED'
                        ? s.mutedChannels.length > 0
                          ? `silenced on ${s.mutedChannels.join(', ').toLowerCase()}`
                          : 'silenced'
                        : 'subscribed'}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => clearSub.mutate(s.topic)}>
                    Reset
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <SilenceForm
            onSubmit={(topic) => {
              setError(null);
              setSub.mutate(
                { topic, mode: 'MUTED' },
                { onError: (e) => setError(serverVerdict(e)) },
              );
            }}
            pending={setSub.isPending}
          />
        </CardBody>
      </Card>
    </Section>
  );
}

function SilenceForm({
  onSubmit,
  pending,
}: {
  readonly onSubmit: (topic: string) => void;
  readonly pending: boolean;
}): ReactElement {
  const [topic, setTopic] = useState('');
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <Input
        aria-label="Topic to silence"
        className="font-mono"
        placeholder="topic code, e.g. stock.low"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={pending || topic.trim().length < 2}
        onClick={() => {
          onSubmit(topic.trim());
          setTopic('');
        }}
      >
        Silence it
      </Button>
    </div>
  );
}
