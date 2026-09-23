'use client';

import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarClock, CircleDot, PackageSearch, Wallet } from 'lucide-react';
import { Ident, IssueCategoryLine, Money } from '@skydrop/ui/components';
import type { TicketStatus } from '@skydrop/db';
import { ticketStatusKind, ticketStatusLabel } from '@skydrop/ui/status';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { KpiCard, type KpiTone } from '@skydrop/ui/app/kpi-card';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import type { TicketView } from '@/lib/ops-hooks';
import { useSellerTicket } from '@/lib/ticket-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { TicketConversation } from './ticket-conversation';
import './tickets.css';

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
      <div className="tkt-page">
        <div>
          <BackLink />
          <PageHeader title="Ticket" />
        </div>
        <div className="tkt-card">
          {/* FE-2 — the server's verdict verbatim. A wrong id and
              another seller's ticket both come back TICKET_NOT_FOUND,
              which is the whole message worth showing. */}
          <ErrorState
            message={serverVerdict(query.error, 'Could not load this ticket.')}
            retry={() => void query.refetch()}
          />
          <p className="tkt-help">
            If this ticket was raised from another account in your company, ask them to open it —
            tickets are scoped to the seller they belong to.
          </p>
        </div>
      </div>
    );
  }

  const ticket = query.data;
  // Who opened it, as the server recorded it — not guessed from the type.
  const raisedByUs = ticket.openedBy !== 'SELLER';

  return (
    <div className="tkt-page">
      <div>
        <BackLink />

        <PageHeader
          breadcrumbs={[
            { label: 'Seller console' },
            { label: 'Support', href: '/tickets' },
            { label: ticket.ticketNumber },
          ]}
          Link={Link}
          // The NUMBER leads: it is what you quote to us about this ticket.
          title={
            <span className="tkt-title">
              <span className="sk-ident">{ticket.ticketNumber}</span>
              <span className="tkt-title__sep"> · </span>
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
            <span className="tkt-meta">
              <Fact tone="accent">{humanise(ticket.ticketType)}</Fact>
              {ticket.courierCode !== null && <Fact>{ticket.courierCode}</Fact>}
              {raisedByUs && <Fact dot>Opened for you</Fact>}
            </span>
          }
          action={
            <StatusChip
              kind={ticketStatusKind(ticket.status)}
              label={ticketStatusLabel(ticket.status)}
            />
          }
        />
      </div>

      {/* ── Where this ticket has got to ────────────────────────────
             Four standing facts. Every one is a column on the ticket,
             not a derivation: a tile that needed arithmetic to exist
             would be a claim rather than a record. A refund reads "—"
             until it is paid, never ₹0 — nothing having been decided
             and nothing being owed look the same at a glance otherwise. */}
      <div className="tkt-kpis">
        <KpiCard
          label="Status"
          icon={<CircleDot size={14} />}
          /*
            `ticketStatusLabel`, NOT a local `humanise` of the enum.
            The chip beside this tile reads NEGOTIATING as "Reviewing";
            spelling the raw value put two different words for one
            status on the same screen, three centimetres apart, which
            reads as two different things having happened. The words
            live in `@skydrop/ui/status` (FE-6) — a second vocabulary
            here is the drift that rule exists to prevent.
          */
          figure={<span className="tkt-tile-text">{ticketStatusLabel(ticket.status)}</span>}
          tone={kpiTone(statTone(ticket.status))}
        />
        <KpiCard
          label="Refunded to you"
          icon={<Wallet size={14} />}
          figure={
            ticket.resolutionAmountInr === null ? (
              <span className="tkt-faint">—</span>
            ) : (
              <Money amount={ticket.resolutionAmountInr} direction="credit" />
            )
          }
          tone={ticket.resolutionAmountInr === null ? 'neutral' : 'credit'}
          hint={
            ticket.resolutionAmountInr === null
              ? 'Nothing credited yet.'
              : 'In your wallet balance.'
          }
        />
        <KpiCard
          label="Raised"
          icon={<CalendarClock size={14} />}
          figure={<span className="tkt-tile-text">{formatDate(ticket.createdAt)}</span>}
          tone="neutral"
          hint={
            ticket.resolvedAt === null ? 'Still open.' : `Closed ${formatDate(ticket.resolvedAt)}.`
          }
        />
        <KpiCard
          label="About"
          icon={<PackageSearch size={14} />}
          figure={
            ticket.orderNumber !== null ? (
              <Link
                href={ticket.orderId === null ? '/orders' : `/orders/${ticket.orderId}`}
                className="tkt-tile-link sk-ident"
              >
                {ticket.orderNumber}
              </Link>
            ) : ticket.receiptNumber !== null ? (
              <span className="tkt-tile-text sk-ident">{ticket.receiptNumber}</span>
            ) : (
              <span className="tkt-faint">—</span>
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

      <section className="tkt-section">
        <SectionHeading title="Ticket" note="The facts we hold about it." />
        <div className="tkt-card">
          <dl className="tkt-facts">
            <FactItem label="Type">
              {/* Who is asking, then what about. The category the
                  seller picked is the fastest thing on the page for
                  recognising their own ticket in a list of four. */}
              <span className="tkt-type">
                {humanise(ticket.ticketType)}
                <IssueCategoryLine
                  categoryLabel={ticket.issueCategoryLabel}
                  subcategoryLabel={ticket.issueSubcategoryLabel}
                />
              </span>
            </FactItem>
            <FactItem label="Status">
              <StatusChip
                kind={ticketStatusKind(ticket.status)}
                label={ticketStatusLabel(ticket.status)}
                size="sm"
              />
            </FactItem>
            <FactItem label="Courier">{ticket.courierCode ?? <Dash />}</FactItem>
            {ticket.receiptNumber == null ? null : (
              // A short count at the warehouse (TKT-3): the receipt and
              // the consignment it belongs to.
              <FactItem label="Goods receipt">
                <span className="tkt-small sk-ident">
                  {ticket.receiptNumber}
                  {ticket.consignmentNumber == null ? '' : ` · ${ticket.consignmentNumber}`}
                </span>
              </FactItem>
            )}
            <FactItem label="Order">
              {/* The NUMBER, not the uuid. A uuid cannot be read aloud,
                  repeated down a phone, or matched against the order
                  list; the id is still what the link uses. */}
              {ticket.orderId === null ? (
                <Dash />
              ) : (
                <Link href={`/orders/${ticket.orderId}`} className="tkt-tile-link sk-ident">
                  {ticket.orderNumber ?? <Ident value={ticket.orderId} />}
                </Link>
              )}
            </FactItem>
            <FactItem label="Parcel">
              {/* A seller has no shipment page — parcels are shown on the
                  order — so the id is evidence to quote at us, not a link
                  to nowhere. */}
              {ticket.shipmentId === null ? (
                <Dash />
              ) : ticket.shipmentNumber !== null ? (
                <span className="tkt-small sk-ident">{ticket.shipmentNumber}</span>
              ) : (
                <Ident value={ticket.shipmentId} />
              )}
            </FactItem>
            <FactItem label="Closed">
              {ticket.resolvedAt === null ? <Dash /> : formatDateTime(ticket.resolvedAt)}
            </FactItem>
          </dl>

          {/*
            The description is NOT repeated here.

            It is the first thing the seller said, and the conversation
            below opens with exactly that message — so printing it in the
            facts card too showed the same sentence twice, a few
            centimetres apart, with nothing to say why. This card is for
            the facts ABOUT the ticket; what was said belongs in the
            thread, in order, with a time against it.
          */}
        </div>
      </section>

      {/*
        ONE thread, not a status log above a separate courier box. Our
        reply and the courier's answer are turns in the same exchange;
        filing them apart by origin is an ordering the reader has to
        undo. Status changes with no words stay out of it — "Open →
        Negotiating" is bookkeeping, and putting it in a chat makes the
        messages harder to find rather than the history clearer.
      */}
      <section className="tkt-section">
        <SectionHeading
          title="Conversation"
          note="What you told us, what we found out, and anything the courier said."
        />
        <div className="tkt-card">
          <TicketConversation ticket={ticket} />
        </div>
      </section>
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
    <div className="tkt-refund">
      <div>
        <p className="tkt-refund__label">Refunded to you</p>
        <Money
          amount={ticket.resolutionAmountInr ?? '0'}
          direction="credit"
          size="lg"
          className="tkt-refund__figure"
        />
        <p className="tkt-refund__body">
          {ticket.resolvedAt === null
            ? 'Credited to your Skydrop wallet.'
            : `Credited to your Skydrop wallet on ${formatDateTime(ticket.resolvedAt)}.`}{' '}
          It is part of your balance now and goes out with your next withdrawal.
        </p>
        {ticket.resolutionWalletEntryId !== null && (
          <p className="tkt-refund__entry">
            Ledger entry <Ident value={ticket.resolutionWalletEntryId} />
          </p>
        )}
      </div>
      <Link href="/wallet" className="tkt-refund__link">
        <Wallet size={14} aria-hidden />
        View it in your wallet
      </Link>
    </div>
  );
}

function BackLink(): ReactElement {
  return (
    <Link href="/tickets" className="tkt-back">
      <ArrowLeft size={13} aria-hidden />
      All tickets
    </Link>
  );
}

function DetailSkeleton(): ReactElement {
  return (
    <div className="tkt-page" aria-busy="true">
      <div>
        <BackLink />
        <div className="tkt-skel__head">
          <Skeleton height={24} width="66%" />
          <Skeleton height={14} width="33%" />
        </div>
      </div>
      <div className="tkt-card">
        <div className="tkt-skel__grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="tkt-skel__cell">
              <Skeleton height={12} width={64} />
              <Skeleton height={16} width={112} />
            </div>
          ))}
        </div>
      </div>
      <div className="tkt-card">
        <Skeleton height={16} width="50%" />
        <Skeleton height={16} width="66%" />
      </div>
    </div>
  );
}

function Dash(): ReactElement {
  return <span className="tkt-faint">—</span>;
}

/** A standing fact under the page title — never an action. */
function Fact({
  tone,
  dot = false,
  children,
}: {
  readonly tone?: 'accent' | undefined;
  readonly dot?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span className="tkt-fact" data-tone={tone}>
      {dot && <span className="tkt-fact__dot" aria-hidden />}
      {children}
    </span>
  );
}

/** One label/value pair in the ticket's facts. */
function FactItem({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="tkt-facts__item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The status tile's tone, in the KPI card's vocabulary. */
function kpiTone(tone: 'neutral' | 'warn' | 'bad' | 'good'): KpiTone {
  switch (tone) {
    case 'good':
      return 'credit';
    case 'warn':
      return 'pending';
    case 'bad':
      return 'debit';
    case 'neutral':
      return 'neutral';
    default: {
      const exhaustive: never = tone;
      return exhaustive;
    }
  }
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
