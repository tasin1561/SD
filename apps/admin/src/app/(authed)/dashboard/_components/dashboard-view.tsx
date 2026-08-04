'use client';

import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import {
  Card,
  CardBody,
  ErrorState,
  Money,
  PageHeader,
  Section,
  Skeleton,
  Stat,
} from '@skydrop/ui/components';
import { useOrdersList, useReportSummary } from '@/lib/api-hooks';
import { useTicketsList, useWithdrawalsList } from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';

/**
 * The admin landing page.
 *
 * It replaces a CP1 placeholder that had shipped to production: a
 * "Welcome — feature areas land in CP2 of Module 12" heading over a
 * four-step manual test checklist. That was scaffolding, and it was the
 * first screen every staff member saw on sign-in.
 *
 * What replaces it answers the question someone actually opens this app
 * with: WHAT NEEDS ME TODAY. Work queues first, because each number is
 * a pile of orders waiting on a person; performance and money second,
 * because those are read rather than acted on.
 *
 * Every count comes from an existing list endpoint asked for exactly
 * one row — the total is in the envelope, and pulling a page of records
 * to count them would be wasteful.
 *
 * ── IT SHOWS WHAT YOU MAY SEE, AND ASKS FOR NOTHING ELSE ─────────────
 * This is the ONE page open to every staff member, so it is the page
 * where a permission gap shows up first. It used to fire all eight
 * queries regardless of the viewer: a call agent holds `orders.view`
 * and nothing else here, so they were served their own landing page
 * with a red "403 — does not hold reports.view" across the bottom and
 * two tiles stuck as grey rectangles, because a tile whose request had
 * failed only knew how to keep showing a skeleton.
 *
 * Each tile and each section now checks the permission its DATA needs,
 * and passes that same answer to the query's `enabled` — so a request
 * nobody may make is never sent, rather than sent and then hidden. What
 * is left is a smaller dashboard that is entirely true for whoever is
 * looking at it.
 */

/** Ask for the smallest page; we only want `total`. */
const COUNT_ONLY = { page: 1, pageSize: 1 } as const;

function QueueTile({
  href,
  label,
  count,
  hint,
  loading,
  tone = 'neutral',
}: {
  readonly href: string;
  readonly label: string;
  readonly count: number | undefined;
  readonly hint: string;
  readonly loading: boolean;
  readonly tone?: 'neutral' | 'warn' | 'bad';
}): ReactElement {
  return (
    <Link href={href} className="block focus-visible:outline-none">
      {loading || count === undefined ? (
        <Skeleton className="h-[104px]" />
      ) : (
        <Stat
          label={label}
          value={count.toLocaleString('en-IN')}
          hint={hint}
          // A queue at zero is not a warning, whatever it is when full.
          tone={count === 0 ? 'neutral' : tone}
          className="hover:border-border-strong h-full transition-colors"
        />
      )}
    </Link>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly hint?: string;
}): ReactElement {
  return (
    <div className="min-w-0">
      <div className="text-text-muted text-xs">{label}</div>
      <div className="text-text-bright mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      {hint !== undefined && <div className="text-text-faint mt-0.5 text-xs">{hint}</div>}
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

  // The queues. Each is "orders sitting in a state that needs a human".
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

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="What is waiting on someone right now, and how the last 30 days have gone."
      />

      <Section
        title="Needs attention"
        subtitle="Each number is orders or requests held in a state a person has to clear."
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {canOrders && (
            <>
              <QueueTile
                href="/call-center/queue"
                label="Awaiting call"
                count={awaitingCall.data?.total}
                loading={awaitingCall.isLoading}
                hint="Customer not yet reached"
                tone="warn"
              />
              <QueueTile
                href="/warehouse/pick"
                label="To pick"
                count={toPick.data?.total}
                loading={toPick.isLoading}
                hint="Confirmed, not started"
              />
              <QueueTile
                href="/orders?status=PENDING_MANUAL_PLACEMENT"
                label="Manual placement"
                count={manualPlacement.data?.total}
                loading={manualPlacement.isLoading}
                hint="Courier rejected the parcel"
                tone="bad"
              />
              <QueueTile
                href="/orders?status=OUT_OF_STOCK"
                label="Out of stock"
                count={outOfStock.data?.total}
                loading={outOfStock.isLoading}
                hint="Confirmed with no stock to reserve"
                tone="bad"
              />
              <QueueTile
                href="/holds"
                label="Seller decision"
                count={awaitingSeller.data?.total}
                loading={awaitingSeller.isLoading}
                hint="Call cap reached, seller asked"
                tone="warn"
              />
            </>
          )}
          {canTickets && (
            <QueueTile
              href="/tickets"
              label="Open tickets"
              count={openTickets.data?.total}
              loading={openTickets.isLoading}
              hint="Damage, scrap and seller issues"
              tone="warn"
            />
          )}
          {canMoney && (
            <QueueTile
              href="/withdrawals"
              label="Payout requests"
              count={pendingWithdrawals.data?.total}
              loading={pendingWithdrawals.isLoading}
              hint="Awaiting a remittance"
              tone="warn"
            />
          )}
        </div>
      </Section>

      {canReports &&
        (summary.isError ? (
          <Section title="Last 30 days">
            <ErrorState
              message={summary.error?.message ?? 'Could not load the summary.'}
              retry={() => void summary.refetch()}
            />
          </Section>
        ) : (
          <>
            <Section
              title="Last 30 days"
              subtitle="Rates are of orders created in the window, so a very recent order may not have reached its outcome yet."
            >
              <Card>
                <CardBody>
                  {summary.isLoading || !summary.data ? (
                    <Skeleton className="h-20" />
                  ) : (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
                      <Metric
                        label="Orders created"
                        value={summary.data.orders.created.toLocaleString('en-IN')}
                      />
                      <Metric
                        label="Confirmed on call"
                        value={pct(summary.data.orders.confirmRate)}
                        hint={`${summary.data.orders.confirmed.toLocaleString('en-IN')} orders`}
                      />
                      <Metric
                        label="Delivered"
                        value={pct(summary.data.orders.deliveryRate)}
                        hint={`${summary.data.orders.delivered.toLocaleString('en-IN')} orders`}
                      />
                      <Metric
                        label="Returned"
                        value={pct(summary.data.orders.rtoRate)}
                        hint={`${summary.data.orders.rtoInitiated.toLocaleString('en-IN')} RTOs`}
                      />
                      <Metric
                        label="Rejected on NDR"
                        value={pct(summary.data.orders.ndrRate)}
                        hint={`${summary.data.orders.rejectedNdr.toLocaleString('en-IN')} orders`}
                      />
                      <Metric
                        label="Dispatched"
                        value={summary.data.shipments.dispatched.toLocaleString('en-IN')}
                        hint={
                          summary.data.shipments.avgDispatchHoursFromConfirm === null
                            ? 'No dispatches yet'
                            : `${summary.data.shipments.avgDispatchHoursFromConfirm.toFixed(1)}h after confirm`
                        }
                      />
                    </div>
                  )}
                </CardBody>
              </Card>
            </Section>

            {canMoney && (
              <Section
                title="Money"
                subtitle="Collected from customers against what has been paid out. Outstanding is what sellers are still owed."
                action={
                  <Link
                    href="/settlements"
                    className="text-text-muted hover:text-text-body inline-flex min-h-[30px] items-center text-xs transition-colors"
                  >
                    Settlements →
                  </Link>
                }
              >
                <Card>
                  <CardBody>
                    {summary.isLoading || !summary.data ? (
                      <Skeleton className="h-20" />
                    ) : (
                      <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
                        <Metric
                          label="COD collected"
                          value={<Money amount={summary.data.wallet.codCollected} size="md" />}
                        />
                        <Metric
                          label="Charges debited"
                          value={<Money amount={summary.data.wallet.chargesDebited} size="md" />}
                        />
                        <Metric
                          label="Remitted to sellers"
                          value={<Money amount={summary.data.wallet.remittancesPaid} size="md" />}
                        />
                        <Metric
                          label="Outstanding"
                          value={<Money amount={summary.data.wallet.netOutstanding} size="md" />}
                          hint="Owed to sellers"
                        />
                      </div>
                    )}
                  </CardBody>
                </Card>
              </Section>
            )}
          </>
        ))}

      {nothingToShow && (
        <Card>
          <CardBody>
            <p className="text-text-muted text-sm">
              Your role does not open any of the overview panels. Use the menu on the left for the
              areas you do have — or ask a super admin if you are expecting more here.
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
