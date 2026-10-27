'use client';

import type { ReactElement } from 'react';
import type {
  ResellerMoneyLineView,
  ResellerOrderMoneyView,
  ResellerPartyCreditView,
} from '@skydrop/api-client';
import { ApiError } from '@skydrop/api-client';
import type { StoreWalletEntryDirection, WalletEntryDirection } from '@skydrop/db';
import { Money } from '@skydrop/ui/components';
import { Table, TableEmpty, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Facts, OoCard, OoSection } from './order-ops-parts';
import './order-core.css';
import {
  resellerCreditStatusKind,
  resellerCreditStatusLabel,
  storeWalletDirectionLabel,
  walletDirectionLabel,
} from '@skydrop/ui/status';
import { useResellerOrderMoney } from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { useT } from '@/i18n/client';

function feeLabel(fee: string): string {
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

function signed(amount: string): ReactElement {
  return (
    <Money
      amount={amount.replace(/^-/, '')}
      direction={amount.startsWith('-') ? 'debit' : 'credit'}
      convert={false}
    />
  );
}

function when(p: ResellerPartyCreditView): string {
  if (p.reversedAt !== null) return `Taken back ${new Date(p.reversedAt).toLocaleString()}`;
  if (p.creditedAt !== null) return `Credited ${new Date(p.creditedAt).toLocaleString()}`;
  if (p.dueAt !== null) return `Due ${new Date(p.dueAt).toLocaleString()}`;
  return '—';
}

function Lines({
  title,
  lines,
  label,
}: {
  readonly title: string;
  readonly lines: readonly ResellerMoneyLineView[];
  readonly label: (l: ResellerMoneyLineView) => string;
}): ReactElement {
  const t = useT();
  return (
    <OoCard flush>
      <Table caption={title}>
        <THead>
          <Tr>
            <Th>{title}</Th>
            <Th>{t('ordersResellerMoneyPanel.when')}</Th>
            <Th align="right">{t('ordersResellerMoneyPanel.amount')}</Th>
          </Tr>
        </THead>
        <TBody>
          {lines.length === 0 ? (
            <TableEmpty colSpan={3}>{t('ordersResellerMoneyPanel.noLinesYet')}</TableEmpty>
          ) : (
            lines.map((l) => (
              <Tr key={l.id}>
                <Td>
                  <span className="oo-body">{label(l)}</span>
                  {l.note !== null ? <span className="oo-sub">{l.note}</span> : null}
                </Td>
                <Td className="oo-muted">
                  <span className="sk-figure">{new Date(l.createdAt).toLocaleString()}</span>
                </Td>
                <Td align="right">{signed(l.amountInr)}</Td>
              </Tr>
            ))
          )}
        </TBody>
      </Table>
    </OoCard>
  );
}

/**
 * RS-6 phase 3c — staff see the full split of a reseller order: each
 * party's credit (plan, status, when), every carriage fee split between
 * store and seller, and both wallets' lines on the order. Read-only.
 * Renders nothing for a channel order (the API answers 404 there).
 */
export function ResellerMoneyPanel({
  orderId,
  enabled,
}: {
  readonly orderId: string;
  readonly enabled: boolean;
}): ReactElement | null {
  const t = useT();
  const money = useResellerOrderMoney(orderId, enabled);
  if (!enabled) return null;
  if (money.isLoading) {
    return (
      <OoSection title={t('ordersResellerMoneyPanel.memberStoreOrderMoney')}>
        <SkeletonRows
          rows={4}
          cols={5}
          label={t('ordersResellerMoneyPanel.loadingTheMemberStoreSplit')}
        />
      </OoSection>
    );
  }
  if (money.isError) {
    if (money.error instanceof ApiError && money.error.status === 404) return null;
    return (
      <OoSection title={t('ordersResellerMoneyPanel.memberStoreOrderMoney')}>
        <ErrorState message={serverVerdict(money.error)} retry={() => void money.refetch()} />
      </OoSection>
    );
  }
  const v: ResellerOrderMoneyView | undefined = money.data;
  if (v === undefined) return null;
  return (
    <section className="oo-section">
      <OoSection
        title={t('ordersResellerMoneyPanel.memberStoreOrderMoney')}
        note={t('ordersResellerMoneyPanel.eachPartySCreditAt')}
      >
        <Facts
          items={[
            { label: t('ordersResellerMoneyPanel.payment'), value: v.paymentMode },
            {
              label: 'COD',
              value: v.codInr === null ? '—' : <Money amount={v.codInr} convert={false} />,
            },
            {
              label: t('ordersResellerMoneyPanel.retailTotal'),
              value: <Money amount={v.retailTotalInr} convert={false} />,
            },
            {
              label: t('ordersResellerMoneyPanel.transferTotal'),
              value: <Money amount={v.transferTotalInr} convert={false} />,
            },
            {
              label: t('ordersResellerMoneyPanel.termsVersion'),
              // A uuid is machine text nobody dictates, so it may break;
              // `.sk-ident` alone kept it on one line and pushed the page
              // 104px sideways at 320px.
              value: <span className="sk-ident sk-ident--wrap">{v.termsVersionId}</span>,
            },
            {
              label: t('ordersResellerMoneyPanel.storePays'),
              value: (
                <span className="oo-muted">
                  {Object.entries(v.storePercents)
                    .map(([k, pct]) => `${k.replace(/StorePercent$/, '')} ${pct}%`)
                    .join(' · ')}
                </span>
              ),
            },
          ]}
        />
      </OoSection>

      <OoCard flush>
        <Table caption={t('ordersResellerMoneyPanel.creditsByParty')}>
          <THead>
            <Tr>
              <Th>{t('ordersResellerMoneyPanel.party')}</Th>
              <Th>{t('ordersResellerMoneyPanel.status')}</Th>
              <Th>{t('ordersResellerMoneyPanel.when')}</Th>
              <Th align="right">{t('ordersResellerMoneyPanel.gross')}</Th>
              <Th align="right">{t('ordersResellerMoneyPanel.transfer')}</Th>
              <Th align="right">{t('ordersResellerMoneyPanel.taxShare')}</Th>
              <Th align="right">{t('ordersResellerMoneyPanel.codFee')}</Th>
              <Th align="right">{t('ordersResellerMoneyPanel.instantPay')}</Th>
              <Th align="right">{t('ordersResellerMoneyPanel.net')}</Th>
            </Tr>
          </THead>
          <TBody>
            {v.parties.length === 0 ? (
              <TableEmpty colSpan={9}>
                {t('ordersResellerMoneyPanel.notPlannedYetThePlan')}
              </TableEmpty>
            ) : (
              v.parties.map((p) => (
                <Tr key={p.party}>
                  <Td>
                    <span className="oo-body">
                      {p.party === 'STORE'
                        ? t('ordersResellerMoneyPanel.store')
                        : t('ordersResellerMoneyPanel.client')}
                    </span>
                    <span className="oo-sub">{p.timing}</span>
                  </Td>
                  <Td>
                    <StatusChip
                      kind={resellerCreditStatusKind(p.status)}
                      label={resellerCreditStatusLabel(p.status)}
                      size="sm"
                    />
                    {p.skippedReason !== null ? (
                      <span className="oo-sub sk-ident">{p.skippedReason}</span>
                    ) : null}
                  </Td>
                  <Td className="oo-muted">{when(p)}</Td>
                  <Td align="right">
                    <Money amount={p.grossInr} convert={false} />
                  </Td>
                  <Td align="right">
                    <Money amount={p.transferInr} convert={false} />
                  </Td>
                  <Td align="right">
                    <Money amount={p.taxShareInr} convert={false} />
                  </Td>
                  <Td align="right">
                    <Money amount={p.codFeeShareInr} convert={false} />
                  </Td>
                  <Td align="right">
                    <Money amount={p.instantFeeShareInr} convert={false} />
                  </Td>
                  <Td align="right">
                    <Money amount={p.netInr} convert={false} />
                  </Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      </OoCard>

      {v.fees.length > 0 ? (
        <OoCard flush>
          <Table caption={t('ordersResellerMoneyPanel.feesBilled')}>
            <THead>
              <Tr>
                <Th>{t('ordersResellerMoneyPanel.feeBilled')}</Th>
                <Th align="right">{t('ordersResellerMoneyPanel.store')}</Th>
                <Th align="right">{t('ordersResellerMoneyPanel.client')}</Th>
                <Th align="right">{t('ordersResellerMoneyPanel.total')}</Th>
              </Tr>
            </THead>
            <TBody>
              {v.fees.map((f) => (
                <Tr key={f.fee}>
                  <Td>{feeLabel(f.fee)}</Td>
                  <Td align="right">
                    <Money amount={f.storeInr} convert={false} />
                  </Td>
                  <Td align="right">
                    <Money amount={f.sellerInr} convert={false} />
                  </Td>
                  <Td align="right">
                    <Money amount={f.totalInr} convert={false} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </OoCard>
      ) : null}

      <div className="oo-split">
        <div className="oo-stack oo-stack--tight">
          <Lines
            title={t('ordersResellerMoneyPanel.storeWallet')}
            lines={v.storeLines ?? []}
            label={(l) => storeWalletDirectionLabel(l.direction as StoreWalletEntryDirection)}
          />
          {v.storeNetInr !== null ? (
            <p className="oo-muted oo-row oo-row--end">
              {t('ordersResellerMoneyPanel.storeNet')}{' '}
              <Money amount={v.storeNetInr} convert={false} />
            </p>
          ) : null}
        </div>
        <div className="oo-stack oo-stack--tight">
          <Lines
            title={t('ordersResellerMoneyPanel.clientWallet')}
            lines={v.sellerLines ?? []}
            label={(l) => walletDirectionLabel(l.direction as WalletEntryDirection)}
          />
          {v.sellerNetInr !== null ? (
            <p className="oo-muted oo-row oo-row--end">
              {t('ordersResellerMoneyPanel.clientNet')}{' '}
              <Money amount={v.sellerNetInr} convert={false} />
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
