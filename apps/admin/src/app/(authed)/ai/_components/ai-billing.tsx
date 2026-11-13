'use client';

import { useState, type ReactElement } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Select } from '@skydrop/ui/app/select';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { useToast } from '@skydrop/ui/app/toast';
import { useT } from '@/i18n/client';
import { serverVerdict } from '@/lib/server-verdict';
import { AcCard, AcSection } from '../../settings/_components/ac-parts';
import {
  PORTALS,
  useDailyBilling,
  useFetchDaily,
  useMonthlyBilling,
  type BillingBudget,
  type BillingRow,
  type PortalKey,
} from '../_lib/ai-hooks';
import { billingCsv, downloadText, int, pct100, usd } from '../_lib/ai-format';
import { StackedColumns, type ChartSeries } from './ai-chart';

const PORTAL_COLOR: Record<PortalKey, string> = {
  staff: 'var(--blue-fill)',
  seller: 'var(--teal-fill)',
  store: 'var(--violet-fill)',
  associate: 'var(--saffron-fill)',
};
export const MONITOR_COLOR = 'var(--magenta-fill)';

/** `2026-11` -> `Nov 2026`; `2026-11-03` -> `3 Nov`. */
function label(period: string): string {
  const [y, m, d] = period.split('-').map(Number);
  const mon = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1)).toLocaleString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
  return d === undefined ? `${mon} ${y}` : `${d}`;
}

function useSeries(): ChartSeries[] {
  const t = useT();
  return [
    ...PORTALS.map((p) => ({ key: p, label: t(`ai.portal.${p}`), color: PORTAL_COLOR[p] })),
    { key: 'monitor', label: t('ai.line.monitor'), color: MONITOR_COLOR },
  ];
}

const columnsOf = (rows: readonly BillingRow[]) =>
  rows.map((r) => ({
    id: r.period,
    label: label(r.period),
    values: [
      ...PORTALS.map((p) => Number(r.assistant.portals[p].costUsd)),
      Number(r.monitor.costUsd),
    ],
  }));

function BillingTable({
  rows,
  first,
  action,
}: {
  readonly rows: readonly BillingRow[];
  readonly first: string;
  readonly action?: ((r: BillingRow) => ReactElement) | undefined;
}): ReactElement {
  const t = useT();
  return (
    <Table caption={t('ai.billing.tableCaption')}>
      <THead>
        <Tr>
          <Th>{first}</Th>
          <Th align="right">{t('ai.col.requests')}</Th>
          <Th align="right">{t('ai.col.input')}</Th>
          <Th align="right">{t('ai.col.output')}</Th>
          <Th align="right">{t('ai.col.cacheRead')}</Th>
          <Th align="right">{t('ai.col.cacheWrite')}</Th>
          {PORTALS.map((p) => (
            <Th key={p} align="right">
              {t(`ai.portal.${p}`)}
            </Th>
          ))}
          <Th align="right">{t('ai.line.monitor')}</Th>
          <Th align="right">{t('ai.col.cost')}</Th>
          {action !== undefined && <Th>{''}</Th>}
        </Tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <Tr key={r.period}>
            <Td>
              <strong>{r.period}</strong>
            </Td>
            <Td align="right">{int(r.total.requests)}</Td>
            <Td align="right">{int(r.total.inputTokens)}</Td>
            <Td align="right">{int(r.total.outputTokens)}</Td>
            <Td align="right">{int(r.total.cacheReadTokens)}</Td>
            <Td align="right">{int(r.total.cacheWriteTokens)}</Td>
            {PORTALS.map((p) => (
              <Td key={p} align="right">
                {usd(r.assistant.portals[p].costUsd)}
              </Td>
            ))}
            <Td align="right">{usd(r.monitor.costUsd)}</Td>
            <Td align="right">
              <strong>{usd(r.total.costUsd)}</strong>
            </Td>
            {action !== undefined && <Td>{action(r)}</Td>}
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

function BudgetKpis({
  row,
  budget,
}: {
  readonly row: BillingRow | undefined;
  readonly budget: BillingBudget | null;
}): ReactElement {
  const t = useT();
  const used = budget?.assistantUsedPct ?? null;
  return (
    <div className="ai-kpis">
      <KpiCard
        label={t('ai.kpi.total')}
        figure={usd(row?.total.costUsd ?? 0)}
        secondary={t('ai.kpi.requests', { n: int(row?.total.requests ?? 0) })}
      />
      <KpiCard
        label={t('ai.line.assistant')}
        figure={usd(row?.assistant.total.costUsd ?? 0)}
        tone={used !== null && used >= 80 ? 'debit' : 'neutral'}
        secondary={
          budget === null
            ? undefined
            : t('ai.kpi.ofBudget', { pct: pct100(used), cap: usd(budget.assistantBudgetUsd) })
        }
      />
      <KpiCard
        label={t('ai.line.monitor')}
        figure={usd(row?.monitor.costUsd ?? 0)}
        secondary={
          budget === null
            ? undefined
            : t('ai.kpi.monitorCap', { cap: usd(budget.monitorBudgetUsd) })
        }
      />
      {budget?.projectedCostUsd != null && (
        <KpiCard
          label={t('ai.kpi.projected')}
          figure={usd(budget.projectedCostUsd)}
          secondary={t('ai.kpi.projectedNote', { pct: pct100(budget.projectedPct) })}
        />
      )}
    </div>
  );
}

/** AI billing: month by month, day by day, with CSV for both. */
export function AiBilling(): ReactElement {
  const t = useT();
  const toast = useToast();
  const series = useSeries();
  const monthly = useMonthlyBilling(12);
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked ?? monthly.data?.months[0]?.period ?? '';
  const daily = useDailyBilling(month);
  const fetchDaily = useFetchDaily();
  const [busy, setBusy] = useState<string | null>(null);

  const monthRows = monthly.data?.months ?? [];
  const chartMonths = [...monthRows].reverse();

  const exportMonthDays = async (m: string): Promise<void> => {
    setBusy(m);
    try {
      const d = await fetchDaily(m);
      downloadText(`ai-billing-${m}-daily.csv`, billingCsv(d.days));
    } catch (e) {
      toast.error(serverVerdict(e));
    } finally {
      setBusy(null);
    }
  };

  if (monthly.isError) {
    return <ErrorState title={t('ai.error')} message={serverVerdict(monthly.error)} />;
  }

  return (
    <>
      <p className="ai-note">
        {t('ai.billing.note', { tz: monthly.data?.timezone ?? 'Asia/Dhaka' })}
      </p>

      <AcSection
        title={t('ai.billing.monthly')}
        note={t('ai.billing.monthlyNote')}
        action={
          <Button
            variant="secondary"
            size="sm"
            icon={<Download size={14} />}
            disabled={monthRows.length === 0}
            onClick={() => downloadText('ai-billing-months.csv', billingCsv(monthRows))}
          >
            {t('ai.billing.csvMonths')}
          </Button>
        }
        flush
      >
        {monthly.isLoading ? (
          <Skeleton height={260} />
        ) : (
          <>
            <div className="ai-pad">
              <StackedColumns
                columns={columnsOf(chartMonths)}
                series={series}
                ariaLabel={t('ai.billing.chartMonths')}
                format={(n) => usd(n)}
                unitLabel="USD"
              />
            </div>
            <BillingTable
              rows={monthRows}
              first={t('ai.col.month')}
              action={(r) => (
                <span className="ai-rowacts">
                  <Button variant="ghost" size="sm" onClick={() => setPicked(r.period)}>
                    {t('ai.billing.viewDays')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Download size={13} />}
                    loading={busy === r.period}
                    aria-label={t('ai.billing.csvMonth', { month: r.period })}
                    onClick={() => void exportMonthDays(r.period)}
                  >
                    CSV
                  </Button>
                </span>
              )}
            />
          </>
        )}
      </AcSection>

      <AcSection
        title={t('ai.billing.daily')}
        note={t('ai.billing.dailyNote', { month })}
        action={
          <div className="ai-actions">
            <Select
              aria-label={t('ai.billing.pickMonth')}
              value={month}
              onChange={(e) => setPicked(e.target.value)}
            >
              {monthRows.map((r) => (
                <option key={r.period} value={r.period}>
                  {r.period}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              size="sm"
              icon={<Download size={14} />}
              disabled={daily.data === undefined}
              onClick={() =>
                daily.data &&
                downloadText(`ai-billing-${month}-daily.csv`, billingCsv(daily.data.days))
              }
            >
              {t('ai.billing.csvDays')}
            </Button>
          </div>
        }
        flush
      >
        {daily.isError ? (
          <div className="ai-pad">
            <ErrorState title={t('ai.error')} message={serverVerdict(daily.error)} />
          </div>
        ) : daily.isLoading || daily.data === undefined ? (
          <Skeleton height={260} />
        ) : (
          <>
            <div className="ai-pad">
              <BudgetKpis row={daily.data.total} budget={daily.data.budget} />
              <StackedColumns
                columns={columnsOf(daily.data.days)}
                series={series}
                ariaLabel={t('ai.billing.chartDays', { month })}
                format={(n) => usd(n)}
                unitLabel="USD"
              />
            </div>
            <BillingTable rows={daily.data.days} first={t('ai.col.day')} />
          </>
        )}
      </AcSection>

      <AcCard>
        <p className="ai-note">{t('ai.billing.estimate')}</p>
      </AcCard>
    </>
  );
}
