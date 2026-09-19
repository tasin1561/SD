'use client';

import { useMemo, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { ArrowLeft, BellOff, Lock, ShieldCheck, Store, UserRound } from 'lucide-react';
import {
  Card,
  CardBody,
  CardHeader,
  LoadingState,
  PageHeader,
  Section,
  Switch,
  notificationKindStyle,
} from '@skydrop/ui/components';
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
    <Section>
      <Link
        href="/notifications"
        className="text-text-muted hover:text-text-body mb-4 inline-flex items-center gap-1.5 text-xs transition-colors"
      >
        <ArrowLeft size={12} /> Back to notifications
      </Link>

      <PageHeader
        title="Notification settings"
        subtitle={
          mayReadStoreHalf
            ? 'Two separate choices: what reaches YOU, and what this STORE is told at all. Both only ever remove a message — neither can turn one on that the other switched off. Some messages cannot be switched off by either; they are marked.'
            : 'What reaches YOUR inbox and your email. Some messages cannot be switched off; they are marked.'
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label="Reaching you"
          value={topics.isLoading ? '—' : `${onCount} of ${allTopics.length}`}
          note="topics you have not silenced"
          tone="confirmed"
        />
        {mayReadStoreHalf && (
          <Stat
            label="Store-wide"
            value={categories.isLoading ? '—' : String(categories.data?.length ?? 0)}
            note="categories, set for everybody here"
            tone="in-transit"
          />
        )}
        <Stat
          label="Always sent"
          value={topics.isLoading ? '—' : String(lockedCount)}
          note="answers, money and order changes"
          tone="failed"
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
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
    </Section>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly note: string;
  readonly tone: string;
}): ReactElement {
  return (
    <div
      className="rounded-[8px] border px-3 py-2.5"
      style={{
        borderColor: `var(--status-${tone}-bg)`,
        background: `color-mix(in srgb, var(--status-${tone}-bg), transparent 55%)`,
      }}
    >
      <div className="text-text-muted text-[11px] font-semibold tracking-wide uppercase">
        {label}
      </div>
      <div
        className="mt-1 truncate text-lg font-semibold"
        style={{ color: `var(--status-${tone}-fg)` }}
      >
        {value}
      </div>
      <div className="text-text-faint mt-0.5 text-xs">{note}</div>
    </div>
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
    <Card>
      <CardHeader
        tone="accent"
        title={
          <span className="inline-flex items-center gap-2">
            <UserRound size={14} aria-hidden />
            What reaches you
          </span>
        }
        subtitle="Your own choices, for your own inbox and email. Nobody else at this store sees them, and changing one here does not change what your colleagues receive."
      />
      <CardBody>
        {error !== null && <p className="text-critical mb-3 text-sm">{error}</p>}
        {loading ? (
          <LoadingState label="Loading topics…" rows={3} />
        ) : (
          Object.entries(grouped).map(([group, defs]) => {
            const { Icon } = notificationKindStyle(group);
            const on = defs.filter((d) => !muted.has(d.topic)).length;
            return (
              <div key={group} className="mt-5 first:mt-0">
                <div className="border-border-subtle mb-1 flex items-center justify-between gap-3 border-b pb-1.5">
                  <span className="text-accent inline-flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
                    <Icon size={14} />
                    {group}
                  </span>
                  <span className="text-text-faint text-xs tabular-nums">
                    {on} of {defs.length} on
                  </span>
                </div>
                <ul className="divide-border-subtle divide-y">
                  {defs.map((d) => {
                    const isOn = !muted.has(d.topic);
                    const locked = d.mutable === false;
                    return (
                      <li key={d.topic} className="flex items-start justify-between gap-4 py-2.5">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-text-bright text-sm font-medium">{d.label}</span>
                            {/* The REAL topic key — what a support
                                conversation needs to name, and what the
                                mute is actually stored against. */}
                            <span className="text-text-faint font-mono text-[11px]">{d.topic}</span>
                          </div>
                          <div className="text-text-muted mt-0.5 text-xs">{d.description}</div>
                          {locked ? (
                            /* Locked ON with the SERVER's own reason
                               beside it. Cosmetic — the API refuses the
                               mute either way (FE-2). */
                            <div className="text-warning mt-1 inline-flex items-start gap-1.5 text-xs">
                              <Lock size={12} className="mt-0.5 shrink-0" aria-hidden />
                              <span>Always sent. {d.immutableReason ?? ''}</span>
                            </div>
                          ) : null}
                        </div>
                        <Switch
                          checked={isOn}
                          disabled={locked}
                          label={`Notify me about: ${d.label}`}
                          onChange={() => {
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
      </CardBody>
    </Card>
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
    <Card>
      <CardHeader
        tone="accent"
        title={
          <span className="inline-flex items-center gap-2">
            <Store size={14} aria-hidden />
            What this store is told
          </span>
        }
        subtitle={
          mayManage
            ? 'Applies to EVERYBODY here, not only you — switching a category off stops it reaching your colleagues too. Changes save instantly.'
            : 'Set for the whole store. Somebody who can edit the store profile can change these.'
        }
      />
      <CardBody>
        {error !== null && <p className="text-critical mb-3 text-sm">{error}</p>}
        {loading ? (
          <LoadingState label="Loading categories…" rows={3} />
        ) : (
          <ul className="divide-border-subtle divide-y">
            {rows.map((row) => {
              const label = CATEGORY_LABEL[row.category] ?? {
                title: row.category,
                description: '',
              };
              return (
                <li key={row.category} className="py-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-text-bright text-sm font-medium">{label.title}</div>
                      <div className="text-text-muted mt-0.5 text-xs">{label.description}</div>
                      {!row.mutable && (
                        <div className="text-warning mt-1 inline-flex items-start gap-1.5 text-xs">
                          <Lock size={12} className="mt-0.5 shrink-0" aria-hidden />
                          <span>
                            {row.lockedTopics.length === 0
                              ? 'Nothing is sent under this yet, so there is nothing to switch off.'
                              : 'Everything here is something Skydrop never silences, so there is nothing to switch off.'}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-4">
                      <Switch
                        checked={row.emailEnabled}
                        disabled={!mayManage || !row.mutable}
                        label={`Email the store about ${label.title}`}
                        onChange={(v) => {
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
                        label={`Show ${label.title} in the store's inboxes`}
                        onChange={(v) => {
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
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-text-faint mt-4 text-xs">
          Left switch: email. Right switch: the bell. A message has to pass BOTH this and your own
          choice above to reach you.
        </p>
      </CardBody>
    </Card>
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
    <Card>
      <CardHeader
        tone="accent"
        title={
          <span className="inline-flex items-center gap-2">
            <Lock size={14} aria-hidden />
            Cannot be switched off
          </span>
        }
        subtitle="Neither by you nor store-wide. A warning you can silence is one you find out about too late."
      />
      <CardBody className="flex flex-col gap-3">
        {items.map(({ Icon, title, body }) => (
          <div key={title} className="flex items-start gap-2.5">
            <span className="text-text-muted mt-0.5 shrink-0">
              <Icon size={15} aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="text-text-body text-sm font-medium">{title}</div>
              <div className="text-text-muted text-xs leading-relaxed">{body}</div>
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
