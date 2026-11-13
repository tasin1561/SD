'use client';

import { Suspense, type ReactElement } from 'react';
import { OrdersIndex } from '../../../(authed)/orders/_components/orders-index';
import { EasyHarness, ago, json, type Respond } from '../harness';
import { SELLERS } from '../call-fixtures';

/**
 * /dev/easy/orders — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1).
 *
 *   ?fixture=a  eight orders in mixed statuses   b  no orders   c  the list fails
 */
const FIXTURES = ['a', 'b', 'c'] as const;
type F = (typeof FIXTURES)[number];

const STATUSES = [
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'PACKED',
  'DISPATCHED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'RTO_INITIATED',
  'CANCELLED',
];

const ROWS = STATUSES.map((status, i) => ({
  id: `01a1cf45-0000-73cf-8f7e-eeeeeeeeee${i}0`,
  orderNumber: `SD-2026-26-00015${i}`,
  sellerOrderRef: i % 3 === 0 ? `SHOP-ORDER-REFERENCE-${1000 + i}` : null,
  status,
  source: ['SELLER_PORTAL', 'CSV_IMPORT', 'API'][i % 3],
  recipientName:
    i === 1 ? 'Venkata Subramanian Raghavendra Lakshminarayanan Iyer' : 'Ananya Sharma',
  recipientPhoneE164: `+91987654320${i}`,
  recipientCity: 'Kolkata',
  recipientStateProvince: 'West Bengal',
  recipientPostalCode: '700001',
  codAmountInr: i === 4 ? null : '1499.00',
  placedAt: ago(60 * 7 * (i + 1)),
  sellerId: 's1',
}));

const respond: Respond<F> = (fixture, req) => {
  if (req.path === '/api/admin/orders') {
    if (fixture === 'c')
      return json({ code: 'SERVICE_UNAVAILABLE', message: 'Not reachable' }, 503);
    const items = fixture === 'b' ? [] : ROWS;
    return json({ items, total: items.length, page: 1, pageSize: 25 });
  }
  if (req.path === '/api/admin/sellers') return json(SELLERS);
  return undefined;
};

export default function OrdersHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => ['orders.view', 'sellers.view']}
    >
      <Suspense fallback={null}>
        <OrdersIndex />
      </Suspense>
    </EasyHarness>
  );
}
