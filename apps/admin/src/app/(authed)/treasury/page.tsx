import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { TreasuryIndex } from './_components/treasury-index';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('treasuryPage.treasurySkydropAdmin') };
}

export default function TreasuryPage(): ReactElement {
  return <TreasuryIndex />;
}
