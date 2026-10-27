'use client';

import type { ReactElement } from 'react';
import { Dialog } from '@skydrop/ui/app/dialog';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useFxRateHistory } from '@/lib/api-hooks';
import { useT } from '@/i18n/client';

export function FxHistoryDrawer({
  fromCurrency,
  toCurrency,
  onClose,
}: {
  readonly fromCurrency: string;
  readonly toCurrency: string;
  readonly onClose: () => void;
}): ReactElement {
  const t = useT();
  const history = useFxRateHistory(fromCurrency, toCurrency);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t('fxFxHistoryDrawer.timeline', { fromCurrency, toCurrency })}
      description={t('fxFxHistoryDrawer.appendOnlyHistoryOfEvery')}
      size="lg"
    >
      {history.isLoading ? (
        <SkeletonRows rows={4} cols={5} label={t('fxFxHistoryDrawer.loadingHistory')} />
      ) : history.isError ? (
        <ErrorState
          message={history.error?.message ?? t('fxFxHistoryDrawer.failed')}
          retry={() => void history.refetch()}
        />
      ) : !history.data || history.data.length === 0 ? (
        <EmptyState
          bare
          title={t('fxFxHistoryDrawer.noHistoryYet')}
          description={t('fxFxHistoryDrawer.theFirstChangeYouMake')}
        />
      ) : (
        <Table caption={t('fxFxHistoryDrawer.rateHistoryForTo', { fromCurrency, toCurrency })}>
          <THead>
            <Tr>
              <Th>{t('fxFxHistoryDrawer.when')}</Th>
              <Th align="right">{t('fxFxHistoryDrawer.rate')}</Th>
              <Th align="right">{t('fxFxHistoryDrawer.previous')}</Th>
              <Th>{t('fxFxHistoryDrawer.source')}</Th>
              <Th>{t('fxFxHistoryDrawer.reason')}</Th>
            </Tr>
          </THead>
          <TBody>
            {history.data.map((h) => {
              const change =
                h.previousRate !== null ? Number(h.rate) - Number(h.previousRate) : null;
              return (
                <Tr key={h.id}>
                  <Td className="mk-when sk-figure">{new Date(h.recordedAt).toLocaleString()}</Td>
                  <Td align="right" className="mk-strong sk-figure">
                    {Number(h.rate).toFixed(6)}
                  </Td>
                  <Td align="right" className="mk-small sk-figure">
                    {h.previousRate === null ? (
                      '—'
                    ) : (
                      <>
                        {Number(h.previousRate).toFixed(6)}
                        {change !== null && (
                          <span
                            className="mk-text"
                            data-tone={change > 0 ? 'good' : change < 0 ? 'critical' : undefined}
                          >
                            {' '}
                            {change > 0 ? '↑' : change < 0 ? '↓' : '='}
                            {Math.abs(change).toFixed(6)}
                          </span>
                        )}
                      </>
                    )}
                  </Td>
                  <Td className="mk-small mk-body">
                    {h.source}
                    {h.isManualOverride && (
                      <span className="mk-tag">{t('fxFxHistoryDrawer.manual')}</span>
                    )}
                  </Td>
                  <Td className="mk-small">
                    <span className="mk-clip" title={h.changeReason ?? undefined}>
                      {h.changeReason ?? '—'}
                    </span>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </Dialog>
  );
}
