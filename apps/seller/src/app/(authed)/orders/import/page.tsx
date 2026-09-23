import type { ReactElement } from 'react';
import Link from 'next/link';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { CsvImportPanel } from '../_components/csv-import-panel';

/**
 * Bulk import orders from a CSV. The flow:
 *   1. Download the template
 *   2. Fill in your orders, save as .csv
 *   3. Upload → presign → PUT to Spaces
 *   4. Process → creates a background job
 *   5. Poll the job's status from the "Recent imports" table
 *
 * Errors (per-row) are surfaced via the error-report CSV download.
 */
export default function OrderImportPage(): ReactElement {
  return (
    <div className="ord-page">
      <PageHeader
        breadcrumbs={[
          { label: 'Seller console' },
          { label: 'Fulfilment' },
          { label: 'Orders', href: '/orders' },
          { label: 'CSV import' },
        ]}
        Link={Link}
        title="Bulk order import"
        subtitle="Upload a CSV of orders. One row is one order, and re-uploading a row you have already sent updates it rather than placing it twice."
      />
      <CsvImportPanel
        kind="orders"
        endpointBase="/api/seller/order-imports"
        templateFileName="skydrop-order-import-template.csv"
        previewSampleSize={5}
        // The table keeps the last ten runs and four of each row's
        // numbers; the per-run screen has the rest and, more to the
        // point, a URL — so a job somebody is watching can be sent to
        // whoever is asking about it, and run eleven is still reachable.
        //
        // A PREFIX, not a function: this page is a server component and
        // React refuses to pass a function into a client one, which was
        // 500ing the whole screen (see the prop's own note).
        detailHrefBase="/orders/import"
      />
    </div>
  );
}
