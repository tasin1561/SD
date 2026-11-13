'use client';

import { useState, type ReactElement } from 'react';
import { Button } from '@skydrop/ui/app/button';
import { DateField } from '@skydrop/ui/app/date-field';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { Table, TBody, Td, Th, THead, Tr, TableEmpty } from '@skydrop/ui/app/data-table';
import { useT } from '@/i18n/client';
import { serverVerdict } from '@/lib/server-verdict';
import { AcSection } from '../../settings/_components/ac-parts';
import { PORTALS, useAiDashboard } from '../_lib/ai-hooks';
import { int, pct, pct100, usd } from '../_lib/ai-format';
import { StackedColumns } from './ai-chart';

/** Today in Asia/Dhaka as YYYY-MM-DD (the server's day boundary). */
function dhakaDay(offsetDays = 0): string {
  const d = new Date(Date.now() + 6 * 3600_000 + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** A labelled list of shares: single hue, magnitude by length, the number always printed. */
function Mix({
  rows,
}: {
  readonly rows: ReadonlyArray<{ id: string; label: string; value: number }>;
}): ReactElement {
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <ul className="ai-mix">
      {rows.map((r) => (
        <li key={r.id}>
          <span className="ai-mix__label">{r.label}</span>
          <span className="ai-mix__track" aria-hidden>
            <i style={{ transform: `scaleX(${total === 0 ? 0 : r.value / total})` }} />
          </span>
          <span className="ai-mix__val">
            {int(r.value)}
            <small>{total === 0 ? '' : ` ${pct(r.value / total)}`}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AiDashboard(): ReactElement {
  const t = useT();
  const [from, setFrom] = useState(dhakaDay(-29));
  const [to, setTo] = useState(dhakaDay(0));
  const q = useAiDashboard(from, to);
  const d = q.data;
  const preset = (days: number): void => {
    setFrom(dhakaDay(-(days - 1)));
    setTo(dhakaDay(0));
  };

  const fbTotal = (d?.feedback.up ?? 0) + (d?.feedback.down ?? 0);
  const langLabel = (k: string): string => t(`ai.lang.${k}` as 'ai.lang.en');

  return (
    <>
      <AcSection
        title={t('ai.dash.range')}
        note={t('ai.dash.rangeNote', { tz: d?.range.timezone ?? 'Asia/Dhaka' })}
      >
        <div className="ai-range">
          <DateField
            label={t('ai.dash.from')}
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
          <DateField
            label={t('ai.dash.to')}
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
          <div className="ai-actions">
            {[7, 30, 90].map((n) => (
              <Button key={n} variant="secondary" size="sm" onClick={() => preset(n)}>
                {t('ai.dash.lastDays', { n })}
              </Button>
            ))}
          </div>
        </div>
      </AcSection>

      {q.isError ? (
        <ErrorState
          title={t('ai.error')}
          message={serverVerdict(q.error)}
          retry={() => void q.refetch()}
        />
      ) : d === undefined ? (
        <Skeleton height={320} />
      ) : (
        <>
          <div className="ai-kpis">
            <KpiCard
              label={t('ai.dash.questions')}
              value={d.questions}
              unit={t('ai.dash.perPeriod')}
            />
            <KpiCard label={t('ai.dash.activeUsers')} value={d.activeUsers} />
            <KpiCard
              label={t('ai.dash.spend')}
              figure={usd(d.spend.month?.assistant.total.costUsd ?? 0)}
              tone={(d.spend.budget?.assistantUsedPct ?? 0) >= 80 ? 'debit' : 'neutral'}
              secondary={
                d.spend.budget === null
                  ? undefined
                  : t('ai.kpi.ofBudget', {
                      pct: pct100(d.spend.budget.assistantUsedPct),
                      cap: usd(d.spend.budget.assistantBudgetUsd),
                    })
              }
              foot={
                d.spend.budget?.projectedCostUsd != null
                  ? [{ label: t('ai.kpi.projected'), value: usd(d.spend.budget.projectedCostUsd) }]
                  : undefined
              }
            />
            <KpiCard
              label={t('ai.dash.cacheHit')}
              figure={pct(d.cacheHitRate, 1)}
              hint={t('ai.dash.cacheHitNote')}
            />
            <KpiCard
              label={t('ai.dash.errorRate')}
              figure={pct(d.errorRate, 1)}
              tone={(d.errorRate ?? 0) > 0.05 ? 'debit' : 'neutral'}
            />
            <KpiCard label={t('ai.dash.refusalRate')} figure={pct(d.refusalRate, 1)} />
            <KpiCard label={t('ai.dash.attachments')} value={d.attachments} />
            <KpiCard
              label={t('ai.dash.tickets')}
              figure={`${int(d.proposals.confirmed)} / ${int(d.proposals.raised)}`}
              hint={t('ai.dash.ticketsNote')}
            />
            <KpiCard
              label={t('ai.dash.feedback')}
              figure={fbTotal === 0 ? '—' : pct(d.feedback.up / fbTotal)}
              secondary={t('ai.dash.feedbackNote', { up: d.feedback.up, down: d.feedback.down })}
            />
          </div>

          <AcSection title={t('ai.dash.questionsPerDay')} flush>
            <div className="ai-pad">
              <StackedColumns
                columns={d.questionsPerDay.map((r) => ({
                  id: r.day,
                  label: r.day.slice(8),
                  values: [r.count],
                }))}
                series={[{ key: 'q', label: t('ai.dash.questions'), color: 'var(--blue-fill)' }]}
                ariaLabel={t('ai.dash.questionsPerDay')}
                format={(n) => int(Math.round(n))}
              />
            </div>
          </AcSection>

          <div className="ai-grid2">
            <AcSection title={t('ai.dash.portalMix')}>
              <Mix
                rows={PORTALS.map((p) => ({
                  id: p,
                  label: t(`ai.portal.${p}`),
                  value: d.portals[p],
                }))}
              />
            </AcSection>
            <AcSection
              title={t('ai.dash.languageMix')}
              note={t('ai.dash.languageNote', { n: d.languages.sampled })}
            >
              <Mix
                rows={Object.entries(d.languages.counts)
                  .filter(([, v]) => v > 0)
                  .map(([k, v]) => ({ id: k, label: langLabel(k), value: v }))}
              />
            </AcSection>
          </div>

          <div className="ai-grid2">
            <AcSection title={t('ai.dash.tools')} flush>
              <Table caption={t('ai.dash.tools')}>
                <THead>
                  <Tr>
                    <Th>{t('ai.dash.tool')}</Th>
                    <Th align="right">{t('ai.dash.calls')}</Th>
                    <Th align="right">{t('ai.dash.failed')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {d.tools.length === 0 && <TableEmpty colSpan={3}>{t('ai.empty')}</TableEmpty>}
                  {d.tools.map((r) => (
                    <Tr key={r.name}>
                      <Td>{r.name}</Td>
                      <Td align="right">{int(r.calls)}</Td>
                      <Td align="right">{int(r.failed)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </AcSection>
            <AcSection title={t('ai.dash.notices')} flush>
              <Table caption={t('ai.dash.notices')}>
                <THead>
                  <Tr>
                    <Th>{t('ai.dash.notice')}</Th>
                    <Th align="right">{t('ai.dash.times')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {Object.keys(d.notices).length === 0 && (
                    <TableEmpty colSpan={2}>{t('ai.empty')}</TableEmpty>
                  )}
                  {Object.entries(d.notices).map(([code, n]) => (
                    <Tr key={code}>
                      <Td>{code}</Td>
                      <Td align="right">{int(n)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </AcSection>
          </div>
        </>
      )}
    </>
  );
}
