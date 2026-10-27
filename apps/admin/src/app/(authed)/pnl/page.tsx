import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { PnlIndex } from './_components/pnl-index';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('pnlPage.profitLossSkydropAdmin') };
}

export default function PnlPage(): ReactElement {
  return <PnlIndex />;
}
