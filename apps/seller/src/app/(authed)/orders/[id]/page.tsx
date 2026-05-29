import type { ReactElement } from 'react';
import { OrderDetailView } from '../_components/order-detail';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SellerOrderDetailPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { id } = await params;
  return <OrderDetailView orderId={id} />;
}
