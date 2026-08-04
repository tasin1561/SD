import type { ReactElement } from 'react';
import Link from 'next/link';
import { Card, CardBody, PageHeader } from '@skydrop/ui/components';
import { Webhook, Bell, Key, MapPin } from 'lucide-react';

/**
 * Settings hub — links into each settings sub-area.
 */
export default function SettingsPage(): ReactElement {
  const items = [
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map((it) => (
          <Link key={it.href} href={it.href} className="block">
            <Card className="hover:border-border-strong transition-colors">
              <CardBody>
                <div className="flex items-start gap-3">
                  <div className="text-accent">{it.icon}</div>
                  <div>
                    <div className="text-text-bright font-medium text-sm">{it.title}</div>
                    <div className="text-text-muted text-xs mt-0.5">{it.description}</div>
                  </div>
                </div>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
