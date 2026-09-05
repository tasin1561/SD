'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  Card,
  CardBody,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  PageHeader,
  useToast,
} from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import type { NotificationPreferenceView } from '@skydrop/api-client';
import { useNotificationPreferences, useUpdateNotificationPreference } from '@/lib/api-hooks';

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

export function NotificationPreferencesIndex(): ReactElement {
  const list = useNotificationPreferences();
  const toast = useToast();

  return (
    <div>
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-text-muted hover:text-text-body text-xs mb-4 transition-colors"
      >
        <ArrowLeft size={12} /> Settings
      </Link>
      <PageHeader
        title="Notification preferences"
        subtitle="What the COMPANY is emailed about, by category, and when. Changes save instantly."
        action={
          <Link className="text-sm underline underline-offset-2" href="/notifications">
            Your own inbox
          </Link>
        }
      />
      {list.isLoading ? (
        <LoadingState label="Loading…" />
      ) : list.isError ? (
        <ErrorState message={list.error?.message ?? 'Failed.'} retry={() => void list.refetch()} />
      ) : !list.data || list.data.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-text-muted text-sm">No preferences yet.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
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
    </div>
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

  const label = CATEGORY_LABEL[row.category] ?? {
    title: row.category,
    description: '',
  };

  return (
    <Card>
      <CardBody>
        <div className="text-text-bright text-sm font-medium mb-1">{label.title}</div>
        <p className="text-text-muted text-xs mb-3">{label.description}</p>

        {/*
          Two switches, not six.

          SMS, Webhook and Frequency were on this screen and could not
          be honoured by anything: there is no SMS sender in Phase-1A,
          outbound webhooks are configured per endpoint and never read
          this toggle, and DAILY_DIGEST needs a digest scheduler that
          does not exist. A control that does nothing is worse than no
          control — somebody switches it, believes it, and finds out
          weeks later. The COLUMNS survive for when those channels do,
          so this is a screen change and not a migration.
        */}
        <div className="grid grid-cols-2 gap-3 mb-3">
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

        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
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
                  {
                    quietHoursStart: e.target.value.trim() === '' ? null : e.target.value,
                  },
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
                  {
                    quietHoursEnd: e.target.value.trim() === '' ? null : e.target.value,
                  },
                  'Saved.',
                )
              }
            />
          </FormField>
        </div>
      </CardBody>
    </Card>
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
    <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
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
