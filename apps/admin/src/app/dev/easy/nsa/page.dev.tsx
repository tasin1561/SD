'use client';

import type { ReactElement } from 'react';
import { NsaIndex } from '../../../(authed)/nsa/_components/nsa-index';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * /dev/easy/nsa — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1).
 *
 *   ?fixture=a  four stuck parcels, nights 1 to 4   b  nothing stuck
 *            c  the list fails to load              d  saving the note is refused
 */
const FIXTURES = ['a', 'b', 'c', 'd'] as const;
type F = (typeof FIXTURES)[number];

const ROWS = [1, 2, 3, 4].map((n) => ({
  orderId: `01a1cf45-0000-73cf-8f7e-ff51baf52${String(900 + n)}`,
  orderNumber: `SD-2026-26-00011${n}`,
  sellerId: '01a1cf45-0000-73cf-8f7e-aaaaaaaaaaaa',
  sellerName:
    n === 2
      ? 'Chittagong Home & Lifestyle Exports Private Limited'
      : n === 4
        ? null
        : 'Dhaka Threads Ltd',
  status: 'OUT_FOR_DELIVERY',
  recipientName: [
    'Ananya Sharma',
    'Venkata Subramanian Raghavendra Iyer',
    'Priya Nair',
    'Mohammed Irfan',
  ][n - 1],
  recipientCity: ['Kolkata', 'Thiruvananthapuram', 'Bengaluru', 'Leh'][n - 1],
  recipientPhoneE164: `+91987654321${n}`,
  codAmountInr: n === 3 ? null : '1499.00',
  awbNumber: n === 4 ? null : `3704581000${n}`,
  courierCode: n === 4 ? null : 'DELHIVERY',
  dayCount: n,
  raisedAt: ago(60 * 24 * n),
  outForDeliveryAt: ago(60 * 24 * n + 300),
  acknowledgedAt: n === 2 ? ago(90) : null,
  note:
    n === 2
      ? 'Rang the hub. They say the rider could not find the house; trying again tomorrow.'
      : null,
}));

const respond: Respond<F> = (fixture, req) => {
  if (req.path === '/api/admin/nsa') {
    if (fixture === 'c')
      return json({ code: 'SERVICE_UNAVAILABLE', message: 'Not reachable' }, 503);
    return json(fixture === 'b' ? [] : ROWS);
  }
  if (req.method === 'POST' && req.path.endsWith('/acknowledge')) {
    if (fixture === 'd')
      return json({ code: 'NSA_NOT_FLAGGED', message: 'This parcel is no longer flagged' }, 409);
    return json(ROWS[0]);
  }
  if (req.method === 'POST' && req.path === '/api/admin/nsa/sweep') {
    return json({ examined: 12, raised: 1, escalated: 1, cleared: 2 });
  }
  return undefined;
};

export default function NsaHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => ['orders.tracking.manual_scan', 'orders.view', 'sellers.view']}
    >
      <NsaIndex />
    </EasyHarness>
  );
}
