import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { LiabilitiesIndex } from './_components/liabilities-index';

export const metadata: Metadata = { title: 'What we owe · Skydrop Admin' };

export default function LiabilitiesPage(): ReactElement {
  return <LiabilitiesIndex />;
}
