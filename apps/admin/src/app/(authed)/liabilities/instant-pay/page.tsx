import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { InstantPayAdvances } from './_components/instant-pay-advances';

export const metadata: Metadata = { title: 'Instant Pay advances · Skydrop Admin' };

export default async function InstantPayAdvancesPage({
  searchParams,
}: {
  searchParams: Promise<{ sellerId?: string; courierAccountId?: string }>;
}): Promise<ReactElement> {
  const sp = await searchParams;
  return (
    <InstantPayAdvances
      initialSellerId={sp.sellerId ?? ''}
      initialCourierAccountId={sp.courierAccountId ?? ''}
    />
  );
}
