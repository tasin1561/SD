'use client';

import { useState, type ReactElement } from 'react';
import { Money } from '@skydrop/ui/components';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { DateField } from '@skydrop/ui/app/date-field';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { KpiCard, type KpiTone } from '@skydrop/ui/app/kpi-card';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import type { ReportSummary } from '@skydrop/api-client';
import { useReportSummary } from '@/lib/api-hooks';
import { MoCard } from '../../treasury/_components/money-parts';
import './reports.css';

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
    <div className="mo-page">
      <PageHeader
        title="Reports"
        subtitle="Operational metrics across the date range. Confirm + NDR + RTO + delivery rates; dispatch times; wallet flows."
      />

      <MoCard>
        <div className="rp-range">
          <DateField
            id="reports-from"
            label="From"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <DateField
            id="reports-to"
            label="To (exclusive)"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <span className="mo-faint rp-utc">UTC</span>
        </div>
      </MoCard>

      {summary.isLoading ? (
        <div className="rp-skeletons">
          <Skeleton rounded="md" height={224} />
          <Skeleton rounded="md" height={224} />
          <Skeleton rounded="md" height={224} />
          <Skeleton rounded="md" height={224} />
        </div>
      ) : summary.isError ? (
        <ErrorState
          message={summary.error?.message ?? 'Failed.'}
          retry={() => void summary.refetch()}
        />
      ) : !summary.data ? (
        <ErrorState message="No data." />
      ) : (
        <div className="mo-stack rp-groups">
          <OrdersGroup data={summary.data.orders} />
          <ShipmentsGroup data={summary.data.shipments} />
          <WalletGroup data={summary.data.wallet} />
        </div>
      )}
    </div>
  );
}

function OrdersGroup({ data }: { readonly data: ReportSummary['orders'] }): ReactElement {
  return (
    <section className="rp-group">
      <SectionHeading title="Orders" />
      <div className="mo-kpis">
        <KpiCard label="Created" value={data.created} />
        <KpiCard label="Confirmed" value={data.confirmed} />
        <KpiCard label="Delivered" value={data.delivered} />
        <KpiCard label="RTO initiated" value={data.rtoInitiated} />
        <KpiCard label="Cancelled" value={data.cancelled} />
        <KpiCard label="Rejected (NDR)" value={data.rejectedNdr} />
      </div>
      <div className="mo-kpis">
        <KpiCard
          label="Confirm rate"
          figure={pct(data.confirmRate)}
          tone={rateTone(data.confirmRate >= 0.6 ? 'accent' : 'pending')}
        />
        <KpiCard
          label="Delivery rate"
          figure={pct(data.deliveryRate)}
          tone={rateTone(data.deliveryRate >= 0.85 ? 'accent' : 'pending')}
        />
        <KpiCard
          label="NDR rate"
          figure={pct(data.ndrRate)}
          tone={rateTone(data.ndrRate <= 0.1 ? 'accent' : 'critical')}
        />
        <KpiCard
          label="RTO rate"
          figure={pct(data.rtoRate)}
          tone={rateTone(data.rtoRate <= 0.15 ? 'accent' : 'critical')}
        />
      </div>
    </section>
  );
}

function ShipmentsGroup({ data }: { readonly data: ReportSummary['shipments'] }): ReactElement {
  return (
    <section className="rp-group">
      <SectionHeading title="Shipments" />
      <div className="mo-kpis">
        <KpiCard label="Dispatched" value={data.dispatched} />
        <KpiCard
          label="Avg hours to dispatch"
          hint="From CONFIRMED → DISPATCHED"
          figure={
            data.avgDispatchHoursFromConfirm === null
              ? '—'
              : `${data.avgDispatchHoursFromConfirm} h`
          }
        />
        <KpiCard
          label="Avg days to delivery"
          hint="From DISPATCHED → DELIVERED"
          figure={
            data.avgDeliveryDaysFromDispatch === null
              ? '—'
              : `${data.avgDeliveryDaysFromDispatch} d`
          }
        />
      </div>
    </section>
  );
}

function WalletGroup({ data }: { readonly data: ReportSummary['wallet'] }): ReactElement {
  return (
    <section className="rp-group">
      <SectionHeading title="Wallet flows (INR)" />
      {/* Direction is the whole point of this group: money in, money
          out, what is left. Money encodes it with a sign AND a colour,
          and groups the figure the Indian way. */}
      <div className="mo-kpis">
        <KpiCard
          label="COD collected"
          tone="credit"
          figure={<Money amount={data.codCollected} direction="credit" />}
        />
        <KpiCard
          label="Charges debited"
          tone="debit"
          figure={<Money amount={data.chargesDebited} direction="debit" />}
        />
        <KpiCard
          label="Remittances paid"
          tone="debit"
          figure={<Money amount={data.remittancesPaid} direction="debit" />}
        />
        <KpiCard
          label="Net outstanding"
          hint="Owed to sellers across all wallets"
          figure={<Money amount={data.netOutstanding} />}
        />
      </div>
    </section>
  );
}

/** The old stat tones, mapped onto the KPI card's: good, watch, bad. */
function rateTone(tone: 'accent' | 'pending' | 'critical'): KpiTone {
  return tone === 'accent' ? 'credit' : tone === 'pending' ? 'pending' : 'debit';
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
