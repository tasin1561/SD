'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { CapacityMonitor } from '../../../(authed)/system/capacity/_components/capacity-monitor';
import { ImpersonationReview } from '../../../(authed)/impersonation/_components/impersonation-review';
import { ReportsDashboard } from '../../../(authed)/reports/_components/reports-dashboard';
import { RolesIndex } from '../../../(authed)/roles/_components/roles-index';
import { SettingsIndex } from '../../../(authed)/settings/_components/settings-index';
import { StaffManagementIndex } from '../../../(authed)/staff/_components/staff-management-index';
import { WebhookDeliveriesIndex } from '../../../(authed)/webhooks/_components/webhook-deliveries-index';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * /dev/easy/admin — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1).
 *
 * The administration screens with EMPTY lists: headers, filters and forms,
 * which is what a phone-size and touch-target check measures.
 *
 *   ?fixture=a  settings   b  capacity   c  impersonation   d  roles
 *            e  staff      f  webhooks   g  reports
 */
const FIXTURES = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const;
type F = (typeof FIXTURES)[number];

const SUMMARY = {
  range: { from: ago(60 * 24 * 30), to: ago(0) },
  orders: {
    created: 1284,
    confirmed: 1011,
    delivered: 742,
    rtoInitiated: 96,
    cancelled: 61,
    rejectedNdr: 38,
    confirmRate: 0.787,
    ndrRate: 0.051,
    rtoRate: 0.115,
    deliveryRate: 0.734,
  },
  shipments: {
    dispatched: 931,
    avgDispatchHoursFromConfirm: 19.4,
    avgDeliveryDaysFromDispatch: 3.8,
  },
  wallet: {
    codCollected: '1284500.00',
    chargesDebited: '212340.50',
    remittancesPaid: '880000.00',
    netOutstanding: '192159.50',
  },
};

const CAPACITY = {
  generatedAt: ago(1),
  worstStatus: 'WARNING',
  metrics: [
    {
      key: 'db',
      label: 'Database connections',
      current: 41,
      ceiling: 100,
      unit: 'connections',
      percent: 41,
      status: 'OK',
      ceilingSource: 'MEASURED',
      consequence: 'New requests wait for a free connection.',
      remedy: 'Raise the pool size or add a read replica.',
    },
    {
      key: 'disk',
      label: 'Storage used by uploaded labels and product pictures',
      current: 182340,
      ceiling: 250000,
      unit: 'MB',
      percent: 73,
      status: 'WARNING',
      ceilingSource: 'CONFIGURED',
      consequence: 'Uploads fail when the disk is full.',
      remedy: 'Move old labels to cold storage.',
      detail: 'Growing by about 4 GB a month.',
    },
  ],
  growth: {
    ordersLast30Days: 1284,
    ordersPrev30Days: 1011,
    monthlyGrowthPercent: 27,
    storageMonthsRemaining: 14,
  },
  topology: {
    workersEnabledHere: true,
    apiInstancesAssumed: 1,
    note: 'One droplet runs everything.',
  },
};

const respond: Respond<F> = (_fixture, req) => {
  if (req.method !== 'GET') return undefined;
  if (req.path === '/api/admin/reports/summary') return json(SUMMARY);
  if (req.path === '/api/admin/system/capacity') return json(CAPACITY);
  if (req.path === '/api/admin/staff-roles/catalogue') return json({ groups: [], permissions: [] });
  if (req.path === '/api/admin/staff/invitations') return json({ items: [], total: 0 });
  if (/staff-roles|staff\/users|permissions|settings|impersonation/.test(req.path)) return json([]);
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
    case 'b':
      return <CapacityMonitor />;
    case 'c':
      return <ImpersonationReview />;
    case 'd':
      return <RolesIndex />;
    case 'e':
      return <StaffManagementIndex />;
    case 'f':
      return <WebhookDeliveriesIndex />;
    case 'g':
      return <ReportsDashboard />;
    default:
      return <SettingsIndex />;
  }
}

export default function AdminHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => [
        'rbac.manage',
        'staff.manage',
        'support.impersonate',
        'support.impersonate.review',
        'support.impersonate.write',
        'system.settings.manage',
        'webhooks.retry',
        'reports.view',
        'sellers.view',
      ]}
    >
      <Screen />
    </EasyHarness>
  );
}
