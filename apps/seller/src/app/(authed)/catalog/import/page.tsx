import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/components';
import { CsvImportPanel } from '../../orders/_components/csv-import-panel';
import { SavedMappings } from './_components/saved-mappings';

/**
 * Bulk import products + variants from a CSV. Same flow as the order
 * import — template, upload, process, poll.
 */
export default function CatalogImportPage(): ReactElement {
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Bulk catalog import"
        subtitle="Upload a CSV of products + variants. Re-uploading updates existing rows (dedup by (sellerId, externalRef) for products and (sellerId, skuCode) for variants)."
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
