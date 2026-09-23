import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { PackStation } from './_components/pack-station';
import '../_components/benches.css';

export default function PackPage(): ReactElement {
  return (
    <div className="wh-page">
      <PageHeader
        title="Pack station"
        subtitle="Pull the next picked shipment, pack it, mark complete. It auto-attaches to a DRAFT manifest."
      />
      <PackStation />
    </div>
  );
}
