import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/components';
import { PackStation } from './_components/pack-station';

export default function PackPage(): ReactElement {
  return (
    <div>
      <PageHeader
        title="Pack station"
        subtitle="Pull the next picked shipment, pack it, mark complete. It auto-attaches to a DRAFT manifest."
      />
      <PackStation />
    </div>
  );
}
