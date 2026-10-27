'use client';

import { useState, type ReactElement } from 'react';
import { History, PencilLine } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { Button } from '@skydrop/ui/app/button';
import { useToast } from '@skydrop/ui/app/toast';
import type { FxRateView } from '@skydrop/api-client';
import { useFxRatesList } from '@/lib/api-hooks';
import { FxOverrideModal } from './fx-override-modal';
import { FxHistoryDrawer } from './fx-history-drawer';
import { usePermission } from '@/lib/use-permission';
import { MkCard } from '../../seller-wallets/_components/money-parts';
import { useT } from '@/i18n/client';

export function FxRatesIndex(): ReactElement {
  const t = useT();
  const canWrite = usePermission('fx.manage');
  const list = useFxRatesList();
  const [editing, setEditing] = useState<FxRateView | null>(null);
  const [historyOf, setHistoryOf] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const toast = useToast();

  return (
    <div className="mk-page">
      <PageHeader
        title={t('fxFxRatesIndex.fxRates')}
        subtitle={t('fxFxRatesIndex.currentRatePerFromTo')}
      />

      {list.isLoading ? (
        <SkeletonRows rows={3} cols={5} label={t('fxFxRatesIndex.loadingRates')} />
      ) : list.isError ? (
        <ErrorState
          message={list.error?.message ?? t('fxFxRatesIndex.failed')}
          retry={() => void list.refetch()}
        />
      ) : !list.data || list.data.length === 0 ? (
        <EmptyState
          title={t('fxFxRatesIndex.noRatesYet')}
          description={t('fxFxRatesIndex.useOverrideToSetThe')}
        />
      ) : (
        <MkCard flush>
          <Table caption={t('fxFxRatesIndex.exchangeRates')}>
            <THead>
              <Tr>
                <Th>{t('fxFxRatesIndex.pair')}</Th>
                <Th align="right">{t('fxFxRatesIndex.rate')}</Th>
                <Th>{t('fxFxRatesIndex.source')}</Th>
                <Th>{t('fxFxRatesIndex.fetched')}</Th>
                <Th align="right">{t('fxFxRatesIndex.actions')}</Th>
              </Tr>
            </THead>
            <TBody>
              {list.data.map((r) => (
                <Tr key={`${r.fromCurrency}-${r.toCurrency}`}>
                  <Td className="mk-strong">
                    {r.fromCurrency} → {r.toCurrency}
                  </Td>
                  <Td align="right" className="mk-strong sk-figure">
                    {Number(r.rate).toFixed(6)}
                  </Td>
                  <Td className="mk-small mk-body">
                    {/* A rate OUT of INR is set by hand; the way back is
                        generated from it. Saying so here is what stops
                        someone treating the pair as two numbers to keep
                        in step by eye — which is how they drifted. */}
                    {r.fromCurrency === 'INR' ? (
                      <>
                        {r.source}
                        {r.isManualOverride && (
                          <span className="mk-tag">{t('fxFxRatesIndex.manual')}</span>
                        )}
                      </>
                    ) : (
                      <span className="mk-small">{t('fxFxRatesIndex.derivedExactInverse')}</span>
                    )}
                  </Td>
                  <Td className="mk-when sk-figure">{new Date(r.fetchedAt).toLocaleString()}</Td>
                  <Td align="right">
                    <div className="mk-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<History size={14} />}
                        onClick={() =>
                          setHistoryOf({
                            from: r.fromCurrency,
                            to: r.toCurrency,
                          })
                        }
                      >
                        {t('fxFxRatesIndex.timeline')}
                      </Button>
                      {canWrite &&
                        (r.fromCurrency === 'INR' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<PencilLine size={14} />}
                            onClick={() => setEditing(r)}
                          >
                            {t('fxFxRatesIndex.override')}
                          </Button>
                        ) : (
                          // Not offered, because the server refuses it
                          // (FX_DERIVED_DIRECTION). One number decides
                          // both directions; a second one typed by hand
                          // is how a round trip starts losing a paisa.
                          <span className="mk-faint">
                            {t('fxFxRatesIndex.set', {
                              toCurrency: r.toCurrency,
                              fromCurrency: r.fromCurrency,
                            })}
                          </span>
                        ))}
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </MkCard>
      )}

      {editing && (
        <FxOverrideModal
          rate={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            toast.success(t('fxFxRatesIndex.rateOverridden'));
          }}
        />
      )}
      {historyOf && (
        <FxHistoryDrawer
          fromCurrency={historyOf.from}
          toCurrency={historyOf.to}
          onClose={() => setHistoryOf(null)}
        />
      )}
    </div>
  );
}
