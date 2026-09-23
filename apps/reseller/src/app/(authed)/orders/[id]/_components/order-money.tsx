'use client';

import type { ReactElement } from 'react';
import { Wallet } from 'lucide-react';
import type { ResellerOrderMoneyView } from '@skydrop/api-client';
import type { StoreWalletEntryDirection, WalletEntryDirection } from '@skydrop/db';
import { Money } from '@skydrop/ui/components';
import {
  resellerCreditStatusKind,
  resellerCreditStatusLabel,
  storeWalletDirectionLabel,
} from '@skydrop/ui/status';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { serverVerdict } from '@/lib/server-verdict';
import { useStoreOrderMoney } from '@/lib/order-hooks';
import { Facts, Notice, RoSection } from '../../_components/orders-parts';

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
    <RoSection title="What this order earns you" bare>
      {money.isPending ? (
        <SkeletonRows rows={4} cols={2} label="Loading the money" />
      ) : money.isError ? (
        <ErrorState message={serverVerdict(money.error)} retry={() => void money.refetch()} />
      ) : (
        <MoneyBody m={money.data} />
      )}
    </RoSection>
  );
}

function MoneyBody({ m }: { m: ResellerOrderMoneyView }): ReactElement {
  const store = m.parties.find((p) => p.party === 'STORE') ?? null;
  const lines = m.storeLines ?? [];
  return (
    <div className="ro-stack">
      {store !== null ? (
        <div className="ro-card">
          <div className="ro-stack ro-stack--tight">
            <div className="ro-row">
              <StatusChip
                kind={resellerCreditStatusKind(store.status)}
                label={resellerCreditStatusLabel(store.status)}
                size="sm"
              />
              <span className="ro-muted">{store.timing}</span>
            </div>
            <Facts
              alignEnd
              items={[
                {
                  label: 'COD collected for you',
                  value: <Money amount={store.grossInr} convert={false} />,
                },
                {
                  label: 'Goods at the seller’s transfer price',
                  value: <Money amount={store.transferInr} direction="debit" convert={false} />,
                },
                {
                  label: 'Your share of the COD tax',
                  value: <Money amount={store.taxShareInr} direction="debit" convert={false} />,
                },
                {
                  label: 'Your share of the COD fee',
                  value: <Money amount={store.codFeeShareInr} direction="debit" convert={false} />,
                },
                {
                  label: 'Your share of the Instant Pay fee',
                  value: (
                    <Money amount={store.instantFeeShareInr} direction="debit" convert={false} />
                  ),
                },
                {
                  label: 'You are credited',
                  value: <Signed amount={store.netInr} />,
                  total: true,
                },
                ...(store.dueAt !== null
                  ? [
                      {
                        label: 'Due',
                        value: <span className="sk-figure">{when(store.dueAt)}</span>,
                      },
                    ]
                  : []),
                ...(store.creditedAt !== null
                  ? [
                      {
                        label: 'Credited',
                        value: <span className="sk-figure">{when(store.creditedAt)}</span>,
                      },
                    ]
                  : []),
                ...(store.reversedAt !== null
                  ? [
                      {
                        label: 'Taken back',
                        value: <span className="sk-figure">{when(store.reversedAt)}</span>,
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        </div>
      ) : m.paymentMode === 'PREPAID' ? (
        <Notice tone="info" icon={<Wallet size={16} />}>
          <span>
            A prepaid order is paid from your wallet at confirmation: the goods at the seller’s
            transfer price and your share of the delivery fee. The lines are below.
          </span>
        </Notice>
      ) : (
        <Notice tone="neutral" icon={<Wallet size={16} />}>
          <span>The money for this order is worked out once it is confirmed.</span>
        </Notice>
      )}

      {m.fees.length > 0 ? (
        <div className="ro-card" data-flush="1">
          <Table caption="Skydrop fees and your share">
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
        </div>
      ) : null}

      {lines.length === 0 ? (
        <p className="ro-faint">Nothing has moved in your wallet for this order yet.</p>
      ) : (
        <div className="ro-card" data-flush="1">
          <Table caption="Your wallet lines for this order">
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
                  <Td>
                    <span className="ro-muted sk-figure">{when(l.createdAt)}</span>
                  </Td>
                  <Td>
                    <div>
                      {storeWalletDirectionLabel(
                        l.direction as StoreWalletEntryDirection,
                        'the seller',
                      )}
                    </div>
                    {l.note !== null ? <span className="ro-sub">{l.note}</span> : null}
                  </Td>
                  <Td align="right">
                    <Signed amount={l.amountInr} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      )}
      {m.storeNetInr !== null && lines.length > 0 ? (
        <p className="ro-body">
          Net in your wallet for this order: <Signed amount={m.storeNetInr} />
        </p>
      ) : null}
    </div>
  );
}
