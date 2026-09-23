import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { ReceiveIndex } from './_components/receive-index';
import '../_components/benches.css';

export default function ReceivePage(): ReactElement {
  return (
    <div className="wh-page">
      <PageHeader
        title="Receive station"
        subtitle="Where counting happens. Start receiving on the warehouse floor → record each product’s qty + bin → complete to write stock. A row belonging to a consignment says which one — open that to label, dispatch or see the whole journey."
      />
      <ReceiveIndex />
    </div>
  );
}
