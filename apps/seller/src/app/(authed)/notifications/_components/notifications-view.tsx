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
  useMarkAllNotificationsRead,
  useDismissAllNotifications,
  useDismissNotification,
  useMarkNotificationRead,
  useMarkNotificationUnread,
  useNotificationFeed,
  useNotificationTopics,
  type FeedItem,
} from '@/lib/notification-hooks';

/**
 * Everything that has been sent to this person.
 *
 * ── THE 2026-09-08 REDESIGN ──────────────────────────────────────────
 * From a reference comp. What was taken: a kind you can recognise
 * before you read it (tinted icon tile, coloured edge), category tabs
 * carrying counts, a filter box, an unread/all switch, relative times
 * beside absolute ones, and a row that offers the one thing a person
 * actually wants next — the order it is about.
 *
 * What was deliberately NOT taken, because a comp is a drawing and a
 * drawing can show a control with nothing behind it:
 *
 *   - The four telemetry tiles ("2 Unresolved · <14 hrs SLA", "14 On
 *     Track · 93.4% SLA", "Gateway & Telemetry Relay 99.98%"). We store
 *     no per-parcel SLA and no relay uptime; each would be a figure that
 *     looks like a commitment and is a decoration. The tabs already
 *     carry the only counts that are true.
 *   - "LIVE STREAM CONNECTED". The feed is FETCHED, not streamed. A
 *     badge claiming a socket is a lie about how fresh the page is.
 *   - The whole "Alert Channels & Routing" rail — In-App Webhooks,
 *     WhatsApp Delivery Alerts, Email Ledger Digest, Critical SMS
 *     Escalation. Three of those four were on the preferences screen
 *     once and were REMOVED (NOTIF-15) precisely because nothing read
 *     them: there is no SMS sender, outbound webhooks are configured per
 *     endpoint and never consulted that toggle, and a digest needs a
 *     scheduler that does not exist. Putting them back as switches would
 *     be the same defect wearing a nicer rail.
 *   - "Silent Rules & DND", the NDR-resolution sparkline, and the
 *     warehouse-hub sync bars. None of that is on a notification.
 *   - Per-row "Dispatch Re-attempt" / "Call Consignee / IVR" / "WhatsApp
 *     Buyer" / "Update Landmark". There is no telephony and no WhatsApp;
 *     a re-attempt dispatches a van at our cost and CUR-10 keeps it
 *     behind an operator on a gated screen, not behind a button in an
 *     inbox; editing a recipient mid-flight carries CUR-11's guards.
 *
 * ── THE FILTER IS HONEST ABOUT ITS REACH ─────────────────────────────
 * The feed is cursor-paged at 20 and the endpoint takes no query. So the
 * box filters what is LOADED, and says so the moment there is more
 * behind it — a search that silently ignores page two is worse than no
 * search, because it answers "nothing found" for something that exists.
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
  // (NOTIF-17). Read from that one declared list rather than by
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
      // Body too, because an AWB and an order number live in the prose
      // rather than in a column of their own.
      return `${n.title ?? ''} ${n.body} ${n.topic}`.toLowerCase().includes(q);
    });
  }, [items, query, tab, unreadOnly, byTopic]);

  // The bell links here as `#<id>`. Open that one and scroll to it —
  // otherwise arriving from the bell lands you at the top of a list
  // with the thing you clicked somewhere below, which is the same dead
  // end as not linking at all.
  useEffect(() => {
    const id = window.location.hash.replace(/^#/, '');
    if (id === '' || items.length === 0) return;
    if (!items.some((n) => n.id === id)) return;
    setExpanded(id);
    document.getElementById(id)?.scrollIntoView({ block: 'center' });
  }, [items]);

  const unread = feed.data?.unreadCount ?? 0;
  const filtering = query.trim() !== '' || tab !== '' || unreadOnly;
  const hasMore = feed.data?.nextCursor != null;

  return (
    <Section>
      <PageHeader
        title="Notifications"
        subtitle="Everything sent to you — what a courier did, what the warehouse checked in, and what moved in your wallet."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {unread > 0 && (
              <Button variant="secondary" onClick={() => markAll.mutate()}>
                Mark all read
              </Button>
            )}
            {items.length > 0 && (
              <Button variant="ghost" onClick={() => dismissAll.mutate()}>
                <Trash2 size={13} aria-hidden />
                Clear all
              </Button>
            )}
            <Link
              href="/notifications/settings"
              className="skydrop-hit border-border bg-surface text-text-body hover:border-border-strong hover:text-text-bright inline-flex h-9 items-center gap-1.5 rounded-[5px] border px-3.5 text-sm font-medium transition-colors"
            >
              <Settings2 size={14} aria-hidden />
              Settings
            </Link>
          </div>
        }
      />

      {/* ── Filters ────────────────────────────────────────────── */}
      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-[16rem]">
            <Search
              size={15}
              aria-hidden
              className="text-text-faint pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by order, AWB or wording…"
              aria-label="Filter notifications"
              className="pl-8"
            />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Pill label="All" on={!unreadOnly} onClick={() => setUnreadOnly(false)} />
            <Pill
              label="Unread"
              count={unread}
              on={unreadOnly}
              onClick={() => setUnreadOnly(true)}
            />
          </div>
        </CardBody>

        {tabs.length > 1 && (
          <div
            role="tablist"
            aria-label="Filter by kind"
            className="border-border-subtle flex gap-1 overflow-x-auto border-t px-3 py-2"
          >
            <Pill
              label="Everything"
              count={items.length}
              on={tab === ''}
              onClick={() => setTab('')}
              tab
            />
            {tabs.map(([group, count]) => (
              <Pill
                key={group}
                label={group}
                count={count}
                on={tab === group}
                onClick={() => setTab(group)}
                tab
              />
            ))}
          </div>
        )}
      </Card>

      {/* ── Feed ───────────────────────────────────────────────── */}
      {feed.isLoading && items.length === 0 ? (
        <LoadingState label="Loading notifications…" rows={4} />
      ) : shown.length === 0 ? (
        <EmptyState
          title={filtering ? 'Nothing matches' : 'Nothing yet'}
          description={
            filtering
              ? hasMore
                ? 'Nothing in what is loaded so far. Load earlier notifications to look further back.'
                : 'Nothing here matches. Clear the filter to see everything again.'
              : 'Anything needing you will appear here — a delivery that failed, a parcel coming back, money that moved.'
          }
          {...(filtering
            ? {
                action: (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuery('');
                      setTab('');
                      setUnreadOnly(false);
                    }}
                  >
                    Clear filter
                  </Button>
                ),
              }
            : {})}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((n) => {
            const meta = byTopic.get(n.topic);
            const { Icon, tone } = notificationKindStyle(meta?.group ?? null);
            const open = expanded === n.id;
            const isUnread = n.readAt === null;
            return (
              <li key={n.id} id={n.id}>
                <Card className={clsx('relative overflow-hidden', isUnread && 'border-accent/40')}>
                  {/*
                    A coloured edge, keyed on the KIND rather than on
                    unread. It is what lets somebody find the returns in
                    a list of thirty without reading a word — which is
                    the whole reason the comp put a stripe there.
                  */}
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-[3px]"
                    style={{ background: `var(--status-${tone}-fg)` }}
                  />
                  <CardBody className="pl-5">
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px]"
                        style={{
                          background: `var(--status-${tone}-bg)`,
                          color: `var(--status-${tone}-fg)`,
                        }}
                      >
                        <Icon size={16} />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className="truncate rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
                              style={{
                                background: `var(--status-${tone}-bg)`,
                                color: `var(--status-${tone}-fg)`,
                              }}
                            >
                              {meta?.label ?? humaniseTopic(n.topic)}
                            </span>
                            {isUnread && (
                              <span className="bg-accent-fill text-accent-fg shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                                New
                              </span>
                            )}
                          </span>
                          <span className="text-text-faint shrink-0 text-xs whitespace-nowrap">
                            {agoLabel(n.createdAt, now)}
                            <span className="max-sm:hidden">
                              {' · '}
                              {new Date(n.createdAt).toLocaleString()}
                            </span>
                          </span>
                        </div>

                        {/*
                          The whole block opens it. A notification is a
                          paragraph, not a document — it does not earn a
                          page of its own, and truncating it with no way
                          to read the rest is the thing this fixes.
                          Opening also marks it read, which is what
                          reading something means.
                        */}
                        <button
                          type="button"
                          className="mt-1 block w-full text-left"
                          aria-expanded={open}
                          onClick={() => {
                            setExpanded(open ? null : n.id);
                            if (!open && isUnread) markRead.mutate(n.id);
                          }}
                        >
                          {n.title !== null && (
                            <span
                              className={clsx(
                                'text-text-bright block text-sm leading-snug',
                                isUnread ? 'font-semibold' : 'font-medium',
                              )}
                            >
                              {n.title}
                            </span>
                          )}
                          <span
                            className={clsx(
                              'text-text-muted mt-1 block text-sm leading-relaxed whitespace-pre-line',
                              !open && 'line-clamp-2',
                            )}
                          >
                            {n.body}
                          </span>
                          {!open && (
                            <span className="text-text-faint mt-1 block text-xs">
                              Click to read it all
                            </span>
                          )}
                        </button>

                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                          {/* The one action a person actually wants
                              next, and the only one we can honour from
                              here: the order it is about. */}
                          {n.orderId !== null && (
                            <Link
                              href={`/orders/${n.orderId}`}
                              className="text-accent inline-flex items-center gap-1 text-xs font-medium"
                            >
                              View order <ArrowRight size={12} aria-hidden />
                            </Link>
                          )}
                          <button
                            type="button"
                            className="text-text-muted hover:text-text-bright text-xs"
                            onClick={() =>
                              isUnread ? markRead.mutate(n.id) : markUnread.mutate(n.id)
                            }
                          >
                            {isUnread ? 'Mark read' : 'Mark unread'}
                          </button>
                          <button
                            type="button"
                            className="text-text-faint hover:text-critical text-xs"
                            onClick={() => dismiss.mutate(n.id)}
                          >
                            Dismiss
                          </button>
                          <span className="text-text-faint ml-auto font-mono text-[11px]">
                            {n.topic}
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-text-faint text-xs">
            Showing {shown.length} of {items.length} loaded
          </span>
          <Button
            variant="secondary"
            onClick={() => {
              // Keep what is already on screen. Replacing it would make
              // "load earlier" behave like "go to page two", and the
              // filter above would then be searching a window that
              // moved under it.
              setOlder(items);
              setCursor(feed.data?.nextCursor ?? undefined);
            }}
          >
            Load earlier notifications
          </Button>
        </div>
      )}
    </Section>
  );
}

function Pill({
  label,
  count,
  on,
  onClick,
  tab = false,
}: {
  readonly label: string;
  readonly count?: number;
  readonly on: boolean;
  readonly onClick: () => void;
  readonly tab?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      {...(tab ? { role: 'tab' as const, 'aria-selected': on } : { 'aria-pressed': on })}
      onClick={onClick}
      className={clsx(
        'skydrop-hit inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
        on
          ? 'bg-accent-fill text-accent-fg'
          : 'text-text-muted hover:bg-surface-hover hover:text-text-bright',
      )}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className={clsx('tabular-nums', on ? 'opacity-80' : 'text-text-faint')}>{count}</span>
      )}
    </button>
  );
}
