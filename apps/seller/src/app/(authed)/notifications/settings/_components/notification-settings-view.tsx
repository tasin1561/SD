'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  PageHeader,
  Section,
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
 * This was two screens: `/notifications/settings` for a person's own
 * per-topic silences, and `/settings/notifications` for the company's
 * per-category email preferences. Two tiles on the Settings hub, both
 * called notifications, and the only way to tell them apart was to read
 * the descriptions carefully — which is how somebody changes the wrong
 * one and believes they changed the other.
 *
 * The SCREENS are merged. The two data models are NOT, and must not be.
 * CLAUDE.md asks the question directly — what does a per-company mute
 * mean for a person who did not set it? — and the answer is already
 * settled in `SellerNotificationPreferenceResolver`: both grains can
 * only ever REMOVE a delivery, never add one, and they compose by
 * intersection. The company decides whether a category leaves the
 * building at all; a person decides what reaches their own inbox. One
 * table holding both would have to answer "whose choice was this?" for
 * every row, and it cannot.
 *
 * So: one page, two sections, each stating whose decision it is.
 *
 * ── WHY THIS URL AND NOT THE OTHER ONE ───────────────────────────────
 * `/settings/notifications` sat behind the `notifications.manage`
 * permission, correctly — deciding what the whole company is emailed is
 * an administrative act. But a person's own inbox is SELF-SERVICE and
 * must never be behind a grantable permission (NOTIF-11): the key would
 * have to be granted, no existing role holds it, and most of the estate
 * would have been bounced off their own settings. So the merged page
 * lives at the UNGATED url and the company half is what gets gated,
 * cosmetically, inside it. The old url redirects here.
 */
export function NotificationSettingsView(): ReactElement {
  const identity = useSellerIdentity();
  // Cosmetic only (FE-2) — the API refuses a PATCH from somebody
  // without the permission regardless. This decides whether we render a
  // section they could not use, not whether they may use it.
  const mayManageCompany = can(identity, 'notifications.manage');

  return (
    <Section>
      <Link
        href="/notifications"
        className="text-text-muted hover:text-text-body mb-4 inline-flex items-center gap-1.5 text-xs transition-colors"
      >
        <ArrowLeft size={12} /> Notifications
      </Link>

      <PageHeader
        title="Notification settings"
        subtitle={
          mayManageCompany
            ? 'Two separate choices: what reaches YOU, and what this COMPANY is emailed about. Both only ever remove a message — neither can turn one on that the other switched off. Messages about your account and credentials are in neither list: they always go to your email and cannot be silenced.'
            : 'What reaches YOUR inbox. Messages about your account and credentials are not listed — they only ever go to your email, and cannot be silenced.'
        }
      />

      <YourTopics />
      {mayManageCompany && <CompanyCategories />}
    </Section>
  );
}

/* ── Yours ──────────────────────────────────────────────────────── */

function YourTopics(): ReactElement {
  const topics = useNotificationTopics();
  const subs = useNotificationSubscriptions();
  const setSub = useSetNotificationSubscription();
  const clearSub = useClearNotificationSubscription();
  const [error, setError] = useState<string | null>(null);

  // A topic with no row follows its default, which is ON. Only an
  // explicit MUTED row switches something off.
  const muted = new Set((subs.data ?? []).filter((s) => s.mode === 'MUTED').map((s) => s.topic));
  const grouped = (topics.data ?? []).reduce<Record<string, TopicDef[]>>((acc, t) => {
    (acc[t.group] ??= []).push(t);
    return acc;
  }, {});

  return (
    <Card className="mb-4">
      <CardHeader
        tone="accent"
        title="What reaches you"
        subtitle="Your own choices, for your own inbox. Nobody else at this company sees them, and changing one here does not change what anybody else receives."
      />
      <CardBody>
        {error !== null && <p className="text-status-failed-fg mb-3 text-sm">{error}</p>}
        {topics.isLoading ? (
          <LoadingState label="Loading topics…" rows={3} />
        ) : (
          Object.entries(grouped).map(([group, defs]) => (
            <div key={group} className="mt-4 first:mt-0">
              <h3 className="text-text-faint text-xs font-medium tracking-wide uppercase">
                {group}
              </h3>
              <ul className="divide-border-subtle mt-1 divide-y">
                {defs.map((d) => {
                  const on = !muted.has(d.topic);
                  return (
                    <li key={d.topic} className="flex items-start justify-between gap-4 py-2.5">
                      <div className="min-w-0">
                        <div className="text-sm">{d.label}</div>
                        <div className="text-text-muted text-xs">{d.description}</div>
                      </div>
                      <label className="flex shrink-0 items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={on}
                          aria-label={`Notify me about: ${d.label}`}
                          onChange={() => {
                            setError(null);
                            if (on) {
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
                        <span className="text-text-faint">{on ? 'On' : 'Off'}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
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
  BILLING: {
    title: 'Billing',
    description: 'Remittance summaries + invoices.',
  },
  SYSTEM_ANNOUNCEMENTS: {
    title: 'System announcements',
    description: 'Maintenance windows, policy updates.',
  },
  MARKETING: {
    title: 'Marketing',
    description: 'Skydrop product updates + tips.',
  },
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
      <CardBody>
        {list.isLoading ? (
          <LoadingState label="Loading preferences…" rows={3} />
        ) : list.isError ? (
          <ErrorState
            message={list.error?.message ?? 'Failed.'}
            retry={() => void list.refetch()}
          />
        ) : !list.data || list.data.length === 0 ? (
          <p className="text-text-muted text-sm">No preferences yet.</p>
        ) : (
          <div className="divide-border-subtle divide-y">
            {list.data.map((row) => (
              <PreferenceRow
                key={row.id}
                row={row}
                onToast={(s) => toast.success(s)}
                onError={(e) => toast.error(e)}
              />
            ))}
          </div>
        )}
      </CardBody>
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

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="text-text-bright mb-1 text-sm font-medium">{label.title}</div>
      <p className="text-text-muted mb-3 text-xs">{label.description}</p>

      {/*
        Two switches, not six.

        SMS, Webhook and Frequency were on this screen and could not be
        honoured by anything: there is no SMS sender in Phase-1A,
        outbound webhooks are configured per endpoint and never read
        this toggle, and DAILY_DIGEST needs a digest scheduler that does
        not exist. A control that does nothing is worse than no control
        — somebody switches it, believes it, and finds out weeks later.
        The COLUMNS survive for when those channels do.
      */}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Toggle
          label="Email"
          checked={row.emailEnabled}
          disabled={busy}
          onChange={(v) => void patch({ emailEnabled: v }, 'Saved.')}
        />
        <Toggle
          label="In-app"
          checked={row.inAppEnabled}
          disabled={busy}
          onChange={(v) => void patch({ inAppEnabled: v }, 'Saved.')}
        />
      </div>

      <div className="border-border grid grid-cols-2 gap-3 border-t pt-3">
        <FormField
          label="Quiet hours start (HH:MM)"
          hint="Email only, in your timezone. An email that arrives inside the window is held until it ends, not dropped."
        >
          <Input
            type="time"
            value={row.quietHoursStart ?? ''}
            disabled={busy}
            onBlur={(e) =>
              void patch(
                { quietHoursStart: e.target.value.trim() === '' ? null : e.target.value },
                'Saved.',
              )
            }
          />
        </FormField>
        <FormField label="Quiet hours end (HH:MM)">
          <Input
            type="time"
            value={row.quietHoursEnd ?? ''}
            disabled={busy}
            onBlur={(e) =>
              void patch(
                { quietHoursEnd: e.target.value.trim() === '' ? null : e.target.value },
                'Saved.',
              )
            }
          />
        </FormField>
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (v: boolean) => void;
  readonly disabled?: boolean;
}): ReactElement {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-text-body">{label}</span>
    </label>
  );
}
