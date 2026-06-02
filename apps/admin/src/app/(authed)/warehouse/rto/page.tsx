import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/components';
import { RtoStation } from './_components/rto-station';

export default function RtoPage(): ReactElement {
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="RTO station"
        subtitle="Receive returned parcels, inspect each line, finalize the disposition (restock or write-off)."
      />
      <RtoStation />
    </div>
  );
}
