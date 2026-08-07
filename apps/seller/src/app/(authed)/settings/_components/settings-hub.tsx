'use client';

import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import { useSellerIdentity } from '@skydrop/auth/client';
import { Card, CardBody, EmptyState } from '@skydrop/ui/components';
import { canSeePath } from '@/lib/page-access';

/**
 * The settings tiles, filtered to what this person can actually open.
 *
 * A client component only because the filter needs the identity from
 * AuthProvider; the page around it stays a server component. Each tile
 * is checked with the SAME `canSeePath` the route boundary uses, so a
 * tile can never lead to a page that refuses — the two cannot disagree
 * because they read one table.
 */
export type SettingsTile = {
  readonly href: string;
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
};

export function SettingsHub({ items }: { readonly items: readonly SettingsTile[] }): ReactElement {
  const identity = useSellerIdentity();
  const visible = items.filter((item) => canSeePath(identity, item.href));

  if (visible.length === 0) {
    return (
      <EmptyState
        title="Nothing to configure"
        description="None of these settings are part of your access. An owner or admin on your team can change that."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {visible.map((it) => (
        <Link key={it.href} href={it.href} className="block">
          <Card className="hover:border-border-strong transition-colors">
            <CardBody>
              <div className="flex items-start gap-3">
                <div className="text-accent">{it.icon}</div>
                <div>
                  <div className="text-text-bright text-sm font-medium">{it.title}</div>
                  <div className="text-text-muted mt-0.5 text-xs">{it.description}</div>
                </div>
              </div>
            </CardBody>
          </Card>
        </Link>
      ))}
    </div>
  );
}
