'use client';

import type { ReactElement } from 'react';
import { Num } from '@skydrop/ui/components';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useRecipientAddresses } from '@/lib/account-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import './customers.css';

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
  const list = useRecipientAddresses({ customerId });
  const items = list.data ?? [];

  if (list.isLoading) return <SkeletonRows rows={2} label="Loading delivery history…" />;
  if (list.isError) {
    return <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        bare
        title="No delivery history"
        description="Addresses appear here once an order has been placed to them."
      />
    );
  }

  return (
    <Table caption="Where this customer has taken delivery">
      <THead>
        <Tr>
          <Th>Address</Th>
          <Th align="right">Orders</Th>
          <Th align="right">Delivered</Th>
          <Th align="right">Returned</Th>
          <Th>Last used</Th>
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
                  {new Date(a.lastSeenAt).toLocaleDateString('en-IN')}
                </span>
              </Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
