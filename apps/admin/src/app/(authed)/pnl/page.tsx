import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { PnlIndex } from './_components/pnl-index';

export const metadata: Metadata = { title: 'Profit & loss · Skydrop Admin' };

export default function PnlPage(): ReactElement {
  return <PnlIndex />;
}
