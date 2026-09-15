'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import type { OrderView } from '@skydrop/api-client';
import {
  Card,
  CardBody,
  Money,
  Section,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';

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
    <Section
      title="Reseller store"
      subtitle="Placed by a reseller store under the terms below — snapshotted when it was placed, so later edits never re-price it."
    >
      <Card>
        <CardBody>
          <dl className="grid grid-cols-[minmax(84px,36%)_1fr] gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[180px_1fr] sm:gap-x-6">
            <dt className="text-text-muted">Store</dt>
            <dd className="text-text-body">
              {order.storeId === null ? (
                (order.storeNameSnapshot ?? '—')
              ) : (
                <Link
                  href={`/reseller-stores/${order.storeId}`}
                  className="text-accent hover:underline"
                >
                  {order.storeNameSnapshot ?? 'Reseller store'}
                </Link>
              )}
            </dd>
            <dt className="text-text-muted">Terms version</dt>
            <dd className="text-text-body">
              {order.resellerTermsVersionNumber === null ||
              order.resellerTermsVersionNumber === undefined
                ? '—'
                : `Version ${order.resellerTermsVersionNumber}`}
            </dd>
            {SHARES.map(([key, label]) => {
              const value = order[key];
              return (
                <div key={key} className="contents">
                  <dt className="text-text-muted">{label} — store pays</dt>
                  <dd className="text-text-body">
                    {typeof value === 'string' ? `${value}%` : '—'}
                  </dd>
                </div>
              );
            })}
            <dt className="text-text-muted">Store credited</dt>
            <dd className="text-text-body">
              {timing(order.resellerStoreCreditTrigger, order.resellerStoreCreditDays)}
            </dd>
            <dt className="text-text-muted">Seller credited</dt>
            <dd className="text-text-body">
              {timing(order.resellerSellerCreditTrigger, order.resellerSellerCreditDays)}
            </dd>
          </dl>
        </CardBody>
      </Card>
      <div className="mt-3">
        <Table>
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
                  <div className="text-text-body">{i.productName}</div>
                  <div className="text-text-faint font-mono text-xs">{i.skuCode}</div>
                </Td>
                <Td align="right">{i.quantity}</Td>
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
                <Td className="text-text-muted text-xs">
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
                <Td className="text-text-muted text-xs">
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
      </div>
    </Section>
  );
}
