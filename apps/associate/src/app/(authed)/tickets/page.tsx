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
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import { useMyTickets, type TicketStage } from '@/lib/ticket-hooks';
import { LinkButton } from '../_components/parts';
import '../_components/as.css';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/** The tab id for "every stage" — a tab needs a non-empty id. */
const ALL_STAGES = 'ALL';

const STAGES: ReadonlyArray<{ id: string; label: string }> = [
  { id: ALL_STAGES, label: 'All' },
  { id: 'OPEN', label: 'Open' },
  { id: 'REVIEWING', label: 'Being looked at' },
  { id: 'CLOSED', label: 'Closed' },
];

/**
 * ASSOC-1 capability 5 — the issues this person has raised about their
 * own orders, and what has been said back. Narrowed by the same order
 * scope as the orders themselves.
 */
export default function TicketsPage(): ReactElement {
  const me = useStoreIdentity();
  const [stage, setStage] = useState<TicketStage | ''>('');
  const tickets = useMyTickets(stage === '' ? {} : { stage });
  const mayRaise = can(me, 'tickets.manage');

  return (
    <div className="as-page">
      <PageHeader
        title="Issues"
        subtitle="Something wrong with one of your orders? Raise it here and follow what is said back."
        action={
          mayRaise ? (
            <LinkButton href="/tickets/new" variant="primary" icon={<Plus size={15} />}>
              Raise an issue
            </LinkButton>
          ) : undefined
        }
      />
      <section className="as-section">
        <Tabs
          label="Stage"
          size="sm"
          items={STAGES}
          value={stage === '' ? ALL_STAGES : stage}
          onChange={(id) => setStage(id === ALL_STAGES ? '' : (id as TicketStage))}
        />
        {tickets.isPending ? (
          <SkeletonRows rows={4} cols={4} label="Loading issues" />
        ) : tickets.isError ? (
          <ErrorState message={serverVerdict(tickets.error)} retry={() => void tickets.refetch()} />
        ) : tickets.data.items.length === 0 ? (
          <EmptyState
            tone={stage === '' ? 'positive' : 'neutral'}
            title="Nothing raised"
            description={
              mayRaise
                ? 'Open one of your orders and raise an issue from there — damaged, lost, late, or anything else that needs somebody to look.'
                : 'Nothing has been raised about your orders.'
            }
            action={
              <LinkButton href="/orders" variant="secondary" size="sm">
                Go to my orders <ArrowRight size={14} aria-hidden />
              </LinkButton>
            }
          />
        ) : (
          <div className="as-card" data-flush="1">
            <Table caption="Issues">
              <THead>
                <Tr>
                  <Th>Issue</Th>
                  <Th>Order</Th>
                  <Th>Status</Th>
                  <Th>Raised</Th>
                </Tr>
              </THead>
              <TBody>
                {tickets.data.items.map((t) => (
                  <Tr key={t.id}>
                    <Td>
                      <Link href={`/tickets/${t.id}`} className="as-link sk-ident">
                        {t.ticketNumber}
                      </Link>
                      <span className="as-sub">{t.subject}</span>
                    </Td>
                    <Td>
                      <span className="sk-ident">{t.orderNumber ?? '—'}</span>
                    </Td>
                    <Td>
                      <StatusChip
                        kind={ticketStatusKind(t.status)}
                        label={ticketStatusLabel(t.status)}
                        size="sm"
                      />
                    </Td>
                    <Td>
                      <span className="as-muted sk-figure">{when(t.createdAt)}</span>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
