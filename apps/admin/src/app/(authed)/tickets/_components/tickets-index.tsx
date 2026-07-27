'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  Card,
  EmptyState,
  ErrorNote,
  Ident,
  Money,
  PageHeader,
  Select,
  SkeletonRows,
  Stat,
  TBody,
  Table,
  TablePaginator,
  Td,
  THead,
  Th,
  TicketStatusBadge,
  Toolbar,
  Tr,
} from '@skydrop/ui/components';
import { TicketStatus, TicketType } from '@skydrop/db';
import { useTicketsList, type TicketView } from '@/lib/ops-hooks';
import { TicketDrawer } from './ticket-drawer';

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
  const [status, setStatus] = useState<string>(TicketStatus.OPEN);
  const [ticketType, setTicketType] = useState<string>('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<TicketView | null>(null);

  const list = useTicketsList({
    ...(status === '' ? {} : { status }),
    ...(ticketType === '' ? {} : { ticketType }),
    page,
    pageSize: PAGE_SIZE,
  });

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const refundOnPage = items
    .filter((t) => t.resolutionAmountInr !== null)
    .reduce((sum, t) => sum + Number(t.resolutionAmountInr ?? 0), 0);

  function changeFilter(apply: () => void): void {
    apply();
    setPage(1);
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Tickets"
        subtitle="Scrap/damage raised by RTO inspection, and parcel issues raised by sellers. Resolving with a refund credits the seller's wallet in the same transaction."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Matching this filter"
          value={list.isLoading ? '—' : total}
          tone={status === TicketStatus.OPEN && total > 0 ? 'warn' : 'neutral'}
          hint={
            status === TicketStatus.OPEN
              ? 'Open tickets waiting on a decision'
              : 'Across all pages'
          }
        />
        <Stat
          label="Refunded on this page"
          value={<Money amount={refundOnPage} decimals={false} />}
          hint="Already credited to seller wallets"
        />
        <Stat
          label="Auto-raised"
          value={
            list.isLoading
              ? '—'
              : items.filter((t) => t.ticketType === TicketType.SCRAP_DAMAGE).length
          }
          hint="Opened by RTO inspection, not by a seller"
        />
      </div>

      <Toolbar>
        <label className="text-text-muted text-xs" htmlFor="ticket-status">
          Status
        </label>
        <Select
          id="ticket-status"
          value={status}
          onChange={(e) => changeFilter(() => setStatus(e.target.value))}
          className="w-56"
        >
          <option value="">All statuses</option>
          {Object.values(TicketStatus).map((s) => (
            <option key={s} value={s}>
              {humanise(s)}
            </option>
          ))}
        </Select>

        <label className="text-text-muted ml-2 text-xs" htmlFor="ticket-type">
          Type
        </label>
        <Select
          id="ticket-type"
          value={ticketType}
          onChange={(e) => changeFilter(() => setTicketType(e.target.value))}
          className="w-56"
        >
          <option value="">All types</option>
          {Object.values(TicketType).map((t) => (
            <option key={t} value={t}>
              {humanise(t)}
            </option>
          ))}
        </Select>
      </Toolbar>

      {list.isError ? (
        <Card className="rounded-t-none border-t-0 p-3">
          <ErrorNote
            message={list.error?.message ?? 'Failed to load tickets.'}
            retry={() => void list.refetch()}
          />
        </Card>
      ) : list.isLoading ? (
        <Card className="rounded-t-none border-t-0">
          <SkeletonRows rows={6} cols={6} />
        </Card>
      ) : items.length === 0 ? (
        <Card className="rounded-t-none border-t-0">
          <EmptyState
            bare
            title={
              status === TicketStatus.OPEN
                ? 'No open tickets'
                : 'No tickets match this filter'
            }
            description={
              status === TicketStatus.OPEN
                ? 'Nothing is waiting on a decision. Damage found during RTO inspection opens a ticket here automatically.'
                : 'Try widening the status or type filter.'
            }
          />
        </Card>
      ) : (
        <Table wrapperClassName="rounded-t-none border-t-0">
          <THead>
            <Tr>
              <Th>Type</Th>
              <Th>Subject</Th>
              <Th>Order</Th>
              <Th>Status</Th>
              <Th align="right">Refund</Th>
              <Th>Raised</Th>
            </Tr>
          </THead>
          <TBody>
            {items.map((t) => (
              <Tr key={t.id} interactive onClick={() => setSelected(t)}>
                <Td className="text-text-muted whitespace-nowrap text-xs">
                  {t.ticketType === TicketType.SCRAP_DAMAGE
                    ? 'Scrap / damage'
                    : 'Seller issue'}
                </Td>
                <Td className="max-w-xs truncate">{t.subject}</Td>
                <Td>
                  {t.orderId === null ? (
                    <span className="text-text-faint">—</span>
                  ) : (
                    <Link
                      href={`/orders/${t.orderId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-accent hover:underline"
                    >
                      <Ident value={`${t.orderId.slice(0, 8)}…`} />
                    </Link>
                  )}
                </Td>
                <Td>
                  <TicketStatusBadge status={t.status} />
                </Td>
                <Td align="right">
                  {t.resolutionAmountInr === null ? (
                    <span className="text-text-faint">—</span>
                  ) : (
                    <Money amount={t.resolutionAmountInr} direction="credit" />
                  )}
                </Td>
                <Td className="text-text-muted whitespace-nowrap">
                  {new Date(t.createdAt).toLocaleDateString()}
                </Td>
              </Tr>
            ))}
          </TBody>
          <tfoot>
            <tr>
              <td colSpan={6} className="p-0">
                <TablePaginator
                  page={list.data?.page ?? page}
                  pageSize={list.data?.pageSize ?? PAGE_SIZE}
                  total={total}
                  onPageChange={setPage}
                />
              </td>
            </tr>
          </tfoot>
        </Table>
      )}

      <TicketDrawer ticket={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function humanise(value: string): string {
  const lower = value.replaceAll('_', ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
