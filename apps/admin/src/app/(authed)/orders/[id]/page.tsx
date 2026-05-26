import type { ReactElement } from 'react';
import { OrderDetailView } from '../_components/order-detail';

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  return <OrderDetailView orderId={id} />;
}
