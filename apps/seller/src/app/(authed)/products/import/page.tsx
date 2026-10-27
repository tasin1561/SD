import type { ReactElement } from 'react';
import { History } from 'lucide-react';
import {
  AreaPage,
  LinkButton,
  StockPageHeader,
} from '@/app/(authed)/inventory/_components/stock-ui';
import { CsvImportPanel } from '../../orders/_components/csv-import-panel';
import { SavedMappings } from './_components/saved-mappings';
import { getT } from '@/i18n/server';

/**
 * Bulk import products + variants from a CSV. Same flow as the order
 * import — template, upload, process, poll.
 *
 * The panel's table below is the last ten imports, live while they run.
 * Anything older is on /products/import/jobs, which is also the only way
 * into a single import — the panel's rows do not open.
 */
export default async function CatalogImportPage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <AreaPage>
      <StockPageHeader
        breadcrumbs={[
          { label: t('productImport.clientConsole') },
          { label: t('productImport.stockWms') },
          { label: t('productImport.products'), href: '/products' },
          { label: t('productImport.csvImport') },
        ]}
        title={t('productImport.bulkCatalogueImport')}
        subtitle={t('productImport.uploadACsvOf')}
        action={
          <LinkButton href="/products/import/jobs" variant="ghost" icon={<History size={15} />}>
            {t('productImport.importHistory')}
          </LinkButton>
        }
      />
      <CsvImportPanel
        kind="catalog"
        endpointBase="/api/seller/csv-imports"
        templateFileName="skydrop-catalog-import-template.csv"
        previewSampleSize={5}
      />

      <SavedMappings />
    </AreaPage>
  );
}
