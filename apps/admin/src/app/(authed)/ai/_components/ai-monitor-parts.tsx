'use client';

import type { ReactElement } from 'react';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { useT } from '@/i18n/client';
import { AcCard } from '../../settings/_components/ac-parts';
import type { MonitorScore } from '../_lib/ai-hooks';

/** Safety first: a flagged score is the loudest chip; the rest only appear when they are not fine. */
export function MonitorChips({ m }: { readonly m: MonitorScore }): ReactElement {
  const t = useT();
  return (
    <span className="ai-flags" aria-label={t('ai.mon.score')}>
      {m.safety !== 'none' && (
        <StatusChip kind="failed" label={t(`ai.mon.safety.${m.safety}`)} size="sm" />
      )}
      {m.hallucination && <StatusChip kind="failed" label={t('ai.mon.halluc')} size="sm" />}
      {m.correct === 'no' && <StatusChip kind="rto" label={t('ai.mon.wrong')} size="sm" />}
      {m.answered === 'no' && (
        <StatusChip kind="pending" label={t('ai.mon.unanswered')} size="sm" />
      )}
      {m.frustration >= 2 && (
        <StatusChip kind="pending" label={t('ai.mon.frustrated', { n: m.frustration })} size="sm" />
      )}
      {m.safety === 'none' &&
        !m.hallucination &&
        m.correct !== 'no' &&
        m.answered !== 'no' &&
        m.frustration < 2 && <StatusChip kind="delivered" label={t('ai.mon.fine')} size="sm" />}
    </span>
  );
}

/** The monitor's full score for one conversation (shown above the transcript). */
export function MonitorCard({ m }: { readonly m: MonitorScore }): ReactElement {
  const t = useT();
  const rows: ReadonlyArray<readonly [string, string]> = [
    [t('ai.mon.f.answered'), t(`ai.mon.v.${m.answered}`)],
    [
      t('ai.mon.f.correct'),
      t(`ai.mon.v.${m.correct}`) + (m.correctReason ? ` — ${m.correctReason}` : ''),
    ],
    [t('ai.mon.f.link'), t(`ai.mon.link.${m.link}`)],
    [t('ai.mon.f.language'), m.languageMatch ? t('ai.mon.v.yes') : t('ai.mon.v.no')],
    [t('ai.mon.f.frustration'), `${m.frustration} / 3`],
    ...(m.hallucination
      ? ([[t('ai.mon.f.halluc'), m.hallucinationQuote ?? t('ai.mon.v.yes')]] as const)
      : []),
    ...(m.knowledgeGap ? ([[t('ai.mon.f.gap'), m.knowledgeGap]] as const) : []),
    ...(m.uiConfusion ? ([[t('ai.mon.f.page'), m.uiConfusion]] as const) : []),
    ...(m.safety !== 'none'
      ? ([
          [
            t('ai.mon.f.safety'),
            `${t(`ai.mon.safety.${m.safety}`)}${m.safetyQuote ? ` — “${m.safetyQuote}”` : ''}`,
          ],
        ] as const)
      : []),
  ];
  return (
    <AcCard title={t('ai.mon.cardTitle')} note={m.summary}>
      <MonitorChips m={m} />
      <dl className="ai-mon__dl">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </AcCard>
  );
}
