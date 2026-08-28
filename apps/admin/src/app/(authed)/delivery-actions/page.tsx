import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { DeliveryActionsIndex } from './_components/delivery-actions-index';

export const metadata: Metadata = { title: 'Failed deliveries · Skydrop Admin' };

export default function DeliveryActionsPage(): ReactElement {
  return <DeliveryActionsIndex />;
}
