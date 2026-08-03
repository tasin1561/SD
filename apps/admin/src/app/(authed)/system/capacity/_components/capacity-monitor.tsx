'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Card, CardBody, ErrorState, LoadingState, PageHeader, Stat } from '@skydrop/ui/components';
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

const TONE: Record<CapacityStatus, { fg: string; ring: string; label: string }> = {
  OK: { fg: 'var(--status-delivered-fg)', ring: 'var(--color-border)', label: 'Healthy' },
  WATCH: { fg: 'var(--status-pending-fg)', ring: 'var(--status-pending-fg)', label: 'Watch' },
  WARNING: { fg: 'var(--status-rto-fg)', ring: 'var(--status-rto-fg)', label: 'Plan the work' },
  CRITICAL: {
    fg: 'var(--color-critical-fg)',
    ring: 'var(--color-critical-ring)',
    label: 'Acting soon is not optional',
  },
};

function Gauge({ percent, status }: { percent: number | null; status: CapacityStatus }) {
  const tone = TONE[status];
  // A null percent means we do not know the ceiling. Showing an empty
  // bar would read as "plenty of room", which is the opposite of true.
  if (percent === null) {
    return (
      <div className="bg-surface-2 h-1.5 w-full overflow-hidden rounded-full">
        <div
          className="h-full w-full opacity-30"
          style={{
            background:
              'repeating-linear-gradient(45deg, var(--color-border) 0 4px, transparent 4px 8px)',
          }}
        />
      </div>
    );
  }
  return (
    <div className="bg-surface-2 h-1.5 w-full overflow-hidden rounded-full">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.min(100, Math.max(2, percent))}%`, background: tone.fg }}
      />
    </div>
  );
}

function MetricCard({ m }: { readonly m: CapacityMetric }): ReactElement {
  const tone = TONE[m.status];
  const [open, setOpen] = useState(m.status === 'WARNING' || m.status === 'CRITICAL');

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-text-bright text-sm font-medium">{m.label}</span>
          <span className="text-xs font-medium" style={{ color: tone.fg }}>
            {tone.label}
          </span>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums" style={{ color: tone.fg }}>
            {m.current.toLocaleString('en-IN')}
          </span>
          <span className="text-text-muted text-sm">
            {m.ceiling === null ? m.unit : `of ${m.ceiling.toLocaleString('en-IN')} ${m.unit}`}
          </span>
          {m.percent !== null && (
            <span className="text-text-faint ml-auto text-xs tabular-nums">{m.percent}%</span>
          )}
        </div>

        <Gauge percent={m.percent} status={m.status} />

        <div className="text-text-faint text-[11px]">
          {m.ceilingSource === 'MEASURED'
            ? 'Ceiling read from the system itself.'
            : m.ceilingSource === 'CONFIGURED'
              ? 'Ceiling from system settings — update it when the plan changes.'
              : 'Ceiling unknown; record it in system settings to get a real gauge.'}
          {m.detail && <span className="text-text-muted"> {m.detail}</span>}
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-accent text-xs hover:underline"
        >
          {open ? 'Hide' : 'What happens, and what to do'}
        </button>

        {open && (
          <div className="border-border space-y-2 border-l-2 pl-3 text-xs">
            <p className="text-text-body">
              <span className="text-text-muted">When it fills: </span>
              {m.consequence}
            </p>
            <p className="text-text-body">
              <span className="text-text-muted">To fix: </span>
              {m.remedy}
            </p>
          </div>
        )}
      </CardBody>
    </Card>
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

  if (q.isLoading) return <LoadingState label="Reading system capacity…" />;
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
    <div className="max-w-5xl space-y-5">
      <PageHeader
        title="System limits"
        subtitle="What the platform can currently take, how much of it is used, and what to do before it runs out. Refreshes every 15 seconds."
      />

      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium" style={{ color: tone.fg }}>
              {worstStatus === 'OK'
                ? 'Everything has room'
                : `Tightest constraint: ${tone.label.toLowerCase()}`}
            </span>
            <span className="text-text-faint text-xs">{now && `updated ${now}`}</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              label="Orders, last 30 days"
              value={growth.ordersLast30Days.toLocaleString('en-IN')}
            />
            <Stat
              label="Month on month"
              value={
                growth.monthlyGrowthPercent === null
                  ? '—'
                  : `${growth.monthlyGrowthPercent > 0 ? '+' : ''}${growth.monthlyGrowthPercent}%`
              }
            />
            <Stat
              label="Storage runway"
              value={
                growth.storageMonthsRemaining === null
                  ? '—'
                  : `${growth.storageMonthsRemaining} months`
              }
            />
          </div>

          <p className="text-text-muted text-xs">
            Runway is measured: the database's actual size divided by the orders in it, projected at
            the last 30 days' rate. It is blank until there are enough orders to divide by, and it
            moves whenever the shape of the data does.
          </p>
        </CardBody>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {metrics.map((m) => (
          <MetricCard key={m.key} m={m} />
        ))}
      </div>

      <Card>
        <CardBody className="space-y-2">
          <span className="text-text-bright text-sm font-medium">How requests are served</span>
          <p className="text-text-muted text-xs">
            {topology.apiInstancesAssumed === 1
              ? 'One API process serves every request. Node is single-threaded, so one slow CPU-bound job — a large CSV, image processing, a PDF invoice — delays everyone else, and a restart is downtime for everyone.'
              : `${topology.apiInstancesAssumed} API processes share the traffic.`}{' '}
            {topology.note}
          </p>
          <p className="text-text-muted text-xs">
            To add instances: raise <code className="text-text-body">capacity.api_instances</code>{' '}
            in settings so the connection gauge stays honest, and start every additional process
            with <code className="text-text-body">WORKERS_ENABLED=false</code> so only one owns the
            background queues. Two processes running the same crons would double every sweep.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
