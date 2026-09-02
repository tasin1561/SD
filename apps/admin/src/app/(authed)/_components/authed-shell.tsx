'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode, type ReactElement } from 'react';
import { useApiClient } from '@skydrop/auth/client';
import type { StaffMe } from '@skydrop/api-client';
import { AppShell, Toaster, type NavGroup } from '@skydrop/ui/components';
import {
  AlertTriangle,
  ShieldAlert,
  ReceiptText,
  Scale,
  TrendingUp,
  Inbox,
  Activity,
  ArrowLeftRight,
  Banknote,
  BarChart3,
  Boxes,
  Building2,
  ClipboardList,
  Coins,
  Gauge,
  Headphones,
  Landmark,
  Vault,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  Lock,
  Package,
  PackageSearch,
  PackageX,
  PhoneCall,
  Receipt,
  ScrollText,
  Send,
  Settings,
  KeyRound,
  ShieldCheck,
  Store,
  Truck,
  Users,
  Wallet,
  Warehouse,
  Webhook,
  PhoneForwarded,
} from 'lucide-react';
import { canSeePath } from '@/lib/page-access';
import { PermissionBoundary } from './permission-boundary';

/**
 * The admin shell.
 *
 * The chrome — sidebar, off-canvas drawer, top bar, safe areas — lives
 * in `@skydrop/ui`'s AppShell so apps/admin and apps/seller cannot
 * drift apart again. What stays here is what is genuinely admin: the
 * nav, the brand line, and which two identity fields to show.
 */
export function AuthedShell({
  identity,
  children,
}: {
  identity: StaffMe;
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

  // Grouped rather than flat: the list crossed ~12 items when the R-phase
  // and Delhivery surfaces landed, and a flat list that long stops being
  // scannable — you read it linearly instead of jumping to the section
  // you want. The groups match how the work actually splits: running the
  // floor, moving money, configuring the network, administering the
  // system.
  //
  // Icons earn their place in the mobile drawer, where the nav is the
  // whole screen and a column of same-length labels is slow to scan.
  //
  // FILTERED BY PERMISSION. A link to a page that answers "not part of
  // your access" is worse than no link: it reads as something broken
  // rather than something deliberate. A group whose every item is hidden
  // disappears with them — an empty "Money" heading is a list of what
  // you are not allowed to do.
  const allGroups: NavGroup[] = [
    {
      heading: 'Operations',
      items: [
        { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={15} /> },
        {
          href: '/system-issues',
          label: 'Needs a person',
          icon: <ShieldAlert size={15} />,
        },
        { href: '/orders', label: 'Orders', icon: <Package size={15} /> },
        { href: '/delivery-actions', label: 'Failed deliveries', icon: <PackageX size={15} /> },
        {
          href: '/manual-placement',
          label: 'Manual placement',
          icon: <PackageSearch size={15} />,
        },
        { href: '/nsa', label: 'Needs attention', icon: <AlertTriangle size={15} /> },
        { href: '/call-center', label: 'Call centre', icon: <Headphones size={15} /> },
        { href: '/call-center/queue', label: 'Call queue', icon: <PhoneCall size={15} /> },
        {
          href: '/reattempt-requests',
          label: 'Re-attempt requests',
          icon: <PhoneForwarded size={15} />,
        },
        { href: '/call-center/agents', label: 'Call agents', icon: <Users size={15} /> },
        { href: '/warehouse', label: 'Warehouse', icon: <Warehouse size={15} /> },
        { href: '/tickets', label: 'Tickets', icon: <LifeBuoy size={15} /> },
        { href: '/holds', label: 'Held stock', icon: <Lock size={15} /> },
        {
          href: '/inventory/adjustments',
          label: 'Stock adjustments',
          icon: <ListChecks size={15} />,
        },
        {
          href: '/inventory/cycle-counts',
          label: 'Cycle counts',
          icon: <ClipboardList size={15} />,
        },
        { href: '/inventory/movements', label: 'Stock ledger', icon: <ScrollText size={15} /> },
        { href: '/inventory/transfers', label: 'Transfers', icon: <ArrowLeftRight size={15} /> },
        { href: '/inventory-units', label: 'Unit discrepancies', icon: <Boxes size={15} /> },
      ],
    },
    {
      heading: 'Money',
      items: [
        { href: '/seller-wallets', label: 'Seller wallets', icon: <Wallet size={15} /> },
        { href: '/settlements', label: 'Settlements', icon: <Banknote size={15} /> },
        { href: '/withdrawals', label: 'Withdrawals', icon: <Wallet size={15} /> },
        { href: '/topups', label: 'Top-ups', icon: <Wallet size={15} /> },
        { href: '/treasury', label: 'Treasury', icon: <Vault size={15} /> },
        { href: '/pnl', label: 'Profit & loss', icon: <TrendingUp size={15} /> },
        { href: '/expenses', label: 'Expenses', icon: <ReceiptText size={15} /> },
        { href: '/liabilities', label: 'What we owe', icon: <Scale size={15} /> },
        { href: '/bank-accounts', label: 'Bank accounts', icon: <Landmark size={15} /> },
        { href: '/remittances', label: 'Remittances', icon: <Send size={15} /> },
        { href: '/bank-changes', label: 'Bank changes', icon: <Landmark size={15} /> },
        { href: '/freight', label: 'Inbound freight', icon: <Truck size={15} /> },
        { href: '/margin', label: 'Lane margin', icon: <BarChart3 size={15} /> },
        { href: '/pricing', label: 'Pricing preview', icon: <Receipt size={15} /> },
        { href: '/fx', label: 'FX rates', icon: <Coins size={15} /> },
      ],
    },
    {
      heading: 'Network',
      items: [
        { href: '/leads', label: 'Invite requests', icon: <Inbox size={15} /> },
        { href: '/sellers', label: 'Sellers', icon: <Store size={15} /> },
        { href: '/courier-accounts', label: 'Courier accounts', icon: <Building2 size={15} /> },
        { href: '/delhivery', label: 'Delhivery', icon: <Gauge size={15} /> },
        { href: '/courier-escalation', label: 'Escalations', icon: <Inbox size={15} /> },
      ],
    },
    {
      heading: 'System',
      items: [
        { href: '/reports', label: 'Reports', icon: <BarChart3 size={15} /> },
        { href: '/webhooks', label: 'Webhooks', icon: <Webhook size={15} /> },
        { href: '/staff', label: 'Staff', icon: <ShieldCheck size={15} /> },
        { href: '/roles', label: 'Roles', icon: <KeyRound size={15} /> },
        { href: '/system/capacity', label: 'System limits', icon: <Activity size={15} /> },
        { href: '/settings', label: 'Settings', icon: <Settings size={15} /> },
      ],
    },
  ];

  const navGroups: NavGroup[] = allGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => canSeePath(identity, i.href)) }))
    .filter((g) => g.items.length > 0);

  return (
    <Toaster>
      <AppShell
        subtitle="Admin"
        sectionLabel="Staff console"
        navGroups={navGroups}
        identityPrimary={identity.emailDisplay}
        identitySecondary={identity.roleName}
        // Clicking who you are signed in as is where a person looks for
        // their own account — the page has no nav entry because it is
        // not a section of the product, it is about them.
        identityHref="/account"
        footerNote="Phase 1A"
        pathname={pathname}
        Link={Link}
        onSignOut={() => {
          void handleLogout();
        }}
        signingOut={loggingOut}
      >
        <PermissionBoundary permissions={identity.permissions}>{children}</PermissionBoundary>
      </AppShell>
    </Toaster>
  );
}
