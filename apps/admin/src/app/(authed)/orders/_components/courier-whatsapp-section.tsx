'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactElement } from 'react';

import { useApiClient } from '@skydrop/auth/client';
import { CourierWhatsappMessages } from '@skydrop/ui/app/courier-whatsapp';
import { useLocale, useT } from '@/i18n/client';
import { formatDateTime } from '@/i18n/format';
import { usePermission } from '@/lib/use-permission';

interface CourierMessagesView {
  readonly enabled: boolean;
  readonly shipmentId: string | null;
  readonly lastCheckedAt: string | null;
  readonly checking: boolean;
  readonly pausedUntil: string | null;
  /** Delhivery took the conversation off its panel; these are our saved copy. */
  readonly closed?: boolean;
  readonly messages: readonly { text: string; sentLabel: string; sentAt: string | null }[];
}

/**
 * The WhatsApp messages the courier sent this order's customer, read off
 * the courier's own screen. Hidden until there is at least one. The server
 * scopes the read to this console's own orders; a foreign order is a 404
 * and simply shows nothing.
 */
export function CourierWhatsappSection({
  orderId,
}: {
  readonly orderId: string;
}): ReactElement | null {
  const t = useT();
  const locale = useLocale();
  const client = useApiClient();
  const mayRefresh = usePermission('courier.ops.write');
  const id = orderId;
  const startedAt = useRef(Date.now());
  const q = useQuery({
    queryKey: ['admin-orders', 'courier-messages', id],
    queryFn: () => client.request<CourierMessagesView>(`/api/admin/orders/${id}/courier-messages`),
    enabled: /^[0-9a-f-]{36}$/i.test(id),
    retry: false,
    // A read was queued for this view: look again every 15 s for up to
    // 2 minutes. A hidden tab does not poll (react-query's default).
    refetchInterval: (query) =>
      query.state.data?.checking === true && Date.now() - startedAt.current < 120_000
        ? 15_000
        : false,
  });
  const qc = useQueryClient();
  const [note, setNote] = useState<string | null>(null);
  const refresh = useMutation({
    mutationFn: () =>
      client.request<{ queued: boolean; reason?: string }>(
        `/api/admin/orders/${id}/courier-messages/refresh`,
        { method: 'POST' },
      ),
    onSuccess: (r) => {
      setNote(
        r.queued
          ? t('courierWhatsapp.queued')
          : r.reason === 'TOO_SOON'
            ? t('courierWhatsapp.tooSoon')
            : t('courierWhatsapp.off'),
      );
      void qc.invalidateQueries({ queryKey: ['admin-orders', 'courier-messages', id] });
    },
  });
  const data = q.data;
  if (data === undefined) return null;
  const when = data.lastCheckedAt === null ? null : formatDateTime(data.lastCheckedAt, locale);
  const canAsk = mayRefresh && data.enabled && data.shipmentId !== null;
  if (data.messages.length === 0) {
    if (!canAsk) return null;
    return (
      <div className="sk-cwa__foot">
        <button
          type="button"
          className="sk-cwa__refresh"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          {t('courierWhatsapp.refresh')}
        </button>
        {note !== null && <span>{note}</span>}
      </div>
    );
  }
  return (
    <section aria-label={t('courierWhatsapp.title')}>
      <h4 className="sk-cwa__title">{t('courierWhatsapp.title')}</h4>
      <CourierWhatsappMessages
        messages={data.messages}
        note={t('courierWhatsapp.note')}
        status={
          data.closed === true
            ? t('courierWhatsapp.closed')
            : data.pausedUntil !== null && when !== null
              ? t('courierWhatsapp.paused', { when })
              : data.checking
                ? t('courierWhatsapp.checking')
                : null
        }
        footer={note ?? (when === null ? null : t('courierWhatsapp.checked', { when }))}
        onRefresh={canAsk ? () => refresh.mutate() : undefined}
        refreshLabel={
          refresh.isPending ? t('courierWhatsapp.refreshing') : t('courierWhatsapp.refresh')
        }
        refreshing={refresh.isPending}
      />
    </section>
  );
}

interface Health {
  readonly readsToday: number;
  readonly failuresToday: number;
  readonly readsLastHour: number;
  readonly hourlyCap: number;
  readonly oldestDueMinutes: number | null;
}

/** Reader health for staff who may see courier ops: one quiet line. */
export function CourierWhatsappHealthLine(): ReactElement | null {
  const client = useApiClient();
  const may = usePermission('courier.ops.view');
  const q = useQuery({
    queryKey: ['admin-courier', 'whatsapp-health'],
    queryFn: () => client.request<Health>('/api/admin/courier/whatsapp-health'),
    enabled: may,
    retry: false,
    staleTime: 60_000,
  });
  const t = useT();
  const h = q.data;
  if (h === undefined || (h.readsToday === 0 && h.oldestDueMinutes === null)) return null;
  return (
    <p className="sk-cwa__foot">
      {t('courierWhatsapp.health', {
        reads: h.readsToday,
        failed: h.failuresToday,
        hour: h.readsLastHour,
        cap: h.hourlyCap,
      })}
      {h.oldestDueMinutes === null
        ? ''
        : ` ${t('courierWhatsapp.healthDue', { minutes: h.oldestDueMinutes })}`}
    </p>
  );
}
