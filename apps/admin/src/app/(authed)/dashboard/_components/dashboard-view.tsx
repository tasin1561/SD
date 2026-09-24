'use client';

import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Info,
  Banknote,
  Landmark,
  Receipt,
  Send,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { KpiCard, Odometer, type KpiTone } from '@skydrop/ui/app/kpi-card';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { TooltipCard } from '@skydrop/ui/app/tooltip-card';
import { useOrdersList, useReportSummary } from '@/lib/api-hooks';
import { useTicketsList, useWithdrawalsList } from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { AfCard, MetaFact, Meter } from '@/app/(authed)/system/_components/af-parts';
import './dashboard.css';

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

/** A plain sentence-case heading with its icon; no index, no eyebrow. */
function SectionHead({
  title,
  icon,
  iconTone = 'accent',
  note,
}: {
  title: string;
  icon: ReactNode;
  iconTone?: 'accent' | 'warn' | 'good';
  note?: ReactNode;
}): ReactElement {
  return (
    <SectionHeading
      className="db-head"
      title={
        <span className="db-head__title">
          <span className="db-head__icon" data-tone={iconTone} aria-hidden>
            {icon}
          </span>
          {title}
        </span>
      }
      note={note}
    />
  );
}

// ── the attention queue ───────────────────────────────────────────────

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
  //
  // The WHOLE card opens its page: the label is a link whose ::after
  // covers the card (a button cannot sit inside a link, and the (i) needs
  // to be one). The (i) sits above that cover, so it explains without
  // navigating; the explanation lives there, not as a line on the card.
  return (
    <div
      className="db-attn"
      data-tone={active ? tone : undefined}
      data-active={active ? '1' : undefined}
    >
      <div className="db-attn__top">
        <span className="db-attn__area">{area}</span>
        {active && badge !== undefined ? (
          <span className="db-attn__badge">{badge}</span>
        ) : (
          <span className="db-attn__dot" data-on={active ? '1' : undefined} aria-hidden="true" />
        )}
      </div>

      <div className="db-attn__figure-row">
        {loading ? (
          <Skeleton width="2.5rem" height="2rem" />
        ) : (
          // A plain count rolls up once, on first mount; a refetch just
          // shows the new number.
          <Odometer value={count ?? 0} className="db-attn__figure" />
        )}
        <span className="db-attn__unit">{label.toLowerCase()}</span>
      </div>

      <div className="db-attn__label-row">
        <Link href={href} className="db-attn__link" aria-label={`${area}: ${label}`}>
          {label}
        </Link>
        <TooltipCard title="What this counts" description={hint}>
          <button type="button" className="db-attn__info" aria-label={`About ${label}`}>
            <Info size={14} aria-hidden />
          </button>
        </TooltipCard>
      </div>
    </div>
  );
}

// ── performance ───────────────────────────────────────────────────────

type ChipTone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';
type BarTone = 'accent' | 'good' | 'warn' | 'bad';
type ValueTone = 'default' | 'good' | 'warn' | 'bad' | 'accent';

const VALUE_KPI_TONE: Record<ValueTone, KpiTone> = {
  default: 'neutral',
  good: 'credit',
  warn: 'pending',
  bad: 'debit',
  accent: 'info',
};

function MetricCard({
  label,
  value,
  count,
  chip,
  chipTone = 'neutral',
  hint,
  bar,
  barTone = 'accent',
  valueTone = 'default',
  loading,
}: {
  label: string;
  /** A ready string (a rate). */
  value?: string;
  /** A plain count — rolled once by the odometer. */
  count?: number | undefined;
  chip?: string | undefined;
  chipTone?: ChipTone;
  hint: string;
  bar?: number | undefined;
  barTone?: BarTone;
  valueTone?: ValueTone;
  loading: boolean;
}): ReactElement {
  // Filled chips, not outlines. A pale outline on a card is invisible at
  // a glance, and the chip is the fastest read on the card — it says
  // whether the number is good news before the number is.
  const chipNode =
    chip === undefined ? undefined : (
      <span className="db-chip" data-tone={chipTone}>
        {chip}
      </span>
    );
  const hintNode = (
    <span className="db-metric__hint">
      <span>{hint}</span>
      {bar !== undefined && <Meter value={Math.max(0.02, Math.min(1, bar))} tone={barTone} />}
    </span>
  );
  const tone = VALUE_KPI_TONE[valueTone];
  if (loading) {
    return (
      <KpiCard
        label={label}
        figure={<Skeleton width="4rem" height="1.75rem" />}
        chip={chipNode}
        hint={hintNode}
        tone={tone}
      />
    );
  }
  if (count !== undefined) {
    return (
      <KpiCard
        label={label}
        value={count}
        format={(n) => n.toLocaleString('en-IN')}
        chip={chipNode}
        hint={hintNode}
        tone={tone}
      />
    );
  }
  return (
    <KpiCard label={label} figure={value ?? '—'} chip={chipNode} hint={hintNode} tone={tone} />
  );
}

// ── money ─────────────────────────────────────────────────────────────

const MONEY_TONE: Record<'good' | 'bad' | 'info' | 'accent', KpiTone> = {
  good: 'credit',
  bad: 'debit',
  info: 'info',
  accent: 'pending',
};

/**
 * A money tile. The figure is the caller's own `<Money>` node, exactly as
 * before; the KPI card only draws around it.
 */
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
  // The icon is doing real work: four cards of identical shape are told
  // apart by it before any of the labels are read. Money IN is green,
  // money OUT is red, money MOVED is blue, money we still HOLD is the
  // accent.
  return (
    <KpiCard
      className={emphasis ? 'db-money db-money--emphasis' : 'db-money'}
      label={label}
      icon={icon}
      tone={MONEY_TONE[iconTone]}
      figure={
        loading || amount === undefined ? (
          <Skeleton width="7rem" height="1.75rem" />
        ) : (
          <Money amount={amount} size="md" />
        )
      }
      hint={hint}
      foot={[{ label: footLeft, value: footRight ?? '' }]}
    />
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
    <div className="af-page">
      <PageHeader
        title="Overview"
        subtitle="What is waiting on someone right now, and how the last 30 days have gone."
        meta={
          <MetaFact tone="good" dot>
            Live operations
          </MetaFact>
        }
      />

      {nothingToShow && (
        <AfCard>
          <p className="af-body">
            Your account has no permissions that show anything here yet. Ask a super admin to grant
            the areas you work in.
          </p>
        </AfCard>
      )}

      {(canOrders || canTickets || canMoney) && (
        <section className="db-section">
          <SectionHead
            title="Operations attention queue"
            icon={<AlertTriangle size={14} />}
            iconTone="warn"
            note={
              needingAttention === 0
                ? 'Nothing is waiting on a person'
                : `${needingAttention} ${needingAttention === 1 ? 'queue needs' : 'queues need'} staff attention`
            }
          />
          <div className="db-attn-grid">
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
        </section>
      )}

      {canReports && (
        <section className="db-section">
          <SectionHead
            title="Performance & fulfilment (last 30 days)"
            icon={<TrendingUp size={14} />}
            iconTone="good"
            note={
              <span className="db-legend">
                {(
                  [
                    ['accent', 'Confirmed'],
                    ['good', 'Delivered'],
                    ['bad', 'Returned'],
                  ] as ReadonlyArray<[string, string]>
                ).map(([dot, name]) => (
                  <span key={name} className="db-legend__item">
                    <span className="db-legend__dot" data-tone={dot} aria-hidden="true" />
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
            <div className="db-metric-grid">
              <MetricCard
                label="Orders created"
                count={summary.data?.orders.created}
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
                count={summary.data?.shipments.dispatched}
                hint="Parcels handed to a courier."
                chip="In transit"
                chipTone="info"
                valueTone="accent"
                loading={summary.isLoading}
              />
            </div>
          )}
        </section>
      )}

      {canReports && canMoney && (
        <section className="db-section">
          <SectionHead
            title="Financial treasury & settlements"
            icon={<Landmark size={14} />}
            note={
              <Link href="/treasury" className="af-link">
                Complete ledger →
              </Link>
            }
          />
          <div className="db-money-grid">
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
                <Link href="/what-we-owe" className="af-link">
                  View ledger →
                </Link>
              }
              loading={summary.isLoading}
              emphasis
            />
          </div>
        </section>
      )}

      <div className="db-foot">
        <Activity size={12} aria-hidden />
        Figures cover the last 30 days and refresh when you reload.
      </div>
    </div>
  );
}
