import type { ReactElement } from 'react';
import { SellerDetailView } from '../_components/seller-detail';

export default async function SellerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  return <SellerDetailView sellerId={id} />;
}
