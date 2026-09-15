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
import { useStoreTickets, type TicketStage } from '@/lib/ticket-hooks';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * RS-7 — the store's disputes with its seller. Skydrop referees; a
 * settlement moves money between the store's wallet and the seller's.
 */
export default function TicketsPage(): ReactElement {
  const me = useStoreIdentity();
  const [stage, setStage] = useState<TicketStage | ''>('');
  const tickets = useStoreTickets(stage === '' ? {} : { stage });
  const mayRaise = can(me, 'tickets.manage');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Disputes"
        subtitle="Disagreements with the seller about your orders. Skydrop referees them."
        action={
          mayRaise ? (
            <Link href="/tickets/new" className="text-accent text-sm hover:underline">
              Raise a dispute
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
          title="No disputes"
          description={
            mayRaise
              ? 'Something wrong with an order the seller fulfilled? Open the order and raise a dispute from there.'
              : 'Nothing has been raised with the seller.'
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
              <Th>Dispute</Th>
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
