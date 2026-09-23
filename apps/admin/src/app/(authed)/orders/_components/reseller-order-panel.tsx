'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import type { OrderView } from '@skydrop/api-client';
import { Money } from '@skydrop/ui/components';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Facts, OoCard, OoSection } from './order-ops-parts';

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
  if (order.storeKind !== 'RESELLER') return null;
  return (
    <OoSection
      title="Reseller store"
      note="Placed by a reseller store under the terms below — snapshotted when it was placed, so later edits never re-price it."
    >
      <Facts
        items={[
          {
            label: 'Store',
            value:
              order.storeId === null ? (
                (order.storeNameSnapshot ?? '—')
              ) : (
                <Link href={`/reseller-stores/${order.storeId}`} className="oo-link">
                  {order.storeNameSnapshot ?? 'Reseller store'}
                </Link>
              ),
          },
          {
            label: 'Terms version',
            value:
              order.resellerTermsVersionNumber === null ||
              order.resellerTermsVersionNumber === undefined
                ? '—'
                : `Version ${order.resellerTermsVersionNumber}`,
          },
          ...SHARES.map(([key, label]) => {
            const value = order[key];
            return {
              label: `${label} — store pays`,
              value: typeof value === 'string' ? `${value}%` : '—',
            };
          }),
          {
            label: 'Store credited',
            value: timing(order.resellerStoreCreditTrigger, order.resellerStoreCreditDays),
          },
          {
            label: 'Seller credited',
            value: timing(order.resellerSellerCreditTrigger, order.resellerSellerCreditDays),
          },
        ]}
      />
      <OoCard flush>
        <Table caption="Reseller lines">
          <THead>
            <Tr>
              <Th>Line</Th>
              <Th align="right">Qty</Th>
              <Th align="right">Transfer price</Th>
              <Th align="right">Retail</Th>
              <Th>Range</Th>
              <Th>Stock</Th>
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
                    'Any price'
                  ) : (
                    <>
                      {i.resellerMinRetailInr ? (
                        <Money amount={i.resellerMinRetailInr} convert={false} />
                      ) : (
                        'no minimum'
                      )}{' '}
                      –{' '}
                      {i.resellerMaxRetailInr ? (
                        <Money amount={i.resellerMaxRetailInr} convert={false} />
                      ) : (
                        'no maximum'
                      )}
                    </>
                  )}
                </Td>
                <Td className="oo-muted">
                  {i.resellerStockMode === 'SET_ASIDE'
                    ? 'Set aside'
                    : i.resellerStockMode === 'SHARED'
                      ? 'Shared'
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
