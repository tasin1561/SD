import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/components';
import { ReceiveIndex } from './_components/receive-index';

export default function ReceivePage(): ReactElement {
  return (
    <div>
      <PageHeader
        title="Receive station"
        subtitle="Goods receipts declared by sellers. Start receiving on the warehouse floor → record per-line qty + bin → complete to write stock."
      />
      <ReceiveIndex />
    </div>
  );
}
