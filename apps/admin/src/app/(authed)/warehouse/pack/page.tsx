import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { PackStation } from './_components/pack-station';
import '../_components/benches.css';
import { getT } from '@/i18n/server';

export default async function PackPage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <div className="wh-page">
      <PageHeader
        title={t('warehousePackPage.packStation')}
        subtitle={t('warehousePackPage.pullTheNextPickedShipment')}
      />
      <PackStation />
    </div>
  );
}
