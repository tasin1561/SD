import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/components';
import {
  Webhook,
  Bell,
  Key,
  ShieldCheck,
  PackageSearch,
  ReceiptText,
  Wallet,
  BellRing,
} from 'lucide-react';
import { SettingsHub, type SettingsTile } from './_components/settings-hub';

/**
 * Settings hub — links into each settings sub-area.
 *
 * The tiles are filtered to what the person can open (SettingsHub);
 * webhooks, notifications and API keys each need their own permission,
 * so this list is not the same for everyone.
 */
export default function SettingsPage(): ReactElement {
  const items: SettingsTile[] = [
    {
      // First, and deliberately: it is the tile somebody comes looking
      // for in a hurry, and it is the only one every role may open.
      href: '/settings/security',
      icon: <ShieldCheck size={20} />,
      title: 'Sign-in & sessions',
      description:
        'Who this browser is signed in as, and a way to end every session for the account at once — for a device you no longer control.',
    },
    {
      href: '/settings/orders',
      icon: <ReceiptText size={20} />,
      title: 'Order defaults',
      description:
        'What a new order starts with — the delivery fee you charge your customer, pre-filled into the collectable amount.',
    },
    {
      href: '/settings/stock',
      icon: <PackageSearch size={20} />,
      title: 'Stock alerts',
      description:
        'The quantity at which we warn you a SKU is running out. A SKU with its own threshold ignores it.',
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
      icon: <Wallet size={20} />,
      title: 'Wallet limits and settings',
      description:
        'Withdrawal limits, when COD reaches you, and what is charged. Set by Skydrop and shown read-only, so a limit is never a surprise.',
    },
    {
      href: '/settings/webhooks',
      icon: <Webhook size={20} />,
      title: 'Outbound webhooks',
      description:
        'Configure HTTPS endpoints to receive event POSTs from Skydrop. Each gets a unique HMAC secret.',
    },
    {
      href: '/settings/notifications',
      icon: <Bell size={20} />,
      title: 'Company notification preferences',
      description:
        'What this COMPANY is emailed about, by category, and the quiet hours those emails respect.',
    },
    {
      // The other grain, and it needs saying which is which: the tile
      // above is what the company is emailed; this is what reaches one
      // person's own inbox. Two tiles both called "notifications" with
      // no distinction is how somebody changes the wrong one.
      href: '/notifications/settings',
      icon: <BellRing size={20} />,
      title: 'Your own notifications',
      description:
        'What reaches YOUR inbox, topic by topic. Your choices, separate from the company’s.',
    },
    {
      href: '/settings/api-keys',
      icon: <Key size={20} />,
      title: 'API keys',
      description: 'Programmatic access to the Skydrop seller API. Create, label, and revoke keys.',
    },
  ];
  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Sign-in and sessions, order and stock defaults, wallet limits, webhooks, notifications, API keys."
      />
      <SettingsHub items={items} />
    </div>
  );
}
