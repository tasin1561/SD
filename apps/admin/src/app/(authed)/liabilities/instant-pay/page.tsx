import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { InstantPayAdvances } from './_components/instant-pay-advances';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('liabilitiesInstantPayPage.instantPayAdvancesSkydropAdmin') };
}

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
