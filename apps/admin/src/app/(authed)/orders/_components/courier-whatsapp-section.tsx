'use client';
// Redeploy marker 2026-11-16: #46 was skipped by an overlapping deploy.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactElement } from 'react';

import { useApiClient } from '@skydrop/auth/client';
import { CourierWhatsappMessages } from '@skydrop/ui/app/courier-whatsapp';
import { StatusChip } from '@skydrop/ui/app/status-chip';
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
  readonly ndr?: {
    readonly open: boolean | null;
    readonly attemptsFailed: number | null;
    readonly attemptsMax: number | null;
    readonly deadlineDays: number | null;
    readonly remarkVerified: boolean | null;
    readonly reasonText: string | null;
  } | null;
  readonly fakeAttemptTicket?: { readonly id: string; readonly number: string } | null;
}

type NdrView = NonNullable<CourierMessagesView['ndr']>;

/**
 * Delhivery's NDR panel facts on one line. A fact we could not read is
 * simply not shown; "Not verified" is a red chip, "Verified" a green one.
 */
function NdrLine({
  ndr,
  t,
}: {
  readonly ndr: NdrView;
  readonly t: ReturnType<typeof useT>;
}): ReactElement | null {
  const parts: ReactElement[] = [];
  if (ndr.attemptsFailed !== null && ndr.attemptsMax !== null) {
    parts.push(
      <span key="a">
        {t('courierWhatsapp.ndrAttempts', { failed: ndr.attemptsFailed, max: ndr.attemptsMax })}
      </span>,
    );
  }
  if (ndr.deadlineDays !== null) {
    parts.push(
      <span key="d">
        {ndr.deadlineDays === 0
          ? t('courierWhatsapp.ndrDeadlineToday')
          : ndr.deadlineDays === 1
            ? t('courierWhatsapp.ndrDeadlineOne')
            : t('courierWhatsapp.ndrDeadline', { days: ndr.deadlineDays })}
      </span>,
    );
  }
  if (ndr.remarkVerified !== null) {
    parts.push(
      <span key="r" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {t('courierWhatsapp.ndrRemark')}
        <StatusChip
          size="sm"
          kind={ndr.remarkVerified ? 'delivered' : 'failed'}
          label={
            ndr.remarkVerified
              ? t('courierWhatsapp.ndrVerified')
              : t('courierWhatsapp.ndrNotVerified')
          }
        />
      </span>,
    );
  }
  if (parts.length === 0) return null;
  return (
    <p
      className="sk-cwa__foot"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '4px 10px',
        margin: 0,
      }}
    >
      {parts.map((p, i) => (
        <span key={p.key ?? i} style={{ display: 'inline-flex', gap: 10 }}>
          {i > 0 && <span aria-hidden="true">·</span>}
          {p}
        </span>
      ))}
    </p>
  );
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
  const [ticketNote, setTicketNote] = useState<string | null>(null);
  const fakeTicket = useMutation({
    mutationFn: () =>
      client.request<{ created: boolean; ticket: { id: string; number: string } }>(
        `/api/admin/orders/${id}/courier-ndr/fake-attempt-ticket`,
        { method: 'POST' },
      ),
    onSuccess: (r) => {
      setTicketNote(t('courierWhatsapp.ndrTicketRaised', { number: r.ticket.number }));
      void qc.invalidateQueries({ queryKey: ['admin-orders', 'courier-messages', id] });
    },
  });
  const data = q.data;
  if (data === undefined) return null;
  const when = data.lastCheckedAt === null ? null : formatDateTime(data.lastCheckedAt, locale);
  const canAsk = mayRefresh && data.enabled && data.shipmentId !== null;
  const ndrBlock =
    data.ndr == null ? null : (
      <div>
        <NdrLine ndr={data.ndr} t={t} />
        {data.ndr.reasonText !== null && (
          <p className="sk-cwa__foot" style={{ margin: 0 }}>
            {t('courierWhatsapp.ndrReason', { text: data.ndr.reasonText })}
          </p>
        )}
        {data.ndr.remarkVerified === false && data.fakeAttemptTicket != null && (
          <p className="sk-cwa__foot" style={{ margin: 0 }}>
            {t('courierWhatsapp.ndrTicketOpen', { number: data.fakeAttemptTicket.number })}
          </p>
        )}
        {data.ndr.remarkVerified === false &&
          data.fakeAttemptTicket == null &&
          mayRefresh &&
          data.shipmentId !== null && (
            <div className="sk-cwa__foot">
              <button
                type="button"
                className="sk-cwa__refresh"
                disabled={fakeTicket.isPending}
                onClick={() => fakeTicket.mutate()}
              >
                {t('courierWhatsapp.ndrRaiseTicket')}
              </button>
              {ticketNote !== null && <span>{ticketNote}</span>}
            </div>
          )}
      </div>
    );
  if (data.messages.length === 0) {
    if (!canAsk) return ndrBlock;
    return (
      <>
        {ndrBlock}
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
      </>
    );
  }
  return (
    <section aria-label={t('courierWhatsapp.title')}>
      <h4 className="sk-cwa__title">{t('courierWhatsapp.title')}</h4>
      {ndrBlock}
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
