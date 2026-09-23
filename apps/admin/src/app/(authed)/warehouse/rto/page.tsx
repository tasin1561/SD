import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { RtoStation } from './_components/rto-station';
import '../_components/benches.css';

export default function RtoPage(): ReactElement {
  return (
    <div className="wh-page">
      <PageHeader
        title="RTO station"
        subtitle="Receive returned parcels, inspect each line, finalize the disposition (restock or write-off)."
      />
      <RtoStation />
    </div>
  );
}
