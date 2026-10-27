import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { ManualPlacementIndex } from './_components/manual-placement-index';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('manualPlacementPage.manualPlacementSkydropAdmin') };
}

export default function ManualPlacementPage(): ReactElement {
  return <ManualPlacementIndex />;
}
