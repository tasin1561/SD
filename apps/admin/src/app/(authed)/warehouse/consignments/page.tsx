import { InfoButton } from '@/components/easy/info-button';
import type { ReactElement } from 'react';
import { AreaPage, StockPageHeader } from '../../inventory/_components/stock-kit';
import { ConsignmentsIndex } from './_components/consignments-index';
import { getT } from '@/i18n/server';

export default async function ConsignmentsPage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <AreaPage>
      <StockPageHeader
        breadcrumbs={[
          { label: t('warehouseConsignmentsPage.warehouse'), href: '/warehouse' },
          { label: t('warehouseConsignmentsPage.consignments') },
        ]}
        title={
          <span className="ez-titled">
            {t('warehouseConsignmentsPage.consignments')}
            <InfoButton
              title={t('warehouseConsignmentsPage.consignments')}
              text={t('warehouseConsignmentsPage.theWholeJourneyInOne')}
            />
          </span>
        }
      />
      <ConsignmentsIndex />
    </AreaPage>
  );
}
