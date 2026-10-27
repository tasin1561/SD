import type { ReactElement } from 'react';
import Link from 'next/link';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { CsvImportPanel } from '../_components/csv-import-panel';
import { getT } from '@/i18n/server';

/**
 * Bulk import orders from a CSV. The flow:
 *   1. Download the template
 *   2. Fill in your orders, save as .csv
 *   3. Upload → presign → PUT to Spaces
 *   4. Process → creates a background job
 *   5. Poll the job's status from the "Recent imports" table
 *
 * Errors (per-row) are surfaced via the error-report CSV download.
 *
 * One row is one LINE, not one order: rows sharing an External Ref are
 * lines of one order (ORD-9). Delhivery's own bulk template imports as
 * it comes — see ORD-9b.
 */
export default async function OrderImportPage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <div className="ord-page">
      <PageHeader
        breadcrumbs={[
          { label: t('orderImport.clientConsole') },
          { label: t('orderImport.fulfilment') },
          { label: t('orderImport.orders'), href: '/orders' },
          { label: t('orderImport.csvImport') },
        ]}
        Link={Link}
        title={t('orderImport.bulkOrderImport')}
        subtitle={t('orderImport.uploadACsvOf')}
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
