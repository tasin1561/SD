'use client';

import type { ReactElement } from 'react';
import { CourierDecisionIndex } from '../../../(authed)/courier-decisions/_components/courier-decision-index';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * /dev/easy/courier-decisions — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1).
 *
 *   ?fixture=a  three parcels, one with no carriers   b  nothing waiting
 *            c  the queue fails to load               d  the choice is refused
 */
const FIXTURES = ['a', 'b', 'c', 'd'] as const;
type F = (typeof FIXTURES)[number];

const OPTIONS = [
  {
    courierCompanyId: 1,
    courierName: 'Delhivery Surface',
    rateInr: 78.5,
    estimatedDays: 4,
    etd: null,
  },
  {
    courierCompanyId: 2,
    courierName: 'Blue Dart Air Express Priority',
    rateInr: 142,
    estimatedDays: 1,
    etd: null,
  },
  {
    courierCompanyId: 3,
    courierName: 'Ekart Logistics',
    rateInr: 81,
    estimatedDays: null,
    etd: null,
  },
];

const ROWS = [0, 1, 2].map((i) => ({
  orderId: `01a1cf45-0000-73cf-8f7e-ff51baf52${String(700 + i)}`,
  orderNumber: `SD-2026-26-00009${i}`,
  shipmentId: `sh${i}`,
  shipmentNumber: `SHP-2026-0001${i}`,
  sellerId: 's1',
  sellerCompanyName:
    i === 1 ? 'Chittagong Home & Lifestyle Exports Private Limited' : 'Dhaka Threads Ltd',
  recipientName: 'Ananya Sharma',
  destCity: ['Kolkata', 'Thiruvananthapuram', ''][i],
  destPostalCode: ['700001', '695001', '110001'][i],
  totalWeightGrams: 450 * (i + 1),
  codAmountInr: i === 2 ? null : '1499.00',
  waitingSince: ago([20, 60 * 3, 60 * 7][i] ?? 0),
  options: i === 2 ? [] : OPTIONS,
  optionsFetchedAt: ago(30),
}));

const respond: Respond<F> = (fixture, req) => {
  if (req.path === '/api/admin/courier-decisions') {
    if (fixture === 'c')
      return json({ code: 'SERVICE_UNAVAILABLE', message: 'Not reachable' }, 503);
    return json({ parcels: fixture === 'b' ? [] : ROWS });
  }
  if (req.method === 'POST' && req.path.endsWith('/choose')) {
    if (fixture === 'd')
      return json(
        { code: 'COURIER_ALREADY_BOOKED', message: 'This parcel already has a waybill' },
        409,
      );
    return json({ shipmentId: 'sh0', awbNumber: '37045810001' });
  }
  return undefined;
};

export default function CourierDecisionsHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => ['courier.dispatch', 'orders.view']}
    >
      <CourierDecisionIndex />
    </EasyHarness>
  );
}
