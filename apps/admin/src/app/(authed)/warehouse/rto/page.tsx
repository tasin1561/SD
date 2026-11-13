import { InfoButton } from '@/components/easy/info-button';
import '@/components/easy/easy.css';
import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { RtoStation } from './_components/rto-station';
import '../_components/benches.css';
import { getT } from '@/i18n/server';

export default async function RtoPage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <div className="wh-page ez-touch">
      <PageHeader
        title={
          <span className="ez-titled">
            {t('warehouseRtoPage.rtoStation')}
            <InfoButton
              title={t('warehouseRtoPage.rtoStation')}
              text={t('warehouseRtoPage.receiveReturnedParcelsInspectEach')}
            />
          </span>
        }
      />
      <RtoStation />
    </div>
  );
}
