import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { HandoverBench } from './_components/handover-bench';

export const metadata: Metadata = { title: 'Handover · Skydrop Admin' };

export default function HandoverPage(): ReactElement {
  return <HandoverBench />;
}
