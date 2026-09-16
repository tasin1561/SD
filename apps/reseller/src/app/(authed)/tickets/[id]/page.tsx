'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent, type ReactElement } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { ActorType } from '@skydrop/db';
import { useStoreIdentity } from '@skydrop/auth/client';
import {
  Button,
  Card,
  CardBody,
  ErrorState,
  LoadingState,
  Money,
  PageHeader,
  Section,
  StatusBadge,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
import { ticketStatusKind, ticketStatusLabel } from '@skydrop/ui/status';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import { storeTicketKind } from '@/lib/ticket-kind';
import {
  useReplyStoreTicket,
  useStoreTicket,
  useStoreTicketEvents,
  type StoreTicketView,
} from '@/lib/ticket-hooks';

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

/** RS-7 — one of this store's disputes: what was said, and how it ended. */
export default function TicketPage(): ReactElement {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const ticket = useStoreTicket(id);
  return (
    <div className="space-y-6">
      <Link
        href="/tickets"
        className="text-text-muted hover:text-text-body inline-flex items-center gap-1.5 text-xs"
      >
        <ArrowLeft size={12} /> Tickets
      </Link>
      {ticket.isPending ? (
        <LoadingState label="Loading the ticket" rows={4} />
      ) : ticket.isError ? (
        <ErrorState message={serverVerdict(ticket.error)} retry={() => void ticket.refetch()} />
      ) : (
        <TicketBody t={ticket.data} />
      )}
    </div>
  );
}

function Outcome({ t }: { t: StoreTicketView }): ReactElement | null {
  if (t.resolvedAt === null) return null;
  const amount = t.resolutionAmountInr;
  return (
    <Card>
      <CardBody>
        <p className="text-sm">
          {t.disputePayer === 'STORE' && amount !== null ? (
            <>
              Settled: you paid the seller <Money amount={amount} convert={false} />, taken from
              your wallet.
            </>
          ) : t.disputePayer === 'SELLER' && amount !== null ? (
            <>
              Settled: the seller paid you <Money amount={amount} convert={false} />, credited to
              your wallet.
            </>
          ) : (
            <>Closed {when(t.resolvedAt)}.</>
          )}
        </p>
        {t.resolutionNotes !== null ? (
          <p className="text-text-muted mt-2 text-sm">Skydrop’s note: {t.resolutionNotes}</p>
        ) : null}
      </CardBody>
    </Card>
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

  async function send(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      await reply.mutateAsync({ note });
      setNote('');
      toast.success('Reply sent.');
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <>
      <PageHeader
        title={t.subject}
        subtitle={
          <span>
            <span className="font-mono">{t.ticketNumber}</span>
            {t.orderId !== null ? (
              <>
                {' · order '}
                <Link href={`/orders/${t.orderId}`} className="font-mono hover:underline">
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
          <StatusBadge kind={ticketStatusKind(t.status)} label={ticketStatusLabel(t.status)} />
        }
      />
      <Outcome t={t} />
      <Section title="Conversation">
        {t.description !== null ? (
          <p className="mb-3 text-sm whitespace-pre-wrap">{t.description}</p>
        ) : null}
        {events.isPending ? (
          <LoadingState label="Loading the conversation" rows={3} />
        ) : events.isError ? (
          <ErrorState message={serverVerdict(events.error)} retry={() => void events.refetch()} />
        ) : (
          <ol className="space-y-3">
            {events.data
              .filter((e) => e.note !== null && e.note !== 'Ticket opened')
              .map((e) => (
                <li key={e.id} className={e.actorType === 'STORE' ? 'ml-8 text-right' : 'mr-8'}>
                  <div className="text-text-muted text-xs">
                    {who(e.actorType)} · {when(e.at)}
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{e.note}</div>
                </li>
              ))}
          </ol>
        )}
      </Section>
      {open && can(me, 'tickets.manage') ? (
        <form onSubmit={(e) => void send(e)} className="space-y-2">
          <Textarea
            aria-label="Your reply"
            placeholder="Your reply"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={4000}
          />
          {error !== null ? (
            <p role="alert" className="text-critical text-sm">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={reply.isPending || note.trim() === ''}>
            Send
          </Button>
        </form>
      ) : null}
    </>
  );
}
