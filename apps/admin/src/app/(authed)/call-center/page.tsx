import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { CallCenterStation } from './_components/call-center-station';
import '../orders/_components/order-ops.css';
import { getT } from '@/i18n/server';
import { InfoButton } from '@/components/easy/info-button';
import '@/components/easy/easy.css';

/**
 * Single-page call-center agent workspace. CALL_AGENT role pulls
 * the next FIFO call, sees the recipient + items, picks an outcome,
 * and records it. The order auto-transitions per the CC-2 mapping.
 */
export default async function CallCenterPage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <div className="oo-page ez-touch">
      <PageHeader
        title={
          <span className="ez-titled">
            {t('callCenterPage.callCentre')}
            <InfoButton
              title={t('callCenterPage.callCentre')}
              text={t('callCenterPage.pullACallTalkTo')}
            />
          </span>
        }
      />
      <CallCenterStation />
    </div>
  );
}
