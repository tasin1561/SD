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
import { useLocale, useT } from '@/i18n/client';
import { formatDateTime } from '@/i18n/format';
import { can } from '@/lib/page-access';
import { verdict } from '@/i18n/verdict';
import { useMyTickets, type TicketStage } from '@/lib/ticket-hooks';
import { LinkButton } from '../_components/parts';
import '../_components/as.css';

/** The tab id for "every stage" — a tab needs a non-empty id. */
const ALL_STAGES = 'ALL';

/**
 * ASSOC-1 capability 5 — the issues this person has raised about their
 * own orders, and what has been said back. Narrowed by the same order
 * scope as the orders themselves.
 */
export default function TicketsPage(): ReactElement {
  const t = useT();
  const locale = useLocale();
  const stages: ReadonlyArray<{ id: string; label: string }> = [
    { id: ALL_STAGES, label: t('tickets.stage.all') },
    { id: 'OPEN', label: t('tickets.stage.open') },
    { id: 'REVIEWING', label: t('tickets.stage.reviewing') },
    { id: 'CLOSED', label: t('tickets.stage.closed') },
  ];
  const me = useStoreIdentity();
  const [stage, setStage] = useState<TicketStage | ''>('');
  const tickets = useMyTickets(stage === '' ? {} : { stage });
  const mayRaise = can(me, 'tickets.manage');

  return (
    <div className="as-page">
      <PageHeader
        title={t('tickets.title')}
        subtitle={t('tickets.subtitle')}
        action={
          mayRaise ? (
            <LinkButton href="/tickets/new" variant="primary" icon={<Plus size={15} />}>
              {t('tickets.raise')}
            </LinkButton>
          ) : undefined
        }
      />
      <section className="as-section">
        <Tabs
          label={t('tickets.stage')}
          size="sm"
          items={stages}
          value={stage === '' ? ALL_STAGES : stage}
          onChange={(id) => setStage(id === ALL_STAGES ? '' : (id as TicketStage))}
        />
        {tickets.isPending ? (
          <SkeletonRows rows={4} cols={4} label={t('tickets.loading')} />
        ) : tickets.isError ? (
          <ErrorState message={verdict(tickets.error, t)} retry={() => void tickets.refetch()} />
        ) : tickets.data.items.length === 0 ? (
          <EmptyState
            tone={stage === '' ? 'positive' : 'neutral'}
            title={t('tickets.empty.title')}
            description={mayRaise ? t('tickets.empty.mayRaise') : t('tickets.empty.cannotRaise')}
            action={
              <LinkButton href="/orders" variant="secondary" size="sm">
                {t('tickets.goOrders')} <ArrowRight size={14} aria-hidden />
              </LinkButton>
            }
          />
        ) : (
          <div className="as-card" data-flush="1">
            <Table caption={t('tickets.table.caption')}>
              <THead>
                <Tr>
                  <Th>{t('tickets.col.issue')}</Th>
                  <Th>{t('tickets.col.order')}</Th>
                  <Th>{t('tickets.col.status')}</Th>
                  <Th>{t('tickets.col.raised')}</Th>
                </Tr>
              </THead>
              <TBody>
                {tickets.data.items.map((tk) => (
                  <Tr key={tk.id}>
                    <Td>
                      <Link href={`/tickets/${tk.id}`} className="as-link sk-ident">
                        {tk.ticketNumber}
                      </Link>
                      <span className="as-sub">{tk.subject}</span>
                    </Td>
                    <Td>
                      <span className="sk-ident">{tk.orderNumber ?? '—'}</span>
                    </Td>
                    <Td>
                      <StatusChip
                        kind={ticketStatusKind(tk.status)}
                        label={ticketStatusLabel(tk.status, locale)}
                        size="sm"
                      />
                    </Td>
                    <Td>
                      <span className="as-muted sk-figure">
                        {formatDateTime(tk.createdAt, locale)}
                      </span>
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
