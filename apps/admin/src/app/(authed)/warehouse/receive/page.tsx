import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { ReceiveIndex } from './_components/receive-index';
import '../_components/benches.css';
import { getT } from '@/i18n/server';

export default async function ReceivePage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <div className="wh-page">
      <PageHeader
        title={t('warehouseReceivePage.receiveStation')}
        subtitle={t('warehouseReceivePage.whereCountingHappensStartReceiving')}
      />
      <ReceiveIndex />
    </div>
  );
}
