import type { ReactElement } from 'react';
import { AreaPage, StockPageHeader } from '../../inventory/_components/stock-kit';
import { ManifestsIndex } from './_components/manifests-index';

export default function ManifestsPage(): ReactElement {
  return (
    <AreaPage>
      <StockPageHeader
        breadcrumbs={[{ label: 'Warehouse', href: '/warehouse' }, { label: 'Manifests' }]}
        title="Manifests"
        subtitle="A record of which parcels went out together. Closing and courier handoff are automatic once a box is packed — nothing here needs doing unless something went wrong."
      />
      <ManifestsIndex />
    </AreaPage>
  );
}
