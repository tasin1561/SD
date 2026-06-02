import type { ReactElement } from 'react';
import Link from 'next/link';
import { Card, CardBody, PageHeader } from '@skydrop/ui/components';
import { Webhook, Bell, Key } from 'lucide-react';

/**
 * Settings hub — links into each settings sub-area.
 * - Webhooks (outbound) — Phase 1A scope, full CRUD + secret rotation.
 * - Notification preferences — fast-follow (backend exists).
 * - API keys — fast-follow (backend exists).
 */
export default function SettingsPage(): ReactElement {
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Settings"
        subtitle="Webhooks, notifications, API keys, preferences."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Link href="/settings/webhooks" className="block">
          <Card className="hover:border-border-strong transition-colors">
            <CardBody>
              <div className="flex items-start gap-3">
                <div className="text-accent">
                  <Webhook size={20} />
                </div>
                <div>
                  <div className="text-text-bright font-medium text-sm">
                    Outbound webhooks
                  </div>
                  <div className="text-text-muted text-xs mt-0.5">
                    Configure HTTPS endpoints to receive event POSTs from
                    Skydrop. Each gets a unique HMAC secret.
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>
        </Link>
        <Card className="opacity-60">
          <CardBody>
            <div className="flex items-start gap-3">
              <div className="text-text-muted">
                <Bell size={20} />
              </div>
              <div>
                <div className="text-text-bright font-medium text-sm">
                  Notification preferences{' '}
                  <span className="text-text-faint text-[10px] uppercase ml-1">
                    fast-follow
                  </span>
                </div>
                <div className="text-text-muted text-xs mt-0.5">
                  Channels, categories, quiet hours. Backend ready; UI
                  scheduled post-CP2.
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card className="opacity-60">
          <CardBody>
            <div className="flex items-start gap-3">
              <div className="text-text-muted">
                <Key size={20} />
              </div>
              <div>
                <div className="text-text-bright font-medium text-sm">
                  API keys{' '}
                  <span className="text-text-faint text-[10px] uppercase ml-1">
                    fast-follow
                  </span>
                </div>
                <div className="text-text-muted text-xs mt-0.5">
                  Programmatic access to the Skydrop seller API. Backend
                  ready; UI scheduled post-CP2.
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
