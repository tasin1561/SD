'use client';

import type { ReactElement } from 'react';
import { DashboardView } from '../../../(authed)/dashboard/_components/dashboard-view';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * /dev/easy/dashboard — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1).
 *
 *   ?fixture=a  work waiting in every tile   b  nothing waiting   c  the counts fail to load
 */
const FIXTURES = ['a', 'b', 'c'] as const;
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

const respond: Respond<F> = (fixture, req) => {
  if (fixture === 'c') return json({ code: 'SERVICE_UNAVAILABLE', message: 'Not reachable' }, 503);
  const n = fixture === 'b' ? 0 : 7 + req.path.length + (req.query.get('status')?.length ?? 0);
  if (req.path === '/api/admin/reports/summary') return json(SUMMARY);
  if (req.method === 'GET') return json({ items: [], total: n, page: 1, pageSize: 1 });
  return undefined;
};

export default function DashboardHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => ['orders.view', 'tickets.view', 'money.view', 'reports.view']}
    >
      <DashboardView />
    </EasyHarness>
  );
}
