'use client';

import type { ReactElement } from 'react';
import { AwaitingConfirmationIndex } from '../../../(authed)/call-center/awaiting-confirmation/_components/awaiting-confirmation-index';
import { EasyHarness, json, type Respond } from '../harness';
import { AWAITING, SELLERS } from '../call-fixtures';

/**
 * /dev/easy/awaiting — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1).
 *
 *   ?fixture=a  five orders waiting   b  nothing waiting
 *            c  the list fails        d  sending is refused by the server
 */
const FIXTURES = ['a', 'b', 'c', 'd'] as const;
type F = (typeof FIXTURES)[number];

const respond: Respond<F> = (fixture, req) => {
  if (req.path === '/api/admin/orders/awaiting-confirmation') {
    if (fixture === 'c')
      return json({ code: 'SERVICE_UNAVAILABLE', message: 'Not reachable' }, 503);
    const sellerId = req.query.get('sellerId');
    const rows =
      fixture === 'b' ? [] : AWAITING.filter((r) => sellerId === null || r.clientId === sellerId);
    return json({ items: rows, total: rows.length, page: 1, pageSize: 20 });
  }
  if (req.path === '/api/admin/sellers') return json(SELLERS);
  if (req.method !== 'GET') {
    if (fixture === 'd')
      return json({ code: 'ORDER_NOT_AWAITING', message: 'The order is no longer waiting' }, 409);
    return json({ sent: 1, skipped: [], confirmed: 1 });
  }
  return undefined;
};

export default function AwaitingHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => ['callcenter.queue.manage', 'orders.view', 'sellers.view']}
    >
      <AwaitingConfirmationIndex />
    </EasyHarness>
  );
}
