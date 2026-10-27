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
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

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
const stagesOf = (t: Translate<MessageKey>) =>
  [
    { value: '', label: t('tickets.allTickets') },
    { value: 'OPEN', label: t('tickets.open') },
    { value: 'REVIEWING', label: t('tickets.reviewing') },
    { value: 'CLOSED', label: t('tickets.closed2') },
  ] as const;

export function SellerTicketsIndex(): ReactElement {
  const t = useT();
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
        breadcrumbs={[
          { label: t('tickets.clientConsole') },
          { label: t('tickets.selling') },
          { label: t('tickets.tickets') },
        ]}
        Link={Link}
        title={t('tickets.tickets')}
        subtitle={t('tickets.damageWeFoundOn')}
        meta={
          !loaded ? undefined : (
            <span className="tkt-meta">
              <Fact tone={open > 0 ? 'warn' : 'good'} dot={open > 0}>
                {open === 0
                  ? t('tickets.nothingDisputed')
                  : t('tickets.awaitingADecision', { open })}
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
              {t('tickets.raiseAnIssue')}
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
            label={t('tickets.awaitingADecision2')}
            icon={<CircleDot size={14} />}
            value={open}
            format={String}
            unit={open === 1 ? 'ticket' : 'tickets'}
            tone={open > 0 ? 'pending' : 'neutral'}
            hint={t('tickets.openOrUnderDiscussion')}
          />
        ) : (
          <KpiCard
            label={t('tickets.awaitingADecision2')}
            icon={<CircleDot size={14} />}
            figure={<span className="tkt-faint">—</span>}
            tone="neutral"
            hint={t('tickets.openOrUnderDiscussion')}
          />
        )}
        <KpiCard
          label={t('tickets.refundedToYou')}
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
                ? t('tickets.nothingCreditedOnThe')
                : t(refundedCount === 1 ? 'tickets.fromSettledOne' : 'tickets.fromSettledMany', {
                    refundedCount,
                  })
          }
        />
        {loaded ? (
          <KpiCard
            label={t('tickets.ticketsShown')}
            icon={<LifeBuoy size={14} />}
            value={rows.length}
            format={String}
            unit={rows.length === 1 ? 'ticket' : 'tickets'}
            tone="neutral"
            hint={filtered ? t('tickets.matchingYourFilterAnd') : t('tickets.everyTicketOnYour')}
          />
        ) : (
          <KpiCard
            label={t('tickets.ticketsShown')}
            icon={<LifeBuoy size={14} />}
            figure={<span className="tkt-faint">—</span>}
            tone="neutral"
            hint={filtered ? t('tickets.matchingYourFilterAnd') : t('tickets.everyTicketOnYour')}
          />
        )}
      </div>

      <section className="tkt-section">
        <SectionHeading
          title={t('tickets.ticketRegister')}
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
            label: t('tickets.searchTickets'),
            placeholder: t('tickets.ticketTkOrderParcel'),
          }}
          filters={
            <Tabs
              label={t('tickets.ticketStage')}
              size="sm"
              items={stagesOf(t).map((s) => ({ id: stageTabId(s.value), label: s.label }))}
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
              {t('tickets.reset')}
            </Button>
          )}
        </TableToolbar>

        {list.isError ? (
          <ErrorState
            message={list.error?.message ?? t('tickets.failedToLoadTickets')}
            retry={() => void list.refetch()}
          />
        ) : list.isLoading ? (
          <SkeletonRows rows={4} cols={5} label={t('tickets.loadingYourTickets')} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={filtered ? t('tickets.noTicketsMatch') : t('tickets.noTickets')}
            description={
              filtered ? t('tickets.tryADifferentStage') : t('tickets.nothingIsDisputedIf')
            }
            action={
              canWrite && !filtered ? (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Plus size={14} />}
                  onClick={() => setRaising(true)}
                >
                  {t('tickets.raiseAnIssue')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table caption={t('tickets.ticketRegister')}>
            <THead>
              <Tr>
                <Th>{t('tickets.ticket')}</Th>
                <Th>{t('tickets.raisedBy')}</Th>
                <Th>{t('tickets.subject')}</Th>
                <Th>{t('tickets.order')}</Th>
                <Th>{t('tickets.status')}</Th>
                <Th align="right">{t('tickets.refund')}</Th>
                <Th>{t('tickets.date')}</Th>
                <Th>{t('tickets.courier')}</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((ticket) => (
                <Fragment key={ticket.id}>
                  {/* The row opens the ticket, not the order it is about:
                      a ticket with no order (a general parcel issue) was
                      sending the reader to /orders/null. */}
                  <Tr
                    onActivate={() => router.push(`/tickets/${ticket.id}`)}
                    selected={openThread === ticket.id}
                  >
                    <Td>
                      {/* A LINK, not a span — see the admin list: a row that
                          only responds to a mouse click is reachable by
                          nobody using a keyboard. */}
                      <Link href={`/tickets/${ticket.id}`} className="tkt-number sk-ident">
                        {ticket.ticketNumber}
                      </Link>
                    </Td>
                    <Td>
                      {/* Three answers, not two: a reseller store's
                          dispute is neither yours nor ours, and
                          `=== 'SELLER' ? … : 'Skydrop'` said we had
                          raised it (2026-10-04). */}
                      <span className="tkt-muted">
                        {ticket.openedBy === 'SELLER'
                          ? t('tickets.you')
                          : ticket.openedBy === 'STORE'
                            ? (ticket.storeName ?? t('tickets.aMemberStore'))
                            : 'Skydrop'}
                      </span>
                    </Td>
                    <Td>
                      {/* The real link, in the primary cell — the row click
                          is a pointer convenience layered on top of it, and
                          a `<tr>` cannot be tabbed to. */}
                      <Link href={`/tickets/${ticket.id}`} className="tkt-subject">
                        {ticket.subject}
                      </Link>
                      {ticket.resolutionNotes !== null && ticket.resolutionNotes !== '' && (
                        <span className="tkt-subject-note">{ticket.resolutionNotes}</span>
                      )}
                    </Td>
                    <Td>
                      {ticket.orderId === null ? (
                        <span className="tkt-faint">—</span>
                      ) : (
                        <Link href={`/orders/${ticket.orderId}`} className="tkt-link sk-ident">
                          {/* The order NUMBER. A truncated uuid is not a
                              shorter name for something, it is a name
                              nobody has. */}
                          {ticket.orderNumber ?? <Ident value={`${ticket.orderId.slice(0, 8)}…`} />}
                        </Link>
                      )}
                    </Td>
                    <Td>
                      <StatusChip
                        kind={ticketStatusKind(ticket.status)}
                        label={ticketStatusLabel(ticket.status)}
                        size="sm"
                      />
                    </Td>
                    <Td align="right">
                      {ticket.resolutionAmountInr === null ? (
                        <span className="tkt-faint">—</span>
                      ) : (
                        <Money amount={ticket.resolutionAmountInr} direction="credit" />
                      )}
                    </Td>
                    <Td>
                      <span className="tkt-muted sk-figure">
                        {new Date(ticket.createdAt).toLocaleDateString()}
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
                        aria-expanded={openThread === ticket.id}
                        onClick={(e) => {
                          // The row navigates to the ticket; this cell does not.
                          e.stopPropagation();
                          setOpenThread(openThread === ticket.id ? null : ticket.id);
                        }}
                      >
                        {openThread === ticket.id ? t('tickets.hide') : t('tickets.view')}
                      </Button>
                    </Td>
                  </Tr>
                  {openThread === ticket.id ? (
                    <Tr className="tkt-expanded">
                      <Td colSpan={8}>
                        <div className="tkt-well">
                          <TicketTimeline ticketId={ticket.id} />
                          <CourierThread ticketId={ticket.id} />
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
        <SectionHeading title={t('tickets.howATicketCloses')} />
        <p className="tkt-note">{t('tickets.aTicketClosesIn')}</p>
      </section>

      {loaded && rows.length > 0 && (
        <dl className="tkt-strip">
          <StripItem label={t('tickets.awaitingADecision2')} tone={open > 0 ? 'warn' : 'good'}>
            {open}
          </StripItem>
          <StripItem label={t('tickets.refunded')}>
            {refundedCount === 0 ? (
              '—'
            ) : (
              <Money amount={refunded} direction="credit" decimals={false} />
            )}
          </StripItem>
          <StripItem label={t('tickets.shown')}>
            {t('tickets.tickets2', { rows: rows.length })}
          </StripItem>
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
