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

/**
 * Reseller stores across sellers (RS-9): fraud flags (a threshold crossed,
 * each with its reason — a signal, never a verdict), disputes on reseller
 * orders, and the float per seller and store. Pausing a store stops its
 * new orders; only its seller can resume it.
 */
export default function ResellerAnalysisPage(): ReactElement {
  const mayPause = usePermission('reseller.stores.pause');
  const mayFloat = usePermission('money.treasury.view');
  const fraud = useResellerFraudFlags();
  const disputes = useResellerDisputes();
  const float = useResellerFloat(mayFloat);
  const [pausing, setPausing] = useState<FraudFlag | null>(null);

  return (
    <AcPage>
      <AcHeader
        crumbs={[{ label: 'Reseller stores', href: '/reseller-stores' }, { label: 'Analysis' }]}
        title="Reseller analysis"
        subtitle="Fraud signals, disputes and float across every seller's reseller stores."
        action={
          <Link href="/reseller-stores" className={buttonClassName('secondary', 'md')}>
            <span className="sk-btn__label">All reseller stores</span>
          </Link>
        }
      />

      <AcSection
        title="Fraud flags"
        note={
          fraud.data === undefined
            ? undefined
            : `${fraud.data.storesChecked} stores with orders in the last ${fraud.data.thresholds.windowDays} days. Thresholds are the reseller.fraud_* settings; each flag raises a system issue that clears itself once back under.`
        }
        flush
      >
        {fraud.isPending && <SkeletonRows rows={4} cols={4} label="Loading fraud flags" />}
        {fraud.isError && (
          <ErrorState message={serverVerdict(fraud.error)} retry={() => void fraud.refetch()} />
        )}
        {fraud.data !== undefined &&
          (fraud.data.flags.length === 0 ? (
            <EmptyState bare tone="positive" title="No store is over a threshold" />
          ) : (
            <Table caption="Fraud flags">
              <THead>
                <Tr>
                  <Th>Store</Th>
                  <Th>Signal</Th>
                  <Th>Why</Th>
                  <Th align="right">Actions</Th>
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
                          Pause store
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ))}
      </AcSection>

      <AcSection title="Disputes" note="Tickets on reseller orders placed in the last year." bare>
        {disputes.isPending && <SkeletonRows rows={3} cols={5} label="Loading disputes" />}
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
                label="Open"
                tone={disputes.data.open > 0 ? 'pending' : 'neutral'}
                value={disputes.data.open}
                icon={<ShieldAlert size={16} />}
              />
              <KpiCard label="Settled" value={disputes.data.settled} />
            </div>
            {disputes.data.openTickets.length === 0 ? (
              <EmptyState tone="positive" title="No open disputes" />
            ) : (
              <AcCard flush>
                <Table caption="Open disputes">
                  <THead>
                    <Tr>
                      <Th>Ticket</Th>
                      <Th>Store</Th>
                      <Th>Order</Th>
                      <Th>Status</Th>
                      <Th>Opened</Th>
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
                            label={ticketStatusLabel(t.status as TicketStatus)}
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
          title="Float and advances"
          note="Store balances (a negative one is its seller's exposure), money credited to a store before the courier paid, and Instant Pay advanced on reseller orders."
          bare
        >
          {float.isPending && <SkeletonRows rows={3} cols={4} label="Loading float and advances" />}
          {float.isError && (
            <ErrorState message={serverVerdict(float.error)} retry={() => void float.refetch()} />
          )}
          {float.data !== undefined && (
            <>
              <div className="ac-kpis">
                <KpiCard
                  label="Store wallets"
                  figure={<Money amount={float.data.totals.storesWalletInr} />}
                />
                <KpiCard
                  label="Stores below zero"
                  tone="pending"
                  figure={<Money amount={float.data.totals.storesNegativeInr} />}
                />
                <KpiCard
                  label="Credited before payout"
                  figure={<Money amount={float.data.totals.creditedBeforePayoutInr} />}
                />
                <KpiCard
                  label="Instant Pay advanced"
                  figure={<Money amount={float.data.totals.instantPayAdvanceInr} />}
                />
              </div>
              <AcCard flush>
                <Table caption="Float by seller and store">
                  <THead>
                    <Tr>
                      <Th>Seller / store</Th>
                      <Th align="right">Wallet</Th>
                      <Th align="right">Credited before payout</Th>
                      <Th align="right">Instant Pay advanced</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {float.data.sellers.flatMap((s) => [
                      <Tr key={s.sellerId}>
                        <Td>
                          <span className="ac-strong">{s.sellerName}</span>
                          <span className="ac-cell-sub">
                            own <Money amount={s.sellerWalletInr} /> · group{' '}
                            <Money amount={s.groupInr} />
                          </span>
                        </Td>
                        <Td align="right">
                          <Money amount={s.storesWalletInr} />
                        </Td>
                        <Td />
                        <Td align="right">
                          <Money amount={s.instantPayAdvanceInr} />
                          <span className="ac-cell-sub">
                            <span className="sk-figure">{s.instantPayAdvanceOrders}</span> orders
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
                              {st.status === null
                                ? ''
                                : `${resellerStoreStatusLabel(st.status as ResellerStoreStatus)} · `}
                              may go below zero by{' '}
                              <Money amount={st.negativeLimitInr} convert={false} />
                            </span>
                          </Td>
                          <Td align="right">
                            <Money amount={st.balanceInr} />
                          </Td>
                          <Td align="right">
                            <Money amount={st.creditedBeforePayoutInr} />
                            <span className="ac-cell-sub">
                              <span className="sk-figure">{st.creditedBeforePayoutOrders}</span>{' '}
                              orders
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
