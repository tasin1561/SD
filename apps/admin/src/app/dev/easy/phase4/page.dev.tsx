'use client';

import { Suspense, useEffect, useState, type ReactElement } from 'react';
import { LeadsIndex } from '../../../(authed)/leads/_components/leads-index';
import { SellersIndex } from '../../../(authed)/sellers/_components/sellers-index';
import { SellerDetailView } from '../../../(authed)/sellers/_components/seller-detail';
import { SellerStoresIndex } from '../../../(authed)/stores/_components/seller-stores-index';
import { CourierAccountsIndex } from '../../../(authed)/courier-accounts/_components/courier-accounts-index';
import { DelhiveryOpsIndex } from '../../../(authed)/delhivery/_components/delhivery-ops-index';
import { ShiprocketOpsIndex } from '../../../(authed)/shiprocket/_components/shiprocket-ops-index';
import { CostSyncIndex } from '../../../(authed)/cost-sync/_components/cost-sync-index';
import { CourierEscalationIndex } from '../../../(authed)/courier-escalation/_components/courier-escalation-index';
import { CourierPortalIndex } from '../../../(authed)/courier-escalation/portal/_components/portal-index';
import { CourierTemplatesIndex } from '../../../(authed)/courier-escalation/templates/_components/templates-index';
import { CourierThreadsIndex } from '../../../(authed)/courier-escalation/threads/_components/threads-index';
import { AccountSecurityView } from '../../../(authed)/account/_components/account-security-view';
import { NotificationsView } from '../../../(authed)/notifications/_components/notifications-view';
import { BroadcastsView } from '../../../(authed)/notifications/broadcasts/_components/broadcasts-view';
import { NotificationSettingsView } from '../../../(authed)/notifications/settings/_components/notification-settings-view';
import { PickupsIndex } from '../../../(authed)/warehouse/pickups/_components/pickups-index';
import { EasyHarness, json, type Respond } from '../harness';

/**
 * /dev/easy/phase4 — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1). Mock data
 * only, EMPTY lists: headers, filters and forms, for a phone-size check.
 * Every write is refused, so nothing here reaches a courier or a client.
 *
 *   ?mode=p  lists answer as a page object (default)   a  as a bare array
 *         n  nothing is mocked: each screen shows its "could not load" state
 *
 *   a  LeadsIndex
 *   b  SellersIndex
 *   c  SellerDetailView
 *   d  SellerStoresIndex
 *   e  CourierAccountsIndex
 *   f  DelhiveryOpsIndex
 *   g  ShiprocketOpsIndex
 *   h  CostSyncIndex
 *   i  CourierEscalationIndex
 *   j  CourierPortalIndex
 *   k  CourierTemplatesIndex
 *   l  CourierThreadsIndex
 *   m  AccountSecurityView
 *   n  NotificationsView
 *   o  BroadcastsView
 *   p  NotificationSettingsView
 *   q  PickupsIndex
 */
const FIXTURES = [
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'q',
] as const;
type F = (typeof FIXTURES)[number];

const PERMISSIONS = [
  'callcenter.queue.manage',
  'courier.accounts.manage',
  'courier.accounts.view',
  'courier.ops.view',
  'courier.ops.write',
  'leads.manage',
  'money.treasury.manage',
  'money.treasury.view',
  'money.view',
  'money.wallet.transfer',
  'notifications.broadcast',
  'orders.tracking.run_poll',
  'reseller.credit_after_confirmation.enable',
  'reseller.stores.manage',
  'reseller.stores.pause',
  'sellers.approve',
  'sellers.bank_account.reveal',
  'sellers.courier_links.manage',
  'sellers.invite',
  'sellers.settings.manage',
  'sellers.suspend',
  'support.impersonate',
];

const respond: Respond<F> = (_fixture, req) => {
  if (req.method !== 'GET')
    return json({ code: 'DEV_PAGE', message: 'This is a test page. Nothing was changed.' }, 409);
  const mode = new URLSearchParams(window.location.search).get('mode') ?? 'p';
  if (mode === 'n') return undefined;
  if (mode === 'a') return json([]);
  return json({ items: [], total: 0, page: 1, pageSize: 20 });
};

function Screen(): ReactElement | null {
  const [fixture, setFixture] = useState<string | null>(null);
  useEffect(() => {
    setFixture(new URLSearchParams(window.location.search).get('fixture') ?? 'a');
  }, []);
  switch (fixture) {
    case null:
      return null;
    case 'a':
      return <LeadsIndex />;
    case 'b':
      return <SellersIndex />;
    case 'c':
      return <SellerDetailView sellerId="s1" />;
    case 'd':
      return <SellerStoresIndex />;
    case 'e':
      return <CourierAccountsIndex />;
    case 'f':
      return <DelhiveryOpsIndex />;
    case 'g':
      return <ShiprocketOpsIndex />;
    case 'h':
      return <CostSyncIndex />;
    case 'i':
      return <CourierEscalationIndex />;
    case 'j':
      return <CourierPortalIndex />;
    case 'k':
      return <CourierTemplatesIndex />;
    case 'l':
      return <CourierThreadsIndex />;
    case 'm':
      return <AccountSecurityView />;
    case 'n':
      return <NotificationsView />;
    case 'o':
      return <BroadcastsView />;
    case 'p':
      return <NotificationSettingsView />;
    case 'q':
      return <PickupsIndex />;
    default:
      return null;
  }
}

export default function Phase4Harness(): ReactElement {
  return (
    <EasyHarness fixtures={FIXTURES} respond={respond} permissions={() => PERMISSIONS}>
      <Suspense fallback={null}>
        <Screen />
      </Suspense>
    </EasyHarness>
  );
}
