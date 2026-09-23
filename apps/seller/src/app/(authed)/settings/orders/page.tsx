import type { ReactElement } from 'react';
import { SetPageHeader } from '../_components/settings-parts';
import { OrderDefaultsPanel } from './_components/order-defaults-panel';

export default function OrderDefaultsPage(): ReactElement {
  return (
    <div className="set-page">
      <SetPageHeader
        crumbs={[
          { label: 'Seller console' },
          { label: 'Account' },
          { label: 'Settings', href: '/settings' },
          { label: 'Order defaults' },
        ]}
        title="Order defaults"
        subtitle="What a new order starts with. Every one of these stays editable on the order itself — this only saves you typing the usual answer."
      />
      <OrderDefaultsPanel />
    </div>
  );
}
