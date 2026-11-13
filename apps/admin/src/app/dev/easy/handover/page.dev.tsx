'use client';

import type { ReactElement } from 'react';
import { HandoverBench } from '../../../(authed)/warehouse/handover/_components/handover-bench';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * /dev/easy/handover — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1).
 *
 *   ?fixture=a  four parcels waiting, every scan hands one over
 *            b  nothing waiting              c  the scan is refused by the server
 *            d  the parcel was already scanned
 *            e  the bench is blocked by an open problem
 *            f  long names, no order number
 */
const FIXTURES = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
type F = (typeof FIXTURES)[number];

const WAITING = [1, 2, 3, 4].map((n) => ({
  shipmentId: `sh${n}`,
  shipmentNumber: `SHP-2026-0000${n}`,
  awbNumber: `3704581000${n}`,
  courierCode: n === 4 ? 'SHIPROCKET' : 'DELHIVERY',
  orderNumber: `SD-2026-26-00006${n}`,
  recipientName: ['Ananya Sharma', 'Rahul Verma', 'Priya Nair', 'Mohammed Irfan'][n - 1],
  orderStatus: 'PACKED',
  packedAtIso: ago(30 * n),
  handoverScannedAtIso: null,
}));

let scans = 0;

const respond: Respond<F> = (fixture, req) => {
  if (req.path === '/api/admin/courier/scan-block') {
    return json(
      fixture === 'e'
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
  if (req.path === '/api/admin/courier/handover-queue') {
    if (fixture === 'b') return json({ waiting: [] });
    if (fixture === 'f') {
      return json({
        waiting: [
          {
            ...WAITING[0],
            orderNumber: null,
            recipientName: 'Venkata Subramanian Raghavendra Lakshminarayanan Iyer',
            awbNumber: '370458100000000000000000001',
          },
        ],
      });
    }
    return json({ waiting: WAITING });
  }
  if (req.method === 'POST' && req.path === '/api/admin/courier/handover-scan') {
    if (fixture === 'c') {
      return json({ code: 'HANDOVER_NOT_PACKED', message: 'This parcel is not packed yet' }, 409);
    }
    scans += 1;
    return json({
      shipmentId: `sh${scans}`,
      shipmentNumber: `SHP-2026-0000${scans}`,
      orderId: null,
      alreadyScanned: fixture === 'd',
      dispatched: fixture !== 'd',
      manifestDispatched: false,
    });
  }
  return undefined;
};

export default function HandoverHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => ['courier.pickups.manage', 'warehouse.view', 'orders.view']}
    >
      <HandoverBench />
    </EasyHarness>
  );
}
