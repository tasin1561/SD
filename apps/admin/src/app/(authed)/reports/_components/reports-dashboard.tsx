'use client';

import { useState, type ReactElement, type ReactNode } from 'react';
import {
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Money,
  Skeleton,
  PageHeader,
} from '@skydrop/ui/components';
import type { ReportSummary } from '@skydrop/api-client';
import { useReportSummary } from '@/lib/api-hooks';

/**
 * Operational summary — 3 cards (orders / shipments / wallet) +
 * a date-range picker at the top. UTC throughout (the API treats
 * date params as UTC).
 *
 * Phase-1B scope = single summary card per area. Per-seller / per-day
 * timeseries breakdowns land later once the volume justifies them.
 */
export function ReportsDashboard(): ReactElement {
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(defaultTo());

  const summary = useReportSummary({
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports"
        subtitle="Operational metrics across the date range. Confirm + NDR + RTO + delivery rates; dispatch times; wallet flows."
      />

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 sm:flex-none">
              <div className="text-text-muted text-xs mb-1">From</div>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="sd-field w-full rounded-[5px] border border-border bg-bg px-3 py-1.5 text-sm text-text-bright transition-colors focus:border-accent focus:outline-none"
              />
            </div>
            <div className="min-w-0 flex-1 sm:flex-none">
              <div className="text-text-muted text-xs mb-1">To (exclusive)</div>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="sd-field w-full rounded-[5px] border border-border bg-bg px-3 py-1.5 text-sm text-text-bright transition-colors focus:border-accent focus:outline-none"
              />
            </div>
            <div className="text-text-faint text-xs ml-2">UTC</div>
          </div>
        </CardBody>
      </Card>

      {summary.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      ) : summary.isError ? (
        <ErrorState
          message={summary.error?.message ?? 'Failed.'}
          retry={() => void summary.refetch()}
        />
      ) : !summary.data ? (
        <ErrorState message="No data." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <OrdersCard data={summary.data.orders} />
          <ShipmentsCard data={summary.data.shipments} />
          <WalletCard data={summary.data.wallet} />
        </div>
      )}
    </div>
  );
}

function OrdersCard({ data }: { readonly data: ReportSummary['orders'] }): ReactElement {
  return (
    <Card>
      <CardHeader title="Orders" />
      <CardBody>
        <Stat label="Created" value={data.created} />
        <Stat label="Confirmed" value={data.confirmed} />
        <Stat label="Delivered" value={data.delivered} />
        <Stat label="RTO initiated" value={data.rtoInitiated} />
        <Stat label="Cancelled" value={data.cancelled} />
        <Stat label="Rejected (NDR)" value={data.rejectedNdr} />
        <div className="border-t border-border my-3" />
        <Stat
          label="Confirm rate"
          value={pct(data.confirmRate)}
          tone={data.confirmRate >= 0.6 ? 'accent' : 'pending'}
        />
        <Stat
          label="Delivery rate"
          value={pct(data.deliveryRate)}
          tone={data.deliveryRate >= 0.85 ? 'accent' : 'pending'}
        />
        <Stat
          label="NDR rate"
          value={pct(data.ndrRate)}
          tone={data.ndrRate <= 0.1 ? 'accent' : 'critical'}
        />
        <Stat
          label="RTO rate"
          value={pct(data.rtoRate)}
          tone={data.rtoRate <= 0.15 ? 'accent' : 'critical'}
        />
      </CardBody>
    </Card>
  );
}

function ShipmentsCard({ data }: { readonly data: ReportSummary['shipments'] }): ReactElement {
  return (
    <Card>
      <CardHeader title="Shipments" />
      <CardBody>
        <Stat label="Dispatched" value={data.dispatched} />
        <Stat
          label="Avg hours to dispatch"
          hint="From CONFIRMED → DISPATCHED"
          value={
            data.avgDispatchHoursFromConfirm === null
              ? '—'
              : `${data.avgDispatchHoursFromConfirm} h`
          }
        />
        <Stat
          label="Avg days to delivery"
          hint="From DISPATCHED → DELIVERED"
          value={
            data.avgDeliveryDaysFromDispatch === null
              ? '—'
              : `${data.avgDeliveryDaysFromDispatch} d`
          }
        />
      </CardBody>
    </Card>
  );
}

function WalletCard({ data }: { readonly data: ReportSummary['wallet'] }): ReactElement {
  return (
    <Card>
      <CardHeader title="Wallet flows (INR)" />
      <CardBody>
        {/* Direction is the whole point of this card: money in, money
            out, what is left. Money encodes it with a sign AND a colour,
            and groups the figure the Indian way. */}
        <Stat
          label="COD collected"
          value={<Money amount={data.codCollected} direction="credit" />}
        />
        <Stat
          label="Charges debited"
          value={<Money amount={data.chargesDebited} direction="debit" />}
        />
        <Stat
          label="Remittances paid"
          value={<Money amount={data.remittancesPaid} direction="debit" />}
        />
        <div className="border-t border-border my-3" />
        <Stat
          label="Net outstanding"
          hint="Owed to sellers across all wallets"
          value={<Money amount={data.netOutstanding} />}
        />
      </CardBody>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = 'body',
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly hint?: string;
  readonly tone?: 'body' | 'accent' | 'pending' | 'critical';
}): ReactElement {
  const colorClass =
    tone === 'accent'
      ? 'text-accent'
      : tone === 'pending'
        ? 'text-pending'
        : tone === 'critical'
          ? 'text-critical'
          : 'text-text-bright';
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <div>
        <div className="text-text-muted text-xs">{label}</div>
        {hint && <div className="text-text-faint text-[10px] mt-0.5">{hint}</div>}
      </div>
      <div className={`skydrop-tabular ${colorClass}`}>{value}</div>
    </div>
  );
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function defaultFrom(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
