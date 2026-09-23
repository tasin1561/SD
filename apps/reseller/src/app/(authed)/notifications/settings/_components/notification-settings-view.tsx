'use client';

import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import Link from 'next/link';
import { BellOff, BellRing, Lock, ShieldCheck, Store, UserRound } from 'lucide-react';
import { notificationKindStyle } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Switch } from '@skydrop/ui/app/switch';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useStoreIdentity } from '@skydrop/auth/client';
import { can } from '@/lib/page-access';
import {
  useClearNotificationSubscription,
  useNotificationSubscriptions,
  useNotificationTopics,
  useSetNotificationSubscription,
  useSetStoreNotificationCategory,
  useStoreNotificationCategories,
  type StoreCategoryView,
  type TopicDef,
} from '@/lib/notification-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import '../../_components/notifications.css';

/** What each category means, in words a person reads. */
const CATEGORY_LABEL: Record<string, { title: string; description: string }> = {
  ORDER_UPDATES: {
    title: 'Your orders and your requests',
    description:
      'Answers to what you asked the seller, and changes somebody else made to one of your orders.',
  },
  MONEY: {
    title: 'Money',
    description: 'Credits, fee shares, what you prepaid, and decisions about your wallet.',
  },
  SUPPORT: {
    title: 'Disputes and issues',
    description: 'Replies and outcomes on the tickets you raise with the seller or with Skydrop.',
  },
  TERMS: {
    title: 'The seller’s terms',
    description: 'A new version to accept — who pays which fee, and when each side is credited.',
  },
  ANNOUNCEMENTS: {
    title: 'Announcements',
    description: 'Skydrop speaking to everybody, not only to this store.',
  },
};

/**
 * Everything about what reaches this store, on one page.
 *
 * ── TWO LAYERS, AND THE PAGE SAYS WHOSE EACH ONE IS ──────────────────
 * The seller's merged `/notifications/settings` is the worked example,
 * and the argument is the same. The STORE decides whether a category
 * leaves the building at all; a PERSON decides what reaches their own
 * bell. Both can only ever REMOVE a delivery — neither can switch on
 * something the other switched off — so they compose by intersection,
 * and the order between them cannot surprise anybody. Two data models,
 * one screen, each section stating whose decision it is: one table
 * holding both would have to answer "whose choice was this?" per row,
 * and cannot.
 *
 * ── THE URL IS THE UNGATED ONE, AND THAT IS LOAD-BEARING ─────────────
 * A person's own inbox settings must never sit behind a grantable
 * permission (NOTIF-11) — no store role would have held a new key, so
 * most of the estate would have been bounced off their own settings the
 * day this shipped. The page is open to everybody at the store and the
 * STORE-WIDE half is gated cosmetically inside it (FE-2 — the API
 * refuses the PUT regardless of what rendered).
 *
 * ── LOCKED SWITCHES, WITH THE SERVER'S OWN REASON ────────────────────
 * The owner named three kinds that can never be silenced. They render
 * LOCKED, carrying the reason the API would give — a switch that always
 * refuses teaches people to ignore refusals, while a visibly locked one
 * with an explanation does not.
 */
export function NotificationSettingsView(): ReactElement {
  const identity = useStoreIdentity();
  // Cosmetic only (FE-2). This decides whether we render a section they
  // could not use, not whether they may use it.
  const mayReadStoreHalf = can(identity, 'store.profile.view');
  const mayManageStoreHalf = can(identity, 'store.profile.manage');

  const topics = useNotificationTopics();
  const subs = useNotificationSubscriptions();
  const categories = useStoreNotificationCategories(mayReadStoreHalf);

  // A topic with no row follows its default, which is ON. Only an
  // explicit MUTED row switches something off.
  const muted = useMemo(
    () => new Set((subs.data ?? []).filter((s) => s.mode === 'MUTED').map((s) => s.topic)),
    [subs.data],
  );
  const allTopics = topics.data ?? [];
  const onCount = allTopics.filter((t) => !muted.has(t.topic)).length;
  const lockedCount = allTopics.filter((t) => t.mutable === false).length;

  return (
    <div className="rc-ntf-page">
      <PageHeader
        breadcrumbs={[{ label: 'Notifications', href: '/notifications' }, { label: 'Settings' }]}
        Link={Link}
        title="Notification settings"
        subtitle={
          mayReadStoreHalf
            ? 'Two separate choices: what reaches YOU, and what this STORE is told at all. Both only ever remove a message — neither can turn one on that the other switched off. Some messages cannot be switched off by either; they are marked.'
            : 'What reaches YOUR inbox and your email. Some messages cannot be switched off; they are marked.'
        }
      />

      <div className="rc-ntf-kpis">
        <KpiCard
          label="Reaching you"
          icon={<BellRing size={14} />}
          figure={topics.isLoading ? '—' : `${onCount} of ${allTopics.length}`}
          hint="topics you have not silenced"
          tone="credit"
        />
        {mayReadStoreHalf && (
          <KpiCard
            label="Store-wide"
            icon={<Store size={14} />}
            figure={categories.isLoading ? '—' : String(categories.data?.length ?? 0)}
            hint="categories, set for everybody here"
            tone="info"
          />
        )}
        <KpiCard
          label="Always sent"
          icon={<Lock size={14} />}
          figure={topics.isLoading ? '—' : String(lockedCount)}
          hint="answers, money and order changes"
          tone="pending"
        />
      </div>

      <div className="rc-ntf-layout">
        <div className="rc-ntf-stack">
          <YourTopics topics={allTopics} loading={topics.isLoading} muted={muted} />
          {mayReadStoreHalf && (
            <StoreCategories
              rows={categories.data ?? []}
              loading={categories.isLoading}
              mayManage={mayManageStoreHalf}
            />
          )}
        </div>
        <AlwaysOn />
      </div>
    </div>
  );
}

/** A settings card: an icon chip, a title, whose decision it is. */
function SettingsCard({
  icon,
  title,
  subtitle,
  children,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly subtitle: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section className="rc-ntf-card">
      <div className="rc-ntf-card__head">
        <h2 className="rc-ntf-card__title">
          <span className="rc-ntf-card__chip" aria-hidden>
            {icon}
          </span>
          {title}
        </h2>
        <p className="rc-ntf-card__sub">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

/* ── Layer two: the PERSON ───────────────────────────────────────── */

function YourTopics({
  topics,
  loading,
  muted,
}: {
  readonly topics: readonly TopicDef[];
  readonly loading: boolean;
  readonly muted: ReadonlySet<string>;
}): ReactElement {
  const setSub = useSetNotificationSubscription();
  const clearSub = useClearNotificationSubscription();
  const [error, setError] = useState<string | null>(null);

  const grouped = topics.reduce<Record<string, TopicDef[]>>((acc, t) => {
    (acc[t.group] ??= []).push(t);
    return acc;
  }, {});

  return (
    <SettingsCard
      icon={<UserRound size={14} />}
      title="What reaches you"
      subtitle="Your own choices, for your own inbox and email. Nobody else at this store sees them, and changing one here does not change what your colleagues receive."
    >
      {error !== null && <p className="rc-ntf-error">{error}</p>}
      {loading ? (
        <SkeletonRows rows={3} cols={2} label="Loading topics…" />
      ) : (
        Object.entries(grouped).map(([group, defs]) => {
          const { Icon } = notificationKindStyle(group);
          const on = defs.filter((d) => !muted.has(d.topic)).length;
          return (
            <div key={group} className="rc-ntf-group">
              <div className="rc-ntf-group__head">
                <span className="rc-ntf-group__name">
                  <Icon size={14} aria-hidden />
                  {group}
                </span>
                <span className="rc-ntf-group__count sk-figure">
                  {on} of {defs.length} on
                </span>
              </div>
              <ul className="rc-ntf-rows">
                {defs.map((d) => {
                  const isOn = !muted.has(d.topic);
                  const locked = d.mutable === false;
                  return (
                    <li key={d.topic} className="rc-ntf-row">
                      <div className="rc-ntf-row__text">
                        <div className="rc-ntf-row__name">
                          <span className="rc-ntf-row__label">{d.label}</span>
                          {/* The REAL topic key — what a support
                              conversation needs to name, and what the
                              mute is actually stored against. */}
                          <span className="rc-ntf-row__key sk-ident">{d.topic}</span>
                        </div>
                        <div className="rc-ntf-row__desc">{d.description}</div>
                        {locked ? (
                          /* Locked ON with the SERVER's own reason
                             beside it. Cosmetic — the API refuses the
                             mute either way (FE-2). */
                          <div className="rc-ntf-row__lock">
                            <Lock size={12} aria-hidden />
                            <span>Always sent. {d.immutableReason ?? ''}</span>
                          </div>
                        ) : null}
                      </div>
                      <Switch
                        checked={isOn}
                        disabled={locked}
                        aria-label={`Notify me about: ${d.label}`}
                        onCheckedChange={() => {
                          setError(null);
                          if (isOn) {
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
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })
      )}
    </SettingsCard>
  );
}

/* ── Layer one: the STORE ────────────────────────────────────────── */

function StoreCategories({
  rows,
  loading,
  mayManage,
}: {
  readonly rows: readonly StoreCategoryView[];
  readonly loading: boolean;
  readonly mayManage: boolean;
}): ReactElement {
  const set = useSetStoreNotificationCategory();
  const [error, setError] = useState<string | null>(null);

  return (
    <SettingsCard
      icon={<Store size={14} />}
      title="What this store is told"
      subtitle={
        mayManage
          ? 'Applies to EVERYBODY here, not only you — switching a category off stops it reaching your colleagues too. Changes save instantly.'
          : 'Set for the whole store. Somebody who can edit the store profile can change these.'
      }
    >
      {error !== null && <p className="rc-ntf-error">{error}</p>}
      {loading ? (
        <SkeletonRows rows={3} cols={2} label="Loading categories…" />
      ) : (
        <ul className="rc-ntf-rows">
          {rows.map((row) => {
            const label = CATEGORY_LABEL[row.category] ?? {
              title: row.category,
              description: '',
            };
            return (
              <li key={row.category} className="rc-ntf-row">
                <div className="rc-ntf-row__text">
                  <div className="rc-ntf-row__label">{label.title}</div>
                  <div className="rc-ntf-row__desc">{label.description}</div>
                  {!row.mutable && (
                    <div className="rc-ntf-row__lock">
                      <Lock size={12} aria-hidden />
                      <span>
                        {row.lockedTopics.length === 0
                          ? 'Nothing is sent under this yet, so there is nothing to switch off.'
                          : 'Everything here is something Skydrop never silences, so there is nothing to switch off.'}
                      </span>
                    </div>
                  )}
                </div>
                <div className="rc-ntf-row__switches">
                  <Switch
                    checked={row.emailEnabled}
                    disabled={!mayManage || !row.mutable}
                    aria-label={`Email the store about ${label.title}`}
                    onCheckedChange={(v) => {
                      setError(null);
                      set.mutate(
                        {
                          category: row.category,
                          emailEnabled: v,
                          inAppEnabled: row.inAppEnabled,
                        },
                        { onError: (e) => setError(serverVerdict(e)) },
                      );
                    }}
                  />
                  <Switch
                    checked={row.inAppEnabled}
                    disabled={!mayManage || !row.mutable}
                    aria-label={`Show ${label.title} in the store's inboxes`}
                    onCheckedChange={(v) => {
                      setError(null);
                      set.mutate(
                        {
                          category: row.category,
                          emailEnabled: row.emailEnabled,
                          inAppEnabled: v,
                        },
                        { onError: (e) => setError(serverVerdict(e)) },
                      );
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="rc-ntf-foot">
        Left switch: email. Right switch: the bell. A message has to pass BOTH this and your own
        choice above to reach you.
      </p>
    </SettingsCard>
  );
}

/* ── The rail ────────────────────────────────────────────────────── */

function AlwaysOn(): ReactElement {
  /**
   * The owner's three kinds (2026-09-19) plus NOTIF-9's credential rule.
   * Saying so is what stops somebody hunting for the switch.
   */
  const items: ReadonlyArray<{ Icon: typeof ShieldCheck; title: string; body: string }> = [
    {
      Icon: BellOff,
      title: 'Answers to what you asked',
      body: 'Approved, rejected, or nobody answered in time. Your customer is waiting on that answer.',
    },
    {
      Icon: BellOff,
      title: 'Anything about your money',
      body: 'Credits, fee shares, what you prepaid, and a settled dispute that moves money between your wallet and the seller’s.',
    },
    {
      Icon: BellOff,
      title: 'Changes to your orders',
      body: 'Including a courier refusing an address change the seller had already agreed to.',
    },
    {
      Icon: ShieldCheck,
      title: 'Account and sign-in',
      body: 'Password resets, email verification and team invitations only ever go to your email — an in-app one is unreadable when you are locked out.',
    },
  ];
  return (
    <SettingsCard
      icon={<Lock size={14} />}
      title="Cannot be switched off"
      subtitle="Neither by you nor store-wide. A warning you can silence is one you find out about too late."
    >
      <ul className="rc-ntf-always">
        {items.map(({ Icon, title, body }) => (
          <li key={title} className="rc-ntf-always__item">
            <span className="rc-ntf-always__icon" aria-hidden>
              <Icon size={15} />
            </span>
            <div>
              <div className="rc-ntf-always__title">{title}</div>
              <div className="rc-ntf-always__body">{body}</div>
            </div>
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}
