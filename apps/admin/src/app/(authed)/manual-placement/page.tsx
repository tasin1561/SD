import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { ManualPlacementIndex } from './_components/manual-placement-index';

export const metadata: Metadata = { title: 'Manual placement · Skydrop Admin' };

export default function ManualPlacementPage(): ReactElement {
  return <ManualPlacementIndex />;
}
