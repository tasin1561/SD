'use client';

import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Banknote,
  Landmark,
  Receipt,
  Send,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { Card, CardBody, ErrorState, Money, PageHeader, Skeleton } from '@skydrop/ui/components';
import { useOrdersList, useReportSummary } from '@/lib/api-hooks';
import { useTicketsList, useWithdrawalsList } from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';

/**
 * The admin landing page — the operations cockpit.
 *
 * It answers the question somebody actually opens this app with: WHAT
 * NEEDS ME TODAY. Work queues first, because each number is a pile of
 * orders waiting on a person; performance and money after, because
 * those are read rather than acted on.
 *
 * ── WHY THE ATTENTION ROW LOOKS THE WAY IT DOES ──────────────────────
 * Seven cards, and the ones with work on them are LOUD while the ones
 * at zero go quiet and say "Clear". That asymmetry is the whole design:
 * a row of seven equally-weighted tiles makes somebody read all seven
 * to find the two that matter. A card at zero has nothing to say and
 * should stop competing for the eye.
 *
 * ── EVERY NUMBER IS REAL ─────────────────────────────────────────────
 * Counts come from existing list endpoints asked for exactly one row —
 * the total is in the envelope, so pulling a page of records to count
 * them would be waste. Nothing here is a placeholder figure.
 *
 * ── IT SHOWS WHAT YOU MAY SEE, AND ASKS FOR NOTHING ELSE ─────────────
 * This is the ONE page open to every staff member, so it is where a
 * permission gap surfaces first. Each query is gated on the permission
 * its endpoint requires, so a call agent is not served a landing page
 * of 403s for doing nothing but signing in.
 */

const COUNT_ONLY = { page: 1, pageSize: 1 } as const;

// ── section chrome ────────────────────────────────────────────────────

function SectionHead({
  index,
  title,
  icon,
  iconTone = 'accent',
  note,
}: {
  index: string;
  title: string;
  icon: ReactNode;
  iconTone?: 'accent' | 'warn' | 'good';
  note?: ReactNode;
}): ReactElement {
  const toneClass = {
    accent: 'text-accent',
    warn: 'text-status-pending-fg',
    good: 'text-status-delivered-fg',
  }[iconTone];
  return (
    <div className="mt-7 mb-3 flex flex-wrap items-center justify-between gap-2 first:mt-0">
      <div className="text-text-muted flex items-center gap-2">
        <span className={toneClass}>{icon}</span>
        {/* The eyebrow is a real heading for a screen reader; the
            numbering is decoration and is hidden from one, because
            "section zero one" read aloud is noise. */}
        <h2 className="text-xs font-semibold tracking-[0.09em] uppercase">
          <span aria-hidden="true">{`${index} // `}</span>
          {title}
        </h2>
      </div>
      {note !== undefined && <div className="text-text-faint text-xs">{note}</div>}
    </div>
  );
}

// ── section 01: the attention queue ───────────────────────────────────

function AttentionCard({
  href,
  area,
  label,
  count,
  loading,
  hint,
  badge,
  tone = 'neutral',
}: {
  href: string;
  area: string;
  label: string;
  count: number | undefined;
  loading: boolean;
  hint: string;
  badge?: string;
  tone?: 'neutral' | 'warn' | 'bad' | 'info';
}): ReactElement {
  const active = (count ?? 0) > 0;

  // A card with work on it carries its tone in THREE places at once —
  // the tinted ground, the coloured border, and the figure itself. One
  // of the three alone reads as decoration; together they make the card
  // legible as "this one" from across the room, which is the entire job
  // of an attention queue.
  //
  // A card at zero keeps every one of them at neutral and goes quiet.
  // Two loud layers cancel; seven do nothing at all.
  const skin = !active
    ? { card: 'border-border bg-surface', num: 'text-text-faint', chip: '' }
    : {
        warn: {
          card: 'border-status-pending-ring/60 bg-status-pending-bg',
          num: 'text-status-pending-fg',
          chip: 'bg-status-pending-fg text-[color:var(--color-bg)]',
        },
        bad: {
          card: 'border-status-failed-ring/60 bg-status-failed-bg',
          num: 'text-status-failed-fg',
          chip: 'bg-status-failed-fg text-[color:var(--color-bg)]',
        },
        info: {
          card: 'border-status-confirmed-ring/60 bg-status-confirmed-bg',
          num: 'text-status-confirmed-fg',
          chip: 'bg-status-confirmed-fg text-[color:var(--color-bg)]',
        },
        neutral: {
          card: 'border-accent-ring bg-accent-tint',
          num: 'text-accent',
          chip: 'bg-accent text-accent-fg',
        },
      }[tone];

  return (
    <Link
      href={href}
      className={`block rounded-lg border p-3 transition-colors hover:border-border-strong ${skin.card}`}
      aria-label={`${area}: ${label}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-text-muted text-[11px] font-semibold tracking-[0.08em] uppercase">
          {area}
        </span>
        {active && badge !== undefined ? (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase ${skin.chip}`}
          >
            {badge}
          </span>
        ) : (
          <span
            className={
              active
                ? 'bg-status-pending-fg h-1.5 w-1.5 rounded-full'
                : 'bg-status-delivered-fg h-1.5 w-1.5 rounded-full'
            }
            aria-hidden="true"
          />
        )}
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        {loading ? (
          <Skeleton className="h-8 w-10" />
        ) : (
          <span className={`text-3xl leading-none font-bold tabular-nums ${skin.num}`}>
            {count ?? 0}
          </span>
        )}
        <span className="text-text-muted text-xs">{label.toLowerCase()}</span>
      </div>

      <div className="text-text-strong mt-1.5 text-sm font-semibold">{label}</div>
      <p className="text-text-muted mt-0.5 text-xs leading-snug">{hint}</p>
      <div className="mt-2 text-xs font-semibold">
        {active ? (
          <span className={skin.num}>Open →</span>
        ) : (
          <span className="text-text-faint">Clear</span>
        )}
      </div>
    </Link>
  );
}

// ── section 02: performance ───────────────────────────────────────────

function MetricCard({
  label,
  value,
  chip,
  chipTone = 'neutral',
  hint,
  bar,
  barTone = 'accent',
  valueTone = 'default',
  loading,
}: {
  label: string;
  value: string;
  chip?: string | undefined;
  chipTone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info';
  hint: string;
  bar?: number | undefined;
  barTone?: 'accent' | 'good' | 'warn' | 'bad';
  valueTone?: 'default' | 'good' | 'warn' | 'bad' | 'accent';
  loading: boolean;
}): ReactElement {
  // Filled chips, not outlines. A pale outline on a dark card is
  // invisible at a glance, and the chip is the fastest read on the card
  // — it says whether the number is good news before the number is.
  const chipClass = {
    neutral: 'bg-surface-hover text-text-body',
    good: 'bg-status-delivered-fg text-[color:var(--color-bg)]',
    warn: 'bg-status-pending-fg text-[color:var(--color-bg)]',
    bad: 'bg-status-failed-fg text-[color:var(--color-bg)]',
    info: 'bg-status-confirmed-fg text-[color:var(--color-bg)]',
  }[chipTone];
  const barClass = {
    accent: 'bg-accent',
    good: 'bg-status-delivered-fg',
    warn: 'bg-status-pending-fg',
    bad: 'bg-status-failed-fg',
  }[barTone];
  const valueClass = {
    default: 'text-text-bright',
    good: 'text-status-delivered-fg',
    warn: 'text-status-pending-fg',
    bad: 'text-status-failed-fg',
    accent: 'text-accent',
  }[valueTone];

  return (
    <div className="border-border bg-surface rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-text-muted text-xs font-medium">{label}</div>
        {chip !== undefined && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${chipClass}`}>{chip}</span>
        )}
      </div>
      <div className={`mt-2 text-2xl leading-none font-bold tabular-nums ${valueClass}`}>
        {loading ? <Skeleton className="h-7 w-16" /> : value}
      </div>
      <p className="text-text-muted mt-1.5 text-xs">{hint}</p>
      {bar !== undefined && (
        <div className="bg-surface-hover mt-2.5 h-1.5 w-full overflow-hidden rounded-full">
          <div
            className={`h-full rounded-full ${barClass}`}
            style={{ width: `${Math.max(2, Math.min(100, bar * 100))}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ── section 03: money ─────────────────────────────────────────────────

function MoneyCard({
  label,
  amount,
  hint,
  footLeft,
  footRight,
  icon,
  iconTone,
  loading,
  emphasis = false,
}: {
  label: string;
  amount: string | undefined;
  hint: string;
  footLeft: string;
  footRight?: ReactNode;
  icon: ReactNode;
  iconTone: 'good' | 'bad' | 'info' | 'accent';
  loading: boolean;
  emphasis?: boolean;
}): ReactElement {
  // The icon is the only colour on a money card, and it is doing real
  // work: four cards of identical shape are told apart by it before any
  // of the labels are read. Money IN is green, money OUT is red, money
  // MOVED is blue, money we still HOLD is the accent.
  const iconClass = {
    good: 'text-status-delivered-fg bg-status-delivered-bg',
    bad: 'text-status-failed-fg bg-status-failed-bg',
    info: 'text-status-confirmed-fg bg-status-confirmed-bg',
    accent: 'text-accent bg-accent-tint',
  }[iconTone];

  return (
    <div
      className={[
        'rounded-lg border p-3',
        emphasis ? 'border-accent-ring bg-accent-tint' : 'border-border bg-surface',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-text-strong text-sm font-semibold">{label}</div>
        <span className={`grid h-6 w-6 place-items-center rounded ${iconClass}`}>{icon}</span>
      </div>
      <div className="text-text-bright mt-2 text-2xl font-bold">
        {loading || amount === undefined ? (
          <Skeleton className="h-7 w-28" />
        ) : (
          <Money amount={amount} size="md" />
        )}
      </div>
      <p className="text-text-muted mt-1.5 text-xs leading-snug">{hint}</p>
      <div className="border-border mt-2.5 flex items-center justify-between gap-2 border-t pt-2 text-xs">
        <span className="text-text-muted">{footLeft}</span>
        {footRight}
      </div>
    </div>
  );
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function DashboardView(): ReactElement {
  const canOrders = usePermission('orders.view');
  const canTickets = usePermission('tickets.view');
  const canMoney = usePermission('money.view');
  const canReports = usePermission('reports.view');

  const orders = { enabled: canOrders };
  const awaitingCall = useOrdersList({ ...COUNT_ONLY, status: 'PENDING_CONFIRMATION' }, orders);
  const awaitingSeller = useOrdersList(
    { ...COUNT_ONLY, status: 'AWAITING_SELLER_DECISION' },
    orders,
  );
  const toPick = useOrdersList({ ...COUNT_ONLY, status: 'CONFIRMED' }, orders);
  const manualPlacement = useOrdersList(
    { ...COUNT_ONLY, status: 'PENDING_MANUAL_PLACEMENT' },
    orders,
  );
  const outOfStock = useOrdersList({ ...COUNT_ONLY, status: 'OUT_OF_STOCK' }, orders);
  const openTickets = useTicketsList({ ...COUNT_ONLY, status: 'OPEN' }, { enabled: canTickets });
  const pendingWithdrawals = useWithdrawalsList(
    { ...COUNT_ONLY, status: 'PENDING' },
    { enabled: canMoney },
  );

  const summary = useReportSummary(undefined, { enabled: canReports });
  const nothingToShow = !canOrders && !canTickets && !canMoney && !canReports;

  const needingAttention = [
    awaitingCall.data?.total,
    awaitingSeller.data?.total,
    manualPlacement.data?.total,
    outOfStock.data?.total,
    openTickets.data?.total,
    pendingWithdrawals.data?.total,
  ].reduce<number>((n, c) => n + ((c ?? 0) > 0 ? 1 : 0), 0);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2.5">
        <PageHeader
          title="Overview"
          subtitle="What is waiting on someone right now, and how the last 30 days have gone."
        />
        <span className="bg-status-delivered-bg text-status-delivered-fg mt-0.5 flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.08em] uppercase">
          <span className="bg-status-delivered-fg h-1.5 w-1.5 rounded-full" aria-hidden="true" />
          Live operations
        </span>
      </div>

      {nothingToShow && (
        <Card>
          <CardBody>
            <p className="text-text-body text-sm">
              Your account has no permissions that show anything here yet. Ask a super admin to
              grant the areas you work in.
            </p>
          </CardBody>
        </Card>
      )}

      {(canOrders || canTickets || canMoney) && (
        <>
          <SectionHead
            index="SECTION 01"
            title="Operations attention queue"
            icon={<AlertTriangle size={14} />}
            iconTone="warn"
            note={
              needingAttention === 0
                ? 'Nothing is waiting on a person'
                : `${needingAttention} ${needingAttention === 1 ? 'queue needs' : 'queues need'} staff attention`
            }
          />
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
            {canOrders && (
              <>
                <AttentionCard
                  href="/call-center/queue"
                  area="Call centre"
                  label="Awaiting call"
                  count={awaitingCall.data?.total}
                  loading={awaitingCall.isLoading}
                  hint="Customer not yet reached."
                  badge="P0"
                  tone="warn"
                />
                <AttentionCard
                  href="/orders?status=AWAITING_SELLER_DECISION"
                  area="Merchant"
                  label="Seller decision"
                  count={awaitingSeller.data?.total}
                  loading={awaitingSeller.isLoading}
                  hint="Call cap reached; awaiting the seller."
                  badge="Action"
                  tone="warn"
                />
                <AttentionCard
                  href="/warehouse/printing"
                  area="Warehouse"
                  label="To pick"
                  count={toPick.data?.total}
                  loading={toPick.isLoading}
                  hint="Confirmed and ready for a picking batch."
                />
                <AttentionCard
                  href="/manual-placement"
                  area="Dispatch"
                  label="Manual placement"
                  count={manualPlacement.data?.total}
                  loading={manualPlacement.isLoading}
                  hint="No courier would carry it; needs arranging."
                  badge="Blocked"
                  tone="bad"
                />
                <AttentionCard
                  href="/orders?status=OUT_OF_STOCK"
                  area="Stock"
                  label="Out of stock"
                  count={outOfStock.data?.total}
                  loading={outOfStock.isLoading}
                  hint="Confirmed orders with nothing on the shelf."
                  badge="Blocked"
                  tone="bad"
                />
              </>
            )}
            {canTickets && (
              <AttentionCard
                href="/tickets"
                area="Support"
                label="Open tickets"
                count={openTickets.data?.total}
                loading={openTickets.isLoading}
                hint="Damage claims, missing items, seller issues."
                badge="Action"
                tone="warn"
              />
            )}
            {canMoney && (
              <AttentionCard
                href="/withdrawals"
                area="Settlements"
                label="Withdrawal requests"
                count={pendingWithdrawals.data?.total}
                loading={pendingWithdrawals.isLoading}
                hint="Sellers waiting to be paid out."
                badge="Escrow"
                tone="warn"
              />
            )}
          </div>
        </>
      )}

      {canReports && (
        <>
          <SectionHead
            index="SECTION 02"
            title="Performance & fulfilment (last 30 days)"
            icon={<TrendingUp size={14} />}
            iconTone="good"
            note={
              <span className="flex flex-wrap items-center gap-3">
                {(
                  [
                    ['bg-accent', 'Confirmed'],
                    ['bg-status-delivered-fg', 'Delivered'],
                    ['bg-status-failed-fg', 'Returned'],
                  ] as ReadonlyArray<[string, string]>
                ).map(([dot, name]) => (
                  <span key={name} className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
                    {name}
                  </span>
                ))}
              </span>
            }
          />
          {summary.isError ? (
            <ErrorState
              message={summary.error?.message ?? 'Could not load the summary.'}
              retry={() => void summary.refetch()}
            />
          ) : (
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
              <MetricCard
                label="Orders created"
                value={summary.data?.orders.created.toLocaleString('en-IN') ?? '—'}
                hint="Total pipeline orders."
                loading={summary.isLoading}
              />
              <MetricCard
                label="Confirmed on call"
                value={summary.data === undefined ? '—' : pct(summary.data.orders.confirmRate)}
                hint="Reached and confirmed by an agent."
                chip={
                  summary.data === undefined
                    ? undefined
                    : `${summary.data.orders.confirmed}/${summary.data.orders.created}`
                }
                chipTone="info"
                valueTone="accent"
                bar={summary.data?.orders.confirmRate}
                loading={summary.isLoading}
              />
              <MetricCard
                label="Delivered"
                value={summary.data === undefined ? '—' : pct(summary.data.orders.deliveryRate)}
                hint="Of everything dispatched."
                bar={summary.data?.orders.deliveryRate}
                barTone="good"
                chip={summary.data === undefined ? undefined : 'Completed'}
                chipTone="good"
                valueTone="good"
                loading={summary.isLoading}
              />
              <MetricCard
                label="Returned (RTO)"
                value={summary.data === undefined ? '—' : pct(summary.data.orders.rtoRate)}
                hint="Came back instead of delivering."
                chip={summary.data?.orders.rtoRate === 0 ? 'Zero RTO' : 'Returns'}
                chipTone={summary.data?.orders.rtoRate === 0 ? 'good' : 'bad'}
                valueTone={summary.data?.orders.rtoRate === 0 ? 'good' : 'bad'}
                bar={summary.data?.orders.rtoRate}
                barTone="bad"
                loading={summary.isLoading}
              />
              <MetricCard
                label="Rejected on NDR"
                value={summary.data === undefined ? '—' : pct(summary.data.orders.ndrRate)}
                hint="Gave up after repeated failed delivery."
                chip={summary.data?.orders.ndrRate === 0 ? 'No cases' : 'Cases'}
                chipTone={summary.data?.orders.ndrRate === 0 ? 'good' : 'bad'}
                valueTone={summary.data?.orders.ndrRate === 0 ? 'good' : 'bad'}
                bar={summary.data?.orders.ndrRate}
                barTone="bad"
                loading={summary.isLoading}
              />
              <MetricCard
                label="Dispatched"
                value={summary.data?.shipments.dispatched.toLocaleString('en-IN') ?? '—'}
                hint="Parcels handed to a courier."
                chip="In transit"
                chipTone="info"
                valueTone="accent"
                loading={summary.isLoading}
              />
            </div>
          )}
        </>
      )}

      {canReports && canMoney && (
        <>
          <SectionHead
            index="SECTION 03"
            title="Financial treasury & settlements"
            icon={<Landmark size={14} />}
            note={
              <Link href="/treasury" className="text-accent font-medium">
                Complete ledger →
              </Link>
            }
          />
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-4">
            <MoneyCard
              label="COD collected"
              amount={summary.data?.wallet.codCollected}
              hint="Customer payments gathered on delivery."
              icon={<Banknote size={13} />}
              iconTone="good"
              footLeft="From courier settlements"
              loading={summary.isLoading}
            />
            <MoneyCard
              label="Charges debited"
              amount={summary.data?.wallet.chargesDebited}
              hint="Freight, fulfilment and return fees."
              icon={<Receipt size={13} />}
              iconTone="bad"
              footLeft="Auto-debited from wallets"
              loading={summary.isLoading}
            />
            <MoneyCard
              label="Remitted to sellers"
              amount={summary.data?.wallet.remittancesPaid}
              hint="Paid out to seller bank accounts."
              icon={<Send size={13} />}
              iconTone="info"
              footLeft="Completed remittances"
              loading={summary.isLoading}
            />
            <MoneyCard
              label="Outstanding owed"
              amount={summary.data?.wallet.netOutstanding}
              hint="Seller balances we hold and have not yet paid out."
              icon={<Wallet size={13} />}
              iconTone="accent"
              footLeft="Wallet liability"
              footRight={
                <Link href="/what-we-owe" className="text-accent font-medium">
                  View ledger →
                </Link>
              }
              loading={summary.isLoading}
              emphasis
            />
          </div>
        </>
      )}

      <div className="text-text-faint mt-8 flex items-center gap-1.5 text-xs">
        <Activity size={12} />
        Figures cover the last 30 days and refresh when you reload.
      </div>
    </div>
  );
}
