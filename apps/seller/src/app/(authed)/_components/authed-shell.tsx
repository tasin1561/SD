'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode, type ReactElement } from 'react';
import { useApiClient } from '@skydrop/auth/client';
import type { SellerMe } from '@skydrop/api-client';
import { AppShell, MenuButton, Toaster, type NavGroup } from '@skydrop/ui/components';
import { RestrictionBanner } from './restriction-banner';
import { canSeePath } from '@/lib/page-access';
import { quickActionsFor } from '@/lib/quick-actions';
import {
  Boxes,
  Building2,
  LayoutDashboard,
  LifeBuoy,
  Lock,
  KeyRound,
  Package,
  PackageOpen,
  Settings,
  Truck,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react';

/**
 * The seller shell.
 *
 * Same AppShell as apps/admin (FE-5: the chrome is identity-
 * parameterized, not duplicated). What differs is the nav, the brand
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

  const navGroups: NavGroup[] = [
    {
      heading: 'Selling',
      items: [
        { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={15} /> },
        { href: '/orders', label: 'Orders', icon: <Package size={15} /> },
        { href: '/tracking', label: 'Tracking', icon: <Truck size={15} /> },
        { href: '/customers', label: 'Customers', icon: <Users size={15} /> },
        { href: '/tickets', label: 'Tickets', icon: <LifeBuoy size={15} /> },
      ],
    },
    {
      heading: 'Stock',
      items: [
        { href: '/products', label: 'Products', icon: <Boxes size={15} /> },
        { href: '/inventory', label: 'Inventory', icon: <Warehouse size={15} /> },
        { href: '/inbound', label: 'Add stock', icon: <PackageOpen size={15} /> },
        { href: '/holds', label: 'Held stock', icon: <Lock size={15} /> },
      ],
    },
    {
      heading: 'Money',
      items: [
        { href: '/wallet', label: 'Wallet', icon: <Wallet size={15} /> },
        { href: '/freight', label: 'Inbound freight', icon: <Truck size={15} /> },
      ],
    },
    {
      heading: 'Account',
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
      <AppShell
        subtitle="Seller"
        sectionLabel="Seller portal"
        navGroups={visibleGroups}
        identityPrimary={identity.companyName}
        identitySecondary={identity.emailDisplay}
        headerActions={<MenuButton label="Quick actions" items={quickActions} Link={Link} />}
        drawerActions={
          <MenuButton label="Quick actions" items={quickActions} Link={Link} placement="above" />
        }
        pathname={pathname}
        Link={Link}
        onSignOut={() => {
          void handleLogout();
        }}
        signingOut={loggingOut}
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
            {Number(identity.displayFxRate).toFixed(2)}. Your account is kept in rupees — payout
            requests are made in rupees.
          </p>
        )}
        {children}
      </AppShell>
    </Toaster>
  );
}
