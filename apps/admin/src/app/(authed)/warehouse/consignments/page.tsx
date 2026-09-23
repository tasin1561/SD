import type { ReactElement } from 'react';
import { AreaPage, StockPageHeader } from '../../inventory/_components/stock-kit';
import { ConsignmentsIndex } from './_components/consignments-index';

export default function ConsignmentsPage(): ReactElement {
  return (
    <AreaPage>
      <StockPageHeader
        breadcrumbs={[{ label: 'Warehouse', href: '/warehouse' }, { label: 'Consignments' }]}
        title="Consignments"
        subtitle="The whole journey in one place: where each consignment is, what each stop counted, and the steps the receive station has no opinion about — labelling, dispatch to India, and cancelling. Counting itself happens on the receive station."
      />
      <ConsignmentsIndex />
    </AreaPage>
  );
}
