import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/components';
import { NewProductForm } from './_components/new-product-form';

/**
 * Add one product by hand.
 *
 * The CSV import at /catalog/import is the path for a catalogue; this is
 * the path for a seller with three SKUs, who until now had to build a
 * spreadsheet to add them.
 */
export default function NewProductPage(): ReactElement {
  return (
    <div>
      <PageHeader
        title="New product"
        subtitle="One product and every variant it ships in. Reusing an existing product ID adds to that product instead. Importing a whole catalogue? Use the CSV import instead."
      />
      <NewProductForm />
    </div>
  );
}
