'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarClock, CircleDot, PackageSearch, Wallet } from 'lucide-react';
import {
  BandBody,
  Card,
  CardBody,
  Crumbs,
  DescriptionList,
  ErrorNote,
  Ident,
  IssueCategoryLine,
  MetaChip,
  Money,
  PageHeader,
  SectionBand,
  Skeleton,
  Stat,
  TicketStatusBadge,
} from '@skydrop/ui/components';
import type { TicketStatus } from '@skydrop/db';
import { ticketStatusLabel } from '@skydrop/ui/status';
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
  // Who opened it, as the server recorded it — not guessed from the type.
  const raisedByUs = ticket.openedBy !== 'SELLER';

  return (
    <div>
      <BackLink />

      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: 'Seller console' },
              { label: 'Support', href: '/tickets' },
              { label: ticket.ticketNumber },
            ]}
            Link={Link}
          />
        }
        // The NUMBER leads: it is what you quote to us about this ticket.
        title={
          <span className="min-w-0">
            <span className="font-mono">{ticket.ticketNumber}</span>
            <span className="text-text-muted"> · </span>
            {ticket.subject}
          </span>
        }
        subtitle={`${raisedByUs ? 'Raised by Skydrop' : 'Raised by you'} on ${formatDateTime(ticket.createdAt)}`}
        /*
          Standing facts about THIS ticket, under its number.

          The comp's chip row here carries an SLA clock, a "CCTV
          audited" seal and an escrow protocol. None of the three
          exists: nothing measures a triage SLA per ticket, there is no
          camera evidence store, and no money is held in escrow against
          a dispute. What IS real is what kind of issue it is and who
          the courier was, so that is what the row says.
        */
        meta={
          <>
            <MetaChip tone="accent">{humanise(ticket.ticketType)}</MetaChip>
            {ticket.courierCode !== null && <MetaChip>{ticket.courierCode}</MetaChip>}
            {raisedByUs && <MetaChip dot>Opened for you</MetaChip>}
          </>
        }
        action={<TicketStatusBadge status={ticket.status} />}
      />

      {/* ── Where this ticket has got to ────────────────────────────
             Four standing facts, on the shared `Stat`. Every one is a
             column on the ticket, not a derivation: a tile that needed
             arithmetic to exist would be a claim rather than a record.
             A refund reads "—" until it is paid, never ₹0 — nothing
             having been decided and nothing being owed look the same
             at a glance otherwise. */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Status"
          icon={<CircleDot size={13} aria-hidden />}
          /*
            `ticketStatusLabel`, NOT a local `humanise` of the enum.
            The badge beside this tile reads NEGOTIATING as "Reviewing";
            spelling the raw value put two different words for one
            status on the same screen, three centimetres apart, which
            reads as two different things having happened. The words
            live in `@skydrop/ui/status` (FE-6) — a second vocabulary
            here is the drift that rule exists to prevent.
          */
          value={<span className="text-base">{ticketStatusLabel(ticket.status)}</span>}
          tone={statTone(ticket.status)}
        />
        <Stat
          label="Refunded to you"
          icon={<Wallet size={13} aria-hidden />}
          value={
            ticket.resolutionAmountInr === null ? (
              <span className="text-text-faint">—</span>
            ) : (
              <Money amount={ticket.resolutionAmountInr} direction="credit" />
            )
          }
          tone={ticket.resolutionAmountInr === null ? 'neutral' : 'good'}
          hint={
            ticket.resolutionAmountInr === null
              ? 'Nothing credited yet.'
              : 'In your wallet balance.'
          }
        />
        <Stat
          label="Raised"
          icon={<CalendarClock size={13} aria-hidden />}
          value={<span className="text-base">{formatDate(ticket.createdAt)}</span>}
          tone="neutral"
          hint={
            ticket.resolvedAt === null ? 'Still open.' : `Closed ${formatDate(ticket.resolvedAt)}.`
          }
        />
        <Stat
          label="About"
          icon={<PackageSearch size={13} aria-hidden />}
          value={
            ticket.orderNumber !== null ? (
              <Link
                href={ticket.orderId === null ? '/orders' : `/orders/${ticket.orderId}`}
                className="text-accent font-mono text-base hover:underline"
              >
                {ticket.orderNumber}
              </Link>
            ) : ticket.receiptNumber !== null ? (
              <span className="font-mono text-base">{ticket.receiptNumber}</span>
            ) : (
              <span className="text-text-faint">—</span>
            )
          }
          tone="neutral"
          hint={
            ticket.orderNumber !== null
              ? 'The order this is about.'
              : ticket.receiptNumber !== null
                ? 'The goods receipt this is about.'
                : undefined
          }
        />
      </div>

      {ticket.resolutionAmountInr !== null && <RefundBanner ticket={ticket} />}

      <SectionBand index="01" title="Ticket" note="The facts we hold about it." />
      {/* No <Card> inside: `BandBody` IS the bordered surface the band
          caps, and nesting one drew a second border a hair inside the
          first. */}
      <BandBody className="mb-4">
        <DescriptionList
          columns={3}
          items={[
            {
              label: 'Type',
              // Who is asking, then what about. The category the
              // seller picked is the fastest thing on the page for
              // recognising their own ticket in a list of four.
              value: (
                <span className="block">
                  {humanise(ticket.ticketType)}
                  <IssueCategoryLine
                    categoryLabel={ticket.issueCategoryLabel}
                    subcategoryLabel={ticket.issueSubcategoryLabel}
                  />
                </span>
              ),
            },
            { label: 'Status', value: <TicketStatusBadge status={ticket.status} /> },
            { label: 'Courier', value: ticket.courierCode ?? <Dash /> },
            ...(ticket.receiptNumber == null
              ? []
              : [
                  {
                    // A short count at the warehouse (TKT-3): the
                    // receipt and the consignment it belongs to.
                    label: 'Goods receipt',
                    value: (
                      <span className="font-mono text-xs">
                        {ticket.receiptNumber}
                        {ticket.consignmentNumber == null ? '' : ` · ${ticket.consignmentNumber}`}
                      </span>
                    ),
                  },
                ]),
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
      </BandBody>

      {/*
        ONE thread, not a status log above a separate courier box. Our
        reply and the courier's answer are turns in the same exchange;
        filing them apart by origin is an ordering the reader has to
        undo. Status changes with no words stay out of it — "Open →
        Negotiating" is bookkeeping, and putting it in a chat makes the
        messages harder to find rather than the history clearer.
      */}
      <SectionBand
        index="02"
        title="Conversation"
        note="What you told us, what we found out, and anything the courier said."
      />
      <BandBody>
        <TicketConversation ticket={ticket} />
      </BandBody>
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

/** Day and month only — a tile is a glance, not a timestamp. */
function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * The tone of the STATUS tile.
 *
 * EXHAUSTIVE over `TicketStatus` (the F2 discipline): the `never`
 * assignment means a new value fails to COMPILE until somebody decides
 * whether it reads as settled or as still-being-argued. The first cut
 * of this function was written from memory and invented three statuses
 * that do not exist (`RESOLVED_REPLACEMENT`, `RESOLVED_NO_ACTION`,
 * `CLOSED`) while missing two that do — a `string` parameter let all
 * five through silently and defaulted the real ones to neutral.
 *
 * Deliberately NOT a reach into `ticketStatusKind`, which answers a
 * different question — what colour a BADGE is. A tile has four tones,
 * and the distinction worth drawing here is "finished" versus "still
 * open", which is what a seller is scanning the page for.
 */
function statTone(status: TicketStatus): 'neutral' | 'warn' | 'bad' | 'good' {
  switch (status) {
    case 'RESOLVED_REFUND':
    case 'RESOLVED_RETURNED':
      return 'good';
    // Settled, but not in the seller's favour — the goods are gone and
    // nothing is coming back. Neutral rather than green: it is closed,
    // and calling it good would be our word for somebody else's loss.
    case 'RESOLVED_WRITE_OFF_ACCEPTED':
      return 'neutral';
    case 'REJECTED':
      return 'bad';
    case 'OPEN':
    case 'NEGOTIATING':
      return 'warn';
    // The courier shut their side and we have NOT decided an outcome,
    // so from the seller's view this is still open.
    case 'CLOSED_BY_COURIER':
      return 'warn';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function humanise(value: string): string {
  const lower = value.replaceAll('_', ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
