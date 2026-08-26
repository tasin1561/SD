'use client';

import type { ReactElement, ReactNode } from 'react';
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
import { TicketStatus, TicketType } from '@skydrop/db';
import type { TicketView } from '@/lib/ops-hooks';
import { useSellerTicket } from '@/lib/ticket-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { CourierThread } from './courier-thread';

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
                  value:
                    ticket.orderId === null ? (
                      <Dash />
                    ) : (
                      <Link
                        href={`/orders/${ticket.orderId}`}
                        className="text-accent hover:underline"
                      >
                        <Ident value={ticket.orderId} />
                      </Link>
                    ),
                },
                {
                  label: 'Parcel',
                  // A seller has no shipment page — parcels are shown on
                  // the order — so the id is evidence to quote at us, not
                  // a link to nowhere.
                  value:
                    ticket.shipmentId === null ? <Dash /> : <Ident value={ticket.shipmentId} />,
                },
                {
                  label: 'Closed',
                  value: ticket.resolvedAt === null ? <Dash /> : formatDateTime(ticket.resolvedAt),
                },
              ]}
            />

            {ticket.description !== null && ticket.description !== '' && (
              // Verbatim, as written when the ticket was raised — a
              // seller reading their own words back should recognise
              // them, and ours are the record of what we found.
              <p className="text-text-body bg-surface-raised border-border mt-4 rounded-[var(--radius-2)] border px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
                {ticket.description}
              </p>
            )}
          </CardBody>
        </Card>
      </Section>

      <Section
        title="What has happened"
        subtitle="Appended as the ticket moves. Nothing here is edited after the fact."
      >
        <Card>
          <CardBody>
            <Timeline ticket={ticket} />
          </CardBody>
        </Card>
      </Section>

      <Section
        title="Courier conversation"
        subtitle="Anything the courier says about this parcel, in their words."
      >
        <CourierThread ticketId={ticket.id} />
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

interface TimelineEntry {
  readonly key: string;
  readonly at: string | null;
  readonly title: string;
  readonly detail: ReactNode;
}

/**
 * The ticket's history.
 *
 * The append-only `ticket_events` rows are the real history, and today
 * they are readable only through `GET /admin/tickets/:ticketId/events`
 * — there is no seller-scoped read. Rather than show nothing, this is
 * derived from the ticket's own durable timestamps, which carry the two
 * moments a seller acts on: it was raised, and it was decided. When a
 * seller events endpoint lands, replace the body of this function with
 * the fetched rows; the surrounding shape does not change.
 *
 * An unresolved ticket ends on what happens NEXT rather than on
 * nothing — "no events yet" is a true statement that leaves the reader
 * exactly where they started.
 */
function Timeline({ ticket }: { readonly ticket: TicketView }): ReactElement {
  const raisedByUs = ticket.ticketType === TicketType.SCRAP_DAMAGE;

  const entries: TimelineEntry[] = [
    {
      key: 'opened',
      at: ticket.createdAt,
      title: 'Raised',
      detail: raisedByUs
        ? 'We opened this after inspecting a parcel that came back.'
        : 'You reported a problem with this parcel.',
    },
  ];

  if (ticket.resolvedAt === null) {
    entries.push({
      key: 'pending',
      at: null,
      title: ticket.status === TicketStatus.NEGOTIATING ? 'Under discussion' : 'With our team',
      detail:
        'We are working it out. The outcome appears here, and if it is a refund the money reaches your wallet at the same moment.',
    });
  } else {
    entries.push({
      key: 'resolved',
      at: ticket.resolvedAt,
      title: humanise(ticket.status),
      detail: (
        <>
          <p>{OUTCOME_COPY[ticket.status] ?? 'This ticket was closed.'}</p>
          {ticket.resolutionNotes !== null && ticket.resolutionNotes !== '' && (
            <p className="text-text-body mt-1 whitespace-pre-wrap">{ticket.resolutionNotes}</p>
          )}
        </>
      ),
    });
  }

  return (
    <ol className="border-border space-y-4 border-l pl-4">
      {entries.map((entry) => (
        <li key={entry.key} className="text-sm">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-text-strong font-medium">{entry.title}</span>
            {entry.at !== null && (
              <span className="text-text-faint text-xs">{formatDateTime(entry.at)}</span>
            )}
          </div>
          <div className="text-text-muted mt-0.5 text-xs leading-relaxed">{entry.detail}</div>
        </li>
      ))}
    </ol>
  );
}

/**
 * What each closing status MEANT for the seller, in their terms.
 *
 * Describes an outcome that already happened; it does not predict what
 * the server would allow (FE-2) — nothing on this page writes.
 */
const OUTCOME_COPY: Readonly<Partial<Record<TicketStatus, string>>> = {
  [TicketStatus.RESOLVED_REFUND]: 'We refunded you. The credit is in your wallet.',
  [TicketStatus.RESOLVED_RETURNED]: 'The goods went back to you. No money moved.',
  [TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED]:
    'The loss was accepted and the goods were written off. No money moved.',
  [TicketStatus.REJECTED]: 'The claim was not upheld. No money moved.',
};

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
