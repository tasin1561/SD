'use client';

import type { ReactElement } from 'react';
import { Num } from '@skydrop/ui/components';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useRecipientAddresses } from '@/lib/account-hooks';
import { verdict } from '@/i18n/verdict';
import './customers.css';
import { useT, useLocale } from '@/i18n/client';
import { dateTag } from '@/i18n/format';

/**
 * Where this customer has actually taken delivery.
 *
 * A customer's totals tell you they refuse parcels; this tells you
 * WHERE. The two are different questions, because the same person can
 * be reliable at their office and never in at home — and the address a
 * new order is going to is the thing you can still change.
 *
 * Success and RTO are counted per address, so a line with three
 * failures and no deliveries is worth a call before dispatch rather
 * than an RTO afterwards.
 */
export function AddressHistory({ customerId }: { readonly customerId: string }): ReactElement {
  const locale = useLocale();
  const t = useT();
  const list = useRecipientAddresses({ customerId });
  const items = list.data ?? [];

  if (list.isLoading)
    return <SkeletonRows rows={2} label={t('customers.loadingDeliveryHistory')} />;
  if (list.isError) {
    return <ErrorState message={verdict(list.error, t)} retry={() => void list.refetch()} />;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        bare
        title={t('customers.noDeliveryHistory')}
        description={t('customers.addressesAppearHereOnce')}
      />
    );
  }

  return (
    <Table caption={t('customers.whereThisCustomerHas')}>
      <THead>
        <Tr>
          <Th>{t('customers.address')}</Th>
          <Th align="right">{t('customers.orders')}</Th>
          <Th align="right">{t('customers.delivered')}</Th>
          <Th align="right">{t('customers.returned')}</Th>
          <Th>{t('customers.lastUsed')}</Th>
        </Tr>
      </THead>
      <TBody>
        {items.map((a) => {
          // Never delivered, and tried more than once — the pattern
          // worth seeing before you dispatch to it again.
          const suspect = a.successfulCountAtAddress === 0 && a.rtoCountAtAddress > 1;
          return (
            <Tr key={a.id}>
              <Td>
                <div className="cst-addr-line" data-suspect={suspect ? '1' : undefined}>
                  {a.line1}
                </div>
                <div className="cst-addr-place">
                  {a.city}, {a.stateProvince} {a.postalCode}
                </div>
              </Td>
              <Td align="right">
                <Num value={a.seenCount} />
              </Td>
              <Td align="right">
                <Num value={a.successfulCountAtAddress} />
              </Td>
              <Td align="right">
                {a.rtoCountAtAddress === 0 ? (
                  <span className="cst-faint sk-figure">0</span>
                ) : (
                  <span className="cst-bad sk-figure">{a.rtoCountAtAddress}</span>
                )}
              </Td>
              <Td>
                <span className="cst-date sk-figure">
                  {new Date(a.lastSeenAt).toLocaleDateString(dateTag(locale, 'en-IN'))}
                </span>
              </Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
