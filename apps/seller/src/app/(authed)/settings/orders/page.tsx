import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/components';
import { OrderDefaultsPanel } from './_components/order-defaults-panel';

export default function OrderDefaultsPage(): ReactElement {
  return (
    <div>
      <PageHeader
        title="Order defaults"
        subtitle="What a new order starts with. Every one of these stays editable on the order itself — this only saves you typing the usual answer."
      />
      <OrderDefaultsPanel />
    </div>
  );
}
