'use client';

import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import { useStoreIdentity } from '@skydrop/auth/client';
import { can } from '@/lib/page-access';
import { useStorePosition } from '@/lib/report-hooks';
import {
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  Money,
  PageHeader,
  ResellerStoreStatusBadge,
  Skeleton,
  Stat,
} from '@skydrop/ui/components';

interface Shortcut {
  readonly href: string;
  readonly label: string;
  readonly hint: string;
  readonly permission: string;
}

/** Where a store user usually goes next — each shown only to someone who may open it. */
const SHORTCUTS: readonly Shortcut[] = [
  {
    href: '/orders',
    label: 'Orders',
    hint: 'Where each order has got to',
    permission: 'orders.view',
  },
  {
    href: '/orders/new',
    label: 'New order',
    hint: 'Sell from your catalogue',
    permission: 'orders.create',
  },
  {
    href: '/wallet',
    label: 'Wallet',
    hint: 'Balance and every movement',
    permission: 'wallet.view',
  },
  {
    href: '/reports',
    label: 'Reports',
    hint: 'Profit and loss by month',
    permission: 'reports.view',
  },
  {
    href: '/tickets',
    label: 'Tickets',
    // Two different conversations live behind this one link, and which
    // one a person wants decides what they say — so both are named.
    hint: 'Problems raised with your seller, or with Skydrop',
    permission: 'tickets.view',
  },
];

/**
 * The landing page: which store this is, whether it is open, the one
 * seller it resells for, where the wallet stands (for people who may see
 * the reports) and the pages a store user goes to next.
 */
export default function DashboardPage(): ReactElement {
  const me = useStoreIdentity();
  if (me === null) return <></>;
  const { store, seller } = me;
  const shownAs = store.displayName ?? store.name;
  const shortcuts = SHORTCUTS.filter((s) => can(me, s.permission));

  return (
    <div className="space-y-6">
      <PageHeader title={shownAs} subtitle={`Reselling for ${seller.companyName}`} />

      {store.status === 'PAUSED' ? (
        <p
          role="status"
          className="border-border bg-surface-raised text-text-body rounded-lg border px-3 py-2 text-sm"
        >
          {seller.companyName} has paused this store. It takes no new orders until they resume it;
          anything already placed carries on.
        </p>
      ) : null}

      {can(me, 'reports.view') ? <PositionTiles /> : null}

      {shortcuts.length > 0 ? (
        <nav aria-label="Go to" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {shortcuts.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="border-border bg-surface hover:border-accent rounded-lg border p-3 transition-colors"
            >
              <span className="text-text-body block text-sm font-medium">{s.label} →</span>
              <span className="text-text-muted mt-0.5 block text-xs">{s.hint}</span>
            </Link>
          ))}
        </nav>
      ) : null}

      <Card>
        <CardHeader title="Your store" />
        <CardBody>
          <DescriptionList
            columns={2}
            items={[
              { label: 'Store', value: store.name },
              { label: 'Customers see', value: shownAs },
              {
                label: 'Status',
                value:
                  store.status === null ? '—' : <ResellerStoreStatusBadge status={store.status} />,
              },
              { label: 'Reselling for', value: seller.companyName },
              {
                label: 'Wallet managed by',
                value:
                  store.walletManagedBy === 'SKYDROP'
                    ? 'Skydrop'
                    : store.walletManagedBy === 'SELLER'
                      ? seller.companyName
                      : '—',
              },
              { label: 'Your role', value: me.roleName },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="What you can sell" />
        <CardBody>
          <p className="text-sm">
            {seller.companyName} decides which of their products you may sell, what you pay for each
            and the price range you may sell at.{' '}
            {can(me, 'catalogue.view') ? (
              <Link href="/catalogue" className="text-accent hover:text-accent-hover">
                See your catalogue →
              </Link>
            ) : null}
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

/**
 * Where the wallet stands, from the reports position. A failure here costs
 * the tiles, never the page: the full figures (and a retry) are on /reports.
 */
function PositionTiles(): ReactElement | null {
  const position = useStorePosition();
  if (position.isError) return null;
  const tile = (value: ReactNode): ReactNode =>
    position.isPending ? <Skeleton className="h-7 w-24" /> : value;
  const p = position.data;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Stat
        label="Wallet balance"
        value={tile(p === undefined ? null : <Money amount={p.balanceInr} size="lg" />)}
      />
      <Stat
        label="You are owed"
        tone="good"
        value={tile(p === undefined ? null : <Money amount={p.owedToStoreInr} size="lg" />)}
      />
      <Stat
        label="You owe your seller"
        tone={p === undefined || p.owedByStoreInr === '0.00' ? 'neutral' : 'warn'}
        value={tile(p === undefined ? null : <Money amount={p.owedByStoreInr} size="lg" />)}
      />
    </div>
  );
}
