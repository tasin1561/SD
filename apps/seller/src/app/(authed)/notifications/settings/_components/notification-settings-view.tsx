'use client';

import { useMemo, useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Banknote,
  BellOff,
  Clock,
  Landmark,
  Package,
  PackageCheck,
  RotateCcw,
  ShieldCheck,
  Warehouse,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Section,
  Switch,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import type { NotificationPreferenceView } from '@skydrop/api-client';
import { useSellerIdentity } from '@skydrop/auth/client';
import { can } from '@/lib/page-access';
import { useNotificationPreferences, useUpdateNotificationPreference } from '@/lib/api-hooks';
import {
  useClearNotificationSubscription,
  useNotificationSubscriptions,
  useNotificationTopics,
  useSetNotificationSubscription,
  type TopicDef,
} from '@/lib/notification-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Everything about what Skydrop sends you, on one page.
 *
 * ── THE MERGE, AND WHAT IT DELIBERATELY DID NOT MERGE ────────────────
 * This was two screens: one for a person's own per-topic silences, one
 * for the company's per-category email preferences. Two tiles on the
 * Settings hub, both called notifications, and the only way to tell them
 * apart was to read the descriptions carefully — which is how somebody
 * changes the wrong one and believes they changed the other.
 *
 * The SCREENS are merged. The two data models are NOT, and must not be.
 * The answer is settled in `SellerNotificationPreferenceResolver`: both
 * grains can only ever REMOVE a delivery, never add one, and they
 * compose by intersection. The company decides whether a category leaves
 * the building at all; a person decides what reaches their own inbox.
 * One table holding both would have to answer "whose choice was this?"
 * for every row, and it cannot. So: one page, two sections, each
 * stating whose decision it is.
 *
 * ── WHY THIS URL AND NOT `/settings/notifications` ───────────────────
 * That one sat behind `notifications.manage`, correctly — deciding what
 * the whole company is emailed is an administrative act. But a person's
 * own inbox is SELF-SERVICE and must never be behind a grantable
 * permission (NOTIF-11): no existing role holds that key, so most of the
 * estate would have been bounced off their own settings. The merged page
 * lives at the ungated url and the company half is gated, cosmetically,
 * inside it. The old url redirects here.
 *
 * ── THE 2026-09-08 REDESIGN ──────────────────────────────────────────
 * From a reference comp. Taken: the strip of four figures at the top,
 * switches instead of checkboxes (there is no Save button — each flip is
 * a request, and a switch says "this takes effect now" where a checkbox
 * says "one of several things you are selecting"), the per-group headers
 * with a count, the real topic key beside each label, the company half
 * as a TABLE rather than seven stacked cards, and a rail saying what can
 * never be silenced.
 *
 * NOT taken, because a comp is a drawing and a drawing can show a
 * control with nothing behind it:
 *
 *   - "Save Preferences" and "Reset to Defaults". Every control here
 *     saves on change; a Save button that saves nothing is the worst
 *     kind, because somebody leaves without pressing it and loses
 *     nothing, or presses it and believes it did something. There is no
 *     reset endpoint either.
 *   - "Send Test Email" / "Test In-App Alert". No test-send exists.
 *   - "Delivery success telemetry 99.98%" and its sparkline. Not a
 *     figure we hold.
 *   - `POLICY_RULESET: 0x942B`, `IMMUTABLE_TIER: SEC_ROOT_AUTH`,
 *     `NTP SYNCED`, `AUTO-SYNC ACTIVE`, `v2.14.0`. Invented identifiers
 *     that read as system facts.
 *   - Per-row severity badges ("CRITICAL DECISION", "HIGH PRIORITY
 *     NDR"). A topic carries no severity, so the badge would be a
 *     decision nobody made.
 */
export function NotificationSettingsView(): ReactElement {
  const identity = useSellerIdentity();
  // Cosmetic only (FE-2) — the API refuses a PATCH from somebody
  // without the permission regardless. This decides whether we render a
  // section they could not use, not whether they may use it.
  const mayManageCompany = can(identity, 'notifications.manage');

  const topics = useNotificationTopics();
  const subs = useNotificationSubscriptions();
  const prefs = useNotificationPreferences();

  // A topic with no row follows its default, which is ON. Only an
  // explicit MUTED row switches something off.
  const muted = useMemo(
    () => new Set((subs.data ?? []).filter((s) => s.mode === 'MUTED').map((s) => s.topic)),
    [subs.data],
  );
  const allTopics = topics.data ?? [];
  const onCount = allTopics.filter((t) => !muted.has(t.topic)).length;

  const rows = prefs.data ?? [];
  const quiet = useMemo(() => summariseQuietHours(rows), [rows]);

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
          mayManageCompany
            ? 'Two separate choices: what reaches YOU, and what this COMPANY is emailed about. Both only ever remove a message — neither can turn one on that the other switched off. Messages about your account and credentials are in neither list: they always go to your email and cannot be silenced.'
            : 'What reaches YOUR inbox. Messages about your account and credentials are not listed — they only ever go to your email, and cannot be silenced.'
        }
      />

      {/* ── The four figures. Every one is read from real state; the
             comp's telemetry tiles are not here for that reason. ─── */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Your alerts"
          value={topics.isLoading ? '—' : `${onCount} of ${allTopics.length}`}
          note="topics reaching your inbox"
          tone="confirmed"
        />
        {mayManageCompany && (
          <Stat
            label="Company categories"
            value={prefs.isLoading ? '—' : String(rows.length)}
            note="email + in-app, set for everyone"
            tone="in-transit"
          />
        )}
        <Stat
          label="Quiet hours"
          value={quiet.label}
          note={quiet.note}
          tone={quiet.set ? 'pending' : 'draft'}
        />
        <Stat
          label="Never silenced"
          value="Account & security"
          note="sign-in, password, invites"
          tone="failed"
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          <YourTopics
            topics={topics.data ?? []}
            loading={topics.isLoading}
            muted={muted}
            onError={() => undefined}
          />
          {mayManageCompany && <CompanyCategories />}
        </div>

        <div className="flex flex-col gap-4">
          <AlwaysOn />
          {quiet.timezone !== null && <TimezoneCard timezone={quiet.timezone} quiet={quiet} />}
        </div>
      </div>
    </Section>
  );
}

/* ── The strip ──────────────────────────────────────────────────── */

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
        title={value}
      >
        {value}
      </div>
      <div className="text-text-faint mt-0.5 text-xs">{note}</div>
    </div>
  );
}

/* ── Yours ──────────────────────────────────────────────────────── */

const GROUP_ICON: Record<string, typeof Package> = {
  Orders: Package,
  Shipments: PackageCheck,
  Couriers: PackageCheck,
  Returns: RotateCcw,
  Money: Banknote,
  Warehouse: Warehouse,
  System: ShieldCheck,
};

function YourTopics({
  topics,
  loading,
  muted,
}: {
  readonly topics: readonly TopicDef[];
  readonly loading: boolean;
  readonly muted: ReadonlySet<string>;
  readonly onError: (s: string) => void;
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
        title="What reaches you"
        subtitle="Your own choices, for your own inbox. Nobody else at this company sees them, and changing one here does not change what anybody else receives."
      />
      <CardBody>
        {error !== null && <p className="text-critical mb-3 text-sm">{error}</p>}
        {loading ? (
          <LoadingState label="Loading topics…" rows={3} />
        ) : (
          Object.entries(grouped).map(([group, defs]) => {
            const Icon = GROUP_ICON[group] ?? ShieldCheck;
            const on = defs.filter((d) => !muted.has(d.topic)).length;
            return (
              <div key={group} className="mt-5 first:mt-0">
                <div className="border-border-subtle mb-1 flex items-center justify-between gap-3 border-b pb-1.5">
                  <span className="text-accent inline-flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
                    <Icon size={14} aria-hidden />
                    {group}
                  </span>
                  <span className="text-text-faint text-xs tabular-nums">
                    {on} of {defs.length} on
                  </span>
                </div>
                <ul className="divide-border-subtle divide-y">
                  {defs.map((d) => {
                    const isOn = !muted.has(d.topic);
                    return (
                      <li key={d.topic} className="flex items-start justify-between gap-4 py-2.5">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-text-bright text-sm font-medium">{d.label}</span>
                            {/* The REAL topic key, not an invented event
                                code. It is what a support conversation
                                needs to name, and what the mute is
                                actually stored against. */}
                            <span className="text-text-faint font-mono text-[11px]">{d.topic}</span>
                          </div>
                          <div className="text-text-muted mt-0.5 text-xs">{d.description}</div>
                        </div>
                        <Switch
                          checked={isOn}
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

/* ── The company's ──────────────────────────────────────────────── */

const CATEGORY_LABEL: Record<string, { title: string; description: string }> = {
  ORDER_UPDATES: {
    title: 'Order updates',
    description: 'New orders, confirmations, cancellations, rejections.',
  },
  SHIPMENT_UPDATES: {
    title: 'Shipment updates',
    description: 'Dispatch, in-transit, delivery, NDR, RTO.',
  },
  STOCK_ALERTS: {
    title: 'Stock alerts',
    description: 'Low-stock thresholds + receiving completed.',
  },
  CALL_CENTER_OUTCOMES: {
    title: 'Call centre outcomes',
    description: 'NDR cap reached, customer declined, etc.',
  },
  BILLING: { title: 'Billing', description: 'Remittance summaries + invoices.' },
  SYSTEM_ANNOUNCEMENTS: {
    title: 'System announcements',
    description: 'Maintenance windows, policy updates.',
  },
  MARKETING: { title: 'Marketing', description: 'Skydrop product updates + tips.' },
};

function CompanyCategories(): ReactElement {
  const list = useNotificationPreferences();
  const toast = useToast();

  return (
    <Card>
      <CardHeader
        tone="accent"
        title="What this company is emailed about"
        subtitle="Applies to EVERYONE here, not only you — switching a category off stops that email reaching your colleagues too. Changes save instantly."
      />
      {list.isLoading ? (
        <CardBody>
          <LoadingState label="Loading preferences…" rows={3} />
        </CardBody>
      ) : list.isError ? (
        <CardBody>
          <ErrorState
            message={list.error?.message ?? 'Failed.'}
            retry={() => void list.refetch()}
          />
        </CardBody>
      ) : list.data === undefined || list.data.length === 0 ? (
        <CardBody>
          <p className="text-text-muted text-sm">No preferences yet.</p>
        </CardBody>
      ) : (
        <>
          {/* A TABLE, not seven stacked cards. Seven categories × four
              controls is a grid of the same question asked seven times,
              and a column is how you compare them. The `Table` primitive
              turns each row into a labelled card below `md` (FE-7). */}
          <Table>
            <THead>
              <Tr>
                <Th>Category</Th>
                <Th>Email</Th>
                <Th>In-app</Th>
                <Th>Quiet hours</Th>
                <Th>What that means</Th>
              </Tr>
            </THead>
            <TBody>
              {list.data.map((row) => (
                <PreferenceRow
                  key={row.id}
                  row={row}
                  onToast={(s) => toast.success(s)}
                  onError={(e) => toast.error(e)}
                />
              ))}
            </TBody>
          </Table>
          <CardBody className="border-border-subtle border-t">
            <p className="text-text-faint text-xs">
              {/*
                Two switches, not six. SMS, Webhook and Frequency were on
                this screen and could not be honoured by anything: there
                is no SMS sender in Phase-1A, outbound webhooks are
                configured per endpoint and never read this toggle, and
                DAILY_DIGEST needs a scheduler that does not exist. A
                control that does nothing is worse than no control.
              */}
              Quiet hours hold the EMAIL only, in the company timezone. An email that arrives inside
              the window waits until it ends rather than being dropped — and an inbox line is never
              held, because nothing pings and the row itself is the delivery.
            </p>
          </CardBody>
        </>
      )}
    </Card>
  );
}

function PreferenceRow({
  row,
  onToast,
  onError,
}: {
  readonly row: NotificationPreferenceView;
  readonly onToast: (s: string) => void;
  readonly onError: (s: string) => void;
}): ReactElement {
  const update = useUpdateNotificationPreference();
  const [busy, setBusy] = useState(false);

  async function patch(
    body: Parameters<typeof update.mutateAsync>[0]['body'],
    msg: string,
  ): Promise<void> {
    setBusy(true);
    try {
      await update.mutateAsync({ category: row.category, body });
      onToast(msg);
    } catch (e) {
      if (e instanceof ApiError) {
        const b = e.body as { code?: unknown; message?: unknown } | null;
        const code = typeof b?.code === 'string' ? b.code : null;
        const m = typeof b?.message === 'string' ? b.message : e.message;
        onError(code ? `[${code}] ${m}` : m);
      } else {
        onError(e instanceof Error ? e.message : 'Update failed');
      }
    } finally {
      setBusy(false);
    }
  }

  const label = CATEGORY_LABEL[row.category] ?? { title: row.category, description: '' };
  const held = row.quietHoursStart !== null && row.quietHoursEnd !== null;

  return (
    <Tr>
      <Td>
        <div className="text-text-bright text-sm font-medium">{label.title}</div>
        <div className="text-text-muted text-xs">{label.description}</div>
      </Td>
      <Td>
        <Switch
          checked={row.emailEnabled}
          disabled={busy}
          label={`Email ${label.title}`}
          onChange={(v) => void patch({ emailEnabled: v }, 'Saved.')}
        />
      </Td>
      <Td>
        <Switch
          checked={row.inAppEnabled}
          disabled={busy}
          label={`In-app ${label.title}`}
          onChange={(v) => void patch({ inAppEnabled: v }, 'Saved.')}
        />
      </Td>
      <Td>
        <div className="flex items-center gap-1.5">
          <Input
            type="time"
            aria-label={`Quiet hours start for ${label.title}`}
            className="w-[6.5rem]"
            defaultValue={row.quietHoursStart ?? ''}
            disabled={busy}
            onBlur={(e) =>
              void patch(
                { quietHoursStart: e.target.value.trim() === '' ? null : e.target.value },
                'Saved.',
              )
            }
          />
          <span className="text-text-faint text-xs">to</span>
          <Input
            type="time"
            aria-label={`Quiet hours end for ${label.title}`}
            className="w-[6.5rem]"
            defaultValue={row.quietHoursEnd ?? ''}
            disabled={busy}
            onBlur={(e) =>
              void patch(
                { quietHoursEnd: e.target.value.trim() === '' ? null : e.target.value },
                'Saved.',
              )
            }
          />
        </div>
      </Td>
      <Td>
        {/* Derived, never typed: what the two times above actually do. */}
        {!row.emailEnabled ? (
          <span className="text-text-faint text-xs">No email at all</span>
        ) : held ? (
          <span className="text-text-muted text-xs">Held till {row.quietHoursEnd}</span>
        ) : (
          <span className="text-text-muted text-xs">Sent straight away</span>
        )}
      </Td>
    </Tr>
  );
}

/* ── The rail ───────────────────────────────────────────────────── */

function AlwaysOn(): ReactElement {
  /**
   * NOTIF-9: CREDENTIAL is `[EMAIL]` and `mutable: false`. Not a
   * preference nobody has got round to adding — a password reset you
   * can only read once signed in is useless, an invite has no account
   * to deliver to yet, and "your password was changed" shown in-app is
   * seen by whoever is already inside rather than by the person being
   * warned. Saying so is what stops somebody hunting for the switch.
   */
  const items: ReadonlyArray<{ Icon: typeof ShieldCheck; title: string; body: string }> = [
    {
      Icon: ShieldCheck,
      title: 'Account and sign-in',
      body: 'Password resets, email verification, team invitations, new-device warnings.',
    },
    {
      Icon: Landmark,
      title: 'Bank and payout changes',
      body: 'A change to the account we pay you into is always confirmed by email.',
    },
  ];
  return (
    <Card>
      <CardHeader
        tone="accent"
        title={
          <span className="inline-flex items-center gap-2">
            <BellOff size={14} aria-hidden />
            Cannot be switched off
          </span>
        }
        subtitle="These go to your email whatever is set above. A warning you can silence is one you find out about too late."
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

interface QuietSummary {
  readonly set: boolean;
  readonly label: string;
  readonly note: string;
  readonly timezone: string | null;
  /** Non-null only when every category that HAS a window agrees. */
  readonly window: { start: string; end: string } | null;
}

/**
 * The quiet-hours window, across categories.
 *
 * Each category carries its own, so "the" window only exists when they
 * agree — and where they do not, saying "Varies" is the honest answer
 * rather than picking one and presenting it as the rule.
 */
function summariseQuietHours(rows: readonly NotificationPreferenceView[]): QuietSummary {
  const withWindow = rows.filter((r) => r.quietHoursStart !== null && r.quietHoursEnd !== null);
  const timezone = rows[0]?.timezone ?? null;
  if (rows.length === 0) {
    return { set: false, label: '—', note: 'nothing set yet', timezone: null, window: null };
  }
  if (withWindow.length === 0) {
    return {
      set: false,
      label: 'Not set',
      note: 'email is sent as it happens',
      timezone,
      window: null,
    };
  }
  const distinct = new Set(withWindow.map((r) => `${r.quietHoursStart}-${r.quietHoursEnd}`));
  if (distinct.size > 1) {
    return {
      set: true,
      label: 'Varies',
      note: `${withWindow.length} categories, different windows`,
      timezone,
      window: null,
    };
  }
  const first = withWindow[0];
  const start = first?.quietHoursStart ?? '';
  const end = first?.quietHoursEnd ?? '';
  return {
    set: true,
    label: `${start}–${end}`,
    note:
      withWindow.length === rows.length
        ? 'on every category'
        : `on ${withWindow.length} of ${rows.length}`,
    timezone,
    window: { start, end },
  };
}

function TimezoneCard({
  timezone,
  quiet,
}: {
  readonly timezone: string;
  readonly quiet: QuietSummary;
}): ReactElement {
  // Rendered from the CLIENT clock in the company's zone. Deliberately
  // not a ticking clock: a second-by-second readout on a settings page
  // is motion for its own sake, and this only has to answer "which side
  // of the window are we on".
  const [now] = useState(() => new Date());
  const local = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);

  const inside = quiet.window !== null && isInsideWindow(local, quiet.window);

  return (
    <Card>
      <CardHeader
        tone="accent"
        title={
          <span className="inline-flex items-center gap-2">
            <Clock size={14} aria-hidden />
            Your timezone
          </span>
        }
        subtitle="Quiet hours are read in this zone, from the company profile — never a stored offset, which drifts an hour twice a year."
      />
      <CardBody>
        <div className="text-text-bright font-mono text-lg tabular-nums">{local}</div>
        <div className="text-text-muted mt-0.5 text-xs">{timezone}</div>
        {quiet.window !== null && (
          <div
            className={clsx(
              'mt-3 rounded-[5px] px-2 py-1.5 text-xs font-medium',
              inside ? 'text-[var(--status-pending-fg)]' : 'text-[var(--status-delivered-fg)]',
            )}
            style={{
              background: inside ? 'var(--status-pending-bg)' : 'var(--status-delivered-bg)',
            }}
          >
            {inside
              ? `Inside quiet hours — email is waiting until ${quiet.window.end}`
              : 'Outside quiet hours — email is going out now'}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * `HH:MM` inside `start`–`end`, wrapping midnight.
 *
 * The wrap is the whole point: 22:00→07:00 is the most ordinary
 * configuration there is, and a naive `>= start && < end` reports it as
 * never quiet. Same rule the server applies (NOTIF-15).
 */
function isInsideWindow(hhmm: string, w: { start: string; end: string }): boolean {
  const m = (s: string): number => {
    const [h = '0', min = '0'] = s.split(':');
    return Number(h) * 60 + Number(min);
  };
  const now = m(hhmm);
  const a = m(w.start);
  const b = m(w.end);
  return a <= b ? now >= a && now < b : now >= a || now < b;
}
