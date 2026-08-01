'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode, type ReactElement } from 'react';
import { useApiClient } from '@skydrop/auth/client';
import type { SellerMe } from '@skydrop/api-client';
import { AppShell, Toaster, type NavGroup } from '@skydrop/ui/components';
import { canAccess, seesEverything } from '@/lib/role-access';
import {
  Boxes,
  Building2,
  LayoutDashboard,
  LifeBuoy,
  Lock,
  MapPin,
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
        { href: '/catalog', label: 'Catalog', icon: <Boxes size={15} /> },
        { href: '/inventory', label: 'Inventory', icon: <Warehouse size={15} /> },
        { href: '/inbound', label: 'Inbound stock', icon: <PackageOpen size={15} /> },
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
        { href: '/profile', label: 'Profile', icon: <Building2 size={15} /> },
        { href: '/settings/addresses', label: 'Addresses', icon: <MapPin size={15} /> },
        { href: '/settings', label: 'Settings', icon: <Settings size={15} /> },
      ],
    },
  ];

  // Cosmetic role filter (FE-2) — a link to a page the role cannot open
  // reads as a broken app. Both this and the RoleBoundary read the same
  // table, so the nav and the routes cannot disagree. The server is
  // still the boundary.
  const visibleGroups: NavGroup[] = seesEverything(identity.role)
    ? navGroups
    : navGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => canAccess(identity.role, item.href)),
        }))
        .filter((group) => group.items.length > 0);

  return (
    <Toaster>
      <AppShell
        subtitle="Seller"
        sectionLabel="Seller portal"
        navGroups={visibleGroups}
        identityPrimary={identity.companyName}
        identitySecondary={identity.emailDisplay}
        pathname={pathname}
        Link={Link}
        onSignOut={() => {
          void handleLogout();
        }}
        signingOut={loggingOut}
      >
        {children}
      </AppShell>
    </Toaster>
  );
}
