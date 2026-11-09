import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { OrderDetailView } from '../_components/order-detail';
import { looksLikeOrderId } from '@/lib/order-id';

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  // `[id]` matches any segment, so a guessed or stale URL arrived at
  // the API as an order id and came back as "Validation failed (uuid v
  // 7 is expected)" (see `looksLikeOrderId`).
  if (!looksLikeOrderId(id)) notFound();
  return <OrderDetailView orderId={id} />;
}
