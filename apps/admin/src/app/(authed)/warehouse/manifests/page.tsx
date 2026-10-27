import type { ReactElement } from 'react';
import { AreaPage, StockPageHeader } from '../../inventory/_components/stock-kit';
import { ManifestsIndex } from './_components/manifests-index';
import { getT } from '@/i18n/server';

export default async function ManifestsPage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <AreaPage>
      <StockPageHeader
        breadcrumbs={[
          { label: t('warehouseManifestsPage.warehouse'), href: '/warehouse' },
          { label: t('warehouseManifestsPage.manifests') },
        ]}
        title={t('warehouseManifestsPage.manifests')}
        subtitle={t('warehouseManifestsPage.aRecordOfWhichParcels')}
      />
      <ManifestsIndex />
    </AreaPage>
  );
}
