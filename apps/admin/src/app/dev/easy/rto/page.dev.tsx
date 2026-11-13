'use client';

import { Suspense, type ReactElement } from 'react';
import { RtoStation } from '../../../(authed)/warehouse/rto/_components/rto-station';
import '../../../(authed)/warehouse/_components/benches.css';
import '@/components/easy/easy.css';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * /dev/easy/rto — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1). The returns
 * bench with real-looking rows. Scanning 37045810001 receives a parcel of
 * three lines, ready to inspect.
 *
 *   ?fixture=a  parcels at the door, on the way and on the bench
 *            b  nothing anywhere      c  the scan is refused
 */
const FIXTURES = ['a', 'b', 'c'] as const;
type F = (typeof FIXTURES)[number];

const AWAITING = [0, 1, 2, 3].map((i) => ({
  shipmentId: `aw${i}`,
  shipmentNumber: `SHP-2026-0007${i}`,
  awbNumber: `3704581000${i + 1}`,
  courierCode: i === 3 ? 'SHIPROCKET' : 'DELHIVERY',
  stage: i < 2 ? 'RETURNED' : 'ON_THE_WAY',
  shipmentStatus: i < 2 ? 'RTO_DELIVERED' : 'RTO_IN_TRANSIT',
  orderId: `01a1cf45-0000-73cf-8f7e-ffffffffff${i}0`,
  orderNumber: `SD-2026-26-00017${i}`,
  orderStatus: 'RTO_INITIATED',
  sellerName: i === 1 ? 'Chittagong Home & Lifestyle Exports Private Limited' : 'Dhaka Threads Ltd',
  returnedAt: i < 2 ? ago(60 * 20 * (i + 1)) : null,
  waitingHours: 20 * (i + 1),
  itemCount: i + 1,
}));

const OPEN = [0, 1].map((i) => ({
  shipmentId: `op${i}`,
  shipmentNumber: `SHP-2026-0008${i}`,
  awbNumber: `3704581010${i}`,
  orderNumber: `SD-2026-26-00018${i}`,
  sellerName: 'Dhaka Threads Ltd',
  rtoReceivedAt: ago(60 * 5 * (i + 1)),
  itemCount: 3,
  undecidedCount: 2 - i,
  uninspectedCount: 2 - i,
}));

const line = (n: number): Record<string, unknown> => ({
  shipmentItemId: `si-${n}`,
  skuCode: n === 2 ? 'AVIATOR-BLACK-GOLD-POLARISED-LIMITED-EDITION' : `AVIATO-GREE-BLA${n}`,
  productName:
    n === 2
      ? 'Aviator polarised sunglasses with a gold frame, a hard case and a cleaning cloth'
      : 'Aviator OG Sunglass',
  variantLabel: n === 1 ? 'Green / Black' : null,
  quantity: n,
  rtoCondition: n === 3 ? 'GOOD' : null,
  rtoDisposition: n === 3 ? 'RESTOCK' : null,
  rtoInspectionNotes: null,
  rtoInspections: [],
  thumbnailUrl: null,
});

const DETAIL = {
  shipmentId: 'aw0',
  shipmentNumber: 'SHP-2026-00070',
  orderId: '01a1cf45-0000-73cf-8f7e-ffffffffff00',
  orderStatus: 'RTO_RECEIVED',
  awbNumber: '37045810001',
  rtoReceivedAt: ago(2),
  items: [line(1), line(2), line(3)],
};

const respond: Respond<F> = (fixture, req) => {
  if (req.path.endsWith('/scan-block')) return json(null);
  if (req.path === '/api/warehouse/rto/awaiting-receipt')
    return json({ items: fixture === 'b' ? [] : AWAITING });
  if (req.path === '/api/warehouse/rto/shipments' && req.method === 'GET')
    return json({ items: fixture === 'b' ? [] : OPEN });
  if (/\/rto\/shipments\/[^/]+\/putaway$/.test(req.path) && req.method === 'GET') return json([]);
  if (/\/rto\/shipments\/[^/]+$/.test(req.path) && req.method === 'GET') return json(DETAIL);
  if (req.path === '/api/warehouse/rto/receive') {
    if (fixture === 'c')
      return json({ code: 'RTO_NOT_RETURNING', message: 'This parcel is not coming back' }, 409);
    return json({
      shipmentId: 'aw0',
      orderId: DETAIL.orderId,
      orderStatus: 'RTO_RECEIVED',
      rtoReceivedAt: ago(0),
      alreadyReceived: false,
    });
  }
  if (req.method !== 'GET')
    return json({ code: 'DEV_PAGE', message: 'This is a test page. Nothing was changed.' }, 409);
  return undefined;
};

export default function RtoHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => ['warehouse.view', 'warehouse.manage', 'orders.view', 'inventory.view']}
    >
      <div className="wh-page ez-touch">
        <Suspense fallback={null}>
          <RtoStation />
        </Suspense>
      </div>
    </EasyHarness>
  );
}
