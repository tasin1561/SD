import type { ReactElement } from 'react';
import { AreaPage, StockPageHeader } from '@/app/(authed)/inventory/_components/stock-ui';
import { NewProductForm } from './_components/new-product-form';
import { getT } from '@/i18n/server';

/**
 * Add one product by hand.
 *
 * The CSV import at /products/import is the path for a catalogue; this is
 * the path for a seller with three SKUs, who until now had to build a
 * spreadsheet to add them.
 */
export default async function NewProductPage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <AreaPage>
      <StockPageHeader
        breadcrumbs={[
          { label: t('productNew.clientConsole') },
          { label: t('productNew.stockWms') },
          { label: t('productNew.products'), href: '/products' },
          { label: t('productNew.new') },
        ]}
        title={t('productNew.newProduct')}
        subtitle={t('productNew.oneProductAndEvery')}
      />
      <NewProductForm />
    </AreaPage>
  );
}
