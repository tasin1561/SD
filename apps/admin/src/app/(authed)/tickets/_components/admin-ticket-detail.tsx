'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  DescriptionList,
  ErrorNote,
  FormField,
  Ident,
  PageHeader,
  Select,
  SkeletonRows,
  Textarea,
  TicketStatusBadge,
  useToast,
} from '@skydrop/ui/components';
import { TicketStatus } from '@skydrop/db';
import { useAdminTicket, useTicketEvents, useTransitionTicket } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { TicketCourierPanel } from './ticket-courier-panel';
import { AdminTicketConversation } from './admin-ticket-conversation';

const MOVE_TO: ReadonlyArray<{ value: TicketStatus; label: string }> = [
  { value: TicketStatus.NEGOTIATING, label: 'Under discussion' },
  { value: TicketStatus.RESOLVED_REFUND, label: 'Refund the seller' },
  { value: TicketStatus.RESOLVED_RETURNED, label: 'Goods went back' },
  { value: TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED, label: 'Closed — no money moved' },
  { value: TicketStatus.REJECTED, label: 'Not upheld' },
];

/**
 * One ticket, in full.
 *
 * The drawer stays for triage from the list — glance, move it on, close
 * it. But it was also the only place the courier conversation lived,
 * and a modal already busy with a status form is the wrong home for the
 * exchange this ticket exists to carry.
 */
export function AdminTicketDetail({ ticketId }: { readonly ticketId: string }): ReactElement {
  const toast = useToast();
  const ticket = useAdminTicket(ticketId);
  const events = useTicketEvents(ticketId);
  const transition = useTransitionTicket();
  // FE-2: cosmetic. The server refuses regardless.
  const canResolve = usePermission('tickets.resolve');

  const [to, setTo] = useState<TicketStatus | ''>('');
  const [notes, setNotes] = useState('');
  const [refund, setRefund] = useState('');

  if (ticket.isLoading) return <SkeletonRows rows={6} cols={1} />;
  if (ticket.isError) {
    return <ErrorNote message={serverVerdict(ticket.error)} retry={() => void ticket.refetch()} />;
  }
  const t = ticket.data;
  if (t === undefined) return <div />;

  const apply = (): void => {
    if (to === '') return;
    void (async () => {
      try {
        await transition.mutateAsync({
          ticketId,
          to,
          ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
          ...(to === TicketStatus.RESOLVED_REFUND && refund.trim() !== ''
            ? { refundAmountInr: refund.trim() }
            : {}),
        });
        setTo('');
        setNotes('');
        setRefund('');
        toast.success('Ticket moved');
      } catch (err) {
        toast.error(serverVerdict(err));
      }
    })();
  };

  return (
    <div>
      <Link
        href="/tickets"
        className="text-text-muted hover:text-text-bright mb-3 inline-flex items-center gap-1.5 text-xs"
      >
        <ArrowLeft size={13} /> All tickets
      </Link>

      <PageHeader title={t.subject} subtitle={`Raised ${new Date(t.createdAt).toLocaleString()}`} />

      <Card className="mt-3">
        <CardBody>
          <div className="mb-3">
            <TicketStatusBadge status={t.status} />
          </div>
          <DescriptionList
            items={[
              { label: 'Type', value: t.ticketType.toLowerCase().replaceAll('_', ' ') },
              { label: 'Order', value: t.orderId === null ? '—' : <Ident value={t.orderId} /> },
              {
                label: 'Parcel',
                value: t.shipmentId === null ? '—' : <Ident value={t.shipmentId} />,
              },
              { label: 'Courier', value: t.courierCode ?? '—' },
            ]}
          />
          {t.description !== null && t.description.trim() !== '' && (
            <p className="bg-surface-raised border-border text-text-body mt-3 rounded border px-3 py-2 text-sm whitespace-pre-wrap">
              {t.description}
            </p>
          )}
        </CardBody>
      </Card>

      {/* The conversation FIRST — it is what the ticket is. The courier
          exchange and the status machinery are how we act on it. */}
      <h2 className="text-text-bright mt-5 mb-2 text-sm font-medium">Conversation</h2>
      <Card>
        <CardBody>
          <AdminTicketConversation ticket={t} />
        </CardBody>
      </Card>

      <h2 className="text-text-bright mt-5 mb-2 text-sm font-medium">Courier conversation</h2>
      <TicketCourierPanel ticketId={ticketId} />

      <h2 className="text-text-bright mt-5 mb-2 text-sm font-medium">History</h2>
      <Card>
        <CardBody>
          {events.isLoading ? (
            <SkeletonRows rows={3} cols={1} />
          ) : (events.data ?? []).length === 0 ? (
            <p className="text-text-muted text-sm">Nothing yet.</p>
          ) : (
            <ol className="space-y-2">
              {(events.data ?? []).map((e) => (
                <li key={e.id} className="text-sm">
                  <span className="text-text-muted mr-2 text-xs tabular-nums">
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                  <span className="font-medium">
                    {e.fromStatus === null ? 'Opened' : `${e.fromStatus} → ${e.toStatus}`}
                  </span>
                  {e.notes !== null && e.notes !== '' && (
                    <p className="text-text-body mt-0.5">{e.notes}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>

      {canResolve && t.resolvedAt === null ? (
        <>
          <h2 className="text-text-bright mt-5 mb-2 text-sm font-medium">Move this on</h2>
          <Card>
            <CardBody className="space-y-3">
              <FormField label="Move to" htmlFor="admin-ticket-to">
                <Select
                  id="admin-ticket-to"
                  value={to}
                  onChange={(e) => setTo(e.target.value as TicketStatus | '')}
                >
                  <option value="">Choose an outcome…</option>
                  {MOVE_TO.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </FormField>

              {to === TicketStatus.RESOLVED_REFUND ? (
                <FormField
                  label="Refund (INR)"
                  htmlFor="admin-ticket-refund"
                  hint="Credited to the seller's wallet in the same transaction."
                >
                  <input
                    id="admin-ticket-refund"
                    className="sd-field"
                    value={refund}
                    onChange={(e) => setRefund(e.target.value)}
                    inputMode="decimal"
                  />
                </FormField>
              ) : null}

              <FormField
                label="Notes"
                htmlFor="admin-ticket-notes"
                hint="The seller reads this on their ticket."
              >
                <Textarea
                  id="admin-ticket-notes"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </FormField>

              <div className="flex justify-end">
                <Button
                  variant="primary"
                  size="md"
                  disabled={to === '' || transition.isPending}
                  onClick={apply}
                >
                  {transition.isPending ? 'Applying…' : 'Apply'}
                </Button>
              </div>
            </CardBody>
          </Card>
        </>
      ) : null}
    </div>
  );
}
