import type { ReactElement } from 'react';
import { SetPageHeader } from '../_components/settings-parts';
import { AlertConfigPanel } from './_components/alert-config-panel';
import { getT } from '@/i18n/server';

/**
 * Stock alerts, in Settings.
 *
 * It used to sit at the top of /inventory, where it read as part of the
 * stock figures rather than as a preference: the page is a picture of
 * what is in the warehouse right now, and this is a standing choice about
 * when to be told something is running out. Moving it also stops the
 * one thing on that page a seller is not supposed to change every day
 * from being the first thing they see.
 *
 * The per-SKU override stays on the variant page, next to the SKU it
 * applies to.
 */
export default async function StockSettingsPage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <div className="set-page">
      <SetPageHeader
        crumbs={[
          { label: t('settingsStock.clientConsole') },
          { label: t('settingsStock.account') },
          { label: t('settingsStock.settings'), href: '/settings' },
          { label: t('settingsStock.stockAlerts') },
        ]}
        title={t('settingsStock.stockAlerts')}
        subtitle={t('settingsStock.whenWeWarnYou')}
      />
      <AlertConfigPanel />
    </div>
  );
}
