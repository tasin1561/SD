import type { ReactElement } from 'react';
import { SellerWalletDetailView } from './_components/seller-wallet-detail';

export default async function SellerWalletPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  return <SellerWalletDetailView sellerId={id} />;
}
