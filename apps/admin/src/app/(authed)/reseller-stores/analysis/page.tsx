'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import type { ResellerStoreStatus, TicketStatus } from '@skydrop/db';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Money,
  PageHeader,
  Section,
  Stat,
  StatusBadge,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
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
    <div className="space-y-6">
      <PageHeader
        title="Reseller analysis"
        subtitle="Fraud signals, disputes and float across every seller's reseller stores."
        action={
          <Link href="/reseller-stores" className="text-sm underline">
            All reseller stores
          </Link>
        }
      />

      <Section
        title="Fraud flags"
        subtitle={
          fraud.data === undefined
            ? undefined
            : `${fraud.data.storesChecked} stores with orders in the last ${fraud.data.thresholds.windowDays} days. Thresholds are the reseller.fraud_* settings; each flag raises a system issue that clears itself once back under.`
        }
      >
        {fraud.isPending && <LoadingState label="Loading fraud flags" rows={4} />}
        {fraud.isError && (
          <ErrorState message={serverVerdict(fraud.error)} retry={() => void fraud.refetch()} />
        )}
        {fraud.data !== undefined &&
          (fraud.data.flags.length === 0 ? (
            <EmptyState bare title="No store is over a threshold" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Store</Th>
                  <Th>Signal</Th>
                  <Th>Why</Th>
                  <Th />
                </Tr>
              </THead>
              <TBody>
                {fraud.data.flags.map((f) => (
                  <Tr key={`${f.rule}-${f.storeId}`}>
                    <Td>
                      <Link href={`/reseller-stores/${f.storeId}`} className="text-accent">
                        {f.storeName}
                      </Link>
                      <span className="text-text-muted block text-xs">{f.sellerName}</span>
                    </Td>
                    <Td>
                      <StatusBadge
                        kind={f.severity === 'HIGH' ? 'failed' : 'pending'}
                        label={f.severity}
                      />{' '}
                      {f.value} <span className="text-text-muted text-xs">/ {f.threshold}</span>
                    </Td>
                    <Td>{f.reason}</Td>
                    <Td>
                      {mayPause && (
                        <Button size="sm" variant="destructive" onClick={() => setPausing(f)}>
                          Pause store
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ))}
      </Section>

      <Section title="Disputes" subtitle="Tickets on reseller orders placed in the last year.">
        {disputes.isPending && <LoadingState label="Loading disputes" rows={3} />}
        {disputes.isError && (
          <ErrorState
            message={serverVerdict(disputes.error)}
            retry={() => void disputes.refetch()}
          />
        )}
        {disputes.data !== undefined && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat
                label="Open"
                tone={disputes.data.open > 0 ? 'warn' : 'neutral'}
                value={disputes.data.open}
              />
              <Stat label="Settled" value={disputes.data.settled} />
            </div>
            {disputes.data.openTickets.length === 0 ? (
              <EmptyState bare title="No open disputes" />
            ) : (
              <Table>
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
                        <Link href={`/tickets/${t.id}`} className="text-accent">
                          {t.ticketNumber}
                        </Link>
                        <span className="text-text-muted block text-xs">{t.subject}</span>
                      </Td>
                      <Td>
                        {t.storeId !== null ? (
                          <Link href={`/reseller-stores/${t.storeId}`} className="text-accent">
                            {t.storeName}
                          </Link>
                        ) : (
                          t.storeName
                        )}
                        <span className="text-text-muted block text-xs">{t.sellerName}</span>
                      </Td>
                      <Td>
                        {t.orderId !== null ? (
                          <Link href={`/orders/${t.orderId}`} className="text-accent font-mono">
                            {t.orderNumber}
                          </Link>
                        ) : (
                          <span className="font-mono">{t.orderNumber || '—'}</span>
                        )}
                      </Td>
                      <Td>
                        <StatusBadge
                          kind={ticketStatusKind(t.status as TicketStatus)}
                          label={ticketStatusLabel(t.status as TicketStatus)}
                        />
                      </Td>
                      <Td>{istDateLabel(t.createdAt)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </>
        )}
      </Section>

      {mayFloat && (
        <Section
          title="Float and advances"
          subtitle="Store balances (a negative one is its seller's exposure), money credited to a store before the courier paid, and Instant Pay advanced on reseller orders."
        >
          {float.isPending && <LoadingState label="Loading float and advances" rows={3} />}
          {float.isError && (
            <ErrorState message={serverVerdict(float.error)} retry={() => void float.refetch()} />
          )}
          {float.data !== undefined && (
            <>
              <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat
                  label="Store wallets"
                  value={<Money amount={float.data.totals.storesWalletInr} />}
                />
                <Stat
                  label="Stores below zero"
                  tone="warn"
                  value={<Money amount={float.data.totals.storesNegativeInr} />}
                />
                <Stat
                  label="Credited before payout"
                  value={<Money amount={float.data.totals.creditedBeforePayoutInr} />}
                />
                <Stat
                  label="Instant Pay advanced"
                  value={<Money amount={float.data.totals.instantPayAdvanceInr} />}
                />
              </div>
              <Table>
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
                        <strong>{s.sellerName}</strong>
                        <span className="text-text-muted block text-xs">
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
                        <span className="text-text-muted block text-xs">
                          {s.instantPayAdvanceOrders} orders
                        </span>
                      </Td>
                    </Tr>,
                    ...s.stores.map((st) => (
                      <Tr key={st.storeId}>
                        <Td>
                          <Link
                            href={`/reseller-stores/${st.storeId}`}
                            className="text-accent pl-4"
                          >
                            {st.storeName}
                          </Link>
                          <span className="text-text-muted block pl-4 text-xs">
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
                          <span className="text-text-muted block text-xs">
                            {st.creditedBeforePayoutOrders} orders
                          </span>
                        </Td>
                        <Td />
                      </Tr>
                    )),
                  ])}
                </TBody>
              </Table>
            </>
          )}
        </Section>
      )}

      {pausing !== null && (
        <PauseStoreModal
          storeId={pausing.storeId}
          storeName={pausing.storeName}
          onClose={() => setPausing(null)}
        />
      )}
    </div>
  );
}
