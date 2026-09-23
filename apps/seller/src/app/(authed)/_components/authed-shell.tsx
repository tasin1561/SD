'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode, type ReactElement } from 'react';
import { useApiClient } from '@skydrop/auth/client';
import type { SellerMe } from '@skydrop/api-client';
import { MenuButton, StripFact, Toaster } from '@skydrop/ui/components';
import { Shell, type NavGroup } from '@skydrop/ui/app/shell';
import { ThemeSwitch } from '@skydrop/ui/app/theme-switch';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { RestrictionBanner } from './restriction-banner';
import { NotificationBellContainer } from '@/components/notification-bell-container';
import { canSeePath } from '@/lib/page-access';
import { useStoreRequestCount } from '@/lib/reseller-store-hooks';
import { quickActionsFor } from '@/lib/quick-actions';
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Building2,
  LayoutDashboard,
  LifeBuoy,
  Inbox,
  Lock,
  KeyRound,
  Package,
  PackageOpen,
  PackageSearch,
  Settings,
  Store,
  Tags,
  Truck,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react';
import { OrderOmnisearch } from './order-omnisearch';

/**
 * The seller shell.
 *
 * The brand `Shell` (apps restyle, Phase 3) with the same props the legacy
 * AppShell took — nav, identity, header slots, status strip — plus the
 * three-way theme switch (System / Light / Dark). Both toast providers are
 * mounted while pages move across: a page still calling the legacy
 * `useToast` and a rebuilt one calling the new one each find theirs. What differs is the nav, the brand
 * line, and which identity fields to surface — a seller sees their
 * company and their own email; staff see their email and role.
 *
 * The nav is grouped rather than the flat 14-item list it was: past
 * about ten entries a flat column stops being scannable, and the
 * mobile drawer makes that worse because the nav becomes the whole
 * screen.
 */
export function AuthedShell({
  identity,
  children,
}: {
  identity: SellerMe;
  children: ReactNode;
}): ReactElement {
  const pathname = usePathname();
  const client = useApiClient();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout(): Promise<void> {
    setLoggingOut(true);
    try {
      await client.logout();
    } finally {
      // Hard navigation so SSR re-runs cleanly without stale React
      // state. router.replace('/login') + refresh would also work.
      window.location.assign('/login');
    }
  }

  // 2026-09-16 — how many of this seller's stores are waiting on an
  // answer. Asked ONLY when they hold the permission the endpoint needs:
  // the shell renders on every page, so an unconditional call would fire
  // a 403 on every page view for every seller who does not run stores.
  //
  // BOTH queues, counted by the server. This read the delivery-ask list's
  // length until the address-correction queue landed beside it, so a
  // store asking for a wrong address to be fixed badged nothing and the
  // parcel kept going where the store had already said it should not.
  const canSeeRequests = canSeePath(identity, '/reseller-stores/requests');
  const waiting = useStoreRequestCount({ enabled: canSeeRequests });
  const waitingCount = waiting.data?.total ?? 0;

  const navGroups: NavGroup[] = [
    {
      heading: 'Selling',
      // The ordinals are the comps' own, and they survive the permission
      // filter below on purpose: they number the SECTIONS OF THE
      // PRODUCT, not the rows this particular login can see. Renumbering
      // per person would mean two people describing the same screen by
      // different numbers, which is the one thing a fixed label is for.
      index: '01',
      items: [
        { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={15} /> },
        { href: '/orders', label: 'Orders', icon: <Package size={15} /> },
        { href: '/tracking', label: 'Tracking', icon: <Truck size={15} /> },
        {
          href: '/needs-attention',
          label: 'Needs attention',
          icon: <AlertTriangle size={15} />,
        },
        { href: '/customers', label: 'Customers', icon: <Users size={15} /> },
        { href: '/tickets', label: 'Tickets', icon: <LifeBuoy size={15} /> },
      ],
    },
    {
      heading: 'Stock',
      index: '02',
      items: [
        { href: '/products', label: 'Products', icon: <Boxes size={15} /> },
        { href: '/inventory', label: 'Inventory', icon: <Warehouse size={15} /> },
        { href: '/inbound', label: 'Add stock', icon: <PackageOpen size={15} /> },
        { href: '/holds', label: 'Held stock', icon: <Lock size={15} /> },
      ],
    },
    {
      heading: 'Money',
      index: '03',
      items: [
        { href: '/wallet', label: 'Wallet', icon: <Wallet size={15} /> },
        { href: '/freight', label: 'Inbound freight', icon: <Truck size={15} /> },
      ],
    },
    {
      // RS-1 — separate businesses reselling this seller's stock.
      heading: 'Reselling',
      index: '04',
      items: [
        { href: '/reseller-stores', label: 'Reseller stores', icon: <Store size={15} /> },
        // 2026-09-16 — what the stores are waiting on the seller to decide.
        // The COUNT is the point: an approval queue nobody looks at holds
        // a store's customer waiting, and the in-app notice only covers
        // the moment a request arrives, not the next morning.
        {
          href: '/reseller-stores/requests',
          label: 'Waiting on you',
          icon: <Inbox size={15} />,
          ...(waitingCount > 0
            ? {
                // `accent-fill` + `accent-fg`, a pair the token system
                // actually defines and whose contrast is computed (5.17).
                // It read `bg-accent text-text-inverse`, and
                // `--color-text-inverse` is declared nowhere — so the
                // count was painted in whatever it inherited, on a
                // background chosen for TEXT.
                badge: (
                  <span className="bg-accent-fill text-accent-fg rounded-full px-1.5 py-0.5 font-mono text-[11px] leading-none font-semibold tabular-nums">
                    {waitingCount}
                  </span>
                ),
              }
            : {}),
        },
        // RS-3 — the default price every reseller store pays.
        {
          href: '/reseller-stores/price-list',
          label: 'Reseller price list',
          icon: <Tags size={15} />,
        },
        // RS-8 / RS-9 — how the stores are doing, and the stock they sell.
        {
          href: '/reseller-stores/reports',
          label: 'Reseller reports',
          icon: <BarChart3 size={15} />,
        },
        {
          href: '/reseller-stores/stock-forecast',
          label: 'Stock forecast',
          icon: <PackageSearch size={15} />,
        },
      ],
    },
    {
      heading: 'Account',
      index: '05',
      items: [
        { href: '/team', label: 'Team', icon: <Users size={15} /> },
        { href: '/team/roles', label: 'Roles', icon: <KeyRound size={15} /> },
        { href: '/profile', label: 'Profile', icon: <Building2 size={15} /> },
        { href: '/settings', label: 'Settings', icon: <Settings size={15} /> },
      ],
    },
  ];

  // Cosmetic role filter (FE-2) — a link to a page the role cannot open
  // reads as a broken app. Both this and the RoleBoundary read the same
  // table, so the nav and the routes cannot disagree. The server is
  // still the boundary.
  // Filtered by PERMISSION. A link to a page that answers "not part of
  // your access" reads as broken rather than deliberate, and a group
  // whose every item is hidden goes with them — an empty "Money"
  // heading is a list of what you are not allowed to do.
  const visibleGroups: NavGroup[] = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canSeePath(identity, item.href)),
    }))
    .filter((group) => group.items.length > 0);

  const quickActions = quickActionsFor(identity);

  return (
    <Toaster>
      <ToastProvider>
        <Shell
          subtitle="Seller"
          sectionLabel="Seller portal"
          navGroups={visibleGroups}
          identityPrimary={identity.companyName}
          identitySecondary={identity.emailDisplay}
          // Reachable from EVERY page: the moment somebody needs an order
          // is rarely the moment they are on the orders list. In its OWN
          // slot so it does not squeeze the identity beside it.
          headerCenter={<OrderOmnisearch />}
          headerActions={<MenuButton label="Quick actions" items={quickActions} Link={Link} />}
          // The bell, and ONLY the bell, survives below `lg`: it is the
          // one control that says something needs you, and the inbox has
          // no other route on a phone.
          headerAlways={<NotificationBellContainer />}
          drawerActions={
            <MenuButton label="Quick actions" items={quickActions} Link={Link} placement="above" />
          }
          /*
          The bottom strip — STANDING FACTS about the ground this
          console is standing on, and nothing else.

          Every one of these is read from the identity the SSR gate
          already resolved, or from a count the nav is already asking
          for, so the strip costs no request of its own.

          The comps put a corridor status, a courier API latency and a
          customs-clearance line here. None of those exists as a fact a
          SELLER can be told: there is no corridor telemetry, the
          courier gateway's health is not exposed on any seller
          endpoint, and "SAFTA zero-duty cleared" is not something the
          system knows per account. They are LEFT OUT rather than
          filled with a plausible number — a status strip is read as
          instrumentation, and an invented reading there is worse than
          an empty strip.
        */
          statusStrip={
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <StripFact
                label="Account"
                value={identity.status === 'APPROVED' ? 'Active' : identity.status}
                tone={identity.status === 'APPROVED' ? 'good' : 'warn'}
              />
              <StripFact label="Figures in" value={identity.displayCurrency} />
              {identity.displayCurrency === 'BDT' && identity.displayFxRate !== null && (
                <StripFact
                  label="Rate"
                  value={`₹1 = ৳${Number(identity.displayFxRate).toFixed(4)}`}
                />
              )}
              {canSeeRequests && waitingCount > 0 && (
                <StripFact
                  label="Waiting on you"
                  value={`${waitingCount} store ${waitingCount === 1 ? 'request' : 'requests'}`}
                  tone="warn"
                />
              )}
            </div>
          }
          pathname={pathname}
          Link={Link}
          onSignOut={() => {
            void handleLogout();
          }}
          signingOut={loggingOut}
          themeControl={<ThemeSwitch />}
        >
          {/* A hold changes what the whole portal will do, so it is said
            on every page rather than discovered by a refusal. */}
          <RestrictionBanner />
          {/* Said ONCE, not on every figure. When the whole app is in
            taka, marking each amount as converted is noise; what a
            reader needs is to know the ground they are standing on and
            the rate it was worked out at. */}
          {identity.displayCurrency === 'BDT' && identity.displayFxRate !== null && (
            <p className="text-text-muted border-border bg-surface-raised mb-4 rounded-lg border px-3 py-2 text-xs">
              Amounts are shown in taka, converted from rupees at ₹1 = ৳
              {Number(identity.displayFxRate).toFixed(2)}. Your account is kept in rupees —
              withdrawal requests are made in rupees.
            </p>
          )}
          {children}
        </Shell>
      </ToastProvider>
    </Toaster>
  );
}
