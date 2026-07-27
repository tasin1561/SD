'use client';

import { useEffect, useState, type ReactElement } from 'react';
import {
  Button,
  DescriptionList,
  ErrorNote,
  FormField,
  Ident,
  Input,
  Modal,
  ModalFooter,
  Money,
  Select,
  Skeleton,
  Textarea,
  TicketStatusBadge,
  useToast,
} from '@skydrop/ui/components';
import { TicketStatus } from '@skydrop/db';
import { useTicketEvents, useTransitionTicket, type TicketView } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/** Mirrors the server's TICKET_TRANSITIONS matrix. Cosmetic only (FE-2)
 *  — the server re-checks and returns INVALID_TICKET_TRANSITION. This
 *  exists so an operator isn't offered a move that cannot work. */
const NEXT_STATUSES: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  [TicketStatus.OPEN]: [
    TicketStatus.NEGOTIATING,
    TicketStatus.RESOLVED_REFUND,
    TicketStatus.RESOLVED_RETURNED,
    TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED,
    TicketStatus.REJECTED,
  ],
  [TicketStatus.NEGOTIATING]: [
    TicketStatus.OPEN,
    TicketStatus.RESOLVED_REFUND,
    TicketStatus.RESOLVED_RETURNED,
    TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED,
    TicketStatus.REJECTED,
  ],
  [TicketStatus.RESOLVED_REFUND]: [],
  [TicketStatus.RESOLVED_RETURNED]: [],
  [TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED]: [],
  [TicketStatus.REJECTED]: [],
};

const OUTCOME_COPY: Readonly<Record<string, string>> = {
  [TicketStatus.NEGOTIATING]: 'Still being discussed. Nothing moves yet.',
  [TicketStatus.RESOLVED_REFUND]:
    "Credits the seller's wallet with the amount below, in the same transaction as the status change. This is real money — it cannot be undone from here.",
  [TicketStatus.RESOLVED_RETURNED]: 'The goods went back to the seller. No money moves.',
  [TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED]: 'The seller accepted the loss. No money moves.',
  [TicketStatus.REJECTED]: 'Not a valid claim. No money moves.',
};

/**
 * Ticket detail + resolution.
 *
 * The history is shown above the action because the negotiation is
 * the context for the decision — resolving a ticket without reading
 * what was already agreed is how a seller gets refunded twice.
 *
 * FE-2: the status list is cosmetic; the server owns the matrix, the
 * refund-amount rules, and the wallet write. Its verdict is surfaced
 * verbatim.
 */
export function TicketDrawer({
  ticket,
  onClose,
}: {
  readonly ticket: TicketView | null;
  readonly onClose: () => void;
}): ReactElement {
  const toast = useToast();
  const events = useTicketEvents(ticket?.id ?? null);
  const transition = useTransitionTicket();

  const [to, setTo] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [refundAmountInr, setRefundAmountInr] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  // Reset the form whenever a different ticket opens, so a refund
  // amount typed for one ticket can never be submitted against another.
  useEffect(() => {
    setTo('');
    setNotes('');
    setRefundAmountInr('');
    setServerError(null);
  }, [ticket?.id]);

  const open = ticket !== null;
  const terminal = ticket !== null && NEXT_STATUSES[ticket.status].length === 0;
  const needsAmount = to === TicketStatus.RESOLVED_REFUND;

  async function submit(): Promise<void> {
    if (ticket === null || to === '') return;
    setServerError(null);
    try {
      await transition.mutateAsync({
        ticketId: ticket.id,
        to,
        ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
        ...(needsAmount ? { refundAmountInr: refundAmountInr.trim() } : {}),
      });
      toast.success(`Ticket moved to ${humanise(to)}.`);
      onClose();
    } catch (err) {
      // FE-2 — surface the server's verdict verbatim, no paraphrase.
      setServerError(serverVerdict(err));
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="lg"
      title={ticket?.subject ?? 'Ticket'}
      description={
        ticket === null ? undefined : (
          <span className="flex items-center gap-2">
            <TicketStatusBadge status={ticket.status} />
            <span className="text-text-faint">
              raised {new Date(ticket.createdAt).toLocaleString()}
            </span>
          </span>
        )
      }
    >
      {ticket !== null && (
        <div className="space-y-5">
          <DescriptionList
            items={[
              { label: 'Type', value: humanise(ticket.ticketType) },
              {
                label: 'Courier',
                value: ticket.courierCode ?? <Dash />,
              },
              {
                label: 'Order',
                value: ticket.orderId === null ? <Dash /> : <Ident value={ticket.orderId} />,
              },
              {
                label: 'Shipment',
                value: ticket.shipmentId === null ? <Dash /> : <Ident value={ticket.shipmentId} />,
              },
            ]}
          />

          {ticket.description !== null && ticket.description !== '' && (
            <p className="text-text-body bg-surface-raised border-border rounded-[var(--radius-2)] border px-3 py-2 text-sm leading-relaxed">
              {ticket.description}
            </p>
          )}

          {ticket.resolutionAmountInr !== null && (
            <div className="text-sm">
              <span className="text-text-muted">Refunded: </span>
              <Money amount={ticket.resolutionAmountInr} direction="credit" />
              {ticket.resolutionWalletEntryId !== null && (
                <span className="text-text-faint ml-2 text-xs">
                  wallet entry <Ident value={ticket.resolutionWalletEntryId} />
                </span>
              )}
            </div>
          )}

          {/* ── history ── */}
          <section>
            <h3 className="text-text-muted mb-2 text-xs font-medium tracking-wide uppercase">
              History
            </h3>
            {events.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : events.isError ? (
              <ErrorNote
                message={events.error?.message ?? 'Could not load history.'}
                retry={() => void events.refetch()}
              />
            ) : (events.data?.length ?? 0) === 0 ? (
              <p className="text-text-faint text-xs">No status changes yet.</p>
            ) : (
              <ol className="border-border space-y-2 border-l pl-3">
                {events.data?.map((e) => (
                  <li key={e.id} className="text-xs leading-relaxed">
                    <span className="text-text-body">
                      {e.fromStatus === null
                        ? humanise(e.toStatus)
                        : `${humanise(e.fromStatus)} → ${humanise(e.toStatus)}`}
                    </span>
                    <span className="text-text-faint ml-2">
                      {new Date(e.createdAt).toLocaleString()} · {e.actorType.toLowerCase()}
                    </span>
                    {e.notes !== null && e.notes !== '' && (
                      <div className="text-text-muted mt-0.5">{e.notes}</div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* ── resolution ── */}
          {terminal ? (
            <p className="text-text-faint text-xs">
              This ticket is closed. Its history is append-only and cannot be edited.
            </p>
          ) : (
            <section className="border-border space-y-3 border-t pt-4">
              <FormField label="Move to" htmlFor="ticket-to">
                <Select id="ticket-to" value={to} onChange={(e) => setTo(e.target.value)}>
                  <option value="">Choose an outcome…</option>
                  {NEXT_STATUSES[ticket.status].map((s) => (
                    <option key={s} value={s}>
                      {humanise(s)}
                    </option>
                  ))}
                </Select>
              </FormField>

              {to !== '' && OUTCOME_COPY[to] !== undefined && (
                <p
                  className={
                    to === TicketStatus.RESOLVED_REFUND
                      ? 'text-[var(--status-pending-fg)] text-xs leading-relaxed'
                      : 'text-text-muted text-xs leading-relaxed'
                  }
                >
                  {OUTCOME_COPY[to]}
                </p>
              )}

              {needsAmount && (
                <FormField
                  label="Refund amount (INR)"
                  htmlFor="ticket-refund"
                  hint="Decimal, up to 2 places. Credited as a SCRAP_REFUND wallet entry."
                >
                  <Input
                    id="ticket-refund"
                    inputMode="decimal"
                    placeholder="1250.00"
                    value={refundAmountInr}
                    onChange={(e) => setRefundAmountInr(e.target.value)}
                  />
                </FormField>
              )}

              <FormField
                label="Notes"
                htmlFor="ticket-notes"
                hint="Optional. Appended to the ticket history."
              >
                <Textarea
                  id="ticket-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </FormField>

              {serverError !== null && <ErrorNote message={serverError} />}
            </section>
          )}
        </div>
      )}

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={onClose}>
          Close
        </Button>
        {!terminal && (
          <Button
            variant={to === TicketStatus.RESOLVED_REFUND ? 'destructive' : 'primary'}
            size="md"
            disabled={
              to === '' || transition.isPending || (needsAmount && refundAmountInr.trim() === '')
            }
            onClick={() => void submit()}
          >
            {transition.isPending
              ? 'Applying…'
              : to === TicketStatus.RESOLVED_REFUND
                ? 'Refund seller'
                : 'Apply'}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}

function Dash(): ReactElement {
  return <span className="text-text-faint">—</span>;
}

function humanise(value: string): string {
  const lower = value.replaceAll('_', ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
