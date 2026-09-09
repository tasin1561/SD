import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { CourierDecisionIndex } from './_components/courier-decision-index';

export const metadata: Metadata = { title: 'Courier decisions · Skydrop Admin' };

export default function CourierDecisionsPage(): ReactElement {
  return <CourierDecisionIndex />;
}
