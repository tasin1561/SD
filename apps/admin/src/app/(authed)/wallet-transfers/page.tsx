import type { ReactElement } from 'react';
import { WalletTransfersIndex } from './_components/wallet-transfers-index';

export default async function WalletTransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ sellerId?: string }>;
}): Promise<ReactElement> {
  const { sellerId } = await searchParams;
  return <WalletTransfersIndex initialSellerId={sellerId ?? null} />;
}
