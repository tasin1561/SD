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
        title={t('warehouseConsignmentsPage.consignments')}
        subtitle={t('warehouseConsignmentsPage.theWholeJourneyInOne')}
      />
      <ConsignmentsIndex />
    </AreaPage>
  );
}
