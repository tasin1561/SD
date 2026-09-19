'use client';

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { ArrowRight, Search, Settings2, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  Input,
  LoadingState,
  PageHeader,
  Section,
  agoLabel,
  humaniseTopic,
  notificationKindStyle,
} from '@skydrop/ui/components';
import {
  useDismissAllNotifications,
  useDismissNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useMarkNotificationUnread,
  useNotificationFeed,
  useNotificationTopics,
  type FeedItem,
} from '@/lib/notification-hooks';

/**
 * Everything Skydrop and this store's seller have sent this person.
 *
 * ── WHY THE STORE NEEDED ITS OWN ─────────────────────────────────────
 * Until 2026-09-19 a reseller store was reachable by email and by the
 * terms banner, and nothing else. Every decision on something it had
 * asked for, every change somebody else made to one of its orders, and
 * every reply on a dispute it had raised arrived in a mailbox or not at
 * all — while Skydrop admin and the seller's own staff had had a bell, a
 * feed and a settings page since NOTIF-9..21.
 *
 * ── THE FILTER IS HONEST ABOUT ITS REACH ─────────────────────────────
 * The feed is cursor-paged at 20 and the endpoint takes no query, so the
 * box filters what is LOADED and says so the moment there is more behind
 * it. A search that silently ignores page two is worse than no search,
 * because it answers "nothing found" for something that exists.
 */
export function NotificationsView(): ReactElement {
  /** Pages accumulate — "load earlier" appends rather than replacing. */
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [older, setOlder] = useState<readonly FeedItem[]>([]);
  const feed = useNotificationFeed(cursor);
  const topics = useNotificationTopics();

  const markRead = useMarkNotificationRead();
  const markUnread = useMarkNotificationUnread();
  const dismiss = useDismissNotification();
  const dismissAll = useDismissAllNotifications();
  const markAll = useMarkAllNotificationsRead();

  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);

  // The catalogue gives a topic its GROUP and its name for a person
  // (NOTIF-17) — read from the server's one declared list rather than by
  // pattern-matching a topic string, which is how a second taxonomy
  // starts.
  const byTopic = useMemo(() => {
    const m = new Map<string, { group: string; label: string }>();
    for (const t of topics.data ?? []) m.set(t.topic, { group: t.group, label: t.label });
    return m;
  }, [topics.data]);

  const page = feed.data?.items ?? [];
  const items = useMemo(() => {
    const seen = new Set<string>();
    return [...older, ...page].filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
  }, [older, page]);

  const now = useMemo(() => Date.now(), [items]);

  /** Only the groups actually present — a tab that cannot be empty. */
  const tabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of items) {
      const g = byTopic.get(n.topic)?.group;
      if (g !== undefined) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items, byTopic]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((n) => {
      if (unreadOnly && n.readAt !== null) return false;
      if (tab !== '' && byTopic.get(n.topic)?.group !== tab) return false;
      if (q === '') return true;
      // Body too: an order number lives in the prose rather than in a
      // column of its own.
      return `${n.title ?? ''} ${n.body} ${n.topic}`.toLowerCase().includes(q);
    });
  }, [items, query, tab, unreadOnly, byTopic]);

  // The bell links here as `#<id>` (NOTIF-21). Open that one and scroll
  // to it — arriving from the bell and landing at the top of a list with
  // the thing you clicked somewhere below is the same dead end as not
  // linking at all.
  useEffect(() => {
    const id = window.location.hash.replace(/^#/, '');
    if (id === '' || items.length === 0) return;
    if (!items.some((n) => n.id === id)) return;
    setExpanded(id);
    document.getElementById(id)?.scrollIntoView({ block: 'center' });
  }, [items]);

  const unread = items.filter((n) => n.readAt === null).length;
  const more = feed.data?.nextCursor ?? null;

  return (
    <Section>
      <PageHeader
        title="Notifications"
        subtitle="Everything sent to you about this store. Clearing one hides it from your list; the record of what was sent is kept."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => markAll.mutate()} disabled={unread === 0}>
              Mark all read
            </Button>
            <Button
              variant="ghost"
              onClick={() => dismissAll.mutate()}
              disabled={items.length === 0}
            >
              <Trash2 size={14} aria-hidden /> Clear all
            </Button>
            <Link
              href="/notifications/settings"
              className="text-text-muted hover:text-text-body inline-flex items-center gap-1.5 text-sm"
            >
              <Settings2 size={14} aria-hidden /> Settings
            </Link>
          </div>
        }
      />

      <Card>
        <CardBody className="border-border-subtle flex flex-wrap items-center gap-2 border-b">
          <div className="relative min-w-[12rem] flex-1">
            <Search
              size={14}
              aria-hidden
              className="text-text-faint pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
            />
            <Input
              aria-label="Filter notifications"
              placeholder="Filter what is loaded…"
              className="pl-8"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <TabButton
            active={tab === ''}
            onClick={() => setTab('')}
            label="All"
            count={items.length}
          />
          {tabs.map(([group, count]) => (
            <TabButton
              key={group}
              active={tab === group}
              onClick={() => setTab(group)}
              label={group}
              count={count}
            />
          ))}
          <label className="text-text-muted ml-auto inline-flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
            />
            Unread only
          </label>
        </CardBody>

        {feed.isLoading ? (
          <CardBody>
            <LoadingState label="Loading notifications…" rows={4} />
          </CardBody>
        ) : shown.length === 0 ? (
          <CardBody>
            <EmptyState
              title={items.length === 0 ? 'Nothing yet' : 'Nothing matches'}
              description={
                items.length === 0
                  ? 'Decisions on what you have asked the seller, changes to your orders, replies on your tickets and new terms all land here.'
                  : query.trim() !== '' && more !== null
                    ? 'Nothing on this page matches. There are older notifications that have not been loaded — load them and try again.'
                    : 'Nothing here matches that.'
              }
            />
          </CardBody>
        ) : (
          <ul className="divide-border-subtle divide-y">
            {shown.map((n) => (
              <Row
                key={n.id}
                item={n}
                now={now}
                group={byTopic.get(n.topic)?.group ?? null}
                label={byTopic.get(n.topic)?.label ?? null}
                expanded={expanded === n.id}
                onToggle={() => {
                  setExpanded(expanded === n.id ? null : n.id);
                  if (n.readAt === null) markRead.mutate(n.id);
                }}
                onUnread={() => markUnread.mutate(n.id)}
                onDismiss={() => dismiss.mutate(n.id)}
              />
            ))}
          </ul>
        )}

        {more !== null && (
          <CardBody className="border-border-subtle border-t text-center">
            <Button
              variant="ghost"
              onClick={() => {
                setOlder(items);
                setCursor(more);
              }}
            >
              Load earlier
            </Button>
          </CardBody>
        )}
      </Card>
    </Section>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly label: string;
  readonly count: number;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-accent text-text-inverse'
          : 'text-text-muted hover:bg-surface-raised hover:text-text-body',
      )}
    >
      {label} <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function Row({
  item,
  now,
  group,
  label,
  expanded,
  onToggle,
  onUnread,
  onDismiss,
}: {
  readonly item: FeedItem;
  readonly now: number;
  readonly group: string | null;
  readonly label: string | null;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onUnread: () => void;
  readonly onDismiss: () => void;
}): ReactElement {
  const { Icon, tone } = notificationKindStyle(group);
  return (
    <li
      id={item.id}
      className={clsx(
        'flex items-start gap-3 px-4 py-3',
        item.readAt === null && 'bg-surface-raised',
      )}
    >
      <span
        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px]"
        style={{ background: `var(--status-${tone}-bg)`, color: `var(--status-${tone}-fg)` }}
        aria-hidden
      >
        <Icon size={14} />
      </span>

      <div className="min-w-0 flex-1">
        <button type="button" onClick={onToggle} className="block w-full text-left">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span
              className={clsx(
                'text-sm',
                item.readAt === null ? 'text-text-bright font-semibold' : 'text-text-body',
              )}
            >
              {item.title ?? label ?? humaniseTopic(item.topic)}
            </span>
            <span className="text-text-faint text-xs">{agoLabel(item.createdAt, now)}</span>
          </div>
          <div
            className={clsx(
              'text-text-muted mt-0.5 text-xs whitespace-pre-line',
              !expanded && 'line-clamp-2',
            )}
          >
            {item.body}
          </div>
        </button>

        {expanded && (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            {item.orderId !== null && (
              <Link
                href={`/orders/${item.orderId}`}
                className="text-accent hover:text-accent-hover inline-flex items-center gap-1"
              >
                Open the order <ArrowRight size={12} aria-hidden />
              </Link>
            )}
            {item.readAt !== null && (
              <button
                type="button"
                onClick={onUnread}
                className="text-text-muted hover:text-text-body"
              >
                Mark unread
              </button>
            )}
            <button
              type="button"
              onClick={onDismiss}
              className="text-text-muted hover:text-critical"
            >
              Clear from my list
            </button>
            <span className="text-text-faint font-mono">{label ?? item.topic}</span>
          </div>
        )}
      </div>
    </li>
  );
}
