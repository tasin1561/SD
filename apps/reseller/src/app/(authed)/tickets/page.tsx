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
import type { MessageKey } from '@/i18n/catalog';
import { useLocale, useT } from '@/i18n/client';
import { formatDateTime } from '@/i18n/format';
import { verdict } from '@/i18n/verdict';
import { storeTicketKind } from '@/lib/ticket-kind';
import { useStoreTickets, type TicketStage } from '@/lib/ticket-hooks';
import './_components/tickets.css';

/** The tab id for "every stage" — a tab needs a non-empty id. */
const ALL_STAGES = 'ALL';

/** The stage filter, same words and same values as the select it replaced. */
const STAGES: ReadonlyArray<{ id: string; label: MessageKey }> = [
  { id: ALL_STAGES, label: 'tkt.stage.all' },
  { id: 'OPEN', label: 'tkt.stage.open' },
  { id: 'REVIEWING', label: 'tkt.stage.reviewing' },
  { id: 'CLOSED', label: 'tkt.stage.closed' },
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
  const tr = useT();
  const locale = useLocale();
  const me = useStoreIdentity();
  const [stage, setStage] = useState<TicketStage | ''>('');
  const tickets = useStoreTickets(stage === '' ? {} : { stage });
  const mayRaise = can(me, 'tickets.manage');

  return (
    <div className="rc-tkt-page">
      <PageHeader
        title={tr('tkt.title')}
        subtitle={tr('tkt.subtitle')}
        action={
          mayRaise ? (
            <Link href="/tickets/new" className={buttonClassName('primary', 'md')}>
              <span className="sk-btn__fx" aria-hidden />
              <span className="sk-btn__icon" aria-hidden>
                <Plus size={15} />
              </span>
              <span className="sk-btn__label">{tr('tkt.raise')}</span>
            </Link>
          ) : null
        }
      />
      <section className="rc-tkt-section">
        <Tabs
          label={tr('tkt.stage.label')}
          size="sm"
          items={STAGES.map((s) => ({ id: s.id, label: tr(s.label) }))}
          value={stage === '' ? ALL_STAGES : stage}
          onChange={(id) => setStage(id === ALL_STAGES ? '' : (id as TicketStage))}
        />
        {tickets.isPending ? (
          <SkeletonRows rows={4} cols={5} label={tr('tkt.loading')} />
        ) : tickets.isError ? (
          <ErrorState message={verdict(tickets.error, tr)} retry={() => void tickets.refetch()} />
        ) : tickets.data.items.length === 0 ? (
          <EmptyState
            tone={stage === '' ? 'positive' : 'neutral'}
            title={tr('tkt.empty.title')}
            description={mayRaise ? tr('tkt.empty.raise') : tr('tkt.empty.none')}
            action={
              <Link href="/orders" className={buttonClassName('secondary', 'sm')}>
                <span className="sk-btn__fx" aria-hidden />
                <span className="sk-btn__label">{tr('tkt.empty.go')}</span>
                <span className="sk-btn__icon sk-btn__icon--right" aria-hidden>
                  <ArrowRight size={14} />
                </span>
              </Link>
            }
          />
        ) : (
          <Table caption={tr('tkt.caption')}>
            <THead>
              <Tr>
                <Th>{tr('tkt.col.ticket')}</Th>
                <Th>{tr('tkt.col.with')}</Th>
                <Th>{tr('tkt.col.order')}</Th>
                <Th>{tr('tkt.col.status')}</Th>
                <Th>{tr('tkt.col.opened')}</Th>
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
                    <span className="rc-tkt-muted">{storeTicketKind(t.ticketType, tr).label}</span>
                  </Td>
                  <Td>
                    <span className="rc-tkt-order sk-ident">{t.orderNumber ?? '—'}</span>
                  </Td>
                  <Td>
                    <StatusChip
                      kind={ticketStatusKind(t.status)}
                      label={ticketStatusLabel(t.status, locale)}
                      size="sm"
                    />
                  </Td>
                  <Td>
                    <span className="rc-tkt-muted sk-figure">
                      {formatDateTime(t.createdAt, locale)}
                    </span>
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
