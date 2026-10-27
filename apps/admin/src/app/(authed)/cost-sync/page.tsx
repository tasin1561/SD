import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { CostSyncIndex } from './_components/cost-sync-index';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('costSyncPage.courierCostSyncSkydropAdmin') };
}

export default function CostSyncPage(): ReactElement {
  return <CostSyncIndex />;
}
