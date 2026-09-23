'use client';

import { Fragment, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { ChevronDown, CircleDot, LifeBuoy, MessageSquare, Plus, Wallet } from 'lucide-react';
import Link from 'next/link';
import { Ident, Money } from '@skydrop/ui/components';
import { ticketStatusKind, ticketStatusLabel } from '@skydrop/ui/status';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Table, TableToolbar, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Tabs } from '@skydrop/ui/app/tabs';
import { Button } from '@skydrop/ui/app/button';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { TicketStatus } from '@skydrop/db';
import { useSellerTickets } from '@/lib/ops-hooks';
import { RaiseTicketModal } from './raise-ticket-modal';
import { CourierThread } from './courier-thread';
import { TicketTimeline } from './ticket-timeline';
import { can } from '@/lib/page-access';
import { useSellerIdentity } from '@skydrop/auth/client';
import { useRouter } from 'next/navigation';
import './tickets.css';

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
    <div className="tkt-page">
      <PageHeader
        breadcrumbs={[{ label: 'Seller console' }, { label: 'Selling' }, { label: 'Tickets' }]}
        Link={Link}
        title="Tickets"
        subtitle="Damage we found on returns, and any issue you raise about a parcel. Settled tickets that end in a refund credit your wallet."
        meta={
          !loaded ? undefined : (
            <span className="tkt-meta">
              <Fact tone={open > 0 ? 'warn' : 'good'} dot={open > 0}>
                {open === 0 ? 'Nothing disputed' : `${open} awaiting a decision`}
              </Fact>
              <Fact>
                {rows.length} {rows.length === 1 ? 'ticket' : 'tickets'} shown
              </Fact>
            </span>
          )
        }
        action={
          canWrite ? (
            <Button
              variant="primary"
              size="md"
              icon={<Plus size={15} />}
              onClick={() => setRaising(true)}
            >
              Raise an issue
            </Button>
          ) : null
        }
      />

      {/* ── Where the disputes stand ────────────────────────────────
             Three tiles counted off the rows below, so they cannot
             disagree with the register. The refund tile reads "—"
             rather than ₹0 until something has actually been credited:
             nothing decided and nothing owed look the same at ₹0.
             Counts roll once and land on exactly the string they always
             showed (`String`, no digit grouping). */}
      <div className="tkt-kpis">
        {loaded ? (
          <KpiCard
            label="Awaiting a decision"
            icon={<CircleDot size={14} />}
            value={open}
            format={String}
            unit={open === 1 ? 'ticket' : 'tickets'}
            tone={open > 0 ? 'pending' : 'neutral'}
            hint="Open or under discussion."
          />
        ) : (
          <KpiCard
            label="Awaiting a decision"
            icon={<CircleDot size={14} />}
            figure={<span className="tkt-faint">—</span>}
            tone="neutral"
            hint="Open or under discussion."
          />
        )}
        <KpiCard
          label="Refunded to you"
          icon={<Wallet size={14} />}
          figure={
            !loaded || refundedCount === 0 ? (
              <span className="tkt-faint">—</span>
            ) : (
              <Money amount={refunded} direction="credit" decimals={false} />
            )
          }
          tone={loaded && refundedCount > 0 ? 'credit' : 'neutral'}
          hint={
            !loaded
              ? undefined
              : refundedCount === 0
                ? 'Nothing credited on the tickets shown.'
                : `From ${refundedCount} settled ${refundedCount === 1 ? 'ticket' : 'tickets'}, already in your wallet.`
          }
        />
        {loaded ? (
          <KpiCard
            label="Tickets shown"
            icon={<LifeBuoy size={14} />}
            value={rows.length}
            format={String}
            unit={rows.length === 1 ? 'ticket' : 'tickets'}
            tone="neutral"
            hint={filtered ? 'Matching your filter and search.' : 'Every ticket on your account.'}
          />
        ) : (
          <KpiCard
            label="Tickets shown"
            icon={<LifeBuoy size={14} />}
            figure={<span className="tkt-faint">—</span>}
            tone="neutral"
            hint={filtered ? 'Matching your filter and search.' : 'Every ticket on your account.'}
          />
        )}
      </div>

      <section className="tkt-section">
        <SectionHeading
          title="Ticket register"
          note={
            loaded
              ? `${rows.length} ${rows.length === 1 ? 'ticket' : 'tickets'}${filtered ? ' matching' : ''}`
              : undefined
          }
        />
        <TableToolbar
          search={{
            value: search,
            onChange: setSearch,
            label: 'Search tickets',
            placeholder: 'Ticket (TK-…), order, parcel or waybill',
          }}
          filters={
            <Tabs
              label="Ticket stage"
              size="sm"
              items={STAGES.map((s) => ({ id: stageTabId(s.value), label: s.label }))}
              value={stageTabId(status)}
              onChange={(id) => setStatus(id === ALL_STAGES ? '' : id)}
            />
          }
        >
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                setStatus('');
              }}
            >
              Reset
            </Button>
          )}
        </TableToolbar>

        {list.isError ? (
          <ErrorState
            message={list.error?.message ?? 'Failed to load tickets.'}
            retry={() => void list.refetch()}
          />
        ) : list.isLoading ? (
          <SkeletonRows rows={4} cols={5} label="Loading your tickets…" />
        ) : rows.length === 0 ? (
          <EmptyState
            title={filtered ? 'No tickets match' : 'No tickets'}
            description={
              filtered
                ? 'Try a different stage, or check the ticket number.'
                : 'Nothing is disputed. If a parcel arrives damaged, goes missing, or something else looks wrong, raise it here and we will work it out.'
            }
            action={
              canWrite && !filtered ? (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Plus size={14} />}
                  onClick={() => setRaising(true)}
                >
                  Raise an issue
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table caption="Ticket register">
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
                  <Tr
                    onActivate={() => router.push(`/tickets/${t.id}`)}
                    selected={openThread === t.id}
                  >
                    <Td>
                      <span className="tkt-number sk-ident">{t.ticketNumber}</span>
                    </Td>
                    <Td>
                      <span className="tkt-muted">
                        {t.openedBy === 'SELLER' ? 'You' : 'Skydrop'}
                      </span>
                    </Td>
                    <Td>
                      {/* The real link, in the primary cell — the row click
                          is a pointer convenience layered on top of it, and
                          a `<tr>` cannot be tabbed to. */}
                      <Link href={`/tickets/${t.id}`} className="tkt-subject">
                        {t.subject}
                      </Link>
                      {t.resolutionNotes !== null && t.resolutionNotes !== '' && (
                        <span className="tkt-subject-note">{t.resolutionNotes}</span>
                      )}
                    </Td>
                    <Td>
                      {t.orderId === null ? (
                        <span className="tkt-faint">—</span>
                      ) : (
                        <Link href={`/orders/${t.orderId}`} className="tkt-link sk-ident">
                          {/* The order NUMBER. A truncated uuid is not a
                              shorter name for something, it is a name
                              nobody has. */}
                          {t.orderNumber ?? <Ident value={`${t.orderId.slice(0, 8)}…`} />}
                        </Link>
                      )}
                    </Td>
                    <Td>
                      <StatusChip
                        kind={ticketStatusKind(t.status)}
                        label={ticketStatusLabel(t.status)}
                        size="sm"
                      />
                    </Td>
                    <Td align="right">
                      {t.resolutionAmountInr === null ? (
                        <span className="tkt-faint">—</span>
                      ) : (
                        <Money amount={t.resolutionAmountInr} direction="credit" />
                      )}
                    </Td>
                    <Td>
                      <span className="tkt-muted sk-figure">
                        {new Date(t.createdAt).toLocaleDateString()}
                      </span>
                    </Td>
                    <Td>
                      {/* The conversation with the courier, in their words.
                          Opening it is a deliberate click: the thread is long
                          and belongs beside the ticket, not inside every row. */}
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<MessageSquare size={13} />}
                        iconRight={<ChevronDown size={13} className="tkt-toggle__chev" />}
                        className="tkt-toggle"
                        aria-expanded={openThread === t.id}
                        onClick={(e) => {
                          // The row navigates to the ticket; this cell does not.
                          e.stopPropagation();
                          setOpenThread(openThread === t.id ? null : t.id);
                        }}
                      >
                        {openThread === t.id ? 'Hide' : 'View'}
                      </Button>
                    </Td>
                  </Tr>
                  {openThread === t.id ? (
                    <Tr className="tkt-expanded">
                      <Td colSpan={8}>
                        <div className="tkt-well">
                          <TicketTimeline ticketId={t.id} />
                          <CourierThread ticketId={t.id} />
                        </div>
                      </Td>
                    </Tr>
                  ) : null}
                </Fragment>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <section className="tkt-section">
        <SectionHeading title="How a ticket closes" />
        <p className="tkt-note">
          A ticket closes in one of four ways: we refund you, we return the goods, you accept the
          write-off, or the claim is not upheld. Whichever it is, the full discussion stays on the
          ticket — it is never edited after the fact.
        </p>
      </section>

      {loaded && rows.length > 0 && (
        <dl className="tkt-strip">
          <StripItem label="Awaiting a decision" tone={open > 0 ? 'warn' : 'good'}>
            {open}
          </StripItem>
          <StripItem label="Refunded">
            {refundedCount === 0 ? (
              '—'
            ) : (
              <Money amount={refunded} direction="credit" decimals={false} />
            )}
          </StripItem>
          <StripItem label="Shown">{`${rows.length} tickets`}</StripItem>
        </dl>
      )}

      <RaiseTicketModal open={raising} onOpenChange={setRaising} />
    </div>
  );
}

/** The tab id for the "every stage" choice — a tab needs a non-empty id. */
const ALL_STAGES = 'all';

function stageTabId(value: string): string {
  return value === '' ? ALL_STAGES : value;
}

/** A standing fact under the page title — never an action. */
function Fact({
  tone,
  dot = false,
  children,
}: {
  readonly tone?: 'good' | 'warn' | undefined;
  readonly dot?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span className="tkt-fact" data-tone={tone}>
      {dot && <span className="tkt-fact__dot" aria-hidden />}
      {children}
    </span>
  );
}

/** One total in the strip under the register. */
function StripItem({
  label,
  tone,
  children,
}: {
  readonly label: string;
  readonly tone?: 'good' | 'warn' | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="tkt-strip__item" data-tone={tone}>
      <dt>{label}</dt>
      <dd className="sk-figure">{children}</dd>
    </div>
  );
}
