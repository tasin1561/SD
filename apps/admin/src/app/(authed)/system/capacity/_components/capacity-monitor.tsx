'use client';

import { useEffect, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { AfCard, Meter } from '@/app/(authed)/system/_components/af-parts';
import './capacity.css';
import { useCapacityReport, type CapacityMetric, type CapacityStatus } from '@/lib/api-hooks';

/**
 * What is running out, how fast, and what to do about it.
 *
 * The failures this page exists for do not arrive as a slowdown. A full
 * database disk does not get gradually slower — it works perfectly and
 * then refuses every write. The connection limit does not degrade — the
 * twenty-sixth caller gets an error while the first twenty-five are
 * fine. Both look like an outage rather than a trend, which is the
 * whole argument for a gauge.
 *
 * So the design is deliberately unlike a metrics dashboard. There are
 * no sparklines and no history, because the question is not "what has
 * been happening" — it is "how close are we, and what do I buy". Every
 * reading therefore carries two sentences of prose: what breaks when it
 * fills, and what to do. A number without those has moved the problem
 * to whoever is reading it at 3am.
 *
 * It also says where each ceiling CAME from. Postgres knows its
 * connection limit; it does not know how much disk the plan bought. A
 * ceiling read from a setting is only as true as the last person to
 * update it, and a gauge that hides that distinction is worse than one
 * that admits it.
 */

const REFRESH_MS = 15_000;

/** Each status's words and the tone its gauge and figure take. */
const TONE: Record<CapacityStatus, { tone: 'good' | 'warn' | 'bad' | 'critical'; label: string }> =
  {
    OK: { tone: 'good', label: 'Healthy' },
    WATCH: { tone: 'warn', label: 'Watch' },
    WARNING: { tone: 'bad', label: 'Plan the work' },
    CRITICAL: { tone: 'critical', label: 'Acting soon is not optional' },
  };

function Gauge({
  percent,
  status,
}: {
  percent: number | null;
  status: CapacityStatus;
}): ReactElement {
  const tone = TONE[status].tone;
  // A null percent means we do not know the ceiling. Showing an empty
  // bar would read as "plenty of room", which is the opposite of true.
  if (percent === null) {
    return <span className="cap-unknown" aria-hidden />;
  }
  return (
    <Meter
      value={Math.min(100, Math.max(2, percent)) / 100}
      tone={tone === 'good' ? 'good' : tone === 'warn' ? 'warn' : 'bad'}
    />
  );
}

function MetricCard({ m }: { readonly m: CapacityMetric }): ReactElement {
  const tone = TONE[m.status];
  const [open, setOpen] = useState(m.status === 'WARNING' || m.status === 'CRITICAL');

  return (
    <AfCard
      tone={m.status === 'CRITICAL' ? 'critical' : m.status === 'WARNING' ? 'warn' : undefined}
    >
      <div className="af-row af-row--between">
        <span className="af-title">{m.label}</span>
        <span className="cap-status" data-tone={tone.tone}>
          {tone.label}
        </span>
      </div>

      <div className="cap-figure-row">
        <span className="cap-figure sk-figure" data-tone={tone.tone}>
          {m.current.toLocaleString('en-IN')}
        </span>
        <span className="af-muted">
          {m.ceiling === null ? m.unit : `of ${m.ceiling.toLocaleString('en-IN')} ${m.unit}`}
        </span>
        {m.percent !== null && <span className="af-faint sk-figure cap-pct">{m.percent}%</span>}
      </div>

      <Gauge percent={m.percent} status={m.status} />

      <p className="af-faint">
        {m.ceilingSource === 'MEASURED'
          ? 'Ceiling read from the system itself.'
          : m.ceilingSource === 'CONFIGURED'
            ? 'Ceiling from system settings — update it when the plan changes.'
            : 'Ceiling unknown; record it in system settings to get a real gauge.'}
        {m.detail && <span className="af-small"> {m.detail}</span>}
      </p>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="af-disclose"
      >
        <ChevronRight size={14} className="af-disclose__chev" aria-hidden />
        {open ? 'Hide' : 'What happens, and what to do'}
      </button>

      {open && (
        <div className="cap-explain">
          <p className="af-body">
            <span className="af-small">When it fills: </span>
            {m.consequence}
          </p>
          <p className="af-body">
            <span className="af-small">To fix: </span>
            {m.remedy}
          </p>
        </div>
      )}
    </AfCard>
  );
}

export function CapacityMonitor(): ReactElement {
  const q = useCapacityReport(REFRESH_MS);
  const [now, setNow] = useState<string>('');

  // Rendered client-side only: a server-rendered timestamp would
  // hydrate to a different second and warn.
  useEffect(() => {
    if (q.dataUpdatedAt) setNow(new Date(q.dataUpdatedAt).toLocaleTimeString());
  }, [q.dataUpdatedAt]);

  if (q.isLoading) {
    return (
      <div className="af-page">
        <PageHeader title="System limits" />
        <SkeletonRows rows={4} cols={3} label="Reading system capacity…" />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <ErrorState
        message={q.error?.message ?? 'Could not read capacity.'}
        retry={() => void q.refetch()}
      />
    );
  }

  const { metrics, growth, topology, worstStatus } = q.data;
  const tone = TONE[worstStatus];

  return (
    <div className="af-page">
      <PageHeader
        breadcrumbs={[{ label: 'System' }, { label: 'System limits' }]}
        Link={Link}
        title="System limits"
        subtitle="What the platform can currently take, how much of it is used, and what to do before it runs out. Refreshes every 15 seconds."
      />

      <AfCard>
        <div className="af-row af-row--between">
          <span className="cap-status cap-status--lead" data-tone={tone.tone}>
            {worstStatus === 'OK'
              ? 'Everything has room'
              : `Tightest constraint: ${tone.label.toLowerCase()}`}
          </span>
          <span className="af-faint">{now && `updated ${now}`}</span>
        </div>

        <div className="af-kpis">
          <KpiCard
            label="Orders, last 30 days"
            value={growth.ordersLast30Days}
            format={(n) => n.toLocaleString('en-IN')}
          />
          <KpiCard
            label="Month on month"
            figure={
              growth.monthlyGrowthPercent === null
                ? '—'
                : `${growth.monthlyGrowthPercent > 0 ? '+' : ''}${growth.monthlyGrowthPercent}%`
            }
          />
          <KpiCard
            label="Storage runway"
            figure={
              growth.storageMonthsRemaining === null
                ? '—'
                : `${growth.storageMonthsRemaining} months`
            }
          />
        </div>

        <p className="af-small">
          Runway is measured: the database's actual size divided by the orders in it, projected at
          the last 30 days' rate. It is blank until there are enough orders to divide by, and it
          moves whenever the shape of the data does.
        </p>
      </AfCard>

      <div className="af-grid-2">
        {metrics.map((m) => (
          <MetricCard key={m.key} m={m} />
        ))}
      </div>

      <AfCard>
        <h2 className="af-card__title">How requests are served</h2>
        <p className="af-small">
          {topology.apiInstancesAssumed === 1
            ? 'One API process serves every request. Node is single-threaded, so one slow CPU-bound job — a large CSV, image processing, a PDF invoice — delays everyone else, and a restart is downtime for everyone.'
            : `${topology.apiInstancesAssumed} API processes share the traffic.`}{' '}
          {topology.note}
        </p>
        <p className="af-small">
          To add instances: raise <code className="af-code">capacity.api_instances</code> in
          settings so the connection gauge stays honest, and start every additional process with{' '}
          <code className="af-code">WORKERS_ENABLED=false</code> so only one owns the background
          queues. Two processes running the same crons would double every sweep.
        </p>
      </AfCard>
    </div>
  );
}
