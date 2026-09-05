'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { ArrowLeft, Wallet } from 'lucide-react';
import {
  Card,
  CardBody,
  DescriptionList,
  ErrorNote,
  Ident,
  Money,
  PageHeader,
  Section,
  Skeleton,
  TicketStatusBadge,
} from '@skydrop/ui/components';
import { TicketType } from '@skydrop/db';
import type { TicketView } from '@/lib/ops-hooks';
import { useSellerTicket } from '@/lib/ticket-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { TicketConversation } from './ticket-conversation';

/**
 * One ticket, opened.
 *
 * The list answers "is anything disputed"; this page answers "what
 * happened to mine". Those are different questions and the second one
 * was unanswerable — `GET /seller/tickets/:ticketId` had no caller, so a
 * seller could raise an issue, watch a badge change, and never read the
 * outcome or find the money.
 *
 * ── A REFUND IS MONEY ARRIVING, NOT A STATUS ─────────────────────────
 * When a ticket resolves as RESOLVED_REFUND the server writes a
 * SCRAP_REFUND wallet credit in the SAME transaction as the status
 * change, so `resolvedAt` is also the moment the money landed. That is
 * the fact a seller came here for, and it leads the page: the amount,
 * the date, and a way through to the wallet where it now sits. A badge
 * saying "Resolved refund" tells them a decision was made; it does not
 * tell them they were paid.
 */
export function TicketDetail({ ticketId }: { readonly ticketId: string }): ReactElement {
  const query = useSellerTicket(ticketId);

  if (query.isLoading) return <DetailSkeleton />;

  if (query.isError || query.data === undefined) {
    return (
      <div>
        <BackLink />
        <PageHeader title="Ticket" />
        <Card>
          <CardBody>
            {/* FE-2 — the server's verdict verbatim. A wrong id and
                another seller's ticket both come back TICKET_NOT_FOUND,
                which is the whole message worth showing. */}
            <ErrorNote
              message={serverVerdict(query.error, 'Could not load this ticket.')}
              retry={() => void query.refetch()}
            />
            <p className="text-text-muted mt-3 text-xs">
              If this ticket was raised from another account in your company, ask them to open it —
              tickets are scoped to the seller they belong to.
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  const ticket = query.data;
  const raisedByUs = ticket.ticketType === TicketType.SCRAP_DAMAGE;

  return (
    <div>
      <BackLink />

      <PageHeader
        title={ticket.subject}
        subtitle={`${raisedByUs ? 'Raised by Skydrop' : 'Raised by you'} on ${formatDateTime(ticket.createdAt)}`}
        action={<TicketStatusBadge status={ticket.status} />}
      />

      {ticket.resolutionAmountInr !== null && <RefundBanner ticket={ticket} />}

      <Section title="Ticket">
        <Card>
          <CardBody>
            <DescriptionList
              columns={3}
              items={[
                { label: 'Type', value: humanise(ticket.ticketType) },
                { label: 'Status', value: <TicketStatusBadge status={ticket.status} /> },
                { label: 'Courier', value: ticket.courierCode ?? <Dash /> },
                {
                  label: 'Order',
                  // The NUMBER, not the uuid. A uuid cannot be read
                  // aloud, repeated down a phone, or matched against
                  // the order list; the id is still what the link uses.
                  value:
                    ticket.orderId === null ? (
                      <Dash />
                    ) : (
                      <Link
                        href={`/orders/${ticket.orderId}`}
                        className="text-accent font-mono hover:underline"
                      >
                        {ticket.orderNumber ?? <Ident value={ticket.orderId} />}
                      </Link>
                    ),
                },
                {
                  label: 'Parcel',
                  // A seller has no shipment page — parcels are shown on
                  // the order — so the id is evidence to quote at us, not
                  // a link to nowhere.
                  value:
                    ticket.shipmentId === null ? (
                      <Dash />
                    ) : ticket.shipmentNumber !== null ? (
                      <span className="font-mono text-xs">{ticket.shipmentNumber}</span>
                    ) : (
                      <Ident value={ticket.shipmentId} />
                    ),
                },
                {
                  label: 'Closed',
                  value: ticket.resolvedAt === null ? <Dash /> : formatDateTime(ticket.resolvedAt),
                },
              ]}
            />

            {/*
              The description is NOT repeated here.

              It is the first thing the seller said, and the conversation
              below opens with exactly that message — so printing it in
              the facts card too showed the same sentence twice, a few
              centimetres apart, with nothing to say why. This card is
              for the facts ABOUT the ticket; what was said belongs in
              the thread, in order, with a time against it.
            */}
          </CardBody>
        </Card>
      </Section>

      {/*
        ONE thread, not a status log above a separate courier box. Our
        reply and the courier's answer are turns in the same exchange;
        filing them apart by origin is an ordering the reader has to
        undo. Status changes with no words stay out of it — "Open →
        Negotiating" is bookkeeping, and putting it in a chat makes the
        messages harder to find rather than the history clearer.
      */}
      <Section
        title="Conversation"
        subtitle="What you told us, what we found out, and anything the courier said."
      >
        <Card>
          <CardBody>
            <TicketConversation ticket={ticket} />
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}

/**
 * The money, said plainly.
 *
 * `resolvedAt` is the credit's timestamp because the wallet entry is
 * written in the resolution transaction — so "credited on" is a fact
 * here, not an approximation. The wallet entry id is shown for the same
 * reason it is stored: it is what makes a line in the ledger and this
 * ticket provably the same event.
 */
function RefundBanner({ ticket }: { readonly ticket: TicketView }): ReactElement {
  return (
    <Card className="mb-6">
      <CardBody>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-text-muted text-xs">Refunded to you</p>
            <Money
              amount={ticket.resolutionAmountInr ?? '0'}
              direction="credit"
              size="lg"
              className="mt-1 block"
            />
            <p className="text-text-body mt-2 text-sm">
              {ticket.resolvedAt === null
                ? 'Credited to your Skydrop wallet.'
                : `Credited to your Skydrop wallet on ${formatDateTime(ticket.resolvedAt)}.`}{' '}
              It is part of your balance now and goes out with your next withdrawal.
            </p>
            {ticket.resolutionWalletEntryId !== null && (
              <p className="text-text-faint mt-1 text-xs">
                Ledger entry <Ident value={ticket.resolutionWalletEntryId} />
              </p>
            )}
          </div>
          <Link
            href="/wallet"
            className="text-accent inline-flex items-center gap-1.5 text-sm hover:underline"
          >
            <Wallet size={14} />
            View it in your wallet
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}

function BackLink(): ReactElement {
  return (
    <Link
      href="/tickets"
      className="text-text-muted hover:text-text-bright mb-3 inline-flex items-center gap-1.5 text-xs"
    >
      <ArrowLeft size={13} />
      All tickets
    </Link>
  );
}

function DetailSkeleton(): ReactElement {
  return (
    <div>
      <BackLink />
      <div className="mb-6 space-y-2">
        <Skeleton className="h-6 w-2/3 max-w-sm" />
        <Skeleton className="h-3.5 w-1/3 max-w-[14rem]" />
      </div>
      <Card className="mb-6">
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-28" />
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <div className="space-y-3">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function Dash(): ReactElement {
  return <span className="text-text-faint">—</span>;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-IN');
}

function humanise(value: string): string {
  const lower = value.replaceAll('_', ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
