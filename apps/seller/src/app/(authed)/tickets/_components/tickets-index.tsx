'use client';

import { Fragment, useEffect, useMemo, useState, type ReactElement } from 'react';
import { MessageSquare, CircleDot, LifeBuoy, Wallet } from 'lucide-react';
import Link from 'next/link';
import {
  BandBody,
  Button,
  Crumbs,
  EmptyState,
  ErrorNote,
  FilterChip,
  Ident,
  Input,
  MetaChip,
  Money,
  PageHeader,
  SectionBand,
  SkeletonRows,
  Stat,
  StripFact,
  TBody,
  Table,
  Td,
  THead,
  Th,
  TicketStatusBadge,
  Tr,
} from '@skydrop/ui/components';
import { TicketStatus } from '@skydrop/db';
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
 *
 * ── WHAT THE CONSOLE COMPS SHOW THAT WE DO NOT HAVE ─────────────────
 *   TRIAGE SLA / TIME TO FIRST REPLY   nothing measures either. A clock
 *       on a support screen is a promise, and we make none.
 *   CLAIM VALUE vs REFUNDED            a ticket carries only what was
 *       actually credited (`resolutionAmountInr`, null until paid).
 *       There is no "claimed" figure, so the tile counts what LANDED —
 *       and reads "—" rather than ₹0 while nothing has.
 *
 * The stage chips carry no COUNT: the endpoint answers one stage at a
 * time, so a number beside each would be three more round trips per
 * page view for decoration.
 */

/** The three stages, in the order somebody works through them. */
const STAGES = [
  { value: '', label: 'All tickets' },
  { value: 'OPEN', label: 'Open' },
  { value: 'REVIEWING', label: 'Reviewing' },
  { value: 'CLOSED', label: 'Closed' },
] as const;

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
  // Search by the ticket number you were given (TK-…), the subject, or
  // the order / parcel / waybill it is about. Waits for typing to stop.
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const list = useSellerTickets({
    ...(status === '' ? {} : { stage: status }),
    ...(debounced === '' ? {} : { search: debounced }),
  });
  const filtered = status !== '' || debounced !== '';

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const open = rows.filter(
    (t) => t.status === TicketStatus.OPEN || t.status === TicketStatus.NEGOTIATING,
  ).length;
  const refunded = rows.reduce((sum, t) => sum + Number(t.resolutionAmountInr ?? 0), 0);
  const refundedCount = rows.filter((t) => t.resolutionAmountInr !== null).length;
  const loaded = !list.isLoading && !list.isError;

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[{ label: 'Seller console' }, { label: 'Selling' }, { label: 'Tickets' }]}
            Link={Link}
          />
        }
        title="Tickets"
        subtitle="Damage we found on returns, and any issue you raise about a parcel. Settled tickets that end in a refund credit your wallet."
        meta={
          !loaded ? undefined : (
            <>
              <MetaChip tone={open > 0 ? 'warn' : 'good'} dot={open > 0}>
                {open === 0 ? 'Nothing disputed' : `${open} awaiting a decision`}
              </MetaChip>
              <MetaChip>
                {rows.length} {rows.length === 1 ? 'ticket' : 'tickets'} shown
              </MetaChip>
            </>
          )
        }
        action={
          canWrite ? (
            <Button variant="primary" size="md" onClick={() => setRaising(true)}>
              Raise an issue
            </Button>
          ) : null
        }
      />

      {/* ── Where the disputes stand ────────────────────────────────
             Three tiles counted off the rows below, so they cannot
             disagree with the register. The refund tile reads "—"
             rather than ₹0 until something has actually been credited:
             nothing decided and nothing owed look the same at ₹0. */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Awaiting a decision"
          icon={<CircleDot size={13} aria-hidden />}
          value={loaded ? open : <span className="text-text-faint">—</span>}
          unit={loaded ? (open === 1 ? 'ticket' : 'tickets') : undefined}
          tone={loaded && open > 0 ? 'warn' : 'neutral'}
          hint="Open or under discussion."
        />
        <Stat
          label="Refunded to you"
          icon={<Wallet size={13} aria-hidden />}
          value={
            !loaded || refundedCount === 0 ? (
              <span className="text-text-faint">—</span>
            ) : (
              <Money amount={refunded} direction="credit" decimals={false} />
            )
          }
          tone={loaded && refundedCount > 0 ? 'good' : 'neutral'}
          hint={
            !loaded
              ? undefined
              : refundedCount === 0
                ? 'Nothing credited on the tickets shown.'
                : `From ${refundedCount} settled ${refundedCount === 1 ? 'ticket' : 'tickets'}, already in your wallet.`
          }
        />
        <Stat
          label="Tickets shown"
          icon={<LifeBuoy size={13} aria-hidden />}
          value={loaded ? rows.length : <span className="text-text-faint">—</span>}
          unit={loaded ? (rows.length === 1 ? 'ticket' : 'tickets') : undefined}
          tone="neutral"
          hint={filtered ? 'Matching your filter and search.' : 'Every ticket on your account.'}
        />
      </div>

      <SectionBand
        index="01"
        title="Ticket register"
        note={
          loaded
            ? `${rows.length} ${rows.length === 1 ? 'ticket' : 'tickets'}${filtered ? ' matching' : ''}`
            : undefined
        }
        action={
          <>
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ticket (TK-…), order, parcel or waybill"
              aria-label="Search tickets"
              className="w-full sm:w-72"
            />
            {filtered && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setStatus('');
                }}
                className="text-text-faint hover:text-text-body px-1 text-xs transition-colors"
              >
                Reset
              </button>
            )}
          </>
        }
      />

      <BandBody flush>
        <div className="border-border flex flex-wrap items-center gap-1.5 border-b px-3 py-2.5">
          {STAGES.map((s) => (
            <FilterChip
              key={s.value}
              label={s.label}
              active={status === s.value}
              onClick={() => setStatus(s.value)}
            />
          ))}
        </div>

        {list.isError ? (
          <div className="p-3">
            <ErrorNote
              message={list.error?.message ?? 'Failed to load tickets.'}
              retry={() => void list.refetch()}
            />
          </div>
        ) : list.isLoading ? (
          <SkeletonRows rows={4} cols={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            bare
            title={filtered ? 'No tickets match' : 'No tickets'}
            description={
              filtered
                ? 'Try a different stage, or check the ticket number.'
                : 'Nothing is disputed. If a parcel arrives damaged, goes missing, or something else looks wrong, raise it here and we will work it out.'
            }
            action={
              canWrite && !filtered ? (
                <Button variant="primary" size="sm" onClick={() => setRaising(true)}>
                  Raise an issue
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Ticket</Th>
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
                    <Td className="font-mono text-xs whitespace-nowrap">{t.ticketNumber}</Td>
                    <Td className="text-text-muted text-xs whitespace-nowrap">
                      {t.openedBy === 'SELLER' ? 'You' : 'Skydrop'}
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
                    <Td className="text-text-muted font-mono text-xs whitespace-nowrap">
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
                      <Td colSpan={8} className="bg-surface-raised p-3">
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
      </BandBody>

      <SectionBand index="02" title="How a ticket closes" className="mt-4" />
      <BandBody>
        <p className="text-text-muted text-xs leading-relaxed">
          A ticket closes in one of four ways: we refund you, we return the goods, you accept the
          write-off, or the claim is not upheld. Whichever it is, the full discussion stays on the
          ticket — it is never edited after the fact.
        </p>
      </BandBody>

      {loaded && rows.length > 0 && (
        <div className="text-text-faint border-border mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3 font-mono text-[11px]">
          <StripFact label="Awaiting a decision" value={open} tone={open > 0 ? 'warn' : 'good'} />
          <StripFact
            label="Refunded"
            value={
              refundedCount === 0 ? (
                '—'
              ) : (
                <Money amount={refunded} direction="credit" decimals={false} />
              )
            }
          />
          <StripFact label="Shown" value={`${rows.length} tickets`} />
        </div>
      )}

      <RaiseTicketModal open={raising} onOpenChange={setRaising} />
    </div>
  );
}
