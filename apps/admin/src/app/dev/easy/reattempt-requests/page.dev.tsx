'use client';

import type { ReactElement } from 'react';
import { ReattemptRequestsIndex } from '../../../(authed)/reattempt-requests/_components/reattempt-requests-index';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * /dev/easy/reattempt-requests — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1).
 *
 *   ?fixture=a  three waiting, one approved with extra calls, one declined with a note
 *            b  nothing in any status      c  the list fails to load
 *            d  one request with a very long reason and no order number
 *            e  the decision is refused by the server
 */
const FIXTURES = ['a', 'b', 'c', 'd', 'e'] as const;
type F = (typeof FIXTURES)[number];

const ROWS = [
  {
    id: 'r1',
    orderId: '01a1cf45-6d0b-73cf-8f7e-ff51baf525e6',
    orderNumber: 'SD-2026-26-000071',
    sellerId: 's1',
    reason:
      'The customer messaged us on WhatsApp. She was at work and could not talk. She wants the order.',
    status: 'PENDING',
    decisionNote: null,
    decidedAt: null,
    extraAttempts: 0,
    orderStatusAtRequest: 'REJECTED_BY_CUSTOMER',
    createdAt: ago(42),
  },
  {
    id: 'r2',
    orderId: '01a1cf45-0000-73cf-8f7e-ff51baf525e7',
    orderNumber: 'SD-2026-26-000068',
    sellerId: 's1',
    reason: 'Wrong person picked up the phone. Please try the same number after 6 pm.',
    status: 'PENDING',
    decisionNote: null,
    decidedAt: null,
    extraAttempts: 0,
    orderStatusAtRequest: 'REJECTED_BY_CUSTOMER',
    createdAt: ago(60 * 5),
  },
  {
    id: 'r3',
    orderId: '01a1cf45-0000-73cf-8f7e-ff51baf525e8',
    orderNumber: 'SD-2026-26-000052',
    sellerId: 's2',
    reason: 'Customer paid an advance by bKash and is asking where the parcel is.',
    status: 'APPROVED',
    decisionNote: 'Advance confirmed with the client.',
    decidedAt: ago(60 * 20),
    extraAttempts: 2,
    orderStatusAtRequest: 'REJECTED_BY_CUSTOMER',
    createdAt: ago(60 * 26),
  },
  {
    id: 'r4',
    orderId: '01a1cf45-0000-73cf-8f7e-ff51baf525e9',
    orderNumber: 'SD-2026-26-000040',
    sellerId: 's2',
    reason: 'Please call again.',
    status: 'REJECTED',
    decisionNote: 'No new information. The customer refused twice.',
    decidedAt: ago(60 * 50),
    extraAttempts: 0,
    orderStatusAtRequest: 'REJECTED_BY_CUSTOMER',
    createdAt: ago(60 * 52),
  },
] as const;

const respond: Respond<F> = (fixture, req) => {
  if (req.path === '/api/admin/reattempt-requests') {
    if (fixture === 'c')
      return json({ code: 'SERVICE_UNAVAILABLE', message: 'Not reachable' }, 503);
    if (fixture === 'b') return json([]);
    const status = req.query.get('status');
    if (fixture === 'd') {
      return json([
        {
          ...ROWS[0],
          orderNumber: null,
          reason: `${'A very long reason that keeps going so wrapping can be checked on a small phone. '.repeat(6)}\n${'X'.repeat(80)}`,
        },
      ]);
    }
    return json(status === null ? ROWS : ROWS.filter((r) => r.status === status));
  }
  if (req.method === 'POST' && /\/(approve|reject)$/.test(req.path)) {
    if (fixture === 'e') {
      return json(
        { code: 'REATTEMPT_ORDER_MOVED', message: 'The order is no longer rejected' },
        409,
      );
    }
    return json({ ...ROWS[0], status: req.path.endsWith('approve') ? 'APPROVED' : 'REJECTED' });
  }
  return undefined;
};

export default function ReattemptRequestsHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => ['callcenter.supervise', 'callcenter.work', 'orders.view']}
    >
      <ReattemptRequestsIndex />
    </EasyHarness>
  );
}
