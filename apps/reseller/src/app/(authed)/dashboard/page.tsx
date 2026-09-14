'use client';

import type { ReactElement } from 'react';
import { useStoreIdentity } from '@skydrop/auth/client';
import {
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  PageHeader,
  ResellerStoreStatusBadge,
} from '@skydrop/ui/components';

/**
 * The landing page (RS-11 phase 1): which store this is, whether it is
 * open, and the one seller it resells for. Rendered from the identity the
 * layout already resolved, so there is nothing to load and nothing to
 * fail. Orders, stock and money arrive in later phases.
 */
export default function DashboardPage(): ReactElement {
  const me = useStoreIdentity();
  if (me === null) return <></>;
  const { store, seller } = me;
  const shownAs = store.displayName ?? store.name;

  return (
    <div className="space-y-6">
      <PageHeader title={shownAs} subtitle={`Reselling for ${seller.companyName}`} />

      {store.status === 'PAUSED' ? (
        <p
          role="status"
          className="border-border bg-surface-raised text-text-body rounded-lg border px-3 py-2 text-sm"
        >
          {seller.companyName} has paused this store. It takes no new orders until they resume it;
          anything already placed carries on.
        </p>
      ) : null}

      <Card>
        <CardHeader title="Your store" />
        <CardBody>
          <DescriptionList
            columns={2}
            items={[
              { label: 'Store', value: store.name },
              { label: 'Customers see', value: shownAs },
              {
                label: 'Status',
                value:
                  store.status === null ? '—' : <ResellerStoreStatusBadge status={store.status} />,
              },
              { label: 'Reselling for', value: seller.companyName },
              {
                label: 'Wallet managed by',
                value:
                  store.walletManagedBy === 'SKYDROP'
                    ? 'Skydrop'
                    : store.walletManagedBy === 'SELLER'
                      ? seller.companyName
                      : '—',
              },
              { label: 'Your role', value: me.roleName },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="What comes next" />
        <CardBody>
          <p className="text-sm">
            Your store is set up. The products you may sell, their prices, and placing orders arrive
            in the next releases of this portal — {seller.companyName} decides which products and at
            what price.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
