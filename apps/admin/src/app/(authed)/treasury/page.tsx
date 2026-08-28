import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { TreasuryIndex } from './_components/treasury-index';

export const metadata: Metadata = { title: 'Treasury · Skydrop Admin' };

export default function TreasuryPage(): ReactElement {
  return <TreasuryIndex />;
}
