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
  MessagesSquare,
  Package,
  PhoneOff,
  PlugZap,
  Settings,
  ShoppingBag,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react';
import { can, canSeePath } from '@/lib/page-access';
import { useStoreCallReviews } from '@/lib/review-hooks';
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

  // 2026-09-16 — how many orders are stuck waiting for this store to say
  // "keep trying" or "give the stock back". The COUNT is the point: this
  // queue holds a customer with no news and the seller's stock on a
  // shelf, and nobody at the store is told a second time.
  //
  // Asked ONLY when they hold the permission the endpoint needs — the
  // shell renders on every page, so an unconditional call would fire a
  // 403 on every page view for a store user who cannot answer these. It
  // can still refuse (the seller may keep this question for themselves),
  // which is why the badge reads off `data` and a refusal simply shows
  // no badge; the page itself explains.
  const canAnswerCalls = can(identity, 'orders.actions');
  const callReviews = useStoreCallReviews({ enabled: canAnswerCalls });
  const waitingCalls = callReviews.data?.length ?? 0;

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
        {
          href: '/orders/call-reviews',
          label: 'Unreachable customers',
          icon: <PhoneOff size={15} />,
          ...(waitingCalls > 0
            ? {
                badge: (
                  <span className="bg-accent text-text-inverse rounded-full px-1.5 py-0.5 text-[11px] leading-none font-semibold tabular-nums">
                    {waitingCalls}
                  </span>
                ),
              }
            : {}),
        },
        { href: '/customers', label: 'Customers', icon: <Contact size={15} /> },
        { href: '/catalogue', label: 'Catalogue', icon: <Package size={15} /> },
        { href: '/terms', label: 'Terms', icon: <FileSignature size={15} /> },
        { href: '/wallet', label: 'Wallet', icon: <Wallet size={15} /> },
        { href: '/reports', label: 'Reports', icon: <BarChart3 size={15} /> },
        { href: '/expenses', label: 'Expenses', icon: <ReceiptText size={15} /> },
        // Two conversations live here since 2026-09-16 — with the seller,
        // and with Skydrop — so the label can no longer be "Disputes".
        { href: '/tickets', label: 'Tickets', icon: <MessagesSquare size={15} /> },
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
