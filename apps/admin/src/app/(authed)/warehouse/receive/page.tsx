import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/components';
import { ReceiveIndex } from './_components/receive-index';

export default function ReceivePage(): ReactElement {
  return (
    <div>
      <PageHeader
        title="Receive station"
        subtitle="Where counting happens. Start receiving on the warehouse floor → record each product’s qty + bin → complete to write stock. A row belonging to a consignment says which one — open that to label, dispatch or see the whole journey."
      />
      <ReceiveIndex />
    </div>
  );
}
