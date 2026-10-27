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
import type { MessageKey } from '@/i18n/catalog';
import { useT } from '@/i18n/client';
import { can } from '@/lib/page-access';
import { useStorePosition } from '@/lib/report-hooks';
import { RdCallout, RdCard, RdDl } from '../settings/_components/rd-parts';
import { NewOrderLink, PositionTile, ShortcutCard } from './_components/dashboard-parts';

interface Shortcut {
  readonly href: string;
  readonly label: MessageKey;
  readonly hint: MessageKey;
  readonly permission: string;
  readonly icon: ReactNode;
}

/** Where a store user usually goes next — each shown only to someone who may open it. */
const SHORTCUTS: readonly Shortcut[] = [
  {
    href: '/orders',
    label: 'dash.shortcut.orders',
    hint: 'dash.shortcut.ordersHint',
    permission: 'orders.view',
    icon: <ScrollText size={18} />,
  },
  {
    href: '/orders/new',
    label: 'dash.shortcut.newOrder',
    hint: 'dash.shortcut.newOrderHint',
    permission: 'orders.create',
    icon: <PackagePlus size={18} />,
  },
  {
    href: '/wallet',
    label: 'dash.shortcut.wallet',
    hint: 'dash.shortcut.walletHint',
    permission: 'wallet.view',
    icon: <Wallet size={18} />,
  },
  {
    href: '/reports',
    label: 'dash.shortcut.reports',
    hint: 'dash.shortcut.reportsHint',
    permission: 'reports.view',
    icon: <BarChart3 size={18} />,
  },
  {
    href: '/tickets',
    label: 'dash.shortcut.tickets',
    // Two different conversations live behind this one link, and which
    // one a person wants decides what they say — so both are named.
    hint: 'dash.shortcut.ticketsHint',
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
  const t = useT();
  const me = useStoreIdentity();
  if (me === null) return <></>;
  const { store, seller } = me;
  const shownAs = store.displayName ?? store.name;
  const shortcuts = SHORTCUTS.filter((s) => can(me, s.permission));

  return (
    <div className="rd-page">
      <PageHeader
        title={shownAs}
        subtitle={t('dash.reselling', { seller: seller.companyName })}
        action={can(me, 'orders.create') ? <NewOrderLink /> : undefined}
      />

      {store.status === 'PAUSED' ? (
        <RdCallout tone="warn" icon={<PauseCircle size={15} />} role="status">
          <p>{t('dash.paused', { seller: seller.companyName })}</p>
        </RdCallout>
      ) : null}

      {can(me, 'reports.view') ? <PositionTiles /> : null}

      {shortcuts.length > 0 ? (
        <nav aria-label={t('dash.goTo')} className="rd-section">
          <ul className="rd-db-shortcuts">
            {shortcuts.map((s) => (
              <ShortcutCard
                key={s.href}
                href={s.href}
                icon={s.icon}
                title={t(s.label)}
                body={t(s.hint)}
              />
            ))}
          </ul>
        </nav>
      ) : null}

      <RdCard title={t('dash.store.title')}>
        <RdDl
          columns={2}
          items={[
            { label: t('dash.store.name'), value: store.name },
            { label: t('dash.store.customersSee'), value: shownAs },
            {
              label: t('dash.store.status'),
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
            { label: t('dash.store.resellingFor'), value: seller.companyName },
            {
              label: t('dash.store.walletManagedBy'),
              value:
                store.walletManagedBy === 'SKYDROP'
                  ? 'Skydrop'
                  : store.walletManagedBy === 'SELLER'
                    ? seller.companyName
                    : '—',
            },
            // Every role held (see /account): `roleName` is the first
            // grant and would understate somebody holding two.
            {
              label: t('dash.store.roles'),
              value: me.roleNames.join(t('dash.store.rolesJoin')) || '—',
            },
          ]}
        />
      </RdCard>

      <RdCard title={t('dash.sell.title')}>
        <p className="rd-text">
          {t('dash.sell.body', { seller: seller.companyName })}{' '}
          {can(me, 'catalogue.view') ? (
            <Link href="/catalogue" className="rd-link">
              {t('dash.sell.link')}
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
  const t = useT();
  const position = useStorePosition();
  if (position.isError) return null;
  const loading = position.isPending;
  const p = position.data;
  return (
    <section aria-label={t('dash.tiles.aria')} className="rd-section">
      <div className="rd-db-kpis">
        <PositionTile
          label={t('dash.tile.balance')}
          icon={<Wallet size={16} />}
          tone="neutral"
          loading={loading}
          figure={p === undefined ? null : <Money amount={p.balanceInr} size="lg" />}
        />
        <PositionTile
          label={t('dash.tile.owed')}
          icon={<ArrowDownLeft size={16} />}
          tone="credit"
          loading={loading}
          figure={p === undefined ? null : <Money amount={p.owedToStoreInr} size="lg" />}
        />
        <PositionTile
          label={t('dash.tile.owe')}
          icon={<ArrowUpRight size={16} />}
          tone={p === undefined || p.owedByStoreInr === '0.00' ? 'neutral' : 'pending'}
          loading={loading}
          figure={p === undefined ? null : <Money amount={p.owedByStoreInr} size="lg" />}
        />
      </div>
    </section>
  );
}
