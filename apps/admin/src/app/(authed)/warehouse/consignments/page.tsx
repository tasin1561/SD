import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/components';
import { ConsignmentsIndex } from './_components/consignments-index';

export default function ConsignmentsPage(): ReactElement {
  return (
    <div>
      <PageHeader
        title="Consignments"
        subtitle="Stock on its way in. A consignment either ships straight to India or comes through our Bangladesh warehouse first — open one to count a leg, print labels, or send it on."
      />
      <ConsignmentsIndex />
    </div>
  );
}
