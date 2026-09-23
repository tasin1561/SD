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
import { useTicketsList } from '@/lib/ops-hooks';
import { AfCard } from '@/app/(authed)/system/_components/af-parts';
import { TicketHandlingChip, TicketStatusChip } from './ticket-chips';
import './tickets.css';

const PAGE_SIZE = 25;

/** What an operator calls each kind. F2: a new type fails to compile here. */
function ticketTypeLabel(type: TicketType): string {
  switch (type) {
    case TicketType.SCRAP_DAMAGE:
      return 'Scrap / damage';
    case TicketType.SELLER_RAISED_ISSUE:
      return 'Seller issue';
    case TicketType.COURIER_NDR_ESCALATION:
      return 'Delivery escalation';
    case TicketType.RECEIPT_SHORTFALL:
      return 'Receipt short';
    case TicketType.STORE_DISPUTE:
      return 'Reseller store dispute';
    // 2026-09-16 — a reseller store raising something with SKYDROP, not
    // with its seller staff. Named apart from the dispute for the same
    // reason the types are apart: one is Skydrop's to answer, the other
    // Skydrop referees between seller staff and the store.
    case TicketType.STORE_ISSUE:
      return 'Reseller store issue';
    default:
      // F2: every value above returns, so this is unreachable — but the
      // compiler cannot see that, and `never` is what makes a FUTURE
      // ticket type fail to compile here rather than render a blank
      // label in the Skydrop admin queue.
      return assertNever(type);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled ticket type: ${String(value)}`);
}

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
        breadcrumbs={[{ label: 'Operations' }, { label: 'Tickets' }]}
        Link={Link}
        title="Tickets"
        subtitle="Scrap/damage raised by RTO inspection, and parcel issues raised by sellers. Resolving with a refund credits the seller's wallet in the same transaction."
      />

      <div className="af-kpis">
        {list.isLoading ? (
          <KpiCard label="Matching this filter" figure="—" hint="Loading" />
        ) : (
          <KpiCard
            label="Matching this filter"
            value={total}
            tone={status === 'OPEN' && total > 0 ? 'pending' : 'neutral'}
            hint={status === 'OPEN' ? 'Open tickets waiting on a decision' : 'Across all pages'}
          />
        )}
        <KpiCard
          label="Refunded on this page"
          figure={<Money amount={refundOnPage} decimals={false} />}
          tone="credit"
          hint="Already credited to seller wallets"
        />
        {list.isLoading ? (
          <KpiCard label="Auto-raised" figure="—" hint="Loading" />
        ) : (
          <KpiCard
            label="Auto-raised"
            value={autoRaised}
            hint="Opened by RTO inspection, not by a seller"
          />
        )}
      </div>

      <AfCard>
        <div className="tk-filters">
          <Select
            id="ticket-status"
            label="Status"
            value={status}
            onChange={(e) => changeFilter(() => setStatus(e.target.value))}
          >
            <option value="">All</option>
            <option value="OPEN">Open</option>
            <option value="REVIEWING">Reviewing</option>
            <option value="CLOSED">Closed</option>
          </Select>

          <Select
            id="ticket-type"
            label="Type"
            value={ticketType}
            onChange={(e) => changeFilter(() => setTicketType(e.target.value))}
          >
            <option value="">All types</option>
            {Object.values(TicketType).map((t) => (
              <option key={t} value={t}>
                {humanise(t)}
              </option>
            ))}
          </Select>

          <Select
            id="ticket-handling"
            label="Handling"
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
            <option value="">Auto and manual</option>
            <option value="MANUAL">Manual — needs a person</option>
            <option value="AUTO">Auto — software is carrying it</option>
          </Select>

          <TextField
            type="search"
            label="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ticket (TK-…), order, parcel or waybill"
            aria-label="Search tickets"
          />
        </div>
      </AfCard>

      {list.isError ? (
        <ErrorState
          message={list.error?.message ?? 'Failed to load tickets.'}
          retry={() => void list.refetch()}
        />
      ) : list.isLoading ? (
        <AfCard flush>
          <SkeletonRows rows={6} cols={6} label="Loading tickets" />
        </AfCard>
      ) : items.length === 0 ? (
        <EmptyState
          tone={status === TicketStatus.OPEN ? 'positive' : 'neutral'}
          title={status === TicketStatus.OPEN ? 'No open tickets' : 'No tickets match this filter'}
          description={
            status === TicketStatus.OPEN
              ? 'Nothing is waiting on a decision. Damage found during RTO inspection opens a ticket here automatically.'
              : 'Try widening the status or type filter.'
          }
        />
      ) : (
        <div className="af-stack">
          <Table>
            <THead>
              <Tr>
                <Th>Ticket</Th>
                <Th>Type</Th>
                <Th>Handling</Th>
                <Th>Subject</Th>
                <Th>Order</Th>
                <Th>Status</Th>
                <Th align="right">Refund</Th>
                <Th>Raised</Th>
              </Tr>
            </THead>
            <TBody>
              {items.map((t) => (
                <Tr key={t.id} onActivate={() => router.push(`/tickets/${t.id}`)}>
                  <Td>
                    <span className="tk-number sk-ident">{t.ticketNumber}</span>
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
            label="Ticket pages"
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
