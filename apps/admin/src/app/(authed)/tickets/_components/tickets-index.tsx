'use client';

import { useEffect, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Ident, Money } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { Table, TBody, Td, THead, Th, Tr } from '@skydrop/ui/app/data-table';
import { Pagination } from '@skydrop/ui/app/pagination';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { TicketStatus, TicketType } from '@skydrop/db';
import { ticketTypeLabel } from '@skydrop/ui/status';
import { useTicketsList } from '@/lib/ops-hooks';
import { AfCard } from '@/app/(authed)/system/_components/af-parts';
import { TicketHandlingChip, TicketStatusChip } from './ticket-chips';
import './tickets.css';
import { useT } from '@/i18n/client';

const PAGE_SIZE = 25;

/**
 * The tickets queue (R7).
 *
 * Two populations share one table: SCRAP_DAMAGE tickets that RTO
 * inspection raised automatically, and SELLER_RAISED_ISSUE tickets a
 * seller opened about a parcel. They share a lifecycle, so they share
 * a queue — but the type column comes first, because "did we damage
 * this or is the seller disputing something" changes how you read
 * every other column.
 *
 * The default filter is OPEN: this is a worklist, not an archive.
 */
export function TicketsIndex(): ReactElement {
  const tr = useT();
  // STAGE, not raw status. "Closed" is four different outcomes in the
  // database — refunded, goods back, write-off, not upheld — and a
  // filter listing all four made somebody choose which kind of finished
  // they meant in order to ask "is it finished".
  const [status, setStatus] = useState<string>('OPEN');
  const [ticketType, setTicketType] = useState<string>('');
  // WHO is carrying it. The question a person opening this page is
  // usually asking is "what must I pick up", and before this there was
  // no way to ask it.
  const [handling, setHandling] = useState<string>('');
  const [page, setPage] = useState(1);
  // Search by the number a seller quotes (TK-…), the subject, or the
  // order / parcel / waybill. Waits for typing to stop; a new term goes
  // back to page one.
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  // The row IS the link now: one way in, and it is the page rather than
  // a modal that could only ever show a summary of it.
  const router = useRouter();

  const list = useTicketsList({
    ...(status === '' ? {} : { stage: status }),
    ...(ticketType === '' ? {} : { ticketType }),
    ...(handling === '' ? {} : { handling }),
    ...(debounced === '' ? {} : { search: debounced }),
    page,
    pageSize: PAGE_SIZE,
  });

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const refundOnPage = items
    .filter((t) => t.resolutionAmountInr !== null)
    .reduce((sum, t) => sum + Number(t.resolutionAmountInr ?? 0), 0);
  const autoRaised = items.filter((t) => t.ticketType === TicketType.SCRAP_DAMAGE).length;

  function changeFilter(apply: () => void): void {
    apply();
    setPage(1);
  }

  return (
    <div className="af-page">
      <PageHeader
        breadcrumbs={[
          { label: tr('ticketsTicketsIndex.operations') },
          { label: tr('ticketsTicketsIndex.tickets') },
        ]}
        Link={Link}
        title={tr('ticketsTicketsIndex.tickets')}
        subtitle={tr('ticketsTicketsIndex.scrapDamageRaisedByRto')}
      />

      <div className="af-kpis">
        {list.isLoading ? (
          <KpiCard
            label={tr('ticketsTicketsIndex.matchingThisFilter')}
            figure="—"
            hint={tr('ticketsTicketsIndex.loading')}
          />
        ) : (
          <KpiCard
            label={tr('ticketsTicketsIndex.matchingThisFilter')}
            value={total}
            tone={status === 'OPEN' && total > 0 ? 'pending' : 'neutral'}
            hint={
              status === 'OPEN'
                ? tr('ticketsTicketsIndex.openTicketsWaitingOnA')
                : tr('ticketsTicketsIndex.acrossAllPages')
            }
          />
        )}
        <KpiCard
          label={tr('ticketsTicketsIndex.refundedOnThisPage')}
          figure={<Money amount={refundOnPage} decimals={false} />}
          tone="credit"
          hint={tr('ticketsTicketsIndex.alreadyCreditedToClientWallets')}
        />
        {list.isLoading ? (
          <KpiCard
            label={tr('ticketsTicketsIndex.autoRaised')}
            figure="—"
            hint={tr('ticketsTicketsIndex.loading')}
          />
        ) : (
          <KpiCard
            label={tr('ticketsTicketsIndex.autoRaised')}
            value={autoRaised}
            hint={tr('ticketsTicketsIndex.openedByRtoInspectionNot')}
          />
        )}
      </div>

      <AfCard>
        <div className="tk-filters">
          <Select
            id="ticket-status"
            label={tr('ticketsTicketsIndex.status')}
            value={status}
            onChange={(e) => changeFilter(() => setStatus(e.target.value))}
          >
            <option value="">{tr('ticketsTicketsIndex.all')}</option>
            <option value="OPEN">{tr('ticketsTicketsIndex.open')}</option>
            <option value="REVIEWING">{tr('ticketsTicketsIndex.reviewing')}</option>
            <option value="CLOSED">{tr('ticketsTicketsIndex.closed')}</option>
          </Select>

          <Select
            id="ticket-type"
            label={tr('ticketsTicketsIndex.type')}
            value={ticketType}
            onChange={(e) => changeFilter(() => setTicketType(e.target.value))}
          >
            <option value="">{tr('ticketsTicketsIndex.allTypes')}</option>
            {Object.values(TicketType).map((t) => (
              <option key={t} value={t}>
                {humanise(t)}
              </option>
            ))}
          </Select>

          <Select
            id="ticket-handling"
            label={tr('ticketsTicketsIndex.handling')}
            value={handling}
            onChange={(e) => changeFilter(() => setHandling(e.target.value))}
          >
            {/*
              NONE is deliberately not offered. A scrap ticket raised by
              RTO inspection has no courier to be carried to, so it is
              neither "software has this" nor "somebody must pick this up";
              offering it as a third answer would invite the reading that
              it is waiting on someone.
            */}
            <option value="">{tr('ticketsTicketsIndex.autoAndManual')}</option>
            <option value="MANUAL">{tr('ticketsTicketsIndex.manualNeedsAPerson')}</option>
            <option value="AUTO">{tr('ticketsTicketsIndex.autoSoftwareIsCarryingIt')}</option>
          </Select>

          <TextField
            type="search"
            label={tr('ticketsTicketsIndex.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr('ticketsTicketsIndex.ticketTkOrderParcelOr')}
            aria-label={tr('ticketsTicketsIndex.searchTickets')}
          />
        </div>
      </AfCard>

      {list.isError ? (
        <ErrorState
          message={list.error?.message ?? tr('ticketsTicketsIndex.failedToLoadTickets')}
          retry={() => void list.refetch()}
        />
      ) : list.isLoading ? (
        <AfCard flush>
          <SkeletonRows rows={6} cols={6} label={tr('ticketsTicketsIndex.loadingTickets')} />
        </AfCard>
      ) : items.length === 0 ? (
        <EmptyState
          tone={status === TicketStatus.OPEN ? 'positive' : 'neutral'}
          title={
            status === TicketStatus.OPEN
              ? tr('ticketsTicketsIndex.noOpenTickets')
              : tr('ticketsTicketsIndex.noTicketsMatchThisFilter')
          }
          description={
            status === TicketStatus.OPEN
              ? tr('ticketsTicketsIndex.nothingIsWaitingOnA')
              : tr('ticketsTicketsIndex.tryWideningTheStatusOr')
          }
        />
      ) : (
        <div className="af-stack">
          <Table>
            <THead>
              <Tr>
                <Th>{tr('ticketsTicketsIndex.ticket')}</Th>
                <Th>{tr('ticketsTicketsIndex.type')}</Th>
                <Th>{tr('ticketsTicketsIndex.handling')}</Th>
                <Th>{tr('ticketsTicketsIndex.subject')}</Th>
                <Th>{tr('ticketsTicketsIndex.order')}</Th>
                <Th>{tr('ticketsTicketsIndex.status')}</Th>
                <Th align="right">{tr('ticketsTicketsIndex.refund')}</Th>
                <Th>{tr('ticketsTicketsIndex.raised')}</Th>
              </Tr>
            </THead>
            <TBody>
              {items.map((t) => (
                <Tr key={t.id} onActivate={() => router.push(`/tickets/${t.id}`)}>
                  <Td>
                    {/* A LINK, not a span. `Tr`'s `onActivate` is a pointer
                        convenience on top of a real link — its own docblock
                        says so — and without one there was no keyboard or
                        screen-reader path to a ticket at all, nor any way to
                        open one in a new tab. */}
                    {/* A LINK, not a span. `Tr`'s `onActivate` is a pointer
                        convenience on top of a real link — its own docblock
                        says so — and without one there was no keyboard or
                        screen-reader path to a ticket at all, nor any way to
                        open one in a new tab. */}
                    <Link href={`/tickets/${t.id}`} className="tk-number sk-ident af-link">
                      {t.ticketNumber}
                    </Link>
                  </Td>
                  <Td>
                    <span className="tk-type">{ticketTypeLabel(t.ticketType)}</span>
                  </Td>
                  <Td>
                    <TicketHandlingChip handling={t.handling} />
                  </Td>
                  <Td>
                    <span className="tk-subject" title={t.subject}>
                      {t.subject}
                    </span>
                  </Td>
                  <Td>
                    {t.orderId === null ? (
                      <span className="af-faint">—</span>
                    ) : (
                      <Link
                        href={`/orders/${t.orderId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="af-link sk-ident"
                      >
                        {t.orderNumber ?? <Ident value={`${t.orderId.slice(0, 8)}…`} />}
                      </Link>
                    )}
                  </Td>
                  <Td>
                    <TicketStatusChip status={t.status} size="sm" />
                  </Td>
                  <Td align="right">
                    {t.resolutionAmountInr === null ? (
                      <span className="af-faint">—</span>
                    ) : (
                      <Money amount={t.resolutionAmountInr} direction="credit" />
                    )}
                  </Td>
                  <Td>
                    <span className="af-small af-nowrap">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pagination
            page={list.data?.page ?? page}
            pageSize={list.data?.pageSize ?? PAGE_SIZE}
            total={total}
            onPageChange={setPage}
            label={tr('ticketsTicketsIndex.ticketPages')}
          />
        </div>
      )}
    </div>
  );
}

function humanise(value: string): string {
  const lower = value.replaceAll('_', ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
