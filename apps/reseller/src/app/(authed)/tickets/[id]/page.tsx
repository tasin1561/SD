'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import { Send } from 'lucide-react';
import type { ActorType } from '@skydrop/db';
import { useStoreIdentity } from '@skydrop/auth/client';
import { Money } from '@skydrop/ui/components';
import { ticketStatusKind, ticketStatusLabel } from '@skydrop/ui/status';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { PaperPlaneSendButton } from '@skydrop/ui/app/paper-plane-send';
import { TextArea } from '@skydrop/ui/app/text-field';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import { storeTicketKind } from '@/lib/ticket-kind';
import {
  useReplyStoreTicket,
  useStoreTicket,
  useStoreTicketEvents,
  type StoreTicketView,
} from '@/lib/ticket-hooks';
import '../_components/tickets.css';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function who(actor: ActorType): string {
  switch (actor) {
    case 'STORE':
      return 'You';
    case 'SELLER':
    case 'API':
      return 'The seller';
    default:
      return 'Skydrop';
  }
}

const CRUMBS = [{ label: 'Tickets', href: '/tickets' }, { label: 'Ticket' }] as const;

/** RS-7 — one of this store's disputes: what was said, and how it ended. */
export default function TicketPage(): ReactElement {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const ticket = useStoreTicket(id);
  return (
    <div className="rc-tkt-page">
      {ticket.isPending ? (
        <>
          <PageHeader breadcrumbs={CRUMBS} Link={Link} title="Ticket" />
          <SkeletonRows rows={4} cols={2} label="Loading the ticket" />
        </>
      ) : ticket.isError ? (
        <>
          <PageHeader breadcrumbs={CRUMBS} Link={Link} title="Ticket" />
          <ErrorState message={serverVerdict(ticket.error)} retry={() => void ticket.refetch()} />
        </>
      ) : (
        <TicketBody t={ticket.data} />
      )}
    </div>
  );
}

function Outcome({ t }: { t: StoreTicketView }): ReactElement | null {
  if (t.resolvedAt === null) return null;
  const amount = t.resolutionAmountInr;
  const settled = (t.disputePayer === 'STORE' || t.disputePayer === 'SELLER') && amount !== null;
  return (
    <div className="rc-tkt-card" data-tone={settled ? 'settled' : undefined}>
      <p>
        {t.disputePayer === 'STORE' && amount !== null ? (
          <>
            Settled: you paid the seller <Money amount={amount} convert={false} />, taken from your
            wallet.
          </>
        ) : t.disputePayer === 'SELLER' && amount !== null ? (
          <>
            Settled: the seller paid you <Money amount={amount} convert={false} />, credited to your
            wallet.
          </>
        ) : (
          <>Closed {when(t.resolvedAt)}.</>
        )}
      </p>
      {t.resolutionNotes !== null ? (
        <p className="rc-tkt-card__note">Skydrop’s note: {t.resolutionNotes}</p>
      ) : null}
    </div>
  );
}

/**
 * RS-7 (2026-09-19) — a "correct the figures" dispute: what is being
 * claimed, and the money AS IT STOOD when it was raised.
 *
 * The snapshot is shown rather than a live read on purpose. The ledger
 * keeps moving — a later payout, a courier cost, a refund — so "the
 * figures we were arguing about" and "the figures now" are different
 * questions, and only the first one explains what was asked for.
 */
function Correction({ t }: { t: StoreTicketView }): ReactElement | null {
  if (t.disputeKind !== 'FIGURE_CORRECTION') return null;
  const f = t.disputedFigures;
  return (
    <section className="rc-tkt-section">
      <SectionHeading
        title="The figures"
        note="What was claimed, and what the order’s money looked like when this was raised."
      />
      <div className="rc-tkt-card">
        {t.disputeClaimAmountInr !== null ? (
          <p>
            Claimed: <Money amount={t.disputeClaimAmountInr} convert={false} />{' '}
            <span className="rc-tkt-card__aside">
              {t.disputeClaimPayer === 'STORE' ? '— we owe the seller' : '— the seller owes us'}
            </span>
          </p>
        ) : null}
        {f === null ? (
          <p className="rc-tkt-card__note">No figures were recorded with this one.</p>
        ) : (
          <>
            <p className="rc-tkt-card__as-at">
              As at {when(f.capturedAt)} · order <span className="sk-ident">{f.orderNumber}</span> ·{' '}
              {f.paymentMode}
              {f.codInr === null ? null : (
                <>
                  {' · COD '}
                  <Money amount={f.codInr} convert={false} />
                </>
              )}
            </p>
            {f.parties.map((p) => (
              <p key={p.party}>
                {p.party === 'STORE' ? 'Us' : 'The seller'}: net{' '}
                <Money amount={p.netInr} convert={false} />{' '}
                <span className="rc-tkt-card__aside">({p.status.toLowerCase()})</span>
              </p>
            ))}
          </>
        )}
      </div>
    </section>
  );
}

function TicketBody({ t }: { t: StoreTicketView }): ReactElement {
  const me = useStoreIdentity();
  const events = useStoreTicketEvents(t.id);
  const reply = useReplyStoreTicket(t.id);
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const open = t.resolvedAt === null;

  /**
   * The real request. It rejects after showing the server's verdict, so
   * the send button shows the failure it really had and the paper plane
   * flies only after a real success.
   */
  async function send(): Promise<void> {
    setError(null);
    try {
      await reply.mutateAsync({ note });
      setNote('');
      toast.success('Reply sent.');
    } catch (err) {
      setError(serverVerdict(err));
      throw err;
    }
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Tickets', href: '/tickets' }, { label: t.ticketNumber }]}
        Link={Link}
        title={t.subject}
        subtitle={
          <span className="rc-tkt-sub">
            <span className="sk-ident">{t.ticketNumber}</span>
            {t.orderId !== null ? (
              <>
                {' · order '}
                <Link href={`/orders/${t.orderId}`} className="sk-ident">
                  {t.orderNumber ?? t.orderId}
                </Link>
              </>
            ) : null}
            {' · opened '}
            {when(t.createdAt)}
            {/* WHO is on the other end. Said on the thread itself and not
                only in the list: somebody arriving from a link has not
                seen the list, and what they write next depends on it. */}
            {' · with '}
            {storeTicketKind(t.ticketType).counterparty}
          </span>
        }
        action={
          <StatusChip kind={ticketStatusKind(t.status)} label={ticketStatusLabel(t.status)} />
        }
      />
      <Outcome t={t} />
      <Correction t={t} />
      <section className="rc-tkt-section">
        <SectionHeading title="Conversation" />
        {t.description !== null ? <p className="rc-tkt-opening">{t.description}</p> : null}
        {events.isPending ? (
          <SkeletonRows rows={3} cols={1} label="Loading the conversation" />
        ) : events.isError ? (
          <ErrorState message={serverVerdict(events.error)} retry={() => void events.refetch()} />
        ) : (
          <ol className="rc-tkt-thread">
            {events.data
              .filter((e) => e.note !== null && e.note !== 'Ticket opened')
              .map((e) => {
                const mine = e.actorType === 'STORE';
                return (
                  <li key={e.id} className="rc-tkt-thread__row" data-mine={mine ? '1' : undefined}>
                    <div className="rc-tkt-bubble">
                      <p className="rc-tkt-bubble__who">
                        {who(e.actorType)} · <span className="sk-figure">{when(e.at)}</span>
                      </p>
                      <div className="rc-tkt-bubble__text">{e.note}</div>
                    </div>
                  </li>
                );
              })}
          </ol>
        )}
        {open && can(me, 'tickets.manage') ? (
          <div className="rc-tkt-reply">
            <TextArea
              label="Your reply"
              placeholder="Your reply"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={4000}
              // Display only: the server's limit on a note (AddTicketNoteDto,
              // 2000). The field's own 4000 cap is unchanged.
              countMax={2000}
            />
            {error !== null ? (
              <p role="alert" className="rc-tkt-error">
                {error}
              </p>
            ) : null}
            <div className="rc-tkt-reply__actions">
              <PaperPlaneSendButton
                label="Send"
                busyLabel="Sending…"
                doneLabel="Sent"
                errorLabel="Not sent"
                size="sm"
                icon={<Send size={14} />}
                disabled={reply.isPending || note.trim() === ''}
                onAction={send}
              />
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
