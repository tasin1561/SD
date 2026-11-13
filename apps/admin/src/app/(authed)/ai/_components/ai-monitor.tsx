'use client';

import Link from 'next/link';
import { type ReactElement } from 'react';
import { Play } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TableEmpty, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { useToast } from '@skydrop/ui/app/toast';
import { useT } from '@/i18n/client';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { AcAlert, AcSection } from '../../settings/_components/ac-parts';
import {
  useMonitorFlags,
  useMonitorOverview,
  useMonitorRunNow,
  type MonitorRun,
  type MonitorTheme,
} from '../_lib/ai-hooks';
import { pct100, usd } from '../_lib/ai-format';

const RUN_KIND: Record<MonitorRun['status'], 'delivered' | 'pending' | 'failed' | 'draft'> = {
  done: 'delivered',
  submitted: 'pending',
  collecting: 'pending',
  skipped_budget: 'failed',
  failed: 'failed',
  nothing_to_do: 'draft',
};

function Themes({
  rows,
  may,
}: {
  readonly rows: readonly MonitorTheme[];
  readonly may: boolean;
}): ReactElement {
  const t = useT();
  if (rows.length === 0) return <p className="ai-note">{t('ai.empty')}</p>;
  return (
    <ul className="ai-mix">
      {rows.slice(0, 12).map((r) => (
        <li key={r.label}>
          <span className="ai-mix__label">{r.label}</span>
          <span className="ai-mix__val">
            {r.count}
            {may && (
              <small>
                {' '}
                {r.conversationIds.slice(0, 3).map((id, i) => (
                  <Link key={id} href={`/ai/conversations/${id}`} className="ai-link">
                    {i === 0 ? '' : ', '}#{i + 1}
                  </Link>
                ))}
              </small>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The Monitor tab: safety flags first, then the night, the week's themes, the runs. */
export function AiMonitor(): ReactElement {
  const t = useT();
  const toast = useToast();
  const may = usePermission('assistant.conversations.read');
  const q = useMonitorOverview();
  const flags = useMonitorFlags(may && (q.data?.safetyFlags ?? 0) > 0);
  const run = useMonitorRunNow();
  const d = q.data;

  if (q.isError) {
    return (
      <ErrorState
        title={t('ai.error')}
        message={serverVerdict(q.error)}
        retry={() => void q.refetch()}
      />
    );
  }
  if (d === undefined) return <Skeleton height={320} />;

  const night = d.runs.find((r) => r.status === 'done');
  const s = night?.summary ?? null;
  const onRunNow = (): void =>
    run.mutate(undefined, {
      onSuccess: () => toast.success(t('ai.mon.queued')),
      onError: (e) => toast.error(serverVerdict(e)),
    });

  return (
    <>
      <AcSection
        title={t('ai.mon.status')}
        note={d.enabled ? t('ai.mon.onNote') : t('ai.mon.offNote')}
        action={
          <Button
            variant="secondary"
            size="sm"
            icon={<Play size={14} />}
            loading={run.isPending}
            disabled={!d.enabled || !d.configured}
            onClick={onRunNow}
          >
            {t('ai.mon.runNow')}
          </Button>
        }
      >
        <div className="ai-kpis">
          <KpiCard
            label={t('ai.mon.state')}
            figure={d.enabled ? t('ai.on') : t('ai.off')}
            tone="neutral"
          />
          <KpiCard
            label={t('ai.mon.spent')}
            figure={usd(d.budget.spentUsd)}
            secondary={t('ai.kpi.ofBudget', {
              pct: pct100(d.budget.usedPct),
              cap: usd(d.budget.capUsd),
            })}
            tone={(d.budget.usedPct ?? 0) >= 80 ? 'debit' : 'neutral'}
          />
          <KpiCard
            label={t('ai.mon.flagsWeek')}
            value={d.safetyFlags}
            tone={d.safetyFlags > 0 ? 'debit' : 'neutral'}
          />
        </div>
        {!d.configured && <AcAlert tone="warn" message={t('ai.mon.noKey')} />}
      </AcSection>

      {d.safetyFlags > 0 && (
        <AcSection
          title={t('ai.mon.flagsTitle')}
          note={t('ai.mon.flagsNote')}
          tone="critical"
          flush
        >
          {!may ? (
            <p className="ai-pad">{t('ai.conv.noAccess')}</p>
          ) : flags.data === undefined ? (
            <Skeleton height={120} />
          ) : (
            <Table caption={t('ai.mon.flagsTitle')}>
              <THead>
                <Tr>
                  <Th>{t('ai.conv.when')}</Th>
                  <Th>{t('ai.conv.portal')}</Th>
                  <Th>{t('ai.mon.f.safety')}</Th>
                  <Th>{t('ai.mon.summary')}</Th>
                </Tr>
              </THead>
              <TBody>
                {flags.data.items.map((f) => (
                  <Tr key={f.conversationId}>
                    <Td>{new Date(f.at).toLocaleString()}</Td>
                    <Td>{t(`ai.portal.${f.portal}`)}</Td>
                    <Td>
                      <StatusChip kind="failed" label={t(`ai.mon.safety.${f.safety}`)} size="sm" />
                    </Td>
                    <Td>
                      <Link href={`/ai/conversations/${f.conversationId}`} className="ai-link">
                        {f.safetyQuote ? `“${f.safetyQuote}”` : f.summary || '—'}
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </AcSection>
      )}

      <AcSection
        title={t('ai.mon.night')}
        note={night ? new Date(night.startedAt).toLocaleString() : undefined}
      >
        {s === null ? (
          <p className="ai-note">{t('ai.mon.noNight')}</p>
        ) : (
          <div className="ai-kpis">
            <KpiCard label={t('ai.mon.reviewed')} value={s.scored ?? 0} />
            <KpiCard label={t('ai.mon.unanswered')} value={s.answered?.no ?? 0} />
            <KpiCard label={t('ai.mon.wrong')} value={s.incorrect ?? 0} />
            <KpiCard label={t('ai.mon.halluc')} value={s.hallucinations ?? 0} />
            <KpiCard label={t('ai.mon.frustratedTitle')} value={s.frustrated ?? 0} />
            <KpiCard label={t('ai.mon.cost')} figure={usd(s.costUsd ?? 0)} />
          </div>
        )}
      </AcSection>

      <div className="ai-grid2">
        <AcSection title={t('ai.mon.gaps')} note={t('ai.mon.gapsNote')}>
          <Themes rows={d.week.knowledgeGaps} may={may} />
        </AcSection>
        <AcSection title={t('ai.mon.pages')} note={t('ai.mon.pagesNote')}>
          <Themes rows={d.week.uiConfusions} may={may} />
        </AcSection>
      </div>

      <AcSection title={t('ai.mon.runs')} flush>
        <Table caption={t('ai.mon.runs')}>
          <THead>
            <Tr>
              <Th>{t('ai.conv.when')}</Th>
              <Th>{t('ai.mon.state')}</Th>
              <Th align="right">{t('ai.mon.reviewed')}</Th>
              <Th align="right">{t('ai.mon.skipped')}</Th>
              <Th>{t('ai.mon.note')}</Th>
            </Tr>
          </THead>
          <TBody>
            {d.runs.length === 0 && <TableEmpty colSpan={5}>{t('ai.empty')}</TableEmpty>}
            {d.runs.map((r) => (
              <Tr key={r.id}>
                <Td>{new Date(r.startedAt).toLocaleString()}</Td>
                <Td>
                  <StatusChip
                    kind={RUN_KIND[r.status]}
                    label={t(`ai.mon.run.${r.status}`)}
                    size="sm"
                  />
                </Td>
                <Td align="right">{r.scored}</Td>
                <Td align="right">{r.skippedBudget}</Td>
                <Td>{r.note ?? '—'}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </AcSection>
    </>
  );
}
