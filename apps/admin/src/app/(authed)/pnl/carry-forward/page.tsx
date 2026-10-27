import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { CarryForwardIndex } from './_components/carry-forward-index';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('pnlCarryForwardPage.carryForwardPLSkydrop') };
}

export default function CarryForwardPnlPage(): ReactElement {
  return <CarryForwardIndex />;
}
