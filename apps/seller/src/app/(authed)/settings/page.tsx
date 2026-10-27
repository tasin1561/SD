import type { ReactElement } from 'react';
import {
  Webhook,
  Bell,
  Key,
  ShieldCheck,
  PackageSearch,
  ReceiptText,
  Wallet,
  Store,
} from 'lucide-react';
import { SettingsHub, type SettingsTile } from './_components/settings-hub';
import { SetPageHeader } from './_components/settings-parts';
import { getT } from '@/i18n/server';

/**
 * Settings hub — links into each settings sub-area.
 *
 * The tiles are filtered to what the person can open (SettingsHub);
 * webhooks, notifications and API keys each need their own permission,
 * so this list is not the same for everyone.
 */
export default async function SettingsPage(): Promise<ReactElement> {
  const { t } = await getT();
  const items: SettingsTile[] = [
    {
      // First, and deliberately: it is the tile somebody comes looking
      // for in a hurry, and it is the only one every role may open.
      href: '/settings/security',
      group: 'account',
      icon: <ShieldCheck size={16} />,
      title: t('settingsHub.signInSessions'),
      description: t('settingsHub.whoThisBrowserIs'),
    },
    {
      href: '/settings/stores',
      group: 'account',
      icon: <Store size={16} />,
      title: t('settingsHub.stores'),
      description: t('settingsHub.theShopsYouSell'),
    },
    {
      href: '/settings/orders',
      group: 'defaults',
      icon: <ReceiptText size={16} />,
      title: t('settingsHub.orderDefaults'),
      description: t('settingsHub.whatANewOrder'),
    },
    {
      href: '/settings/stock',
      group: 'defaults',
      icon: <PackageSearch size={16} />,
      title: t('settingsHub.stockAlerts'),
      description: t('settingsHub.theQuantityAtWhich'),
    },
    {
      // Lives under /wallet rather than /settings, so it is gated on
      // wallet.view and the hub's own filter hides this tile from anyone
      // who could not open the page anyway.
      //
      // Listed here as well as on the wallet page because the two ways
      // in are for different moments: from the wallet when a withdrawal was
      // just refused, and from here when somebody is working through
      // what their account is set to.
      href: '/wallet/limits',
      group: 'money',
      icon: <Wallet size={16} />,
      title: t('settingsHub.walletLimitsAndSettings'),
      description: t('settingsHub.withdrawalLimitsWhenCod'),
    },
    {
      href: '/settings/webhooks',
      group: 'integrations',
      icon: <Webhook size={16} />,
      title: t('settingsHub.outboundWebhooks'),
      description: t('settingsHub.configureHttpsEndpointsTo'),
    },
    {
      // ONE tile. It was two, both called notifications, distinguishable
      // only by reading the descriptions carefully — which is how
      // somebody changes the wrong one and believes they changed the
      // other. Both grains now live on one page, in sections that each
      // say whose decision they are.
      href: '/notifications/settings',
      group: 'notifications',
      icon: <Bell size={16} />,
      title: t('settingsHub.notificationSettings'),
      description: t('settingsHub.whatReachesYourInbox'),
    },
    {
      href: '/settings/api-keys',
      group: 'integrations',
      icon: <Key size={16} />,
      title: t('settingsHub.apiKeys'),
      description: t('settingsHub.programmaticAccessToThe'),
    },
  ];
  return (
    <div className="set-page">
      <SetPageHeader
        crumbs={[
          { label: t('settingsHub.clientConsole') },
          { label: t('settingsHub.account') },
          { label: t('settingsHub.settings') },
        ]}
        title={t('settingsHub.settings')}
        subtitle={t('settingsHub.signInAndSessions')}
      />
      <SettingsHub items={items} />
    </div>
  );
}
