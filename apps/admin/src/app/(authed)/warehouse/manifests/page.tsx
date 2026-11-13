import { InfoButton } from '@/components/easy/info-button';
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
        title={
          <span className="ez-titled">
            {t('warehouseManifestsPage.manifests')}
            <InfoButton
              title={t('warehouseManifestsPage.manifests')}
              text={t('warehouseManifestsPage.aRecordOfWhichParcels')}
            />
          </span>
        }
      />
      <ManifestsIndex />
    </AreaPage>
  );
}
