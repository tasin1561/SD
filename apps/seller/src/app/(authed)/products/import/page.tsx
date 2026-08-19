import type { ReactElement } from 'react';
import Link from 'next/link';
import { History } from 'lucide-react';
import { Button, PageHeader } from '@skydrop/ui/components';
import { CsvImportPanel } from '../../orders/_components/csv-import-panel';
import { SavedMappings } from './_components/saved-mappings';

/**
 * Bulk import products + variants from a CSV. Same flow as the order
 * import — template, upload, process, poll.
 *
 * The panel's table below is the last ten imports, live while they run.
 * Anything older is on /products/import/jobs, which is also the only way
 * into a single import — the panel's rows do not open.
 */
export default function CatalogImportPage(): ReactElement {
  return (
    <div>
      <PageHeader
        title="Bulk catalog import"
        subtitle="Upload a CSV of products + variants. Re-uploading updates existing rows (dedup by (sellerId, externalRef) for products and (sellerId, skuCode) for variants)."
        action={
          <Link href="/products/import/jobs">
            <Button variant="ghost" size="md">
              <History size={14} /> Import history
            </Button>
          </Link>
        }
      />
      <CsvImportPanel
        kind="catalog"
        endpointBase="/api/seller/csv-imports"
        templateFileName="skydrop-catalog-import-template.csv"
        previewSampleSize={5}
      />

      <SavedMappings />
    </div>
  );
}
