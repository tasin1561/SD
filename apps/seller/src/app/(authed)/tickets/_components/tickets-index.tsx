'use client';

import { Fragment, useState, type ReactElement } from 'react';
import { MessageSquare } from 'lucide-react';
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
import { CourierThread } from './courier-thread';
import { TicketTimeline } from './ticket-timeline';
import { can } from '@/lib/page-access';
import { useSellerIdentity } from '@skydrop/auth/client';
import { useRouter } from 'next/navigation';

/**
 * The seller's ticket list.
 *
 * Two kinds appear here and the distinction matters to the reader:
 * tickets Skydrop raised (we found damage during return inspection) and
 * tickets they raised (something is wrong with a parcel). Both settle
 * through the same negotiation, and a refund lands in their wallet.
 */
export function SellerTicketsIndex(): ReactElement {
  const router = useRouter();
  const canWrite = can(useSellerIdentity(), 'tickets.create');
  const [status, setStatus] = useState<string>('');
  const [raising, setRaising] = useState(false);
  // Which ticket's courier conversation is open. One at a time: these are
  // long verbatim threads, and expanding several turns the list into a wall.
  const [openThread, setOpenThread] = useState<string | null>(null);
  // Filtered by STAGE, not by raw status. "Closed" is four different
  // outcomes in the database — refunded, goods back, write-off, not
  // upheld — and a filter offering all four made somebody pick which
  // kind of finished they meant in order to ask "is it finished".
  const list = useSellerTickets(status === '' ? {} : { stage: status });

  const rows = list.data ?? [];
  const open = rows.filter(
    (t) => t.status === TicketStatus.OPEN || t.status === TicketStatus.NEGOTIATING,
  ).length;
  const refunded = rows.reduce((sum, t) => sum + Number(t.resolutionAmountInr ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Tickets"
        subtitle="Damage we found on returns, and any issue you raise about a parcel. Settled tickets that end in a refund credit your wallet."
        action={
          canWrite ? (
            <Button variant="primary" size="md" onClick={() => setRaising(true)}>
              Raise an issue
            </Button>
          ) : null
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
          <option value="">All</option>
          <option value="OPEN">Open</option>
          <option value="REVIEWING">Reviewing</option>
          <option value="CLOSED">Closed</option>
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
              canWrite && status === '' ? (
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
              <Th>Courier</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((t) => (
              <Fragment key={t.id}>
                {/* The row opens the ticket, not the order it is about:
                    a ticket with no order (a general parcel issue) was
                    sending the reader to /orders/null. */}
                <Tr onActivate={() => router.push(`/tickets/${t.id}`)}>
                  <Td className="text-text-muted whitespace-nowrap text-xs">
                    {t.ticketType === TicketType.SCRAP_DAMAGE ? 'Skydrop' : 'You'}
                  </Td>
                  <Td className="max-w-xs">
                    {/* The real link, in the primary cell — the row click
                        is a pointer convenience layered on top of it, and
                        a `<tr>` cannot be tabbed to. */}
                    <Link href={`/tickets/${t.id}`} className="hover:text-accent block truncate">
                      {t.subject}
                    </Link>
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
                        className="text-accent font-mono text-xs hover:underline"
                      >
                        {/* The order NUMBER. A truncated uuid is not a
                            shorter name for something, it is a name
                            nobody has. */}
                        {t.orderNumber ?? <Ident value={`${t.orderId.slice(0, 8)}…`} />}
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
                  <Td>
                    {/* The conversation with the courier, in their words.
                        Opening it is a deliberate click: the thread is long
                        and belongs beside the ticket, not inside every row. */}
                    <button
                      type="button"
                      className="text-accent inline-flex items-center gap-1 text-xs hover:underline"
                      aria-expanded={openThread === t.id}
                      onClick={(e) => {
                        // The row navigates to the ticket; this cell does not.
                        e.stopPropagation();
                        setOpenThread(openThread === t.id ? null : t.id);
                      }}
                    >
                      <MessageSquare size={13} />
                      {openThread === t.id ? 'Hide' : 'View'}
                    </button>
                  </Td>
                </Tr>
                {openThread === t.id ? (
                  <Tr>
                    <Td colSpan={7} className="bg-surface-1 p-3">
                      <TicketTimeline ticketId={t.id} />
                      <CourierThread ticketId={t.id} />
                    </Td>
                  </Tr>
                ) : null}
              </Fragment>
            ))}
          </TBody>
        </Table>
      )}

      <Card className="mt-4">
        <CardBody>
          <p className="text-text-muted text-xs leading-relaxed">
            A ticket closes in one of four ways: we refund you, we return the goods, you accept the
            write-off, or the claim is not upheld. Whichever it is, the full discussion stays on the
            ticket — it is never edited after the fact.
          </p>
        </CardBody>
      </Card>

      <RaiseTicketModal open={raising} onOpenChange={setRaising} />
    </div>
  );
}
