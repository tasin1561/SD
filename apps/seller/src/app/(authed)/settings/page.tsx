import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/components';
import { Webhook, Bell, Key, MapPin } from 'lucide-react';
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
      href: '/settings/addresses',
      icon: <MapPin size={20} />,
      title: 'Your addresses',
      description:
        'Where your stock ships from and where you can be reached. A consignment is booked against your Bangladesh origin address.',
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
      title: 'Notification preferences',
      description:
        'Pick channels (email/SMS/in-app/webhook) per category, set quiet hours and timezone.',
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
      <PageHeader title="Settings" subtitle="Addresses, webhooks, notifications, API keys." />
      <SettingsHub items={items} />
    </div>
  );
}
