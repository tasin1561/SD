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
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';
import { richMessage, useLocale, useT } from '@/i18n/client';
import { formatDateTime } from '@/i18n/format';
import { verdict } from '@/i18n/verdict';
import { useStoreOrderMoney } from '@/lib/order-hooks';
import { Facts, Notice, RoSection } from '../../_components/orders-parts';

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

function feeName(fee: WalletEntryDirection, t: Translate<MessageKey>): string {
  switch (fee) {
    case 'ORDER_CHARGES':
      return t('ordm.fee.delivery');
    case 'RTO_FEE':
      return t('ordm.fee.rto');
    case 'CUSTOMER_RETURN_FEE':
      return t('ordm.fee.customerReturn');
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
  const t = useT();
  const money = useStoreOrderMoney(orderId);
  return (
    <RoSection title={t('ordm.title')} bare>
      {money.isPending ? (
        <SkeletonRows rows={4} cols={2} label={t('ordm.loading')} />
      ) : money.isError ? (
        <ErrorState message={verdict(money.error, t)} retry={() => void money.refetch()} />
      ) : (
        <MoneyBody m={money.data} />
      )}
    </RoSection>
  );
}

function MoneyBody({ m }: { m: ResellerOrderMoneyView }): ReactElement {
  const t = useT();
  const locale = useLocale();
  const when = (iso: string): string => formatDateTime(iso, locale);
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
                  label: t('ordm.cod'),
                  value: <Money amount={store.grossInr} convert={false} />,
                },
                {
                  label: t('ordm.transfer'),
                  value: <Money amount={store.transferInr} direction="debit" convert={false} />,
                },
                {
                  label: t('ordm.taxShare'),
                  value: <Money amount={store.taxShareInr} direction="debit" convert={false} />,
                },
                {
                  label: t('ordm.codFeeShare'),
                  value: <Money amount={store.codFeeShareInr} direction="debit" convert={false} />,
                },
                {
                  label: t('ordm.instantShare'),
                  value: (
                    <Money amount={store.instantFeeShareInr} direction="debit" convert={false} />
                  ),
                },
                {
                  label: t('ordm.credited'),
                  value: <Signed amount={store.netInr} />,
                  total: true,
                },
                ...(store.dueAt !== null
                  ? [
                      {
                        label: t('ordm.due'),
                        value: <span className="sk-figure">{when(store.dueAt)}</span>,
                      },
                    ]
                  : []),
                ...(store.creditedAt !== null
                  ? [
                      {
                        label: t('ordm.creditedAt'),
                        value: <span className="sk-figure">{when(store.creditedAt)}</span>,
                      },
                    ]
                  : []),
                ...(store.reversedAt !== null
                  ? [
                      {
                        label: t('ordm.takenBack'),
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
          <span>{t('ordm.prepaidNote')}</span>
        </Notice>
      ) : (
        <Notice tone="neutral" icon={<Wallet size={16} />}>
          <span>{t('ordm.notYet')}</span>
        </Notice>
      )}

      {m.fees.length > 0 ? (
        <div className="ro-card" data-flush="1">
          <Table caption={t('ordm.fees.caption')}>
            <THead>
              <Tr>
                <Th>{t('ordm.fees.fee')}</Th>
                <Th align="right">{t('ordm.fees.share')}</Th>
              </Tr>
            </THead>
            <TBody>
              {m.fees.map((f) => (
                <Tr key={f.fee}>
                  <Td>{feeName(f.fee, t)}</Td>
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
        <p className="ro-faint">{t('ordm.lines.none')}</p>
      ) : (
        <div className="ro-card" data-flush="1">
          <Table caption={t('ordm.lines.caption')}>
            <THead>
              <Tr>
                <Th>{t('ordm.lines.when')}</Th>
                <Th>{t('ordm.lines.in')}</Th>
                <Th align="right">{t('ordm.lines.amount')}</Th>
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
                        'the client',
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
          {richMessage(t('ordm.net'), { amount: <Signed amount={m.storeNetInr} /> })}
        </p>
      ) : null}
    </div>
  );
}
