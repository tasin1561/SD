import type { ReactElement } from 'react';
import Link from 'next/link';
import { Crumbs, PageHeader } from '@skydrop/ui/components';
import { OrderDefaultsPanel } from './_components/order-defaults-panel';

export default function OrderDefaultsPage(): ReactElement {
  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: 'Seller console' },
              { label: 'Account' },
              { label: 'Settings', href: '/settings' },
              { label: 'Order defaults' },
            ]}
            Link={Link}
          />
        }
        title="Order defaults"
        subtitle="What a new order starts with. Every one of these stays editable on the order itself — this only saves you typing the usual answer."
      />
      <OrderDefaultsPanel />
    </div>
  );
}
