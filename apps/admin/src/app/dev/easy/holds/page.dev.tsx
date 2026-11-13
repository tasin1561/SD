'use client';

import type { ReactElement } from 'react';
import { AdminHoldsIndex } from '../../../(authed)/holds/_components/admin-holds-index';
import { EasyHarness, ago, json, type Respond } from '../harness';
import { SELLERS } from '../call-fixtures';

/**
 * /dev/easy/holds — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1).
 *
 *   ?fixture=a  five reviews in every status   b  nothing held   c  the list fails
 */
const FIXTURES = ['a', 'b', 'c'] as const;
type F = (typeof FIXTURES)[number];

const STATUSES = [
  'OPEN',
  'OPEN',
  'SELLER_RELEASED',
  'SELLER_REQUESTED_MORE_ATTEMPTS',
  'AUTO_RELEASED',
];

const ROWS = STATUSES.map((status, i) => ({
  id: `h${i}`,
  sellerId: `01a1cf45-0000-73cf-8f7e-aaaaaaaaaaa${i}`,
  orderId: `01a1cf45-0000-73cf-8f7e-bbbbbbbbbbb${i}`,
  status,
  attemptCount: i + 2,
  heldQty: (i + 1) * 3,
  note: i === 3 ? 'Customer is travelling; asked us to try again after the 20th.' : null,
  resolvedAt: status === 'OPEN' ? null : ago(60 * 5),
  createdAt: ago(60 * 24 * (i + 1)),
}));

const respond: Respond<F> = (fixture, req) => {
  if (req.path === '/api/admin/early-reservation-reviews') {
    if (fixture === 'c')
      return json({ code: 'SERVICE_UNAVAILABLE', message: 'Not reachable' }, 503);
    if (fixture === 'b') return json([]);
    const status = req.query.get('status');
    return json(status === null ? ROWS : ROWS.filter((r) => r.status === status));
  }
  if (req.path === '/api/admin/sellers') return json(SELLERS);
  return undefined;
};

export default function HoldsHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => ['orders.view', 'sellers.view']}
    >
      <AdminHoldsIndex />
    </EasyHarness>
  );
}
