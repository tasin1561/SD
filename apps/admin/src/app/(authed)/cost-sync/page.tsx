import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { CostSyncIndex } from './_components/cost-sync-index';

export const metadata: Metadata = { title: 'Courier cost sync · Skydrop Admin' };

export default function CostSyncPage(): ReactElement {
  return <CostSyncIndex />;
}
