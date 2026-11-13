import { InfoButton } from '@/components/easy/info-button';
import '@/components/easy/easy.css';
import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { ReceiveIndex } from './_components/receive-index';
import '../_components/benches.css';
import { getT } from '@/i18n/server';

export default async function ReceivePage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <div className="wh-page ez-touch">
      <PageHeader
        title={
          <span className="ez-titled">
            {t('warehouseReceivePage.receiveStation')}
            <InfoButton
              title={t('warehouseReceivePage.receiveStation')}
              text={t('warehouseReceivePage.whereCountingHappensStartReceiving')}
            />
          </span>
        }
      />
      <ReceiveIndex />
    </div>
  );
}
