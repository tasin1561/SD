import '@/components/easy/easy.css';
import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { PackStation } from './_components/pack-station';
import { InfoButton } from '@/components/easy/info-button';
import '../_components/benches.css';
import { getT } from '@/i18n/server';

export default async function PackPage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <div className="wh-page ez-touch">
      <PageHeader
        title={
          <span className="ez-titled">
            {t('warehousePackPage.packStation')}
            <InfoButton
              title={t('warehousePackPage.packStation')}
              text={t('warehousePackPage.pullTheNextPickedShipment')}
            />
          </span>
        }
      />
      <PackStation />
    </div>
  );
}
