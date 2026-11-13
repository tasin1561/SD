'use client';

import { Suspense, type ReactElement } from 'react';
import { SettlementsIndex } from '../../../(authed)/settlements/_components/settlements-index';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * /dev/easy/settlements — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1).
 * Invented payouts and orders; every write is refused, so nothing here can
 * reach a real settlement.
 *
 *   ?fixture=a  overdue and short-paid orders, four payouts   b  all clear
 */
const FIXTURES = ['a', 'b'] as const;
type F = (typeof FIXTURES)[number];

const order = (i: number, short: boolean): Record<string, unknown> => ({
  orderId: `01a1cf45-0000-73cf-8f7e-3434343434${i}0`,
  orderNumber: `SD-2026-26-0002${i}0`,
  sellerId: 's1',
  deliveredAt: ago(60 * 24 * (12 + i)),
  ageDays: 12 + i,
  expectedInr: `${1499 + i * 500}.00`,
  settledInr: short ? `${1200 + i * 500}.00` : '0.00',
  shortfallInr: short ? '299.00' : `${1499 + i * 500}.00`,
});

const RECON = {
  generatedAt: ago(1),
  overdueAfterDays: 10,
  outstandingFloatInr: '184250.00',
  overdueInr: '8494.00',
  overdueOrders: [0, 1, 2].map((i) => order(i, false)),
  shortPaidOrders: [3, 4].map((i) => order(i, true)),
};

const SETTLEMENTS = [0, 1, 2, 3].map((i) => ({
  id: `st${i}`,
  courierAccountId: 'c1',
  reference: i === 1 ? 'UTR202611130000123456789-DELHIVERY-COD-REMIT' : `UTR2026111300${i}`,
  amountInr: `${(i + 1) * 48250}.00`,
  allocatedInr: `${(i + 1) * 48000}.00`,
  earlyCodFeeInr: '0.00',
  freightDeductedInr: i === 2 ? '1250.00' : '0.00',
  rtoReversalInr: '0.00',
  keptBackInr: '0.00',
  unallocatedInr: i === 0 ? '250.00' : '0.00',
  receivedAt: ago(60 * 24 * (i + 1)),
  note: i === 0 ? 'Second payout of the week. One order is still to be matched.' : null,
  lines: [],
  createdAt: ago(60 * 24 * (i + 1) - 30),
}));

const respond: Respond<F> = (fixture, req) => {
  if (req.method !== 'GET')
    return json({ code: 'DEV_PAGE', message: 'This is a test page. Nothing was changed.' }, 409);
  if (req.path === '/api/admin/courier-settlements/reconciliation')
    return json(
      fixture === 'b'
        ? { ...RECON, overdueOrders: [], shortPaidOrders: [], overdueInr: '0.00' }
        : RECON,
    );
  if (req.path === '/api/admin/courier-settlements')
    return json(fixture === 'b' ? [] : SETTLEMENTS);
  return json([]);
};

export default function SettlementsHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => ['money.settlements.record', 'money.view', 'orders.view', 'sellers.view']}
    >
      <Suspense fallback={null}>
        <SettlementsIndex />
      </Suspense>
    </EasyHarness>
  );
}
