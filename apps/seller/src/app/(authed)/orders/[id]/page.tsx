import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { OrderDetailView } from '../_components/order-detail';
import { looksLikeOrderId } from '@/lib/order-id';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SellerOrderDetailPage({ params }: PageProps): Promise<ReactElement> {
  const { id } = await params;
  // `[id]` matches any segment, so a guessed or stale URL like
  // `/orders/v2` arrived at the API as an order id and came back as
  // "Validation failed (uuid v 7 is expected)". A page that is not
  // there should say so (see `looksLikeOrderId`).
  if (!looksLikeOrderId(id)) notFound();
  return <OrderDetailView orderId={id} />;
}
