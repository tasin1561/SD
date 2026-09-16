'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { useStoreIdentity } from '@skydrop/auth/client';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Select,
  StatusBadge,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { ticketStatusKind, ticketStatusLabel } from '@skydrop/ui/status';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import { storeTicketKind } from '@/lib/ticket-kind';
import { useStoreTickets, type TicketStage } from '@/lib/ticket-hooks';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

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
    <div className="space-y-6">
      <PageHeader
        title="Tickets"
        subtitle="Problems with your orders — raised with your seller, or with Skydrop."
        action={
          mayRaise ? (
            <Link href="/tickets/new" className="text-accent text-sm hover:underline">
              Raise a ticket
            </Link>
          ) : null
        }
      />
      <div className="max-w-xs">
        <Select
          aria-label="Stage"
          value={stage}
          onChange={(e) => setStage(e.target.value as TicketStage | '')}
        >
          <option value="">All</option>
          <option value="OPEN">Open</option>
          <option value="REVIEWING">Being reviewed</option>
          <option value="CLOSED">Closed</option>
        </Select>
      </div>
      {tickets.isPending ? (
        <LoadingState label="Loading disputes" rows={4} />
      ) : tickets.isError ? (
        <ErrorState message={serverVerdict(tickets.error)} retry={() => void tickets.refetch()} />
      ) : tickets.data.items.length === 0 ? (
        <EmptyState
          title="No tickets"
          description={
            mayRaise
              ? 'Something wrong with one of your orders? Open it and raise a ticket from there — with your seller if it is about the goods or the price, with Skydrop if we damaged it, lost it or are sitting on it.'
              : 'Nothing has been raised with your seller or with Skydrop.'
          }
          action={
            <Link href="/orders" className="text-accent text-sm hover:underline">
              Go to your orders
            </Link>
          }
        />
      ) : (
        <Table>
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
                  <Link href={`/tickets/${t.id}`} className="hover:underline">
                    <span className="font-mono text-xs">{t.ticketNumber}</span>
                    <div>{t.subject}</div>
                  </Link>
                </Td>
                <Td className="text-text-muted text-xs">{storeTicketKind(t.ticketType).label}</Td>
                <Td className="font-mono text-xs">{t.orderNumber ?? '—'}</Td>
                <Td>
                  <StatusBadge
                    kind={ticketStatusKind(t.status)}
                    label={ticketStatusLabel(t.status)}
                  />
                </Td>
                <Td className="text-text-muted text-xs">{when(t.createdAt)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
