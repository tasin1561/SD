'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { TopupsIndex } from '../../../(authed)/topups/_components/topups-index';
import { WithdrawalsIndex } from '../../../(authed)/withdrawals/_components/withdrawals-index';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * /dev/easy/money — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1). Mock data
 * only: nothing here can reach a real wallet.
 *
 *   ?fixture=a  withdrawals, four requests   b  top-ups, three claims
 *            c  withdrawals, empty           d  top-ups, empty
 */
const FIXTURES = ['a', 'b', 'c', 'd'] as const;
type F = (typeof FIXTURES)[number];

const WD = ['PENDING', 'APPROVED', 'PAID', 'REJECTED'].map((status, i) => ({
  id: `wd${i}`,
  sellerId: `01a1cf45-0000-73cf-8f7e-aaaaaaaaaaa${i}`,
  sellerName: i === 1 ? 'Chittagong Home & Lifestyle Exports Private Limited' : 'Dhaka Threads Ltd',
  sellerBalanceInr: '18250.40',
  currency: 'INR',
  amountRequested: ['2946.40', '12000.00', '500.00', '75000.00'][i],
  status,
  requestedBy: i === 0 ? 'SYSTEM' : 'SELLER',
  linkedRemittanceId: status === 'PAID' ? '0198f3c2-0000-7000-8000-000000000001' : null,
  rejectionReason:
    status === 'REJECTED' ? 'The bank account name does not match the client.' : null,
  note: i === 1 ? 'Please send before Friday.' : null,
  createdAt: ago(60 * 30 * (i + 1)),
  resolvedAt: i >= 2 ? ago(60 * 5) : null,
  waitingHours: i < 2 ? 30 * (i + 1) : null,
  slaBreached: i === 1,
}));

const TOPUPS = ['PENDING', 'ACCEPTED', 'REJECTED'].map((status, i) => ({
  id: `tp${i}`,
  sellerId: `01a1cf45-0000-73cf-8f7e-aaaaaaaaaaa${i}`,
  sellerName: 'Dhaka Threads Ltd',
  bankLabel: 'Main collection account',
  bankName: 'HDFC Bank',
  bankAccountName: 'Skydrop Logistics Private Limited',
  bankAccountNumber: '50200012345678',
  bankBranchName: i === 0 ? 'Park Street, Kolkata' : null,
  sellerCompanyName:
    i === 1 ? 'Chittagong Home & Lifestyle Exports Private Limited' : 'Dhaka Threads Ltd',
  reviewedByEmail: status === 'PENDING' ? null : 'finance@skydrop.global',
  currency: 'INR',
  amount: ['25000.00', '5000.00', '100000.00'][i],
  transactionRef: i === 2 ? null : `UTR20261113000${i}`,
  hasProof: i !== 1,
  status,
  reviewNote: status === 'REJECTED' ? 'No matching credit on the statement.' : null,
  reviewedAt: status === 'PENDING' ? null : ago(60 * 3),
  createdAt: ago(60 * 12 * (i + 1)),
}));

const respond: Respond<F> = (fixture, req) => {
  if (req.path === '/api/admin/withdrawal-requests') {
    const items = fixture === 'c' ? [] : WD;
    return json({
      items,
      total: items.length,
      page: 1,
      pageSize: 20,
      slaHours: 48,
      breachedCount: fixture === 'c' ? 0 : 1,
      breachedInr: fixture === 'c' ? '0.00' : '12000.00',
      oldestPendingHours: fixture === 'c' ? null : 60,
    });
  }
  if (req.path === '/api/admin/wallet/topups') return json(fixture === 'd' ? [] : TOPUPS);
  if (req.method === 'GET') return json({ items: [], total: 0, page: 1, pageSize: 20 });
  // Every write is answered with a refusal: the test page changes nothing.
  return json({ code: 'DEV_PAGE', message: 'This is a test page. Nothing was changed.' }, 409);
};

function Screen(): ReactElement | null {
  const [fixture, setFixture] = useState<string | null>(null);
  useEffect(() => {
    setFixture(new URLSearchParams(window.location.search).get('fixture') ?? 'a');
  }, []);
  if (fixture === null) return null;
  return fixture === 'b' || fixture === 'd' ? <TopupsIndex /> : <WithdrawalsIndex />;
}

export default function MoneyHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => [
        'money.topups.review',
        'money.withdrawals.review',
        'money.view',
        'sellers.view',
      ]}
    >
      <Screen />
    </EasyHarness>
  );
}
