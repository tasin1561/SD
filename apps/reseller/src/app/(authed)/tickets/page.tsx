'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { ArrowRight, Plus } from 'lucide-react';
import { useStoreIdentity } from '@skydrop/auth/client';
import { ticketStatusKind, ticketStatusLabel } from '@skydrop/ui/status';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Tabs } from '@skydrop/ui/app/tabs';
import { buttonClassName } from '@skydrop/ui/app/button';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import { storeTicketKind } from '@/lib/ticket-kind';
import { useStoreTickets, type TicketStage } from '@/lib/ticket-hooks';
import './_components/tickets.css';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/** The tab id for "every stage" — a tab needs a non-empty id. */
const ALL_STAGES = 'ALL';

/** The stage filter, same words and same values as the select it replaced. */
const STAGES: ReadonlyArray<{ id: string; label: string }> = [
  { id: ALL_STAGES, label: 'All' },
  { id: 'OPEN', label: 'Open' },
  { id: 'REVIEWING', label: 'Being reviewed' },
  { id: 'CLOSED', label: 'Closed' },
];

/**
 * The store's two kinds of conversation about its own orders, in one
 * list: a DISPUTE with its seller (Skydrop referees; a settlement moves
 * money between their wallets), and an ISSUE raised with SKYDROP about
 * something in our hands, which the seller is not told about.
 *
 * They share a list because they are worked as one thread each and both
 * hang off an order — but the "With" column is not decoration: it is the
 * difference between arguing with your supplier and talking to your
 * logistics provider, and a person opening the wrong thread says the
 * wrong thing to the wrong company.
 */
export default function TicketsPage(): ReactElement {
  const me = useStoreIdentity();
  const [stage, setStage] = useState<TicketStage | ''>('');
  const tickets = useStoreTickets(stage === '' ? {} : { stage });
  const mayRaise = can(me, 'tickets.manage');

  return (
    <div className="rc-tkt-page">
      <PageHeader
        title="Tickets"
        subtitle="Problems with your orders — raised with your seller, or with Skydrop."
        action={
          mayRaise ? (
            <Link href="/tickets/new" className={buttonClassName('primary', 'md')}>
              <span className="sk-btn__fx" aria-hidden />
              <span className="sk-btn__icon" aria-hidden>
                <Plus size={15} />
              </span>
              <span className="sk-btn__label">Raise a ticket</span>
            </Link>
          ) : null
        }
      />
      <section className="rc-tkt-section">
        <Tabs
          label="Stage"
          size="sm"
          items={STAGES}
          value={stage === '' ? ALL_STAGES : stage}
          onChange={(id) => setStage(id === ALL_STAGES ? '' : (id as TicketStage))}
        />
        {tickets.isPending ? (
          <SkeletonRows rows={4} cols={5} label="Loading disputes" />
        ) : tickets.isError ? (
          <ErrorState message={serverVerdict(tickets.error)} retry={() => void tickets.refetch()} />
        ) : tickets.data.items.length === 0 ? (
          <EmptyState
            tone={stage === '' ? 'positive' : 'neutral'}
            title="No tickets"
            description={
              mayRaise
                ? 'Something wrong with one of your orders? Open it and raise a ticket from there — with your seller if it is about the goods or the price, with Skydrop if we damaged it, lost it or are sitting on it.'
                : 'Nothing has been raised with your seller or with Skydrop.'
            }
            action={
              <Link href="/orders" className={buttonClassName('secondary', 'sm')}>
                <span className="sk-btn__fx" aria-hidden />
                <span className="sk-btn__label">Go to your orders</span>
                <span className="sk-btn__icon sk-btn__icon--right" aria-hidden>
                  <ArrowRight size={14} />
                </span>
              </Link>
            }
          />
        ) : (
          <Table caption="Tickets">
            <THead>
              <Tr>
                <Th>Ticket</Th>
                <Th>With</Th>
                <Th>Order</Th>
                <Th>Status</Th>
                <Th>Opened</Th>
              </Tr>
            </THead>
            <TBody>
              {tickets.data.items.map((t) => (
                <Tr key={t.id}>
                  <Td>
                    <Link href={`/tickets/${t.id}`} className="rc-tkt-cell">
                      <span className="rc-tkt-number sk-ident">{t.ticketNumber}</span>
                      <span className="rc-tkt-subject">{t.subject}</span>
                    </Link>
                  </Td>
                  <Td>
                    <span className="rc-tkt-muted">{storeTicketKind(t.ticketType).label}</span>
                  </Td>
                  <Td>
                    <span className="rc-tkt-order sk-ident">{t.orderNumber ?? '—'}</span>
                  </Td>
                  <Td>
                    <StatusChip
                      kind={ticketStatusKind(t.status)}
                      label={ticketStatusLabel(t.status)}
                      size="sm"
                    />
                  </Td>
                  <Td>
                    <span className="rc-tkt-muted sk-figure">{when(t.createdAt)}</span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </div>
  );
}
