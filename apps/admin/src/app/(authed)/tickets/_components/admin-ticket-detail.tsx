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
import { AdminTicketConversation } from './admin-ticket-conversation';

/**
 * THREE stages, in the order a ticket actually travels: Open →
 * Reviewing → Closed.
 *
 * The dropdown used to list five, and it was really two questions
 * wearing one control: what STAGE is this at, and — if it is finishing
 * — HOW did it finish. Five flat options made those look like peers,
 * so "Refund the seller" sat next to "Under discussion" as if they were
 * the same kind of choice.
 *
 * They are not, and the difference is money: `RESOLVED_REFUND` writes a
 * SCRAP_REFUND credit to the seller's wallet inside the transition
 * transaction (TKT-1). Collapsing the outcomes into one "Closed" would
 * have meant either paying on EVERY close or never being able to pay at
 * all — so the four outcomes survive, asked at the step where they are
 * the actual question.
 */
const STAGES: ReadonlyArray<{ value: 'REVIEWING' | 'CLOSED'; label: string }> = [
  { value: 'REVIEWING', label: 'Reviewing' },
  { value: 'CLOSED', label: 'Closed' },
];

/** How a ticket finished. Asked only once "Closed" is chosen. */
const OUTCOMES: ReadonlyArray<{ value: TicketStatus; label: string }> = [
  { value: TicketStatus.RESOLVED_REFUND, label: 'Refunded the seller' },
  { value: TicketStatus.RESOLVED_RETURNED, label: 'Goods went back' },
  { value: TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED, label: 'Seller accepted the loss' },
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

  const [stage, setStage] = useState<'' | 'REVIEWING' | 'CLOSED'>('');
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
        setStage('');
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
              {
                label: 'Order',
                // The NUMBER. An operator quoting a ticket to a seller
                // or a courier needs the name they both use.
                value:
                  t.orderId === null ? (
                    '—'
                  ) : t.orderNumber !== null ? (
                    <span className="font-mono text-xs">{t.orderNumber}</span>
                  ) : (
                    <Ident value={t.orderId} />
                  ),
              },
              {
                label: 'Parcel',
                value:
                  t.shipmentId === null ? (
                    '—'
                  ) : t.shipmentNumber !== null ? (
                    <span className="font-mono text-xs">{t.shipmentNumber}</span>
                  ) : (
                    <Ident value={t.shipmentId} />
                  ),
              },
              { label: 'Courier', value: t.courierCode ?? '—' },
            ]}
          />
          {/*
            The description is NOT repeated here — the conversation
            below opens with exactly this message, so printing it in the
            facts card too showed the same sentence twice a few
            centimetres apart. Facts about the ticket here; what was
            said belongs in the thread, in order, with a time on it.
            Same change as the seller page.
          */}
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

      {/*
        The courier conversation is NOT on this page any more.

        It has its own screen — Courier escalation → Conversations —
        which does the same job with room for it, so nothing is lost:
        the manual relay to Delhivery is exactly as available as it was.
        What it was doing HERE was taking a third of a ticket page to
        say "nothing said either way yet" and offering two empty
        textareas beneath the seller conversation somebody actually came
        to read.

        This page is now one thread: the seller and us. Talking to the
        courier is a different act, in a different place, and mixing
        them is the same confusion that put two message boxes on the
        seller's ticket page.
      */}

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
                  {e.note !== null && e.note !== '' && (
                    <p className="text-text-body mt-0.5">{e.note}</p>
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
            {/*
              ONE ROW. Stage, outcome, refund, note, Apply.

              The conditional fields appear IN the row rather than under
              it, so choosing "Closed" widens the line instead of
              starting a new block — the form grows sideways as the
              decision narrows.

              Notes stays a <Textarea> at one row rather than becoming
              an <Input>: it is still somewhere a person may want two
              sentences, and swapping it would have bought the same
              height by taking that away. Its hint moved into the
              placeholder, which says the same thing without costing a
              line.
            */}
            <CardBody>
              <div className="flex flex-wrap items-end gap-2.5">
                <FormField label="Move to" htmlFor="admin-ticket-stage" className="w-[140px]">
                  <Select
                    id="admin-ticket-stage"
                    value={stage}
                    onChange={(e) => {
                      const next = e.target.value as '' | 'REVIEWING' | 'CLOSED';
                      setStage(next);
                      // Reviewing IS a status; Closed is four of them,
                      // so it waits for the second question.
                      setTo(next === 'REVIEWING' ? TicketStatus.NEGOTIATING : '');
                    }}
                  >
                    <option value="">Choose…</option>
                    {STAGES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </FormField>

                {stage === 'CLOSED' ? (
                  <FormField label="How" htmlFor="admin-ticket-to" className="w-[200px]">
                    <Select
                      id="admin-ticket-to"
                      value={to}
                      onChange={(e) => setTo(e.target.value as TicketStatus | '')}
                    >
                      <option value="">Outcome…</option>
                      {OUTCOMES.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                ) : null}

                {to === TicketStatus.RESOLVED_REFUND ? (
                  <FormField
                    label="Refund (INR)"
                    htmlFor="admin-ticket-refund"
                    className="w-[130px]"
                  >
                    <input
                      id="admin-ticket-refund"
                      className="sd-field"
                      value={refund}
                      onChange={(e) => setRefund(e.target.value)}
                      inputMode="decimal"
                      // The hint is gone from under the field but the
                      // fact is not: this credits a seller's wallet in
                      // the same transaction, so it says so where it
                      // cannot be missed.
                      title="Credited to the seller's wallet in the same transaction."
                    />
                  </FormField>
                ) : null}

                <FormField
                  label="Notes"
                  htmlFor="admin-ticket-notes"
                  className="min-w-[200px] flex-1"
                >
                  <Textarea
                    id="admin-ticket-notes"
                    rows={1}
                    placeholder="The seller reads this on their ticket."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </FormField>

                <Button
                  variant="primary"
                  size="md"
                  className="shrink-0"
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
