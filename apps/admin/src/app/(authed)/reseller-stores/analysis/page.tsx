'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import {
  Button,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
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
  useToast,
} from '@skydrop/ui/components';
import { istDateLabel } from '@/lib/ist-day';
import {
  usePauseResellerStore,
  useResellerDisputes,
  useResellerFloat,
  useResellerFraudFlags,
  type FraudFlag,
} from '@/lib/reseller-analysis-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';

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
    <>
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
        {fraud.isPending && <LoadingState rows={4} />}
        {fraud.isError && (
          <ErrorState message={fraud.error.message} retry={() => void fraud.refetch()} />
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
                      <Link href={`/reseller-stores/${f.storeId}`}>{f.storeName}</Link>
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
        {disputes.isPending && <LoadingState rows={3} />}
        {disputes.isError && (
          <ErrorState message={disputes.error.message} retry={() => void disputes.refetch()} />
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
                        <Link href={`/tickets/${t.id}`}>{t.ticketNumber}</Link>
                        <span className="text-text-muted block text-xs">{t.subject}</span>
                      </Td>
                      <Td>
                        {t.storeName}
                        <span className="text-text-muted block text-xs">{t.sellerName}</span>
                      </Td>
                      <Td>{t.orderNumber}</Td>
                      <Td>{t.status}</Td>
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
          {float.isPending && <LoadingState rows={3} />}
          {float.isError && (
            <ErrorState message={float.error.message} retry={() => void float.refetch()} />
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
                          <span className="pl-4">{st.storeName}</span>
                          <span className="text-text-muted block pl-4 text-xs">
                            {st.status ?? ''} · limit ₹{st.negativeLimitInr}
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

      {pausing !== null && <PauseModal flag={pausing} onClose={() => setPausing(null)} />}
    </>
  );
}

function PauseModal({ flag, onClose }: { flag: FraudFlag; onClose: () => void }): ReactElement {
  const toast = useToast();
  const pause = usePauseResellerStore();
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      tone="critical"
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Pause “${flag.storeName}”?`}
      description="It stops placing new orders now. Orders already placed carry on, and only its seller can resume it. The seller and the store read your reason."
    >
      <FormField label="Why" htmlFor="reason" required>
        <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
      <ModalFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="destructive"
          disabled={pause.isPending}
          onClick={() =>
            pause.mutate(
              { storeId: flag.storeId, reason },
              {
                onSuccess: () => {
                  toast.success('Paused.');
                  onClose();
                },
                onError: (err) => toast.error(serverVerdict(err)),
              },
            )
          }
        >
          Pause
        </Button>
      </ModalFooter>
    </Modal>
  );
}
