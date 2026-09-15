'use client';

import type { ReactElement } from 'react';
import type { ResellerOrderMoneyView } from '@skydrop/api-client';
import type { StoreWalletEntryDirection, WalletEntryDirection } from '@skydrop/db';
import {
  Card,
  CardBody,
  ErrorState,
  LoadingState,
  Money,
  Section,
  StatusBadge,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import {
  resellerCreditStatusKind,
  resellerCreditStatusLabel,
  storeWalletDirectionLabel,
} from '@skydrop/ui/status';
import { serverVerdict } from '@/lib/server-verdict';
import { useStoreOrderMoney } from '@/lib/order-hooks';

function when(iso: string | null): string {
  return iso === null
    ? '—'
    : new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/** A signed amount (`-12.50` / `12.50`) as a Money with its direction. */
function Signed({ amount }: { amount: string }): ReactElement {
  const debit = amount.startsWith('-');
  return (
    <Money
      amount={debit ? amount.slice(1) : amount}
      direction={debit ? 'debit' : 'credit'}
      convert={false}
    />
  );
}

function feeName(fee: WalletEntryDirection): string {
  switch (fee) {
    case 'ORDER_CHARGES':
      return 'Delivery fee';
    case 'RTO_FEE':
      return 'Return fee';
    case 'CUSTOMER_RETURN_FEE':
      return 'Customer return fee';
    default:
      return fee.toLowerCase().replace(/_/g, ' ');
  }
}

/**
 * RS-6 phase 3c — what this order earns the store and when: its own credit
 * (the COD it collected, less the transfer price and its fee shares), the
 * carriage fees billed so far and its share of each, and the store wallet's
 * lines for this order. Every figure is the server's (FE-2): nothing here
 * recomputes a share.
 */
export function OrderMoney({ orderId }: { orderId: string }): ReactElement {
  const money = useStoreOrderMoney(orderId);
  return (
    <Section title="What this order earns you">
      {money.isPending ? (
        <LoadingState label="Loading the money" rows={4} />
      ) : money.isError ? (
        <ErrorState message={serverVerdict(money.error)} retry={() => void money.refetch()} />
      ) : (
        <MoneyBody m={money.data} />
      )}
    </Section>
  );
}

function MoneyBody({ m }: { m: ResellerOrderMoneyView }): ReactElement {
  const store = m.parties.find((p) => p.party === 'STORE') ?? null;
  const lines = m.storeLines ?? [];
  return (
    <div className="space-y-4">
      {store !== null ? (
        <Card>
          <CardBody>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusBadge
                kind={resellerCreditStatusKind(store.status)}
                label={resellerCreditStatusLabel(store.status)}
              />
              <span className="text-text-muted text-sm">{store.timing}</span>
            </div>
            <dl className="grid grid-cols-[minmax(120px,50%)_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-text-muted">COD collected for you</dt>
              <dd className="text-right">
                <Money amount={store.grossInr} convert={false} />
              </dd>
              <dt className="text-text-muted">Goods at the seller’s transfer price</dt>
              <dd className="text-right">
                <Money amount={store.transferInr} direction="debit" convert={false} />
              </dd>
              <dt className="text-text-muted">Your share of the COD tax</dt>
              <dd className="text-right">
                <Money amount={store.taxShareInr} direction="debit" convert={false} />
              </dd>
              <dt className="text-text-muted">Your share of the COD fee</dt>
              <dd className="text-right">
                <Money amount={store.codFeeShareInr} direction="debit" convert={false} />
              </dd>
              <dt className="text-text-muted">Your share of the Instant Pay fee</dt>
              <dd className="text-right">
                <Money amount={store.instantFeeShareInr} direction="debit" convert={false} />
              </dd>
              <dt className="text-text-body font-medium">You are credited</dt>
              <dd className="text-right font-medium">
                <Signed amount={store.netInr} />
              </dd>
              {store.dueAt !== null ? (
                <>
                  <dt className="text-text-muted">Due</dt>
                  <dd className="text-right">{when(store.dueAt)}</dd>
                </>
              ) : null}
              {store.creditedAt !== null ? (
                <>
                  <dt className="text-text-muted">Credited</dt>
                  <dd className="text-right">{when(store.creditedAt)}</dd>
                </>
              ) : null}
              {store.reversedAt !== null ? (
                <>
                  <dt className="text-text-muted">Taken back</dt>
                  <dd className="text-right">{when(store.reversedAt)}</dd>
                </>
              ) : null}
            </dl>
          </CardBody>
        </Card>
      ) : m.paymentMode === 'PREPAID' ? (
        <p className="text-text-muted text-sm">
          A prepaid order is paid from your wallet at confirmation: the goods at the seller’s
          transfer price and your share of the delivery fee. The lines are below.
        </p>
      ) : (
        <p className="text-text-muted text-sm">
          The money for this order is worked out once it is confirmed.
        </p>
      )}

      {m.fees.length > 0 ? (
        <Table>
          <THead>
            <Tr>
              <Th>Skydrop fee</Th>
              <Th align="right">Your share</Th>
            </Tr>
          </THead>
          <TBody>
            {m.fees.map((f) => (
              <Tr key={f.fee}>
                <Td>{feeName(f.fee)}</Td>
                <Td align="right">
                  <Money amount={f.storeInr} direction="debit" convert={false} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      ) : null}

      {lines.length === 0 ? (
        <p className="text-text-faint text-xs">
          Nothing has moved in your wallet for this order yet.
        </p>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>When</Th>
              <Th>In your wallet</Th>
              <Th align="right">Amount</Th>
            </Tr>
          </THead>
          <TBody>
            {lines.map((l) => (
              <Tr key={l.id}>
                <Td className="text-text-muted text-xs">{when(l.createdAt)}</Td>
                <Td>
                  <div>
                    {storeWalletDirectionLabel(
                      l.direction as StoreWalletEntryDirection,
                      'the seller',
                    )}
                  </div>
                  {l.note !== null ? <div className="text-text-faint text-xs">{l.note}</div> : null}
                </Td>
                <Td align="right">
                  <Signed amount={l.amountInr} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      {m.storeNetInr !== null && lines.length > 0 ? (
        <p className="text-sm">
          Net in your wallet for this order: <Signed amount={m.storeNetInr} />
        </p>
      ) : null}
    </div>
  );
}
