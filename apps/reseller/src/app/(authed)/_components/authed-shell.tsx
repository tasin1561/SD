'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactElement, type ReactNode } from 'react';
import { useApiClient } from '@skydrop/auth/client';
import type { StoreMe } from '@skydrop/api-client';
import { AppShell, Toaster, type NavGroup } from '@skydrop/ui/components';
import {
  BarChart3,
  Contact,
  ReceiptText,
  FileSignature,
  LayoutDashboard,
  Package,
  PlugZap,
  Settings,
  ShoppingBag,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react';
import { can, canSeePath } from '@/lib/page-access';
import { TermsBanner } from './terms-banner';

/**
 * The reseller shell — the SAME `AppShell` as the seller and admin apps
 * (FE-7); only the nav, the brand line and the two identity fields
 * differ. The store is named first, because that is whose portal this is.
 */
export function AuthedShell({
  identity,
  children,
}: {
  identity: StoreMe;
  children: ReactNode;
}): ReactElement {
  const pathname = usePathname();
  const client = useApiClient();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut(): Promise<void> {
    setSigningOut(true);
    try {
      await client.logout();
    } finally {
      window.location.assign('/login');
    }
  }

  const navGroups: NavGroup[] = [
    {
      heading: 'Store',
      items: [
        { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={15} /> },
        { href: '/orders', label: 'Orders', icon: <ShoppingBag size={15} /> },
        { href: '/customers', label: 'Customers', icon: <Contact size={15} /> },
        { href: '/catalogue', label: 'Catalogue', icon: <Package size={15} /> },
        { href: '/terms', label: 'Terms', icon: <FileSignature size={15} /> },
        { href: '/wallet', label: 'Wallet', icon: <Wallet size={15} /> },
        { href: '/reports', label: 'Reports', icon: <BarChart3 size={15} /> },
        { href: '/expenses', label: 'Expenses', icon: <ReceiptText size={15} /> },
      ],
    },
    {
      heading: 'Setup',
      items: [
        { href: '/team', label: 'Team', icon: <Users size={15} /> },
        { href: '/integrations', label: 'Integrations', icon: <PlugZap size={15} /> },
        { href: '/settings', label: 'Store settings', icon: <Settings size={15} /> },
      ],
    },
    {
      heading: 'You',
      items: [{ href: '/account', label: 'My account', icon: <UserRound size={15} /> }],
    },
  ];

  // Filtered by permission from the SAME table the route boundary reads,
  // so a link never points at a page that refuses to render.
  const visible = navGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => canSeePath(identity, i.href)) }))
    .filter((g) => g.items.length > 0);

  return (
    <Toaster>
      <AppShell
        subtitle="Reseller"
        sectionLabel="Reseller portal"
        navGroups={visible}
        identityPrimary={identity.store.displayName ?? identity.store.name}
        identitySecondary={identity.emailDisplay}
        pathname={pathname}
        Link={Link}
        onSignOut={() => {
          void signOut();
        }}
        signingOut={signingOut}
      >
        {/* RS-4: stays until the terms in force are accepted. */}
        <TermsBanner enabled={can(identity, 'terms.view')} />
        {children}
      </AppShell>
    </Toaster>
  );
}
