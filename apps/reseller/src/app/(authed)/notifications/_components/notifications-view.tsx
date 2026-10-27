'use client';

import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCheck, Settings2, Trash2 } from 'lucide-react';
import { agoLabel, humaniseTopic, notificationKindStyle } from '@skydrop/ui/components';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { Button, buttonClassName } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { Tabs } from '@skydrop/ui/app/tabs';
import { TableToolbar } from '@skydrop/ui/app/data-table';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
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
import { useLocale, useT } from '@/i18n/client';
import './notifications.css';

/** The tab id that means "every group" — a group name is never empty. */
const ALL_GROUPS = '__all';

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
  const t = useT();
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
  // Clearing and marking everything read ask first (owner, 2026-09-24):
  // each restates how many it touches. So does clearing one message —
  // once cleared it cannot be brought back from here.
  const [pendingDismiss, setPendingDismiss] = useState<FeedItem | null>(null);
  const [confirmDismissAll, setConfirmDismissAll] = useState(false);
  const [confirmMarkAll, setConfirmMarkAll] = useState(false);

  // The catalogue gives a topic its GROUP and its name for a person
  // (NOTIF-17) — read from the server's one declared list rather than by
  // pattern-matching a topic string, which is how a second taxonomy
  // starts.
  const byTopic = useMemo(() => {
    const m = new Map<string, { group: string; label: string }>();
    for (const tp of topics.data ?? []) m.set(tp.topic, { group: tp.group, label: tp.label });
    return m;
  }, [topics.data]);

  const items = useMemo(() => {
    // The page is read INSIDE the memo: `feed.data?.items ?? []` is a
    // fresh array identity on every render, so as a dependency it would
    // rebuild this list on each keystroke in the search box.
    const page = feed.data?.items ?? [];
    const seen = new Set<string>();
    return [...older, ...page].filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
  }, [older, feed.data]);

  // ONE `now` per render pass, so no two rows can disagree about what it
  // is mid-list. Deliberately not memoised on `items`: `Row` is not
  // memoised either, so pinning it bought nothing, and `Date.now()` did
  // not read the list it claimed to depend on.
  const now = Date.now();

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

  function titleOf(n: FeedItem): string {
    return n.title ?? byTopic.get(n.topic)?.label ?? humaniseTopic(n.topic);
  }

  return (
    <div className="rc-ntf-page">
      <PageHeader
        title={t('rntf.title')}
        subtitle={t('rntf.subtitle')}
        action={
          <div className="rc-ntf-actions">
            <Button
              variant="secondary"
              icon={<CheckCheck size={15} />}
              onClick={() => setConfirmMarkAll(true)}
              disabled={unread === 0}
            >
              {t('rntf.markAllRead')}
            </Button>
            <Button
              variant="ghost"
              icon={<Trash2 size={14} />}
              onClick={() => setConfirmDismissAll(true)}
              disabled={items.length === 0}
            >
              {t('rntf.clearAll')}
            </Button>
            <Link href="/notifications/settings" className={buttonClassName('ghost', 'md')}>
              <span className="sk-btn__fx" aria-hidden />
              <span className="sk-btn__icon" aria-hidden>
                <Settings2 size={15} />
              </span>
              <span className="sk-btn__label">{t('rntf.settings')}</span>
            </Link>
          </div>
        }
      />

      <section className="rc-ntf-section">
        <SectionHeading
          title={t('rntf.inbox')}
          note={
            shown.length === items.length
              ? t(items.length === 1 ? 'rntf.count.one' : 'rntf.count.other', { n: items.length })
              : t('rntf.shownOfLoaded', { shown: shown.length, total: items.length })
          }
        />
        <TableToolbar
          search={{
            value: query,
            onChange: setQuery,
            label: t('rntf.filter.label'),
            placeholder: t('rntf.filter.placeholder'),
          }}
        />
        <div className="rc-ntf-filters">
          <Tabs
            label={t('rntf.tabs.label')}
            size="sm"
            items={[
              { id: ALL_GROUPS, label: t('rntf.tabs.all'), count: items.length },
              ...tabs.map(([group, count]) => ({ id: group, label: group, count })),
            ]}
            value={tab === '' ? ALL_GROUPS : tab}
            onChange={(id) => setTab(id === ALL_GROUPS ? '' : id)}
          />
          <Checkbox
            label={t('rntf.unreadOnly')}
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
          />
        </div>

        {feed.isLoading ? (
          <SkeletonRows rows={4} cols={2} label={t('rntf.loading')} />
        ) : shown.length === 0 ? (
          <EmptyState
            tone={items.length === 0 ? 'positive' : 'neutral'}
            title={items.length === 0 ? t('rntf.empty.title') : t('rntf.empty.noMatch')}
            description={
              items.length === 0
                ? t('rntf.empty.body')
                : query.trim() !== '' && more !== null
                  ? t('rntf.empty.olderNotLoaded')
                  : t('rntf.empty.nothingHere')
            }
          />
        ) : (
          <ul className="rc-ntf-list">
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
                onUnread={() => markUnread.mutateAsync(n.id)}
                onDismiss={() => setPendingDismiss(n)}
              />
            ))}
          </ul>
        )}

        {more !== null && (
          <div className="rc-ntf-more">
            <Button
              variant="secondary"
              onClick={() => {
                setOlder(items);
                setCursor(more);
              }}
            >
              {t('rntf.loadEarlier')}
            </Button>
          </div>
        )}
      </section>

      {/* A failure is not reported by any of these three, exactly as
          before: the row simply stays as it was. */}
      <ConfirmDialog
        open={confirmMarkAll}
        onOpenChange={setConfirmMarkAll}
        title={t('rntf.markAll.title')}
        entity={t(more !== null ? 'rntf.markAll.entityMore' : 'rntf.markAll.entity', { n: unread })}
        consequence={t('rntf.markAll.consequence')}
        confirmLabel={t('rntf.markAllRead')}
        onConfirm={() =>
          markAll.mutateAsync().then(
            () => undefined,
            () => undefined,
          )
        }
      />
      <ConfirmDialog
        open={confirmDismissAll}
        onOpenChange={setConfirmDismissAll}
        title={t('rntf.clearAll.title')}
        entity={t(more !== null ? 'rntf.clearAll.entityMore' : 'rntf.clearAll.entity', {
          n: items.length,
        })}
        consequence={t('rntf.clearAll.consequence')}
        confirmLabel={t('rntf.clearAll')}
        destructive
        onConfirm={() =>
          dismissAll.mutateAsync().then(
            () => undefined,
            () => undefined,
          )
        }
      />
      <ConfirmDialog
        open={pendingDismiss !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDismiss(null);
        }}
        title={t('rntf.clearOne.title')}
        entity={pendingDismiss === null ? '' : titleOf(pendingDismiss)}
        consequence={t('rntf.clearOne.consequence')}
        confirmLabel={t('rntf.clearOne.confirm')}
        destructive
        onConfirm={() =>
          pendingDismiss === null
            ? undefined
            : dismiss.mutateAsync(pendingDismiss.id).then(
                () => undefined,
                () => undefined,
              )
        }
      />
    </div>
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
  readonly onUnread: () => Promise<unknown>;
  readonly onDismiss: () => void;
}): ReactElement {
  const t = useT();
  const locale = useLocale();
  const { Icon, tone } = notificationKindStyle(group);
  const isUnread = item.readAt === null;
  // The kind's colours, read from the status tokens by name — never a hex.
  const toneVars = {
    '--rc-ntf-fg': `var(--st-${tone}-fg)`,
    '--rc-ntf-bg': `var(--st-${tone}-bg)`,
    '--rc-ntf-line': `var(--st-${tone}-line)`,
  } as CSSProperties;
  return (
    <li
      id={item.id}
      className="rc-ntf-item"
      data-unread={isUnread ? '1' : undefined}
      style={toneVars}
    >
      <span className="rc-ntf-item__edge" aria-hidden />
      <span className="rc-ntf-item__icon" aria-hidden>
        <Icon size={16} />
      </span>

      <div className="rc-ntf-item__body">
        <button
          type="button"
          onClick={onToggle}
          className="rc-ntf-item__open"
          aria-expanded={expanded}
        >
          <span className="rc-ntf-item__top">
            <span className="rc-ntf-item__title" data-unread={isUnread ? '1' : undefined}>
              {item.title ?? label ?? humaniseTopic(item.topic)}
            </span>
            {isUnread && <span className="rc-ntf-item__new">{t('rntf.row.new')}</span>}
            <span className="rc-ntf-item__when sk-figure">
              {agoLabel(item.createdAt, now, locale)}
            </span>
          </span>
          <span className="rc-ntf-item__text" data-open={expanded ? '1' : undefined}>
            {item.body}
          </span>
        </button>

        {expanded && (
          <div className="rc-ntf-item__actions">
            {item.orderId !== null && (
              <Link href={`/orders/${item.orderId}`} className="rc-ntf-item__order">
                {t('rntf.row.openOrder')} <ArrowRight size={12} aria-hidden />
              </Link>
            )}
            {item.readAt !== null && (
              <AsyncButton
                variant="ghost"
                size="sm"
                labels={{
                  idle: t('rntf.row.markUnread'),
                  busy: t('rntf.row.marking'),
                  done: t('rntf.row.unread'),
                }}
                onAction={onUnread}
              />
            )}
            <Button variant="ghost" size="sm" icon={<Trash2 size={13} />} onClick={onDismiss}>
              {t('rntf.clearOne.confirm')}
            </Button>
            <span className={label === null ? 'rc-ntf-item__topic sk-ident' : 'rc-ntf-item__topic'}>
              {label ?? item.topic}
            </span>
          </div>
        )}
      </div>
    </li>
  );
}
