'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode, type ReactElement } from 'react';
import { useApiClient } from '@skydrop/auth/client';
import type { StaffMe } from '@skydrop/api-client';
import { NotificationBellContainer } from '@/components/notification-bell-container';
import { Toaster } from '@skydrop/ui/components';
import { Shell, type NavGroup } from '@skydrop/ui/app/shell';
import { ToastProvider } from '@skydrop/ui/app/toast';
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
  RefreshCw,
  Truck,
  Users,
  Wallet,
  Warehouse,
  Webhook,
  PhoneForwarded,
} from 'lucide-react';
import { useT } from '@/i18n/client';
import { PrefsControl } from '@/components/prefs-control';
import { canSeePath } from '@/lib/page-access';
import { PermissionBoundary } from './permission-boundary';
import { LiveSupportSessions } from './live-support-sessions';
import { OrderOmnisearch } from './order-omnisearch';

/**
 * The admin shell.
 *
 * The chrome — sidebar, off-canvas drawer, top bar, safe areas — lives
 * in `@skydrop/ui`'s Shell (apps restyle) so apps/admin, apps/seller and
 * apps/reseller cannot drift apart again. What stays here is what is genuinely admin: the
 * nav, the brand line, and which two identity fields to show.
 */
export function AuthedShell({
  identity,
  children,
}: {
  identity: StaffMe;
  children: ReactNode;
}): ReactElement {
  const t = useT();

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
      heading: t('nav.operations'),
      items: [
        { href: '/dashboard', label: t('nav.dashboard'), icon: <LayoutDashboard size={15} /> },
        {
          href: '/system-issues',
          label: t('nav.needsAPerson'),
          icon: <ShieldAlert size={15} />,
        },
        { href: '/orders', label: t('nav.orders'), icon: <Package size={15} /> },
        {
          href: '/delivery-actions',
          label: t('nav.failedDeliveries'),
          icon: <PackageX size={15} />,
        },
        {
          href: '/courier-decisions',
          label: t('nav.courierDecisions'),
          icon: <Truck size={15} />,
        },
        {
          href: '/manual-placement',
          label: t('nav.manualPlacement'),
          icon: <PackageSearch size={15} />,
        },
        { href: '/nsa', label: t('nav.needsAttention'), icon: <AlertTriangle size={15} /> },
        { href: '/call-center', label: t('nav.callCentre'), icon: <Headphones size={15} /> },
        { href: '/call-center/queue', label: t('nav.callQueue'), icon: <PhoneCall size={15} /> },
        {
          href: '/reattempt-requests',
          label: t('nav.reattemptRequests'),
          icon: <PhoneForwarded size={15} />,
        },
        { href: '/call-center/agents', label: t('nav.callAgents'), icon: <Users size={15} /> },
        { href: '/warehouse', label: t('nav.warehouse'), icon: <Warehouse size={15} /> },
        { href: '/tickets', label: t('nav.tickets'), icon: <LifeBuoy size={15} /> },
        { href: '/holds', label: t('nav.heldStock'), icon: <Lock size={15} /> },
        {
          href: '/inventory/adjustments',
          label: t('nav.stockAdjustments'),
          icon: <ListChecks size={15} />,
        },
        {
          href: '/inventory/cycle-counts',
          label: t('nav.cycleCounts'),
          icon: <ClipboardList size={15} />,
        },
        {
          href: '/inventory/movements',
          label: t('nav.stockLedger'),
          icon: <ScrollText size={15} />,
        },
        {
          href: '/inventory/transfers',
          label: t('nav.transfers'),
          icon: <ArrowLeftRight size={15} />,
        },
        { href: '/inventory-units', label: t('nav.unitDiscrepancies'), icon: <Boxes size={15} /> },
      ],
    },
    {
      heading: t('nav.money'),
      items: [
        { href: '/seller-wallets', label: t('nav.clientWallets'), icon: <Wallet size={15} /> },
        { href: '/settlements', label: t('nav.settlements'), icon: <Banknote size={15} /> },
        { href: '/withdrawals', label: t('nav.withdrawals'), icon: <Wallet size={15} /> },
        {
          href: '/wallet-transfers',
          label: t('nav.walletTransfers'),
          icon: <ArrowLeftRight size={15} />,
        },
        { href: '/topups', label: t('nav.topUps'), icon: <Wallet size={15} /> },
        {
          href: '/reseller-store-wallets',
          label: t('nav.memberStoreWallets'),
          icon: <Wallet size={15} />,
        },
        { href: '/treasury', label: t('nav.treasury'), icon: <Vault size={15} /> },
        { href: '/courier-wallet', label: t('nav.courierWallets'), icon: <Wallet size={15} /> },
        { href: '/pnl', label: t('nav.profitLoss'), icon: <TrendingUp size={15} /> },
        {
          href: '/pnl/carry-forward',
          label: t('nav.carryForward'),
          icon: <TrendingUp size={15} />,
        },
        { href: '/expenses', label: t('nav.expenses'), icon: <ReceiptText size={15} /> },
        { href: '/liabilities', label: t('nav.whatWeOwe'), icon: <Scale size={15} /> },
        { href: '/bank-accounts', label: t('nav.bankAccounts'), icon: <Landmark size={15} /> },
        { href: '/remittances', label: t('nav.remittances'), icon: <Send size={15} /> },
        { href: '/bank-changes', label: t('nav.bankChanges'), icon: <Landmark size={15} /> },
        { href: '/freight', label: t('nav.inboundFreight'), icon: <Truck size={15} /> },
        { href: '/margin', label: t('nav.laneMargin'), icon: <BarChart3 size={15} /> },
        { href: '/pricing', label: t('nav.pricingPreview'), icon: <Receipt size={15} /> },
        { href: '/fx', label: t('nav.fxRates'), icon: <Coins size={15} /> },
      ],
    },
    {
      heading: t('nav.network'),
      items: [
        { href: '/leads', label: t('nav.inviteRequests'), icon: <Inbox size={15} /> },
        { href: '/sellers', label: t('nav.clients'), icon: <Store size={15} /> },
        { href: '/stores', label: t('nav.shops'), icon: <Building2 size={15} /> },
        { href: '/reseller-stores', label: t('nav.memberStores'), icon: <Store size={15} /> },
        {
          href: '/reseller-stores/analysis',
          label: t('nav.memberStoreAnalysis'),
          icon: <BarChart3 size={15} />,
        },
        {
          href: '/courier-accounts',
          label: t('nav.courierAccounts'),
          icon: <Building2 size={15} />,
        },
        { href: '/delhivery', label: t('authedShell.delhivery'), icon: <Gauge size={15} /> },
        { href: '/shiprocket', label: t('authedShell.shiprocket'), icon: <Gauge size={15} /> },
        { href: '/cost-sync', label: t('nav.courierCostSync'), icon: <RefreshCw size={15} /> },
        { href: '/courier-escalation', label: t('nav.escalations'), icon: <Inbox size={15} /> },
      ],
    },
    {
      heading: t('nav.system'),
      items: [
        { href: '/reports', label: t('nav.reports'), icon: <BarChart3 size={15} /> },
        { href: '/webhooks', label: t('nav.webhooks'), icon: <Webhook size={15} /> },
        { href: '/staff', label: t('nav.staff'), icon: <ShieldCheck size={15} /> },
        { href: '/roles', label: t('nav.roles'), icon: <KeyRound size={15} /> },
        // The log of who has been inside whose account. Filtered on
        // `support.impersonate.review` by `canSeePath`, so a person who
        // USES impersonation but may not review it does not see a link
        // to a page whose only query would refuse them.
        {
          href: '/impersonation',
          label: t('nav.supportSessions'),
          icon: <ShieldAlert size={15} />,
        },
        { href: '/system/capacity', label: t('nav.systemLimits'), icon: <Activity size={15} /> },
        { href: '/settings', label: t('nav.settings'), icon: <Settings size={15} /> },
      ],
    },
  ];

  const navGroups: NavGroup[] = allGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => canSeePath(identity, i.href)) }))
    .filter((g) => g.items.length > 0);

  return (
    <Toaster>
      <ToastProvider>
        <Shell
          subtitle={t('shell.subtitle')}
          sectionLabel={t('shell.section')}
          navGroups={navGroups}
          identityPrimary={identity.emailDisplay}
          // Every role, not `roleName` — that is the FIRST one only, and
          // a person holding a tier plus a job function read as holding
          // just the tier. The single `role` enum this replaced was
          // worse again: null for an access tier and for anything
          // invented on /roles, so it was blank for exactly the people
          // that screen is newest for.
          identitySecondary={identity.roleNames.join(' · ')}
          // Clicking who you are signed in as is where a person looks for
          // their own account — the page has no nav entry because it is
          // not a section of the product, it is about them.
          identityHref="/account"
          // Reachable from EVERY page, because the moment somebody needs a
          // parcel is rarely the moment they are on the orders list. In its
          // OWN slot: sharing the right-hand one squeezed the identity and
          // the sign-out button until both wrapped.
          headerCenter={<OrderOmnisearch />}
          // The bell, and ONLY the bell, survives below `lg`: it is the
          // one control that says something needs you, and the inbox has
          // no other route on a phone. The support-session chip joins it
          // for the same reason and renders nothing at all when no
          // session is running, so it costs the other 99% of pages a
          // DOM node and no space.
          headerAlways={
            <>
              <LiveSupportSessions />
              <NotificationBellContainer />
            </>
          }
          pathname={pathname}
          Link={Link}
          onSignOut={() => {
            void handleLogout();
          }}
          signingOut={loggingOut}
          themeControl={<PrefsControl />}
        >
          <PermissionBoundary permissions={identity.permissions}>{children}</PermissionBoundary>
        </Shell>
      </ToastProvider>
    </Toaster>
  );
}
