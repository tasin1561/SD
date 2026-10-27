'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import type { ResellerStoreStatus, TicketStatus } from '@skydrop/db';
import { PauseCircle, ShieldAlert } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { Button, buttonClassName } from '@skydrop/ui/app/button';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TBody, THead, Table, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { AcCard, AcHeader, AcPage, AcSection } from '../../settings/_components/ac-parts';
import { resellerStoreStatusLabel, ticketStatusKind, ticketStatusLabel } from '@skydrop/ui/status';
import { istDateLabel } from '@/lib/ist-day';
import {
  useResellerDisputes,
  useResellerFloat,
  useResellerFraudFlags,
  type FraudFlag,
} from '@/lib/reseller-analysis-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { PauseStoreModal } from '../_components/pause-store-modal';
import { useT, useLocale } from '@/i18n/client';
import { richMessage } from '@/i18n/client';

/**
 * Reseller stores across sellers (RS-9): fraud flags (a threshold crossed,
 * each with its reason — a signal, never a verdict), disputes on reseller
 * orders, and the float per seller and store. Pausing a store stops its
 * new orders; only its seller can resume it.
 */
export default function ResellerAnalysisPage(): ReactElement {
  const locale = useLocale();
  const tr = useT();
  const mayPause = usePermission('reseller.stores.pause');
  const mayFloat = usePermission('money.treasury.view');
  const fraud = useResellerFraudFlags();
  const disputes = useResellerDisputes();
  const float = useResellerFloat(mayFloat);
  const [pausing, setPausing] = useState<FraudFlag | null>(null);

  return (
    <AcPage>
      <AcHeader
        crumbs={[
          { label: tr('resellerStoresAnalysisPage.memberStores'), href: '/reseller-stores' },
          { label: tr('resellerStoresAnalysisPage.analysis') },
        ]}
        title={tr('resellerStoresAnalysisPage.memberStoreAnalysis')}
        subtitle={tr('resellerStoresAnalysisPage.fraudSignalsDisputesAndFloat')}
        action={
          <Link href="/reseller-stores" className={buttonClassName('secondary', 'md')}>
            <span className="sk-btn__label">
              {tr('resellerStoresAnalysisPage.allMemberStores')}
            </span>
          </Link>
        }
      />

      <AcSection
        title={tr('resellerStoresAnalysisPage.fraudFlags')}
        note={
          fraud.data === undefined
            ? undefined
            : tr('resellerStoresAnalysisPage.storesWithOrdersInThe', {
                storesChecked: fraud.data.storesChecked,
                windowDays: fraud.data.thresholds.windowDays,
              })
        }
        flush
      >
        {fraud.isPending && (
          <SkeletonRows
            rows={4}
            cols={4}
            label={tr('resellerStoresAnalysisPage.loadingFraudFlags')}
          />
        )}
        {fraud.isError && (
          <ErrorState message={serverVerdict(fraud.error)} retry={() => void fraud.refetch()} />
        )}
        {fraud.data !== undefined &&
          (fraud.data.flags.length === 0 ? (
            <EmptyState
              bare
              tone="positive"
              title={tr('resellerStoresAnalysisPage.noStoreIsOverA')}
            />
          ) : (
            <Table caption={tr('resellerStoresAnalysisPage.fraudFlags')}>
              <THead>
                <Tr>
                  <Th>{tr('resellerStoresAnalysisPage.store')}</Th>
                  <Th>{tr('resellerStoresAnalysisPage.signal')}</Th>
                  <Th>{tr('resellerStoresAnalysisPage.why')}</Th>
                  <Th align="right">{tr('resellerStoresAnalysisPage.actions')}</Th>
                </Tr>
              </THead>
              <TBody>
                {fraud.data.flags.map((f) => (
                  <Tr key={`${f.rule}-${f.storeId}`}>
                    <Td>
                      <Link href={`/reseller-stores/${f.storeId}`} className="ac-link ac-cell-main">
                        {f.storeName}
                      </Link>
                      <span className="ac-cell-sub">{f.sellerName}</span>
                    </Td>
                    <Td>
                      <span className="ac-inline">
                        <StatusChip
                          kind={f.severity === 'HIGH' ? 'failed' : 'pending'}
                          label={f.severity}
                          size="sm"
                        />
                        <span className="sk-figure">
                          {f.value} <span className="ac-faint">/ {f.threshold}</span>
                        </span>
                      </span>
                    </Td>
                    <Td>{f.reason}</Td>
                    <Td align="right">
                      {mayPause && (
                        <Button
                          size="sm"
                          variant="destructive"
                          icon={<PauseCircle size={14} />}
                          onClick={() => setPausing(f)}
                        >
                          {tr('resellerStoresAnalysisPage.pauseStore')}
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ))}
      </AcSection>

      <AcSection
        title={tr('resellerStoresAnalysisPage.disputes')}
        note={tr('resellerStoresAnalysisPage.ticketsOnMemberStoreOrders')}
        bare
      >
        {disputes.isPending && (
          <SkeletonRows
            rows={3}
            cols={5}
            label={tr('resellerStoresAnalysisPage.loadingDisputes')}
          />
        )}
        {disputes.isError && (
          <ErrorState
            message={serverVerdict(disputes.error)}
            retry={() => void disputes.refetch()}
          />
        )}
        {disputes.data !== undefined && (
          <>
            <div className="ac-kpis">
              <KpiCard
                label={tr('resellerStoresAnalysisPage.open')}
                tone={disputes.data.open > 0 ? 'pending' : 'neutral'}
                value={disputes.data.open}
                icon={<ShieldAlert size={16} />}
              />
              <KpiCard
                label={tr('resellerStoresAnalysisPage.settled')}
                value={disputes.data.settled}
              />
            </div>
            {disputes.data.openTickets.length === 0 ? (
              <EmptyState tone="positive" title={tr('resellerStoresAnalysisPage.noOpenDisputes')} />
            ) : (
              <AcCard flush>
                <Table caption={tr('resellerStoresAnalysisPage.openDisputes')}>
                  <THead>
                    <Tr>
                      <Th>{tr('resellerStoresAnalysisPage.ticket')}</Th>
                      <Th>{tr('resellerStoresAnalysisPage.store')}</Th>
                      <Th>{tr('resellerStoresAnalysisPage.order')}</Th>
                      <Th>{tr('resellerStoresAnalysisPage.status')}</Th>
                      <Th>{tr('resellerStoresAnalysisPage.opened')}</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {disputes.data.openTickets.map((t) => (
                      <Tr key={t.id}>
                        <Td>
                          <Link href={`/tickets/${t.id}`} className="ac-link sk-ident">
                            {t.ticketNumber}
                          </Link>
                          <span className="ac-cell-sub">{t.subject}</span>
                        </Td>
                        <Td>
                          {t.storeId !== null ? (
                            <Link href={`/reseller-stores/${t.storeId}`} className="ac-link">
                              {t.storeName}
                            </Link>
                          ) : (
                            t.storeName
                          )}
                          <span className="ac-cell-sub">{t.sellerName}</span>
                        </Td>
                        <Td>
                          {t.orderId !== null ? (
                            <Link href={`/orders/${t.orderId}`} className="ac-link sk-ident">
                              {t.orderNumber}
                            </Link>
                          ) : (
                            <span className="sk-ident">{t.orderNumber || '—'}</span>
                          )}
                        </Td>
                        <Td>
                          <StatusChip
                            kind={ticketStatusKind(t.status as TicketStatus)}
                            label={ticketStatusLabel(t.status as TicketStatus, locale)}
                            size="sm"
                          />
                        </Td>
                        <Td>
                          <span className="sk-figure ac-faint">{istDateLabel(t.createdAt)}</span>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </AcCard>
            )}
          </>
        )}
      </AcSection>

      {mayFloat && (
        <AcSection
          title={tr('resellerStoresAnalysisPage.floatAndAdvances')}
          note={tr('resellerStoresAnalysisPage.storeBalancesANegativeOne')}
          bare
        >
          {float.isPending && (
            <SkeletonRows
              rows={3}
              cols={4}
              label={tr('resellerStoresAnalysisPage.loadingFloatAndAdvances')}
            />
          )}
          {float.isError && (
            <ErrorState message={serverVerdict(float.error)} retry={() => void float.refetch()} />
          )}
          {float.data !== undefined && (
            <>
              <div className="ac-kpis">
                <KpiCard
                  label={tr('resellerStoresAnalysisPage.storeWallets')}
                  figure={<Money amount={float.data.totals.storesWalletInr} />}
                />
                <KpiCard
                  label={tr('resellerStoresAnalysisPage.storesBelowZero')}
                  tone="pending"
                  figure={<Money amount={float.data.totals.storesNegativeInr} />}
                />
                <KpiCard
                  label={tr('resellerStoresAnalysisPage.creditedBeforePayout')}
                  figure={<Money amount={float.data.totals.creditedBeforePayoutInr} />}
                />
                <KpiCard
                  label={tr('resellerStoresAnalysisPage.instantPayAdvanced')}
                  figure={<Money amount={float.data.totals.instantPayAdvanceInr} />}
                />
              </div>
              <AcCard flush>
                <Table caption={tr('resellerStoresAnalysisPage.floatByClientAndStore')}>
                  <THead>
                    <Tr>
                      <Th>{tr('resellerStoresAnalysisPage.clientStore')}</Th>
                      <Th align="right">{tr('resellerStoresAnalysisPage.wallet')}</Th>
                      <Th align="right">{tr('resellerStoresAnalysisPage.creditedBeforePayout')}</Th>
                      <Th align="right">{tr('resellerStoresAnalysisPage.instantPayAdvanced')}</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {float.data.sellers.flatMap((s) => [
                      <Tr key={s.sellerId}>
                        <Td>
                          <span className="ac-strong">{s.sellerName}</span>
                          <span className="ac-cell-sub">
                            {richMessage(tr('resellerStoresAnalysisPage.ownGroup'), {
                              money: <Money amount={s.sellerWalletInr} />,
                              money2: <Money amount={s.groupInr} />,
                            })}
                          </span>
                        </Td>
                        <Td align="right">
                          <Money amount={s.storesWalletInr} />
                        </Td>
                        <Td />
                        <Td align="right">
                          <Money amount={s.instantPayAdvanceInr} />
                          <span className="ac-cell-sub">
                            {richMessage(tr('resellerStoresAnalysisPage.orders'), {
                              span: <span className="sk-figure">{s.instantPayAdvanceOrders}</span>,
                            })}
                          </span>
                        </Td>
                      </Tr>,
                      ...s.stores.map((st) => (
                        <Tr key={st.storeId}>
                          <Td>
                            <span className="ac-indent">
                              <Link href={`/reseller-stores/${st.storeId}`} className="ac-link">
                                {st.storeName}
                              </Link>
                            </span>
                            <span className="ac-cell-sub ac-indent">
                              {tr('resellerStoresAnalysisPage.mayGoBelowZeroBy', {
                                value:
                                  st.status === null
                                    ? ''
                                    : `${resellerStoreStatusLabel(st.status as ResellerStoreStatus)} · `,
                              })}{' '}
                              <Money amount={st.negativeLimitInr} convert={false} />
                            </span>
                          </Td>
                          <Td align="right">
                            <Money amount={st.balanceInr} />
                          </Td>
                          <Td align="right">
                            <Money amount={st.creditedBeforePayoutInr} />
                            <span className="ac-cell-sub">
                              {richMessage(tr('resellerStoresAnalysisPage.orders'), {
                                span: (
                                  <span className="sk-figure">{st.creditedBeforePayoutOrders}</span>
                                ),
                              })}
                            </span>
                          </Td>
                          <Td />
                        </Tr>
                      )),
                    ])}
                  </TBody>
                </Table>
              </AcCard>
            </>
          )}
        </AcSection>
      )}

      {pausing !== null && (
        <PauseStoreModal
          storeId={pausing.storeId}
          storeName={pausing.storeName}
          onClose={() => setPausing(null)}
        />
      )}
    </AcPage>
  );
}
