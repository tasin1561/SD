'use client';

import { clsx } from 'clsx';
import { Bell, CheckCheck, X } from 'lucide-react';
// SHARED with the full inbox page. A group that is a red triangle in
// one surface and a blue lorry in the other teaches the reader that the
// icon means nothing.
import { agoLabel, humaniseTopic, notificationKindStyle } from './notification-kind';
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';

export interface BellItem {
  readonly id: string;
  readonly title: string | null;
  readonly body: string;
  /** The template code without its `.email` suffix (NOTIF-14/17). */
  readonly topic: string;
  readonly createdAt: string;
  readonly readAt: string | null;
}

/**
 * The bell, and the panel behind it.
 *
 * PRESENTATIONAL ONLY — it fetches nothing and knows no routes. Both
 * apps pass their own data and callbacks, which is what lets one
 * component serve a seller's inbox and a staff member's without either
 * app's data layer leaking into `@skydrop/ui` (FE-6).
 *
 * ── THE 2026-09-07 REDESIGN ──────────────────────────────────────────
 * Built from two reference comps, one light and one dark. What was
 * taken from them: a header that states the unread count as a figure
 * rather than only as a dot, category TABS so "what needs me" can be
 * reached without reading past six delivery updates, a tinted icon tile
 * per row so a kind is recognised before it is read, relative times,
 * and a per-row dismiss.
 *
 * What was deliberately NOT taken, because a comp is a drawing and a
 * drawing can show a control with nothing behind it — the same
 * discipline the seller order list already documents:
 *
 *   - "Trigger IVR Call" / "Dispatch IVR Ping" / "WhatsApp Buyer".
 *     There is no telephony and no WhatsApp integration; CUR-10 also
 *     keeps a courier write behind an operator on a gated screen, not
 *     behind a button in a dropdown.
 *   - "Update Landmark" / "Edit Address & Transmit". Editing a
 *     recipient mid-flight is a courier ops action with its own guards
 *     (CUR-11); a two-word button in a panel cannot carry them.
 *   - "SLA: 3h 40m left" countdowns. We do not store a per-parcel SLA,
 *     so the number would be decoration that looks like a commitment.
 *   - "Live WebSocket · AP-SOUTH-1". The count is POLLED (see the
 *     container). A status line claiming a live socket would be a lie
 *     about how fresh the panel is.
 *
 * The TABS are the topic catalogue's own groups (NOTIF-17), resolved by
 * the container, and only the groups actually present in the feed get a
 * tab — so a tab can never be empty and the strip stays short without
 * anybody maintaining a second list of what to show.
 */

export function NotificationBell({
  unread,
  items,
  loading = false,
  onOpen,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  groupOf,
  labelOf,
  viewAllHref,
  preferencesHref,
  Link,
}: {
  readonly unread: number;
  readonly items: readonly BellItem[];
  readonly loading?: boolean;
  /** Called when the panel opens — the moment to fetch. */
  readonly onOpen?: () => void;
  readonly onMarkRead?: (id: string) => void;
  readonly onMarkAllRead?: () => void;
  /** NOTIF-21: hides this row from THIS person's feed. Never a delete. */
  readonly onDismiss?: (id: string) => void;
  /** Topic → catalogue group. Absent means no tabs. */
  readonly groupOf?: (topic: string) => string | null;
  /** Topic → its name for a person. Falls back to the topic, humanised. */
  readonly labelOf?: (topic: string) => string | null;
  readonly viewAllHref: string;
  readonly preferencesHref?: string;
  readonly Link: (props: {
    href: string;
    className?: string;
    children: ReactNode;
    onClick?: () => void;
  }) => ReactElement;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<string>('');
  const wrap = useRef<HTMLDivElement | null>(null);

  // Close on an outside click or Escape. Without the keyboard half this
  // is a panel a keyboard user can open and not dismiss.
  useEffect(() => {
    if (!open) return undefined;
    function onDown(e: MouseEvent): void {
      if (wrap.current !== null && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Read ONCE per opening rather than per render: `Date.now()` in the
  // body would make every row's age change on any state update, which
  // is both pointless work and a way for two rows written in the same
  // second to disagree about how old they are.
  const now = useMemo(() => Date.now(), [open, items]);

  /**
   * Only the groups actually present, in the catalogue's order.
   *
   * A tab that is always there and sometimes empty teaches people that
   * tabs mean nothing; one derived from the feed cannot be empty by
   * construction, and the strip shrinks on a quiet day rather than
   * asking for horizontal room it does not need.
   */
  const tabs = useMemo(() => {
    if (groupOf === undefined) return [];
    const counts = new Map<string, number>();
    for (const n of items) {
      const g = groupOf(n.topic);
      if (g !== null) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items, groupOf]);

  const shown = useMemo(
    () =>
      tab === '' || groupOf === undefined ? items : items.filter((n) => groupOf(n.topic) === tab),
    [items, tab, groupOf],
  );

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className="text-text-muted hover:text-text relative inline-flex h-11 w-11 items-center justify-center rounded-md"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) onOpen?.();
        }}
      >
        <Bell size={18} aria-hidden />
        {unread > 0 && (
          <span className="bg-status-failed-fg absolute top-1.5 right-1.5 min-w-[16px] rounded-full px-1 text-[10px] leading-4 font-semibold text-white">
            {/* Capped at 9+ on purpose: past a handful the exact number
                stops being information and starts being a wall. */}
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="border-border bg-surface absolute right-0 z-50 mt-1 w-[min(400px,calc(100vw-1.5rem))] overflow-hidden rounded-[10px] border shadow-xl"
        >
          {/* ── Header ─────────────────────────────────────────── */}
          <div className="border-border-subtle flex items-center justify-between gap-2 border-b px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <Bell size={15} aria-hidden className="text-text-muted shrink-0" />
              <span className="text-text-bright truncate text-sm font-semibold">Notifications</span>
              {unread > 0 && (
                <span className="bg-accent-fill text-accent-fg shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                  {unread} unread
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {unread > 0 && onMarkAllRead !== undefined && (
                <button
                  type="button"
                  aria-label="Mark all notifications read"
                  title="Mark all read"
                  className="text-text-muted hover:text-accent inline-flex items-center gap-1 rounded-[4px] px-1.5 py-1 text-xs font-medium"
                  onClick={() => onMarkAllRead()}
                >
                  <CheckCheck size={13} aria-hidden />
                  {/* The words go on a phone, where the header is a
                      title, a count pill and two buttons inside 336px
                      and they collided. The icon keeps its name for a
                      screen reader and its tooltip for a mouse. */}
                  <span className="max-sm:hidden">Mark read</span>
                </button>
              )}
              <button
                type="button"
                aria-label="Close notifications"
                onClick={() => setOpen(false)}
                // A round, bordered target rather than a bare glyph.
                // An icon on its own does not read as a control until
                // you hover it, which is exactly when you no longer
                // need telling.
                className="border-border bg-surface-raised text-text-faint hover:border-border-strong hover:text-text-body flex h-7 w-7 items-center justify-center rounded-full border transition-colors"
              >
                <X size={14} aria-hidden />
              </button>
            </div>
          </div>

          {/* ── Tabs ───────────────────────────────────────────── */}
          {tabs.length > 1 && (
            <div
              role="tablist"
              aria-label="Filter notifications"
              // Scrolls sideways rather than wrapping: a second row of
              // tabs pushes the first notification off a phone screen,
              // and this strip is short by construction anyway.
              className="border-border-subtle flex gap-1 overflow-x-auto border-b px-2 py-1.5"
            >
              <TabButton
                label="All"
                count={items.length}
                on={tab === ''}
                onClick={() => setTab('')}
              />
              {tabs.map(([group, count]) => (
                <TabButton
                  key={group}
                  label={group}
                  count={count}
                  on={tab === group}
                  onClick={() => setTab(group)}
                />
              ))}
            </div>
          )}

          {/* ── Feed ───────────────────────────────────────────── */}
          <div className="max-h-[min(60vh,26rem)] overflow-y-auto">
            {loading ? (
              <p className="text-text-muted px-3 py-8 text-center text-sm">Loading…</p>
            ) : shown.length === 0 ? (
              <p className="text-text-muted px-3 py-8 text-center text-sm">
                {items.length === 0
                  ? 'Nothing yet. This is where anything needing you will appear.'
                  : `Nothing in ${tab}.`}
              </p>
            ) : (
              <ul className="divide-border-subtle divide-y">
                {shown.map((n) => {
                  const group = groupOf?.(n.topic) ?? null;
                  const { Icon, tone } = notificationKindStyle(group);
                  const chip = labelOf?.(n.topic) ?? humaniseTopic(n.topic);
                  const isUnread = n.readAt === null;
                  return (
                    <li
                      key={n.id}
                      className={clsx('relative', isUnread && 'bg-[var(--color-accent-tint)]')}
                    >
                      {/* The unread mark is a BAR on the edge, not only a
                          dot beside the title: at a glance it is the
                          shape of the list that says how much is new. */}
                      {isUnread && (
                        <span aria-hidden className="bg-accent absolute inset-y-0 left-0 w-[3px]" />
                      )}
                      <div className="flex items-start gap-2.5 px-3 py-2.5">
                        <span
                          aria-hidden
                          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px]"
                          style={{
                            background: `var(--status-${tone}-bg)`,
                            color: `var(--status-${tone}-fg)`,
                          }}
                        >
                          <Icon size={15} />
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span
                              className="truncate rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
                              style={{
                                background: `var(--status-${tone}-bg)`,
                                color: `var(--status-${tone}-fg)`,
                              }}
                            >
                              {chip}
                            </span>
                            <span className="text-text-faint shrink-0 text-[11px] whitespace-nowrap">
                              {agoLabel(n.createdAt, now)}
                            </span>
                          </div>

                          {/*
                            A LINK, not a button. The panel truncates —
                            there is no room for a paragraph beside a
                            bell — so clicking has to take you where the
                            whole thing is readable, anchored at this
                            one. A button that only marked it read left
                            the text you were reaching for still cut off.
                          */}
                          <Link
                            href={`${viewAllHref}#${n.id}`}
                            className="mt-1 block"
                            onClick={() => {
                              if (isUnread) onMarkRead?.(n.id);
                              setOpen(false);
                            }}
                          >
                            {n.title !== null && (
                              <span className="text-text-bright block text-sm leading-snug font-medium">
                                {n.title}
                              </span>
                            )}
                            {/* NO `block` here. `line-clamp-2` works by
                                setting `display: -webkit-box`, so a
                                `block` beside it is two display
                                utilities fighting — and which wins is
                                decided by Tailwind's generated source
                                order, not by the class list. `block`
                                won, and every notification rendered its
                                full paragraph. */}
                            <span className="text-text-muted mt-0.5 line-clamp-2 text-xs leading-relaxed">
                              {n.body}
                            </span>
                          </Link>
                        </div>

                        {onDismiss !== undefined && (
                          <button
                            type="button"
                            aria-label="Dismiss this notification"
                            title="Dismiss"
                            onClick={() => onDismiss(n.id)}
                            // Same round target, and it goes CRITICAL on
                            // hover: dismissing takes the row off this
                            // person's feed for good (NOTIF-21), so the
                            // control should say so before the click
                            // rather than after it.
                            className="border-border bg-surface-raised text-text-faint hover:border-[var(--color-critical-ring)] hover:bg-[var(--color-critical-tint)] hover:text-critical flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors"
                          >
                            <X size={13} aria-hidden />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* ── Footer ─────────────────────────────────────────── */}
          <div className="border-border-subtle bg-surface-raised/50 flex items-center justify-between gap-3 border-t px-3 py-2">
            {preferencesHref === undefined ? (
              <span />
            ) : (
              <Link
                href={preferencesHref}
                className="text-text-muted hover:text-text-bright text-xs"
                onClick={() => setOpen(false)}
              >
                Preferences
              </Link>
            )}
            <Link
              href={viewAllHref}
              className="text-accent text-xs font-medium"
              onClick={() => setOpen(false)}
            >
              See everything →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  label,
  count,
  on,
  onClick,
}: {
  readonly label: string;
  readonly count: number;
  readonly on: boolean;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={clsx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors',
        on
          ? 'bg-accent-fill text-accent-fg'
          : 'text-text-muted hover:bg-surface-hover hover:text-text-bright',
      )}
    >
      {label}
      <span className={clsx('tabular-nums', on ? 'opacity-80' : 'text-text-faint')}>{count}</span>
    </button>
  );
}
