'use client';

import type { ReactElement } from 'react';
import { PackStation } from '../../../(authed)/warehouse/pack/_components/pack-station';
import '../../../(authed)/warehouse/_components/benches.css';
import '@/components/easy/easy.css';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * /dev/easy/pack — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1).
 *
 *   ?fixture=a  four parcels waiting; a label scan opens a box of two lines
 *            b  nothing waiting        c  the product scan is refused
 *            d  the bench is blocked by an open problem
 *            e  long product names, five lines in the box
 */
const FIXTURES = ['a', 'b', 'c', 'd', 'e'] as const;
type F = (typeof FIXTURES)[number];

const AWB = '38061110634966';
const WAITING = [1, 2, 3, 4].map((n) => ({
  shipmentId: `sh${n}`,
  shipmentNumber: `SHP-2026-0000${n}`,
  courierCode: n === 4 ? 'SHIPROCKET' : 'DELHIVERY',
  awbNumber: n === 3 ? null : `3806111063496${n}`,
  orderNumber: `SD-2026-26-00006${n}`,
  recipientName: ['Ananya Sharma', 'Rahul Verma', 'Priya Nair', 'Mohammed Irfan'][n - 1],
  labelPrintedAtIso: n === 3 ? null : ago(20 * n),
  pickCompletedAtIso: ago(30 * n),
  itemCount: n,
}));

const line = (n: number, long: boolean): Record<string, unknown> => ({
  variantId: `v${n}`,
  skuCode: long ? `AVIATOR-BLACK-GOLD-POLARISED-LIMITED-${n}` : `AVIATO-BLAC-GOL${n}`,
  productName: long
    ? 'Aviator polarised sunglasses with a gold frame, a hard case and a cleaning cloth'
    : 'Aviator',
  quantity: n,
  thumbnailUrl: null,
});

const respond: Respond<F> = (fixture, req) => {
  if (req.path === '/api/admin/courier/scan-block') {
    return json(
      fixture === 'd'
        ? {
            issueId: 'i1',
            title: 'A parcel was scanned that the system does not know',
            detail: 'Give the parcel to the supervisor before scanning anything else.',
            shipmentNumber: 'SHP-2026-00009',
            raisedAt: ago(4),
          }
        : null,
    );
  }
  if (req.path === '/api/warehouse/packs/queue') {
    return json({ waiting: fixture === 'b' ? [] : WAITING, inProgress: [] });
  }
  if (req.path === '/api/warehouse/packs/boxes/open') {
    return json({
      packBoxId: 'box-1',
      shipmentId: 'sh1',
      orderId: 'order-1',
      awbNumber: AWB,
      expiresAt: '2099-01-01T00:00:00.000Z',
      alreadyOpen: false,
      expected: (fixture === 'e' ? [1, 2, 3, 4, 5] : [1, 2]).map((n) => line(n, fixture === 'e')),
    });
  }
  if (/\/packs\/boxes\/box-1\/scan$/.test(req.path)) {
    if (fixture === 'c')
      return json(
        { code: 'PACK_WRONG_PRODUCT', message: 'This product is not in this order' },
        409,
      );
    return json({
      packBoxId: 'box-1',
      variantId: 'v1',
      skuCode: 'AVIATO-BLAC-GOL1',
      stockUnitId: null,
      expiresAt: '2099-01-01T00:05:00.000Z',
    });
  }
  if (req.method !== 'GET') return json({ manifestNumber: null });
  return undefined;
};

export default function PackHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => ['warehouse.pick.supervise', 'warehouse.view', 'orders.view']}
    >
      <div className="wh-page ez-touch">
        <PackStation />
      </div>
    </EasyHarness>
  );
}
