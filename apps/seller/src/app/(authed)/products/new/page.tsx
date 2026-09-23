import type { ReactElement } from 'react';
import { AreaPage, StockPageHeader } from '@/app/(authed)/inventory/_components/stock-ui';
import { NewProductForm } from './_components/new-product-form';

/**
 * Add one product by hand.
 *
 * The CSV import at /products/import is the path for a catalogue; this is
 * the path for a seller with three SKUs, who until now had to build a
 * spreadsheet to add them.
 */
export default function NewProductPage(): ReactElement {
  return (
    <AreaPage>
      <StockPageHeader
        breadcrumbs={[
          { label: 'Seller console' },
          { label: 'Stock & WMS' },
          { label: 'Products', href: '/products' },
          { label: 'New' },
        ]}
        title="New product"
        subtitle="One product and every variant it ships in. Reusing an existing product reference adds to that product instead. Bringing in a whole catalogue? Use the CSV import."
      />
      <NewProductForm />
    </AreaPage>
  );
}
