'use client';

import type { ReactElement } from 'react';
import { DeliveryActionsIndex } from '../../../(authed)/delivery-actions/_components/delivery-actions-index';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * /dev/easy/delivery-actions — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1).
 *
 *   ?fixture=a  six requests, every status and action   b  nothing waiting
 *            c  the queue fails to load                 d  the decision is refused
 */
const FIXTURES = ['a', 'b', 'c', 'd'] as const;
type F = (typeof FIXTURES)[number];

const STATUSES = ['PENDING', 'PENDING', 'APPROVED', 'EXECUTED', 'FAILED', 'REJECTED', 'EXPIRED'];
const ACTIONS = ['REATTEMPT', 'RECALL', 'RTO'];

const ROWS = STATUSES.map((status, i) => ({
  id: `d${i}`,
  action: ACTIONS[i % 3],
  reason:
    i === 0
      ? 'The customer says nobody came. She is at home all day tomorrow and wants it delivered before noon.'
      : 'Customer asked for another try.',
  status,
  decisionNote: status === 'REJECTED' ? 'Three attempts were already made.' : null,
  executionError: status === 'FAILED' ? '[DLV-409] Shipment is already in RTO' : null,
  createdAt: ago(60 * (i + 1) * 3),
  waitingOnSeller: i === 1,
  resellerStore: i === 1 ? { name: 'riya-store', displayName: 'Riya Fashion House' } : null,
  order: { orderNumber: `SD-2026-26-00012${i}`, status: 'NDR', recipientName: 'Ananya Sharma' },
  seller: {
    companyName:
      i === 2 ? 'Chittagong Home & Lifestyle Exports Private Limited' : 'Dhaka Threads Ltd',
  },
  shipment: { shipmentNumber: `SHP-2026-0003${i}`, awbNumber: i === 3 ? null : `3704581001${i}` },
}));

const respond: Respond<F> = (fixture, req) => {
  if (req.path === '/api/admin/delivery-actions') {
    if (fixture === 'c')
      return json({ code: 'SERVICE_UNAVAILABLE', message: 'Not reachable' }, 503);
    if (fixture === 'b') return json([]);
    const status = req.query.get('status');
    return json(status === null ? ROWS : ROWS.filter((r) => r.status === status));
  }
  if (req.method === 'POST' && /\/(approve|reject)$/.test(req.path)) {
    if (fixture === 'd')
      return json(
        { code: 'DELIVERY_ACTION_HELD_FOR_SELLER', message: 'The client decides this request' },
        409,
      );
    return json(ROWS[0]);
  }
  return undefined;
};

export default function DeliveryActionsHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => ['courier.ops.write', 'orders.view']}
    >
      <DeliveryActionsIndex />
    </EasyHarness>
  );
}
