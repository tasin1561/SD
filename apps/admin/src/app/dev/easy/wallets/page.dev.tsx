'use client';

import { Suspense, type ReactElement } from 'react';
import { SellerWalletsIndex } from '../../../(authed)/seller-wallets/_components/seller-wallets-index';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * /dev/easy/wallets — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1). Invented
 * clients and balances; every write is refused.
 *
 *   ?fixture=a  six client wallets, in credit and in debt   b  no clients
 */
const FIXTURES = ['a', 'b'] as const;
type F = (typeof FIXTURES)[number];

const ROWS = [0, 1, 2, 3, 4, 5].map((i) => ({
  sellerId: `01a1cf45-0000-73cf-8f7e-56565656565${i}`,
  companyName:
    i === 1 ? 'Chittagong Home & Lifestyle Exports Private Limited' : `Dhaka Threads Ltd ${i}`,
  email:
    i === 1
      ? 'accounts.payable.department@chittagong-home-lifestyle.example.com'
      : 'owner@example.com',
  status: i === 4 ? 'SUSPENDED' : 'APPROVED',
  balanceInr: i === 3 ? '-12450.75' : `${(i + 1) * 15292}.78`,
  pendingWithdrawalInr: i === 0 ? '15292.78' : '0.00',
  pendingTopupInr: i === 2 ? '25000.00' : '0.00',
  updatedAt: ago(60 * 5 * (i + 1)),
  lastMovementDirection: i % 2 === 0 ? 'CREDIT' : 'DEBIT',
  lastMovementAt: i === 5 ? null : ago(60 * 5 * (i + 1)),
}));

const TOTALS = {
  owedToSellersInr: '2418280.00',
  owedBySellersInr: '12450.75',
  netInr: '2405829.25',
  pendingWithdrawalInr: '15292.78',
  pendingTopupInr: '25000.00',
  sellersInCredit: 5,
  sellersInDebt: 1,
};

const respond: Respond<F> = (fixture, req) => {
  if (req.method !== 'GET')
    return json({ code: 'DEV_PAGE', message: 'This is a test page. Nothing was changed.' }, 409);
  if (/seller-wallets/.test(req.path) && !/\/[0-9a-f-]{20,}/.test(req.path))
    return json({ totals: TOTALS, rows: fixture === 'b' ? [] : ROWS });
  return json([]);
};

export default function WalletsHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => ['money.view', 'money.wallets.reconcile', 'sellers.view', 'fx.view']}
    >
      <Suspense fallback={null}>
        <SellerWalletsIndex />
      </Suspense>
    </EasyHarness>
  );
}
