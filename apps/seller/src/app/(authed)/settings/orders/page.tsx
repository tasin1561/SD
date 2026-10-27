import type { ReactElement } from 'react';
import { SetPageHeader } from '../_components/settings-parts';
import { OrderDefaultsPanel } from './_components/order-defaults-panel';
import { getT } from '@/i18n/server';

export default async function OrderDefaultsPage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <div className="set-page">
      <SetPageHeader
        crumbs={[
          { label: t('settingsOrders.clientConsole') },
          { label: t('settingsOrders.account') },
          { label: t('settingsOrders.settings'), href: '/settings' },
          { label: t('settingsOrders.orderDefaults') },
        ]}
        title={t('settingsOrders.orderDefaults')}
        subtitle={t('settingsOrders.whatANewOrder')}
      />
      <OrderDefaultsPanel />
    </div>
  );
}
