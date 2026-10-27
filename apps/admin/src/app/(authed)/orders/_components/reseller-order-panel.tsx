'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import type { OrderView } from '@skydrop/api-client';
import { Money } from '@skydrop/ui/components';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Facts, OoCard, OoSection } from './order-ops-parts';
import { useT } from '@/i18n/client';

const SHARES: ReadonlyArray<readonly [keyof OrderView, string]> = [
  ['resellerDeliveryFeeStorePercent', 'Delivery fee'],
  ['resellerReturnFeeStorePercent', 'Return fee'],
  ['resellerCustomerReturnFeeStorePercent', 'Customer return fee'],
  ['resellerCodFeeStorePercent', 'COD fee'],
  ['resellerCodTaxStorePercent', 'COD tax'],
  ['resellerInstantPayFeeStorePercent', 'Instant Pay fee'],
];

function timing(trigger: string | null | undefined, days: number | null | undefined): string {
  if (trigger === null || trigger === undefined) return '—';
  const label = trigger.toLowerCase().replace(/_/g, ' ');
  return days !== null && days !== undefined && days > 0 ? `${label} (+${days} days)` : label;
}

/**
 * RS-5 — a reseller store's order as Skydrop sees it: which store placed
 * it, the terms version it was placed under, the six fee shares and both
 * credit timings snapshotted on the order, and each line's transfer price
 * and retail as placed. Read-only; staff see the customer in full above.
 * Renders nothing for the seller's own (channel) order.
 */
export function ResellerOrderPanel({ order }: { order: OrderView }): ReactElement | null {
  const t = useT();
  if (order.storeKind !== 'RESELLER') return null;
  return (
    <OoSection
      title={t('ordersResellerOrderPanel.memberStore')}
      note={t('ordersResellerOrderPanel.placedByAMemberStore')}
    >
      <Facts
        items={[
          {
            label: t('ordersResellerOrderPanel.store'),
            value:
              order.storeId === null ? (
                (order.storeNameSnapshot ?? '—')
              ) : (
                <Link href={`/reseller-stores/${order.storeId}`} className="oo-link">
                  {order.storeNameSnapshot ?? t('ordersResellerOrderPanel.memberStore')}
                </Link>
              ),
          },
          {
            label: t('ordersResellerOrderPanel.termsVersion'),
            value:
              order.resellerTermsVersionNumber === null ||
              order.resellerTermsVersionNumber === undefined
                ? '—'
                : t('ordersResellerOrderPanel.version', {
                    resellerTermsVersionNumber: order.resellerTermsVersionNumber,
                  }),
          },
          ...SHARES.map(([key, label]) => {
            const value = order[key];
            return {
              label: t('ordersResellerOrderPanel.storePays', { label }),
              value: typeof value === 'string' ? `${value}%` : '—',
            };
          }),
          {
            label: t('ordersResellerOrderPanel.storeCredited'),
            value: timing(order.resellerStoreCreditTrigger, order.resellerStoreCreditDays),
          },
          {
            label: t('ordersResellerOrderPanel.clientCredited'),
            value: timing(order.resellerSellerCreditTrigger, order.resellerSellerCreditDays),
          },
        ]}
      />
      <OoCard flush>
        <Table caption={t('ordersResellerOrderPanel.memberStoreLines')}>
          <THead>
            <Tr>
              <Th>{t('ordersResellerOrderPanel.line')}</Th>
              <Th align="right">{t('ordersResellerOrderPanel.qty')}</Th>
              <Th align="right">{t('ordersResellerOrderPanel.transferPrice')}</Th>
              <Th align="right">{t('ordersResellerOrderPanel.retail')}</Th>
              <Th>{t('ordersResellerOrderPanel.range')}</Th>
              <Th>{t('ordersResellerOrderPanel.stock')}</Th>
            </Tr>
          </THead>
          <TBody>
            {order.items.map((i) => (
              <Tr key={i.id}>
                <Td>
                  <span className="oo-body">{i.productName}</span>
                  <span className="oo-sub sk-ident">{i.skuCode}</span>
                </Td>
                <Td align="right">
                  <span className="sk-figure">{i.quantity}</span>
                </Td>
                <Td align="right">
                  {i.resellerTransferPriceInr ? (
                    <Money amount={i.resellerTransferPriceInr} convert={false} />
                  ) : (
                    '—'
                  )}
                </Td>
                <Td align="right">
                  {i.resellerRetailUnitInr ? (
                    <Money amount={i.resellerRetailUnitInr} convert={false} />
                  ) : (
                    '—'
                  )}
                </Td>
                <Td className="oo-muted">
                  {(i.resellerMinRetailInr ?? null) === null &&
                  (i.resellerMaxRetailInr ?? null) === null ? (
                    t('ordersResellerOrderPanel.anyPrice')
                  ) : (
                    <>
                      {i.resellerMinRetailInr ? (
                        <Money amount={i.resellerMinRetailInr} convert={false} />
                      ) : (
                        t('ordersResellerOrderPanel.noMinimum')
                      )}{' '}
                      –{' '}
                      {i.resellerMaxRetailInr ? (
                        <Money amount={i.resellerMaxRetailInr} convert={false} />
                      ) : (
                        t('ordersResellerOrderPanel.noMaximum')
                      )}
                    </>
                  )}
                </Td>
                <Td className="oo-muted">
                  {i.resellerStockMode === 'SET_ASIDE'
                    ? t('ordersResellerOrderPanel.setAside')
                    : i.resellerStockMode === 'SHARED'
                      ? t('ordersResellerOrderPanel.shared')
                      : '—'}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </OoCard>
    </OoSection>
  );
}
