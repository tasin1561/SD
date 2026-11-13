'use client';

import { Suspense, type ReactElement } from 'react';
import { RemittancesIndex } from '../../../(authed)/remittances/_components/remittances-index';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * /dev/easy/remittances — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1).
 * Invented payouts to clients; every write is refused.
 *
 *   ?fixture=a  five recorded payouts and two requests waiting   b  nothing yet
 */
const FIXTURES = ['a', 'b'] as const;
type F = (typeof FIXTURES)[number];

const ITEMS = [0, 1, 2, 3, 4].map((i) => ({
  id: `0198f3c2-0000-7000-8000-00000000000${i}`,
  sellerId: 's1',
  sellerName: i === 1 ? 'Chittagong Home & Lifestyle Exports Private Limited' : 'Dhaka Threads Ltd',
  currency: i % 2 === 0 ? 'BDT' : 'INR',
  amount: `${(i + 1) * 21500}.00`,
  sourceCurrency: 'INR',
  sourceAmount: `${(i + 1) * 15292}.78`,
  fxRateSnapshot: i % 2 === 0 ? '1.4060' : '1.0000',
  bankReference: i === 1 ? 'UTR202611130000123456789-CITYBANK-OUTWARD-REMIT' : `UTR2026111400${i}`,
  paidAt: ago(60 * 24 * (i + 1)),
  note: i === 0 ? 'Weekly payout. The client asked for it before Friday.' : null,
  createdAt: ago(60 * 24 * (i + 1) - 20),
  paidFromLabel: 'City Bank — owner capital',
  paidFromBank: 'City Bank PLC',
  recordedByName: 'finance@skydrop.global',
}));

const WAITING = [0, 1].map((i) => ({
  id: `wd${i}`,
  sellerId: 's1',
  sellerName: 'Dhaka Threads Ltd',
  sellerBalanceInr: '18250.40',
  currency: 'INR',
  amountRequested: ['2946.40', '12000.00'][i],
  status: 'APPROVED',
  requestedBy: 'SELLER',
  linkedRemittanceId: null,
  rejectionReason: null,
  note: null,
  createdAt: ago(60 * 30 * (i + 1)),
  resolvedAt: null,
  waitingHours: 30 * (i + 1),
  slaBreached: i === 1,
}));

const respond: Respond<F> = (fixture, req) => {
  if (req.method !== 'GET')
    return json({ code: 'DEV_PAGE', message: 'This is a test page. Nothing was changed.' }, 409);
  if (req.path === '/api/admin/remittances') {
    const items = fixture === 'b' ? [] : ITEMS;
    return json({ items, total: items.length, page: 1, pageSize: 50 });
  }
  if (req.path === '/api/admin/withdrawal-requests') {
    const items = fixture === 'b' ? [] : WAITING;
    return json({
      items,
      total: items.length,
      page: 1,
      pageSize: 50,
      slaHours: 48,
      breachedCount: 1,
      breachedInr: '12000.00',
      oldestPendingHours: 60,
    });
  }
  return json([]);
};

export default function RemittancesHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => [
        'money.remittances.manage',
        'money.withdrawals.review',
        'money.view',
        'sellers.view',
      ]}
    >
      <Suspense fallback={null}>
        <RemittancesIndex />
      </Suspense>
    </EasyHarness>
  );
}
