import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { PrintingStation } from './_components/printing-station';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('warehousePrintingPage.printingSkydropAdmin') };
}

export default function WarehousePrintingPage(): ReactElement {
  return <PrintingStation />;
}
