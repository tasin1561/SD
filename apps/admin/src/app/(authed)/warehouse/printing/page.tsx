import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { PrintingStation } from './_components/printing-station';

export const metadata: Metadata = { title: 'Printing · Skydrop Admin' };

export default function WarehousePrintingPage(): ReactElement {
  return <PrintingStation />;
}
