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
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

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
const TONE = (
  t: Translate<MessageKey>,
): Record<CapacityStatus, { tone: 'good' | 'warn' | 'bad' | 'critical'; label: string }> => ({
  OK: { tone: 'good', label: t('systemCapacityCapacityMonitor.healthy') },
  WATCH: { tone: 'warn', label: t('systemCapacityCapacityMonitor.watch') },
  WARNING: { tone: 'bad', label: t('systemCapacityCapacityMonitor.planTheWork') },
  CRITICAL: { tone: 'critical', label: t('systemCapacityCapacityMonitor.actingSoonIsNotOptional') },
});

function Gauge({
  percent,
  status,
}: {
  percent: number | null;
  status: CapacityStatus;
}): ReactElement {
  const t = useT();
  const tone = TONE(t)[status].tone;
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
  const t = useT();
  const tone = TONE(t)[m.status];
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
          ? t('systemCapacityCapacityMonitor.ceilingReadFromTheSystem')
          : m.ceilingSource === 'CONFIGURED'
            ? t('systemCapacityCapacityMonitor.ceilingFromSystemSettingsUpdate')
            : t('systemCapacityCapacityMonitor.ceilingUnknownRecordItIn')}
        {m.detail && <span className="af-small"> {m.detail}</span>}
      </p>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="af-disclose"
      >
        <ChevronRight size={14} className="af-disclose__chev" aria-hidden />
        {open
          ? t('systemCapacityCapacityMonitor.hide')
          : t('systemCapacityCapacityMonitor.whatHappensAndWhatTo')}
      </button>

      {open && (
        <div className="cap-explain">
          <p className="af-body">
            <span className="af-small">{t('systemCapacityCapacityMonitor.whenItFills')} </span>
            {m.consequence}
          </p>
          <p className="af-body">
            <span className="af-small">{t('systemCapacityCapacityMonitor.toFix')} </span>
            {m.remedy}
          </p>
        </div>
      )}
    </AfCard>
  );
}

export function CapacityMonitor(): ReactElement {
  const t = useT();
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
        <PageHeader title={t('systemCapacityCapacityMonitor.systemLimits')} />
        <SkeletonRows
          rows={4}
          cols={3}
          label={t('systemCapacityCapacityMonitor.readingSystemCapacity')}
        />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <ErrorState
        message={q.error?.message ?? t('systemCapacityCapacityMonitor.couldNotReadCapacity')}
        retry={() => void q.refetch()}
      />
    );
  }

  const { metrics, growth, topology, worstStatus } = q.data;
  const tone = TONE(t)[worstStatus];

  return (
    <div className="af-page">
      <PageHeader
        breadcrumbs={[
          { label: t('systemCapacityCapacityMonitor.system') },
          { label: t('systemCapacityCapacityMonitor.systemLimits') },
        ]}
        Link={Link}
        title={t('systemCapacityCapacityMonitor.systemLimits')}
        subtitle={t('systemCapacityCapacityMonitor.whatThePlatformCanCurrently')}
      />

      <AfCard>
        <div className="af-row af-row--between">
          <span className="cap-status cap-status--lead" data-tone={tone.tone}>
            {worstStatus === 'OK'
              ? t('systemCapacityCapacityMonitor.everythingHasRoom')
              : t('systemCapacityCapacityMonitor.tightestConstraint', {
                  value: tone.label.toLowerCase(),
                })}
          </span>
          <span className="af-faint">{now && `updated ${now}`}</span>
        </div>

        <div className="af-kpis">
          <KpiCard
            label={t('systemCapacityCapacityMonitor.ordersLast30Days')}
            value={growth.ordersLast30Days}
            format={(n) => n.toLocaleString('en-IN')}
          />
          <KpiCard
            label={t('systemCapacityCapacityMonitor.monthOnMonth')}
            figure={
              growth.monthlyGrowthPercent === null
                ? '—'
                : `${growth.monthlyGrowthPercent > 0 ? '+' : ''}${growth.monthlyGrowthPercent}%`
            }
          />
          <KpiCard
            label={t('systemCapacityCapacityMonitor.storageRunway')}
            figure={
              growth.storageMonthsRemaining === null
                ? '—'
                : `${growth.storageMonthsRemaining} months`
            }
          />
        </div>

        <p className="af-small">{t('systemCapacityCapacityMonitor.runwayIsMeasuredTheDatabase')}</p>
      </AfCard>

      <div className="af-grid-2">
        {metrics.map((m) => (
          <MetricCard key={m.key} m={m} />
        ))}
      </div>

      <AfCard>
        <h2 className="af-card__title">
          {t('systemCapacityCapacityMonitor.howRequestsAreServed')}
        </h2>
        <p className="af-small">
          {topology.apiInstancesAssumed === 1
            ? t('systemCapacityCapacityMonitor.oneApiProcessServesEvery')
            : t('systemCapacityCapacityMonitor.apiProcessesShareTheTraffic', {
                apiInstancesAssumed: topology.apiInstancesAssumed,
              })}{' '}
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
