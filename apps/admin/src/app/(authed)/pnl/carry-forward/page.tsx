import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { CarryForwardIndex } from './_components/carry-forward-index';

export const metadata: Metadata = { title: 'Carry-forward P&L · Skydrop Admin' };

export default function CarryForwardPnlPage(): ReactElement {
  return <CarryForwardIndex />;
}
