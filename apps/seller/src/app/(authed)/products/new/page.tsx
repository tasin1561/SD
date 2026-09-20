import type { ReactElement } from 'react';
import Link from 'next/link';
import { Crumbs, PageHeader } from '@skydrop/ui/components';
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
    <div>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: 'Seller console' },
              { label: 'Stock & WMS' },
              { label: 'Products', href: '/products' },
              { label: 'New' },
            ]}
            Link={Link}
          />
        }
        title="New product"
        subtitle="One product and every variant it ships in. Reusing an existing product reference adds to that product instead. Bringing in a whole catalogue? Use the CSV import."
      />
      <NewProductForm />
    </div>
  );
}
