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
import { useT } from '@/i18n/client';

/**
 * Operational summary — 3 cards (orders / shipments / wallet) +
 * a date-range picker at the top. UTC throughout (the API treats
 * date params as UTC).
 *
 * Phase-1B scope = single summary card per area. Per-seller / per-day
 * timeseries breakdowns land later once the volume justifies them.
 */
export function ReportsDashboard(): ReactElement {
  const t = useT();
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(defaultTo());

  const summary = useReportSummary({
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
  });

  return (
    <div className="mo-page">
      <PageHeader
        title={t('reportsReportsDashboard.reports')}
        subtitle={t('reportsReportsDashboard.operationalMetricsAcrossTheDate')}
      />

      <MoCard>
        <div className="rp-range">
          <DateField
            id="reports-from"
            label={t('reportsReportsDashboard.from')}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <DateField
            id="reports-to"
            label={t('reportsReportsDashboard.toExclusive')}
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
          message={summary.error?.message ?? t('reportsReportsDashboard.failed')}
          retry={() => void summary.refetch()}
        />
      ) : !summary.data ? (
        <ErrorState message={t('reportsReportsDashboard.noData')} />
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
  const t = useT();
  return (
    <section className="rp-group">
      <SectionHeading title={t('reportsReportsDashboard.orders')} />
      <div className="mo-kpis">
        <KpiCard label={t('reportsReportsDashboard.created')} value={data.created} />
        <KpiCard label={t('reportsReportsDashboard.confirmed')} value={data.confirmed} />
        <KpiCard label={t('reportsReportsDashboard.delivered')} value={data.delivered} />
        <KpiCard label={t('reportsReportsDashboard.rtoInitiated')} value={data.rtoInitiated} />
        <KpiCard label={t('reportsReportsDashboard.cancelled')} value={data.cancelled} />
        <KpiCard label={t('reportsReportsDashboard.rejectedNdr')} value={data.rejectedNdr} />
      </div>
      <div className="mo-kpis">
        <KpiCard
          label={t('reportsReportsDashboard.confirmRate')}
          figure={pct(data.confirmRate)}
          tone={rateTone(data.confirmRate >= 0.6 ? 'accent' : 'pending')}
        />
        <KpiCard
          label={t('reportsReportsDashboard.deliveryRate')}
          figure={pct(data.deliveryRate)}
          tone={rateTone(data.deliveryRate >= 0.85 ? 'accent' : 'pending')}
        />
        <KpiCard
          label={t('reportsReportsDashboard.ndrRate')}
          figure={pct(data.ndrRate)}
          tone={rateTone(data.ndrRate <= 0.1 ? 'accent' : 'critical')}
        />
        <KpiCard
          label={t('reportsReportsDashboard.rtoRate')}
          figure={pct(data.rtoRate)}
          tone={rateTone(data.rtoRate <= 0.15 ? 'accent' : 'critical')}
        />
      </div>
    </section>
  );
}

function ShipmentsGroup({ data }: { readonly data: ReportSummary['shipments'] }): ReactElement {
  const t = useT();
  return (
    <section className="rp-group">
      <SectionHeading title={t('reportsReportsDashboard.shipments')} />
      <div className="mo-kpis">
        <KpiCard label={t('reportsReportsDashboard.dispatched')} value={data.dispatched} />
        <KpiCard
          label={t('reportsReportsDashboard.avgHoursToDispatch')}
          hint={t('reportsReportsDashboard.fromConfirmedDispatched')}
          figure={
            data.avgDispatchHoursFromConfirm === null
              ? '—'
              : `${data.avgDispatchHoursFromConfirm} h`
          }
        />
        <KpiCard
          label={t('reportsReportsDashboard.avgDaysToDelivery')}
          hint={t('reportsReportsDashboard.fromDispatchedDelivered')}
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
  const t = useT();
  return (
    <section className="rp-group">
      <SectionHeading title={t('reportsReportsDashboard.walletFlowsInr')} />
      {/* Direction is the whole point of this group: money in, money
          out, what is left. Money encodes it with a sign AND a colour,
          and groups the figure the Indian way. */}
      <div className="mo-kpis">
        <KpiCard
          label={t('reportsReportsDashboard.codCollected')}
          tone="credit"
          figure={<Money amount={data.codCollected} direction="credit" />}
        />
        <KpiCard
          label={t('reportsReportsDashboard.chargesDebited')}
          tone="debit"
          figure={<Money amount={data.chargesDebited} direction="debit" />}
        />
        <KpiCard
          label={t('reportsReportsDashboard.remittancesPaid')}
          tone="debit"
          figure={<Money amount={data.remittancesPaid} direction="debit" />}
        />
        <KpiCard
          label={t('reportsReportsDashboard.netOutstanding')}
          hint={t('reportsReportsDashboard.owedToClientsAcrossAll')}
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
