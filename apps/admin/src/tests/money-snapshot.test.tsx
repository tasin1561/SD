/**
 * Money is sacred across the apps restyle.
 *
 * Renders admin's seller-wallet detail (balance cards and ledger) and the
 * top-up review queue against fixed data and snapshots every money string
 * they show and speak. Recorded on the pre-restyle markup in Phase 1, so
 * admin's baseline predates every change to its screens. A restyle that
 * moves a single figure, sign, grouping or currency fails here.
 *
 * When this fails: the snapshot is right and the screen is wrong. Update it
 * only for a deliberate change to how money is written, and say so in the
 * commit.
 */
import { waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildFetchMock, makeStaff, renderWithProviders } from './helpers';
import { moneyStrings } from './money-strings';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

import { SellerWalletDetailView } from '../app/(authed)/seller-wallets/[id]/_components/seller-wallet-detail';
import { TopupsIndex } from '../app/(authed)/topups/_components/topups-index';

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-20T06:30:00.000Z'));
});

const MONEY_PERMISSIONS = [
  'money.wallets.view',
  'money.topups.view',
  'money.topups.review',
  'money.withdrawals.view',
  'sellers.view',
];

const DETAIL = {
  seller: { id: 's1', companyName: 'Menev Store', email: 'owner@menev.test', status: 'APPROVED' },
  balanceInr: '-3600.00',
  withdrawableInr: '0.00',
  minimumBalanceInr: '500.00',
  pendingWithdrawalInr: '1200.00',
  pendingTopupInr: '2500.00',
  settings: [],
};

const entry = (
  id: string,
  direction: string,
  amount: string,
  after: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  currency: 'INR',
  direction,
  amount,
  runningBalanceAfter: after,
  linkedOrderId: null,
  linkedOrderNumber: null,
  linkedConsignmentId: null,
  linkedConsignmentNumber: null,
  reasonCode: null,
  note: null,
  createdAt: '2026-09-18T10:15:00.000Z',
  ...extra,
});

const ENTRIES = {
  items: [
    entry('e1', 'ORDER_CHARGES', '162.60', '-3600.00', {
      linkedOrderId: 'o1',
      linkedOrderNumber: 'SD-2026-38-000101',
    }),
    entry('e2', 'COD_COLLECTION', '1180.00', '-3437.40', { linkedOrderId: 'o1' }),
    entry('e3', 'INBOUND_FREIGHT', '3658.54', '-4617.40', {
      linkedConsignmentId: 'c1',
      linkedConsignmentNumber: 'CN-2026-09-000004',
    }),
    entry('e4', 'TOPUP', '1234567.89', '-958.86'),
    entry('e5', 'STAFF_CREDIT', '0.05', '-1235526.75', { note: 'Rounding correction.' }),
  ],
};

const topup = (id: string, currency: string, amount: string, status: string) => ({
  id,
  sellerId: 's1',
  sellerName: 'Menev Store',
  sellerCompanyName: 'Menev Store',
  bankLabel: currency === 'BDT' ? 'BRAC Payout' : 'HDFC Current',
  bankName: currency === 'BDT' ? 'BRAC Bank' : 'HDFC Bank',
  bankAccountName: 'Skydrop',
  bankAccountNumber: '50100123456789',
  bankBranchName: null,
  reviewedByEmail: status === 'PENDING' ? null : 'admin@test.local',
  currency,
  amount,
  transactionRef: `NEFT-${id}`,
  hasProof: false,
  status,
  reviewNote: null,
  reviewedAt: status === 'PENDING' ? null : '2026-09-19T08:00:00.000Z',
  createdAt: '2026-09-18T10:15:00.000Z',
});

const TOPUPS = [
  topup('t1', 'INR', '5000.00', 'PENDING'),
  topup('t2', 'BDT', '12300.50', 'PENDING'),
  topup('t3', 'INR', '1234567.89', 'ACCEPTED'),
];

function fetchMock(): ReturnType<typeof vi.fn> {
  const many = <T,>(body: T) => Array.from({ length: 20 }, () => ({ status: 200, body }));
  return buildFetchMock([
    { match: /\/api\/admin\/seller-wallets\/s1$/, responses: many(DETAIL) },
    { match: /\/api\/admin\/seller-wallets\/s1\/entries/, responses: many(ENTRIES) },
    { match: /\/api\/admin\/seller-wallets\/s1\/topups/, responses: many([]) },
    { match: /\/api\/admin\/seller-wallets\/s1\/withdrawals/, responses: many([]) },
    { match: /\/api\/admin\/wallet\/topups/, responses: many(TOPUPS) },
  ]);
}

describe('admin money strings', () => {
  it('seller wallet detail and ledger', async () => {
    const r = renderWithProviders(<SellerWalletDetailView sellerId="s1" />, {
      identity: makeStaff(undefined, MONEY_PERMISSIONS),
      fetchImpl: fetchMock(),
    });
    await waitFor(() => expect(r.container.textContent).toContain('CN-2026-09-000004'));
    expect(moneyStrings(r.container)).toMatchSnapshot();
  });

  it('top-up review queue', async () => {
    const r = renderWithProviders(<TopupsIndex />, {
      identity: makeStaff(undefined, MONEY_PERMISSIONS),
      fetchImpl: fetchMock(),
    });
    await waitFor(() => expect(r.container.textContent).toContain('NEFT-t2'));
    expect(moneyStrings(r.container)).toMatchSnapshot();
  });
});
