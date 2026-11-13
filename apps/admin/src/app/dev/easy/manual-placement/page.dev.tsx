'use client';

import type { ReactElement } from 'react';
import { ManualPlacementIndex } from '../../../(authed)/manual-placement/_components/manual-placement-index';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * /dev/easy/manual-placement — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1).
 *
 *   ?fixture=a  five parcels, every reason   b  nothing waiting
 *            c  the worklist fails to load   d  the waybill is refused
 */
const FIXTURES = ['a', 'b', 'c', 'd'] as const;
type F = (typeof FIXTURES)[number];

const CODES = ['NON_SERVICEABLE', 'AWB_REJECTED', 'COURIER_FAILURE', 'MANUAL_REPLACEMENT', null];

const ROWS = CODES.map((reasonCode, i) => ({
  orderId: `01a1cf45-0000-73cf-8f7e-ff51baf52${String(800 + i)}`,
  orderNumber: `SD-2026-26-00010${i}`,
  sellerId: 's1',
  sellerCompanyName:
    i === 1
      ? 'Chittagong Home & Lifestyle Exports Private Limited'
      : i === 4
        ? null
        : 'Dhaka Threads Ltd',
  shipmentId: `sh${i}`,
  shipmentNumber: `SHP-2026-0002${i}`,
  destCity: ['Kolkata', 'Thiruvananthapuram', '', 'New Delhi', 'Leh'][i],
  destPostalCode: ['700001', '695001', '110001', '110002', '194101'][i],
  codAmountInr: i === 2 ? null : '1499.00',
  waitingHours: [0, 5, 13, 30, 2][i],
  arrivedAt: ago(60 * ([0, 5, 13, 30, 2][i] ?? 0)),
  reason:
    i === 1
      ? '[ER0005] suspicious order/consignee — the consignee phone number has been flagged on earlier consignments'
      : i === 0
        ? 'Pincode 700001 is not serviceable for COD'
        : null,
  reasonCode,
  needsPicking: i % 2 === 0,
}));

const respond: Respond<F> = (fixture, req) => {
  if (req.path === '/api/admin/courier/manual-placement/queue') {
    if (fixture === 'c')
      return json({ code: 'SERVICE_UNAVAILABLE', message: 'Not reachable' }, 503);
    return json(fixture === 'b' ? [] : ROWS);
  }
  if (req.method === 'POST' && req.path.endsWith('/place-awb')) {
    if (fixture === 'd')
      return json(
        { code: 'AWB_ALREADY_USED', message: 'This waybill is already on a parcel' },
        409,
      );
    return json({ shipmentId: 'sh0', awbNumber: 'BD123456789' });
  }
  return undefined;
};

export default function ManualPlacementHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => ['courier.manual_placement', 'courier.dispatch', 'orders.view']}
    >
      <ManualPlacementIndex />
    </EasyHarness>
  );
}
