import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/components';
import { ConsignmentsIndex } from './_components/consignments-index';

export default function ConsignmentsPage(): ReactElement {
  return (
    <div>
      <PageHeader
        title="Consignments"
        subtitle="The whole journey in one place: where each consignment is, what each stop counted, and the steps the receive station has no opinion about — labelling, dispatch to India, and cancelling. Counting itself happens on the receive station."
      />
      <ConsignmentsIndex />
    </div>
  );
}
