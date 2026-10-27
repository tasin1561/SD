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
import type { MessageKey } from '@/i18n/catalog';
import { useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
import '../../_components/notifications.css';

/** What each category means, in words a person reads. */
const CATEGORY_LABEL: Record<string, { title: MessageKey; description: MessageKey }> = {
  ORDER_UPDATES: {
    title: 'rnts.cat.ORDER_UPDATES.title',
    description: 'rnts.cat.ORDER_UPDATES.desc',
  },
  MONEY: {
    title: 'rnts.cat.MONEY.title',
    description: 'rnts.cat.MONEY.desc',
  },
  SUPPORT: {
    title: 'rnts.cat.SUPPORT.title',
    description: 'rnts.cat.SUPPORT.desc',
  },
  TERMS: {
    title: 'rnts.cat.TERMS.title',
    description: 'rnts.cat.TERMS.desc',
  },
  ANNOUNCEMENTS: {
    title: 'rnts.cat.ANNOUNCEMENTS.title',
    description: 'rnts.cat.ANNOUNCEMENTS.desc',
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
  const t = useT();
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
  const onCount = allTopics.filter((tp) => !muted.has(tp.topic)).length;
  const lockedCount = allTopics.filter((tp) => tp.mutable === false).length;

  return (
    <div className="rc-ntf-page">
      <PageHeader
        breadcrumbs={[
          { label: t('rntf.title'), href: '/notifications' },
          { label: t('rnts.crumb.settings') },
        ]}
        Link={Link}
        title={t('rnts.title')}
        subtitle={mayReadStoreHalf ? t('rnts.subtitle.store') : t('rnts.subtitle.own')}
      />

      <div className="rc-ntf-kpis">
        <KpiCard
          label={t('rnts.kpi.reaching')}
          icon={<BellRing size={14} />}
          figure={
            topics.isLoading
              ? '—'
              : t('rnts.kpi.reachingFigure', { on: onCount, total: allTopics.length })
          }
          hint={t('rnts.kpi.reachingHint')}
          tone="credit"
        />
        {mayReadStoreHalf && (
          <KpiCard
            label={t('rnts.kpi.storeWide')}
            icon={<Store size={14} />}
            figure={categories.isLoading ? '—' : String(categories.data?.length ?? 0)}
            hint={t('rnts.kpi.storeWideHint')}
            tone="info"
          />
        )}
        <KpiCard
          label={t('rnts.kpi.always')}
          icon={<Lock size={14} />}
          figure={topics.isLoading ? '—' : String(lockedCount)}
          hint={t('rnts.kpi.alwaysHint')}
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
  const t = useT();
  const setSub = useSetNotificationSubscription();
  const clearSub = useClearNotificationSubscription();
  const [error, setError] = useState<string | null>(null);

  const grouped = topics.reduce<Record<string, TopicDef[]>>((acc, tp) => {
    (acc[tp.group] ??= []).push(tp);
    return acc;
  }, {});

  return (
    <SettingsCard
      icon={<UserRound size={14} />}
      title={t('rnts.yours.title')}
      subtitle={t('rnts.yours.sub')}
    >
      {error !== null && <p className="rc-ntf-error">{error}</p>}
      {loading ? (
        <SkeletonRows rows={3} cols={2} label={t('rnts.yours.loading')} />
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
                  {t('rnts.yours.count', { on, total: defs.length })}
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
                            <span>
                              {t('rnts.yours.locked', { reason: d.immutableReason ?? '' })}
                            </span>
                          </div>
                        ) : null}
                      </div>
                      <Switch
                        checked={isOn}
                        disabled={locked}
                        aria-label={t('rnts.yours.aria', { label: d.label })}
                        onCheckedChange={() => {
                          setError(null);
                          if (isOn) {
                            setSub.mutate(
                              { topic: d.topic, mode: 'MUTED' },
                              { onError: (e) => setError(verdict(e, t)) },
                            );
                          } else {
                            clearSub.mutate(d.topic, {
                              onError: (e) => setError(verdict(e, t)),
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
  const t = useT();
  const set = useSetStoreNotificationCategory();
  const [error, setError] = useState<string | null>(null);

  return (
    <SettingsCard
      icon={<Store size={14} />}
      title={t('rnts.store.title')}
      subtitle={mayManage ? t('rnts.store.sub.manage') : t('rnts.store.sub.view')}
    >
      {error !== null && <p className="rc-ntf-error">{error}</p>}
      {loading ? (
        <SkeletonRows rows={3} cols={2} label={t('rnts.store.loading')} />
      ) : (
        <ul className="rc-ntf-rows">
          {rows.map((row) => {
            const known = CATEGORY_LABEL[row.category];
            const label = {
              title: known === undefined ? row.category : t(known.title),
              description: known === undefined ? '' : t(known.description),
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
                          ? t('rnts.store.lock.empty')
                          : t('rnts.store.lock.never')}
                      </span>
                    </div>
                  )}
                </div>
                <div className="rc-ntf-row__switches">
                  <Switch
                    checked={row.emailEnabled}
                    disabled={!mayManage || !row.mutable}
                    aria-label={t('rnts.store.emailAria', { title: label.title })}
                    onCheckedChange={(v) => {
                      setError(null);
                      set.mutate(
                        {
                          category: row.category,
                          emailEnabled: v,
                          inAppEnabled: row.inAppEnabled,
                        },
                        { onError: (e) => setError(verdict(e, t)) },
                      );
                    }}
                  />
                  <Switch
                    checked={row.inAppEnabled}
                    disabled={!mayManage || !row.mutable}
                    aria-label={t('rnts.store.inAppAria', { title: label.title })}
                    onCheckedChange={(v) => {
                      setError(null);
                      set.mutate(
                        {
                          category: row.category,
                          emailEnabled: row.emailEnabled,
                          inAppEnabled: v,
                        },
                        { onError: (e) => setError(verdict(e, t)) },
                      );
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="rc-ntf-foot">{t('rnts.store.foot')}</p>
    </SettingsCard>
  );
}

/* ── The rail ────────────────────────────────────────────────────── */

function AlwaysOn(): ReactElement {
  /**
   * The owner's three kinds (2026-09-19) plus NOTIF-9's credential rule.
   * Saying so is what stops somebody hunting for the switch.
   */
  const t = useT();
  const items: ReadonlyArray<{ Icon: typeof ShieldCheck; title: string; body: string }> = [
    {
      Icon: BellOff,
      title: t('rnts.always.answers.title'),
      body: t('rnts.always.answers.body'),
    },
    {
      Icon: BellOff,
      title: t('rnts.always.money.title'),
      body: t('rnts.always.money.body'),
    },
    {
      Icon: BellOff,
      title: t('rnts.always.orders.title'),
      body: t('rnts.always.orders.body'),
    },
    {
      Icon: ShieldCheck,
      title: t('rnts.always.account.title'),
      body: t('rnts.always.account.body'),
    },
  ];
  return (
    <SettingsCard
      icon={<Lock size={14} />}
      title={t('rnts.always.title')}
      subtitle={t('rnts.always.sub')}
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
