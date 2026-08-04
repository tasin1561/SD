import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/components';
import { PickStation } from './_components/pick-station';

export default function PickPage(): ReactElement {
  return (
    <div>
      <PageHeader
        title="Pick station"
        subtitle="Pull the next confirmed order, claim it, walk to the bins, record each line, complete."
      />
      <PickStation />
    </div>
  );
}
