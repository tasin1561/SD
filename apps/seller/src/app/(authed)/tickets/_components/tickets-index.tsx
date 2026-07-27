'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  Button,
  Card,
  CardBody,
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
  Td,
  THead,
  Th,
  TicketStatusBadge,
  Toolbar,
  Tr,
} from '@skydrop/ui/components';
import { TicketStatus, TicketType } from '@skydrop/db';
import { useSellerTickets } from '@/lib/ops-hooks';
import { RaiseTicketModal } from './raise-ticket-modal';

/**
 * The seller's ticket list.
 *
 * Two kinds appear here and the distinction matters to the reader:
 * tickets Skydrop raised (we found damage during return inspection) and
 * tickets they raised (something is wrong with a parcel). Both settle
 * through the same negotiation, and a refund lands in their wallet.
 */
export function SellerTicketsIndex(): ReactElement {
  const [status, setStatus] = useState<string>('');
  const [raising, setRaising] = useState(false);
  const list = useSellerTickets(status === '' ? {} : { status });

  const rows = list.data ?? [];
  const open = rows.filter(
    (t) => t.status === TicketStatus.OPEN || t.status === TicketStatus.NEGOTIATING,
  ).length;
  const refunded = rows.reduce(
    (sum, t) => sum + Number(t.resolutionAmountInr ?? 0),
    0,
  );

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Tickets"
        subtitle="Damage we found on returns, and any issue you raise about a parcel. Settled tickets that end in a refund credit your wallet."
        action={
          <Button variant="primary" size="md" onClick={() => setRaising(true)}>
            Raise an issue
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Stat
          label="Awaiting a decision"
          value={list.isLoading ? '—' : open}
          tone={open > 0 ? 'warn' : 'neutral'}
          hint="Open or under discussion"
        />
        <Stat
          label="Refunded to you"
          value={<Money amount={refunded} decimals={false} />}
          hint="Already credited to your wallet"
        />
      </div>

      <Toolbar>
        <label className="text-text-muted text-xs" htmlFor="seller-ticket-status">
          Status
        </label>
        <Select
          id="seller-ticket-status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-56"
        >
          <option value="">All statuses</option>
          {Object.values(TicketStatus).map((s) => (
            <option key={s} value={s}>
              {humanise(s)}
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
          <SkeletonRows rows={4} cols={5} />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="rounded-t-none border-t-0">
          <EmptyState
            bare
            title={status === '' ? 'No tickets' : 'No tickets with that status'}
            description={
              status === ''
                ? 'Nothing is disputed. If a parcel arrives damaged, goes missing, or something else looks wrong, raise it here and we will work it out.'
                : 'Try a different status.'
            }
            action={
              status === '' ? (
                <Button variant="primary" size="sm" onClick={() => setRaising(true)}>
                  Raise an issue
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Table wrapperClassName="rounded-t-none border-t-0">
          <THead>
            <Tr>
              <Th>Raised by</Th>
              <Th>Subject</Th>
              <Th>Order</Th>
              <Th>Status</Th>
              <Th align="right">Refund</Th>
              <Th>Date</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((t) => (
              <Tr key={t.id}>
                <Td className="text-text-muted whitespace-nowrap text-xs">
                  {t.ticketType === TicketType.SCRAP_DAMAGE ? 'Skydrop' : 'You'}
                </Td>
                <Td className="max-w-xs">
                  <div className="truncate">{t.subject}</div>
                  {t.resolutionNotes !== null && t.resolutionNotes !== '' && (
                    <div className="text-text-faint mt-0.5 truncate text-xs">
                      {t.resolutionNotes}
                    </div>
                  )}
                </Td>
                <Td>
                  {t.orderId === null ? (
                    <span className="text-text-faint">—</span>
                  ) : (
                    <Link
                      href={`/orders/${t.orderId}`}
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
        </Table>
      )}

      <Card className="mt-4">
        <CardBody>
          <p className="text-text-muted text-xs leading-relaxed">
            A ticket closes in one of four ways: we refund you, we return the goods,
            you accept the write-off, or the claim is not upheld. Whichever it is, the
            full discussion stays on the ticket — it is never edited after the fact.
          </p>
        </CardBody>
      </Card>

      <RaiseTicketModal open={raising} onOpenChange={setRaising} />
    </div>
  );
}

function humanise(value: string): string {
  const lower = value.replaceAll('_', ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
