import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { HandoverBench } from './_components/handover-bench';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('warehouseHandoverPage.handoverSkydropAdmin') };
}

export default function HandoverPage(): ReactElement {
  return <HandoverBench />;
}
