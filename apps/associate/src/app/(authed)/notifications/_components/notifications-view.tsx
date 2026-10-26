'use client';

import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import Link from 'next/link';
import { ArrowRight, BellOff, CheckCheck, Trash2 } from 'lucide-react';
import type { Locale } from '@skydrop/ui/app/i18n';
import { agoLabel, humaniseTopic, notificationKindStyle } from '@skydrop/ui/components';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useLocale, useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
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
import '../../_components/as.css';

/**
 * Everything Skydrop and this store have sent this person — the daily
 * digest of what was delivered, came back or could not be delivered
 * (ASSOC-1 capability 6) among it.
 *
 * ── WHY IT EXISTS AT ALL ────────────────────────────────────────────
 * That digest is IN-APP only, by NOTIF-23: a message with an inbox
 * behind it is not also emailed. NOTIF-23's premise is that an inbox
 * exists — and for an associate it did not, so the one notification the
 * owner named by hand was going somewhere nobody could read it.
 *
 * ── NO SEARCH BOX, UNLIKE THE STORE'S OWN ───────────────────────────
 * The feed is cursor-paged and the endpoint takes no query, so a box
 * here could only filter what is LOADED — which answers "nothing found"
 * for something that exists on page two. The store's portal has one and
 * says so in its own copy; this list is a day's worth of parcels and
 * "load earlier" is the honest shape for it.
 */
export function NotificationsView(): ReactElement {
  const t = useT();
  const locale = useLocale();
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
  // Clearing everything and marking everything read ask first; each
  // restates how many it touches. So does clearing one, because once it
  // is gone from the list it cannot be brought back from here.
  const [pendingDismiss, setPendingDismiss] = useState<FeedItem | null>(null);
  const [confirmDismissAll, setConfirmDismissAll] = useState(false);
  const [confirmMarkAll, setConfirmMarkAll] = useState(false);

  // The catalogue gives a topic its GROUP and its name for a person
  // (NOTIF-17) — the server's one declared list rather than a pattern
  // match on the topic string, which is how a second taxonomy starts.
  const byTopic = useMemo(() => {
    const m = new Map<string, { group: string; label: string }>();
    for (const tp of topics.data ?? []) m.set(tp.topic, { group: tp.group, label: tp.label });
    return m;
  }, [topics.data]);

  const items = useMemo(() => {
    // The page is read INSIDE the memo: `feed.data?.items ?? []` is a
    // fresh array identity every render, so as a dependency it would
    // rebuild this list on each render pass.
    const page = feed.data?.items ?? [];
    const seen = new Set<string>();
    return [...older, ...page].filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
  }, [older, feed.data]);

  // ONE `now` per render pass, so no two rows can disagree about what it
  // is mid-list.
  const now = Date.now();

  // The bell links here as `#<id>` (NOTIF-21): the dropdown truncates, so
  // a click that only marked it read left the text somebody was reaching
  // for still cut off. Open that one and scroll to it — arriving from the
  // bell and landing at the top of a list with the thing you clicked
  // somewhere below is the same dead end as not linking at all.
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
    <div className="as-page" data-width="narrow">
      <PageHeader
        title={t('ntf.title')}
        subtitle={t('ntf.subtitle')}
        action={
          <div className="as-row">
            <Button
              variant="secondary"
              icon={<CheckCheck size={15} />}
              onClick={() => setConfirmMarkAll(true)}
              disabled={unread === 0}
            >
              {t('ntf.markAllRead')}
            </Button>
            <Button
              variant="ghost"
              icon={<Trash2 size={14} />}
              onClick={() => setConfirmDismissAll(true)}
              disabled={items.length === 0}
            >
              {t('ntf.clearAll')}
            </Button>
          </div>
        }
      />

      <section className="as-section">
        <SectionHeading
          title={t('ntf.inbox')}
          note={
            items.length === 0
              ? undefined
              : `${t(items.length === 1 ? 'ntf.count.one' : 'ntf.count.other', { n: items.length })}${
                  unread === 0 ? '' : t('ntf.unreadSuffix', { n: unread })
                }`
          }
        />

        {feed.isPending && items.length === 0 ? (
          <SkeletonRows rows={5} cols={1} label={t('ntf.loading')} />
        ) : feed.isError && items.length === 0 ? (
          <ErrorState message={verdict(feed.error, t)} retry={() => void feed.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<BellOff size={20} />}
            tone="positive"
            title={t('ntf.empty.title')}
            description={t('ntf.empty.body')}
          />
        ) : (
          <>
            <ul className="as-ntf-list">
              {items.map((n) => (
                <Row
                  key={n.id}
                  item={n}
                  now={now}
                  locale={locale}
                  group={byTopic.get(n.topic)?.group ?? null}
                  label={byTopic.get(n.topic)?.label ?? null}
                  expanded={expanded === n.id}
                  onToggle={() => {
                    const open = expanded === n.id;
                    setExpanded(open ? null : n.id);
                    // Opening it IS reading it.
                    if (!open && n.readAt === null) markRead.mutate(n.id);
                  }}
                  onUnread={() => markUnread.mutateAsync(n.id)}
                  onDismiss={() => setPendingDismiss(n)}
                />
              ))}
            </ul>
            {more !== null ? (
              <div className="as-row">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    // Keep what is on screen, then ask for the next page.
                    setOlder(items);
                    setCursor(more);
                  }}
                >
                  {t('ntf.loadEarlier')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <ConfirmDialog
        open={confirmMarkAll}
        onOpenChange={setConfirmMarkAll}
        title={t('ntf.markAll.title')}
        entity={t('ntf.unreadCount', { n: unread })}
        consequence={t('ntf.markAll.consequence')}
        confirmLabel={t('ntf.markAllRead')}
        cancelLabel={t('ntf.markAll.notNow')}
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
        title={t('ntf.clearAll.title')}
        entity={t(items.length === 1 ? 'ntf.count.one' : 'ntf.count.other', { n: items.length })}
        consequence={t('ntf.clearAll.consequence')}
        confirmLabel={t('ntf.clearAll')}
        cancelLabel={t('ntf.clearAll.keep')}
        destructive
        onConfirm={() =>
          dismissAll.mutateAsync().then(
            () => {
              // The accumulated pages are gone too, or a cleared inbox
              // would keep rendering what this page was already holding.
              setOlder([]);
              setCursor(undefined);
            },
            () => undefined,
          )
        }
      />

      <ConfirmDialog
        open={pendingDismiss !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDismiss(null);
        }}
        title={t('ntf.clearOne.title')}
        entity={pendingDismiss === null ? '' : titleOf(pendingDismiss, byTopic)}
        consequence={t('ntf.clearOne.consequence')}
        confirmLabel={t('ntf.clearOne.confirm')}
        cancelLabel={t('ntf.clearOne.keep')}
        destructive
        onConfirm={() =>
          pendingDismiss === null
            ? undefined
            : dismiss.mutateAsync(pendingDismiss.id).then(
                () => {
                  setOlder((prev) => prev.filter((n) => n.id !== pendingDismiss.id));
                },
                () => undefined,
              )
        }
      />
    </div>
  );
}

function titleOf(n: FeedItem, byTopic: Map<string, { group: string; label: string }>): string {
  return n.title ?? byTopic.get(n.topic)?.label ?? humaniseTopic(n.topic);
}

function Row({
  item,
  now,
  locale,
  group,
  label,
  expanded,
  onToggle,
  onUnread,
  onDismiss,
}: {
  readonly item: FeedItem;
  readonly now: number;
  readonly locale: Locale;
  readonly group: string | null;
  readonly label: string | null;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onUnread: () => Promise<unknown>;
  readonly onDismiss: () => void;
}): ReactElement {
  const t = useT();
  const { Icon, tone } = notificationKindStyle(group);
  const isUnread = item.readAt === null;
  // The kind's colours, read from the status tokens BY NAME — never a hex.
  const toneVars = {
    '--as-ntf-fg': `var(--st-${tone}-fg)`,
    '--as-ntf-bg': `var(--st-${tone}-bg)`,
    '--as-ntf-line': `var(--st-${tone}-line)`,
  } as CSSProperties;
  return (
    <li
      id={item.id}
      className="as-ntf-item"
      data-unread={isUnread ? '1' : undefined}
      style={toneVars}
    >
      <span className="as-ntf-item__edge" aria-hidden />
      <span className="as-ntf-item__icon" aria-hidden>
        <Icon size={16} />
      </span>

      <div className="as-ntf-item__body">
        <button
          type="button"
          onClick={onToggle}
          className="as-ntf-item__open"
          aria-expanded={expanded}
        >
          <span className="as-ntf-item__top">
            <span className="as-ntf-item__title" data-unread={isUnread ? '1' : undefined}>
              {item.title ?? label ?? humaniseTopic(item.topic)}
            </span>
            {isUnread && <span className="as-ntf-item__new">{t('ntf.row.new')}</span>}
            <span className="as-ntf-item__when sk-figure">
              {agoLabel(item.createdAt, now, locale)}
            </span>
          </span>
          <span className="as-ntf-item__text" data-open={expanded ? '1' : undefined}>
            {item.body}
          </span>
        </button>

        {expanded && (
          <div className="as-ntf-item__actions">
            {item.orderId !== null && (
              <Link href={`/orders/${item.orderId}`} className="as-ntf-item__order">
                {t('ntf.row.openOrder')} <ArrowRight size={12} aria-hidden />
              </Link>
            )}
            {item.readAt !== null && (
              <AsyncButton
                variant="ghost"
                size="sm"
                labels={{
                  idle: t('ntf.row.markUnread'),
                  busy: t('ntf.row.marking'),
                  done: t('ntf.row.unread'),
                }}
                onAction={onUnread}
              />
            )}
            <Button variant="ghost" size="sm" icon={<Trash2 size={13} />} onClick={onDismiss}>
              {t('ntf.row.clear')}
            </Button>
            <span className={label === null ? 'as-ntf-item__topic sk-ident' : 'as-ntf-item__topic'}>
              {label ?? item.topic}
            </span>
          </div>
        )}
      </div>
    </li>
  );
}
