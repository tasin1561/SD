'use client';

import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  LifeBuoy,
  PackagePlus,
  PauseCircle,
  ScrollText,
  Wallet,
} from 'lucide-react';
import { useStoreIdentity } from '@skydrop/auth/client';
import { Money } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { resellerStoreStatusKind, resellerStoreStatusLabel } from '@skydrop/ui/status';
import { can } from '@/lib/page-access';
import { useStorePosition } from '@/lib/report-hooks';
import { RdCallout, RdCard, RdDl } from '../settings/_components/rd-parts';
import { NewOrderLink, PositionTile, ShortcutCard } from './_components/dashboard-parts';

interface Shortcut {
  readonly href: string;
  readonly label: string;
  readonly hint: string;
  readonly permission: string;
  readonly icon: ReactNode;
}

/** Where a store user usually goes next — each shown only to someone who may open it. */
const SHORTCUTS: readonly Shortcut[] = [
  {
    href: '/orders',
    label: 'Orders',
    hint: 'Where each order has got to',
    permission: 'orders.view',
    icon: <ScrollText size={18} />,
  },
  {
    href: '/orders/new',
    label: 'New order',
    hint: 'Sell from your catalogue',
    permission: 'orders.create',
    icon: <PackagePlus size={18} />,
  },
  {
    href: '/wallet',
    label: 'Wallet',
    hint: 'Balance and every movement',
    permission: 'wallet.view',
    icon: <Wallet size={18} />,
  },
  {
    href: '/reports',
    label: 'Reports',
    hint: 'Profit and loss by month',
    permission: 'reports.view',
    icon: <BarChart3 size={18} />,
  },
  {
    href: '/tickets',
    label: 'Tickets',
    // Two different conversations live behind this one link, and which
    // one a person wants decides what they say — so both are named.
    hint: 'Problems raised with your seller, or with Skydrop',
    permission: 'tickets.view',
    icon: <LifeBuoy size={18} />,
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
    <div className="rd-page">
      <PageHeader
        title={shownAs}
        subtitle={`Reselling for ${seller.companyName}`}
        action={can(me, 'orders.create') ? <NewOrderLink /> : undefined}
      />

      {store.status === 'PAUSED' ? (
        <RdCallout tone="warn" icon={<PauseCircle size={15} />} role="status">
          <p>
            {seller.companyName} has paused this store. It takes no new orders until they resume it;
            anything already placed carries on.
          </p>
        </RdCallout>
      ) : null}

      {can(me, 'reports.view') ? <PositionTiles /> : null}

      {shortcuts.length > 0 ? (
        <nav aria-label="Go to" className="rd-section">
          <ul className="rd-db-shortcuts">
            {shortcuts.map((s) => (
              <ShortcutCard
                key={s.href}
                href={s.href}
                icon={s.icon}
                title={s.label}
                body={s.hint}
              />
            ))}
          </ul>
        </nav>
      ) : null}

      <RdCard title="Your store">
        <RdDl
          columns={2}
          items={[
            { label: 'Store', value: store.name },
            { label: 'Customers see', value: shownAs },
            {
              label: 'Status',
              value:
                store.status === null ? (
                  '—'
                ) : (
                  <StatusChip
                    kind={resellerStoreStatusKind(store.status)}
                    label={resellerStoreStatusLabel(store.status)}
                    size="sm"
                  />
                ),
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
      </RdCard>

      <RdCard title="What you can sell">
        <p className="rd-text">
          {seller.companyName} decides which of their products you may sell, what you pay for each
          and the price range you may sell at.{' '}
          {can(me, 'catalogue.view') ? (
            <Link href="/catalogue" className="rd-link">
              See your catalogue →
            </Link>
          ) : null}
        </p>
      </RdCard>
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
  const loading = position.isPending;
  const p = position.data;
  return (
    <section aria-label="Wallet" className="rd-section">
      <div className="rd-db-kpis">
        <PositionTile
          label="Wallet balance"
          icon={<Wallet size={16} />}
          tone="neutral"
          loading={loading}
          figure={p === undefined ? null : <Money amount={p.balanceInr} size="lg" />}
        />
        <PositionTile
          label="You are owed"
          icon={<ArrowDownLeft size={16} />}
          tone="credit"
          loading={loading}
          figure={p === undefined ? null : <Money amount={p.owedToStoreInr} size="lg" />}
        />
        <PositionTile
          label="You owe your seller"
          icon={<ArrowUpRight size={16} />}
          tone={p === undefined || p.owedByStoreInr === '0.00' ? 'neutral' : 'pending'}
          loading={loading}
          figure={p === undefined ? null : <Money amount={p.owedByStoreInr} size="lg" />}
        />
      </div>
    </section>
  );
}
