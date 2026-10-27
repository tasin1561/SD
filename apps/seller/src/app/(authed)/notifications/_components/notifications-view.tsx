'use client';

import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import Link from 'next/link';
import { ArrowRight, BellOff, Settings2, Trash2 } from 'lucide-react';
import { agoLabel, humaniseTopic, notificationKindStyle } from '@skydrop/ui/components';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { Button, buttonClassName } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { Tabs } from '@skydrop/ui/app/tabs';
import { TableToolbar } from '@skydrop/ui/app/data-table';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
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
import { SetFact, SetPageHeader } from '../../settings/_components/settings-parts';
import './notifications.css';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';

/** The tab id that means "every group" — a group name is never empty. */
const ALL_GROUPS = '__all';

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
  // Dismissing asks first — one message, or the whole inbox.
  const [pendingDismiss, setPendingDismiss] = useState<FeedItem | null>(null);
  const [confirmDismissAll, setConfirmDismissAll] = useState(false);

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

  function resetFilters(): void {
    setQuery('');
    setTab('');
    setUnreadOnly(false);
  }

  return (
    <div className="set-page">
      <SetPageHeader
        crumbs={[
          { label: t('notifications.clientConsole') },
          { label: t('notifications.notifications') },
        ]}
        title={t('notifications.notifications')}
        subtitle={t('notifications.everythingSentToYou')}
        meta={
          feed.data === undefined ? undefined : (
            <span className="set-meta">
              {unread > 0 ? (
                <SetFact tone="accent">{unread} unread</SetFact>
              ) : (
                <SetFact tone="good" dot>
                  {t('notifications.allRead')}
                </SetFact>
              )}
              <SetFact>{items.length} loaded</SetFact>
              {hasMore && <SetFact dot>{t('notifications.moreFurtherBack')}</SetFact>}
            </span>
          )
        }
        action={
          <div className="set-actions">
            {unread > 0 && (
              <AsyncButton
                variant="secondary"
                labels={{
                  idle: t('notifications.markAllRead'),
                  busy: t('notifications.marking'),
                  done: t('notifications.allRead'),
                }}
                onAction={() => markAll.mutateAsync()}
              />
            )}
            {items.length > 0 && (
              <Button
                variant="ghost"
                icon={<Trash2 size={14} />}
                onClick={() => setConfirmDismissAll(true)}
              >
                {t('notifications.clearAll')}
              </Button>
            )}
            <Link href="/notifications/settings" className={buttonClassName('secondary', 'md')}>
              <span className="sk-btn__fx" aria-hidden />
              <span className="sk-btn__icon" aria-hidden>
                <Settings2 size={15} />
              </span>
              <span className="sk-btn__label">{t('notifications.settings')}</span>
            </Link>
          </div>
        }
      />

      <section className="set-section">
        <SectionHeading
          title={t('notifications.inbox')}
          note={
            shown.length === items.length
              ? `${items.length} ${items.length === 1 ? 'message' : 'messages'}`
              : t('notifications.ofLoaded', { shown: shown.length, items: items.length })
          }
        />

        <TableToolbar
          search={{
            value: query,
            onChange: setQuery,
            label: t('notifications.filterNotifications'),
            placeholder: t('notifications.orderAwbOrWording'),
          }}
          action={
            filtering ? (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                {t('notifications.reset')}
              </Button>
            ) : undefined
          }
        />

        {/* Read/unread, then the kind tabs. They filter the same list;
            the kind tabs only appear when there is more than one kind. */}
        <div className="ntf-filters">
          <Tabs
            label={t('notifications.readState')}
            size="sm"
            items={[
              { id: 'all', label: t('notifications.all') },
              { id: 'unread', label: t('notifications.unread'), count: unread },
            ]}
            value={unreadOnly ? 'unread' : 'all'}
            onChange={(id) => setUnreadOnly(id === 'unread')}
          />
          {tabs.length > 1 && (
            <Tabs
              label={t('notifications.kindOfNotification')}
              size="sm"
              items={[
                { id: ALL_GROUPS, label: t('notifications.everything'), count: items.length },
                ...tabs.map(([group, count]) => ({ id: group, label: group, count })),
              ]}
              value={tab === '' ? ALL_GROUPS : tab}
              onChange={(id) => setTab(id === ALL_GROUPS ? '' : id)}
            />
          )}
        </div>

        {feed.isLoading && items.length === 0 ? (
          <div className="set-card" data-flush>
            <SkeletonRows rows={4} cols={2} label={t('notifications.loadingNotifications')} />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            {...(filtering ? {} : { icon: <BellOff size={22} /> })}
            title={filtering ? t('notifications.nothingMatches') : t('notifications.nothingYet')}
            description={
              filtering
                ? hasMore
                  ? t('notifications.nothingInWhatIs')
                  : t('notifications.nothingHereMatchesClear')
                : t('notifications.anythingNeedingYouWill')
            }
            {...(filtering
              ? {
                  action: (
                    <Button variant="secondary" onClick={resetFilters}>
                      {t('notifications.clearFilter')}
                    </Button>
                  ),
                }
              : {})}
          />
        ) : (
          <ul className="ntf-list">
            {shown.map((n) => {
              const meta = byTopic.get(n.topic);
              const { Icon, tone } = notificationKindStyle(meta?.group ?? null);
              const open = expanded === n.id;
              const isUnread = n.readAt === null;
              // The kind's colours, read from the status tokens by name —
              // never a hex (FE-6).
              const toneVars = {
                '--ntf-fg': `var(--st-${tone}-fg)`,
                '--ntf-bg': `var(--st-${tone}-bg)`,
                '--ntf-line': `var(--st-${tone}-line)`,
              } as CSSProperties;
              return (
                <li
                  key={n.id}
                  id={n.id}
                  className="ntf-item"
                  data-unread={isUnread ? '1' : undefined}
                  style={toneVars}
                >
                  {/*
                    A coloured edge, keyed on the KIND rather than on
                    unread. It is what lets somebody find the returns in
                    a list of thirty without reading a word.
                  */}
                  <span className="ntf-item__edge" aria-hidden />
                  <span className="ntf-item__icon" aria-hidden>
                    <Icon size={16} />
                  </span>

                  <div className="ntf-item__body">
                    <div className="ntf-item__top">
                      <span className="ntf-item__tags">
                        <span className="ntf-item__kind">
                          {meta?.label ?? humaniseTopic(n.topic)}
                        </span>
                        {isUnread && (
                          <span className="ntf-item__new">{t('notifications.new')}</span>
                        )}
                      </span>
                      <span className="ntf-item__when sk-figure">
                        {agoLabel(n.createdAt, now)}
                        <span className="ntf-item__abs">
                          {' · '}
                          {new Date(n.createdAt).toLocaleString('en-IN')}
                        </span>
                      </span>
                    </div>

                    {/*
                      The whole block opens it. A notification is a
                      paragraph, not a document — it does not earn a
                      page of its own, and truncating it with no way to
                      read the rest is the thing this fixes. Opening
                      also marks it read, which is what reading
                      something means.
                    */}
                    <button
                      type="button"
                      className="ntf-item__open"
                      aria-expanded={open}
                      onClick={() => {
                        setExpanded(open ? null : n.id);
                        if (!open && isUnread) markRead.mutate(n.id);
                      }}
                    >
                      {n.title !== null && (
                        <span className="ntf-item__title" data-unread={isUnread ? '1' : undefined}>
                          {n.title}
                        </span>
                      )}
                      <span className="ntf-item__text" data-open={open ? '1' : undefined}>
                        {n.body}
                      </span>
                      {!open && (
                        <span className="ntf-item__more">{t('notifications.clickToReadIt')}</span>
                      )}
                    </button>

                    <div className="ntf-item__actions">
                      {/* The one action a person actually wants next,
                          and the only one we can honour from here: the
                          order it is about. */}
                      {n.orderId !== null && (
                        <Link href={`/orders/${n.orderId}`} className="ntf-item__order">
                          {t('notifications.viewOrder')} <ArrowRight size={12} aria-hidden />
                        </Link>
                      )}
                      <AsyncButton
                        variant="ghost"
                        size="sm"
                        labels={
                          isUnread
                            ? {
                                idle: t('notifications.markRead'),
                                busy: t('notifications.marking'),
                                done: t('notifications.read'),
                              }
                            : {
                                idle: t('notifications.markUnread'),
                                busy: t('notifications.marking'),
                                done: t('notifications.unread'),
                              }
                        }
                        onAction={() =>
                          isUnread ? markRead.mutateAsync(n.id) : markUnread.mutateAsync(n.id)
                        }
                      />
                      <Button variant="ghost" size="sm" onClick={() => setPendingDismiss(n)}>
                        {t('notifications.dismiss')}
                      </Button>
                      <span className="ntf-item__topic sk-ident">{n.topic}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {hasMore && (
          <div className="ntf-more">
            <span className="set-faint sk-figure">
              {richMessage(t('notifications.showingOfLoaded'), {
                shown: shown.length,
                items: items.length,
              })}
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
              {t('notifications.loadEarlierNotifications')}
            </Button>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={pendingDismiss !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDismiss(null);
        }}
        title={t('notifications.dismissThisNotification')}
        entity={
          pendingDismiss === null
            ? ''
            : (pendingDismiss.title ??
              byTopic.get(pendingDismiss.topic)?.label ??
              humaniseTopic(pendingDismiss.topic))
        }
        consequence={t('notifications.itLeavesYourInbox')}
        confirmLabel={t('notifications.dismiss')}
        onConfirm={() =>
          pendingDismiss === null
            ? undefined
            : // A failure is not reported here, exactly as before: the row
              // simply stays in the inbox.
              dismiss.mutateAsync(pendingDismiss.id).then(
                () => undefined,
                () => undefined,
              )
        }
      />

      <ConfirmDialog
        open={confirmDismissAll}
        onOpenChange={setConfirmDismissAll}
        title={t('notifications.clearYourWholeInbox')}
        entity={t(hasMore ? 'notifications.inboxLoadedMore' : 'notifications.inboxLoaded', {
          count: items.length,
        })}
        consequence={t('notifications.everyNotificationInYour')}
        confirmLabel={t('notifications.clearAll')}
        destructive
        onConfirm={() =>
          dismissAll.mutateAsync().then(
            () => undefined,
            () => undefined,
          )
        }
      />
    </div>
  );
}
