'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactElement, type ReactNode } from 'react';
import { useApiClient } from '@skydrop/auth/client';
import type { StoreMe } from '@skydrop/api-client';
import { Toaster } from '@skydrop/ui/components';
import { Shell, type NavGroup } from '@skydrop/ui/app/shell';
import { ToastProvider } from '@skydrop/ui/app/toast';
import {
  Bell,
  Contact,
  MessagesSquare,
  Package,
  PlusCircle,
  ShoppingBag,
  Upload,
  UserRound,
} from 'lucide-react';
import { useT } from '@/i18n/client';
import { canSeePath } from '@/lib/page-access';
import { PrefsControl } from '@/components/prefs-control';
import { NotificationBellContainer } from '@/components/notification-bell-container';

/**
 * The associate shell — the shared brand `Shell` (FE-7); only the nav,
 * the brand line and the two identity fields differ. The STORE is named
 * first, because that is whose name goes on the parcel; the person's own
 * email sits under it.
 *
 * ── THE NAV IS FIVE THINGS AND THAT IS THE DESIGN ───────────────────
 * An associate places orders, checks what they may sell and for how
 * much, follows the ones they placed (asking for another delivery
 * attempt where the store allows it), looks after the people they sold
 * to, and raises an issue. Everything else a store
 * can do — the wallet, the terms, the reports, the team, the catalogue's
 * prices — is either the store's money or the store's margin, and a
 * person holding the `associate` role does not hold the permission for
 * any of it. A link that would 403 is not here at all: one that bounces
 * teaches somebody to stop reading the nav.
 *
 * `PrefsControl` (language + theme) is mounted here AND in the signed-out
 * `AuthFrame` — the second mount is the one that goes missing silently (FE-7).
 */
export function AuthedShell({
  identity,
  children,
}: {
  identity: StoreMe;
  children: ReactNode;
}): ReactElement {
  const t = useT();
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
      heading: t('nav.selling'),
      items: [
        { href: '/orders/new', label: t('nav.newOrder'), icon: <PlusCircle size={15} /> },
        { href: '/catalogue', label: t('nav.whatISell'), icon: <Package size={15} /> },
        { href: '/orders/import', label: t('nav.uploadCsv'), icon: <Upload size={15} /> },
      ],
    },
    {
      heading: t('nav.following'),
      items: [
        { href: '/orders', label: t('nav.myOrders'), icon: <ShoppingBag size={15} /> },
        { href: '/customers', label: t('nav.myCustomers'), icon: <Contact size={15} /> },
        { href: '/tickets', label: t('nav.issues'), icon: <MessagesSquare size={15} /> },
      ],
    },
    {
      heading: t('nav.you'),
      items: [
        // Ungated on purpose (NOTIF-11): a person's own inbox is
        // self-service, so it is absent from PAGE_PERMISSIONS and
        // `canSeePath` lets everybody through.
        { href: '/notifications', label: t('nav.notifications'), icon: <Bell size={15} /> },
        { href: '/account', label: t('nav.myAccount'), icon: <UserRound size={15} /> },
      ],
    },
  ];

  // Filtered by permission from the SAME table the route boundary reads,
  // so a link never points at a page that refuses to render.
  const visible = navGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => canSeePath(identity, i.href)) }))
    .filter((g) => g.items.length > 0);

  return (
    <Toaster>
      <ToastProvider>
        <Shell
          subtitle={t('shell.subtitle')}
          sectionLabel={t('shell.section')}
          navGroups={visible}
          identityPrimary={identity.store.displayName ?? identity.store.name}
          identitySecondary={identity.emailDisplay}
          pathname={pathname}
          Link={Link}
          // The bell, at every width (FE-7's `headerAlways`): the one
          // thing that says "something needs you" must not be the one
          // thing a phone cannot see. It carries the daily digest of
          // what was delivered, came back, or could not be delivered —
          // which is in-app ONLY (NOTIF-23), so this is the only place
          // it can be read.
          headerAlways={<NotificationBellContainer />}
          onSignOut={() => {
            void signOut();
          }}
          signingOut={signingOut}
          themeControl={<PrefsControl />}
        >
          {children}
        </Shell>
      </ToastProvider>
    </Toaster>
  );
}
