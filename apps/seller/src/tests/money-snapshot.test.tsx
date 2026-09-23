/**
 * Money is sacred across the apps restyle.
 *
 * Renders the seller screens that carry the most money — the dashboard's
 * money cards, the wallet ledger, and one order's charges band — against
 * fixed data, in rupee display and in taka display, and snapshots every
 * money string they show and speak. The snapshot was recorded on the
 * pre-restyle markup (Phase 1, before any shared component changed). A
 * restyle that moves a single figure, sign, grouping or rate fails here.
 *
 * When this fails: the snapshot is right and the screen is wrong. Update
 * the snapshot only for a deliberate change to how money is written, and
 * say so in the commit.
 */
import { waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { MoneyDisplayProvider } from '@skydrop/ui/components';
import { buildFetchMock, renderWithProviders } from './helpers';
import { moneyStrings } from './money-strings';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/page-access', () => ({ can: () => true, canSeePath: () => true }));

import { DashboardView } from '../app/(authed)/dashboard/_components/dashboard-view';
import WalletPage from '../app/(authed)/wallet/page';
import { OrderChargesSection } from '../app/(authed)/orders/_components/order-charges';

beforeAll(() => {
  // Freeze "now" so relative dates and anything derived from them hold still.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-20T06:30:00.000Z'));
});

const WALLET = {
  balances: [
    { currency: 'INR', balance: '12345.67', isConverted: false, fxRate: null },
    { currency: 'BDT', balance: '15185.17', isConverted: true, fxRate: '1.23' },
  ],
};

const IN_FLIGHT = {
  inTransit: { count: 7, codInr: '8450.00' },
  processing: { count: 3, codInr: '1234567.89' },
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
  linkedRemittanceId: null,
  linkedConsignmentId: null,
  linkedConsignmentNumber: null,
  reasonCode: null,
  note: null,
  createdAt: '2026-09-18T10:15:00.000Z',
  ...extra,
});

const ENTRIES = {
  items: [
    entry('e1', 'COD_COLLECTION', '1180.00', '12345.67', {
      linkedOrderId: 'o1',
      linkedOrderNumber: 'SD-2026-38-000101',
    }),
    entry('e2', 'GST_WITHHOLDING', '180.00', '11165.67', { linkedOrderId: 'o1' }),
    entry('e3', 'ORDER_CHARGES', '162.60', '11345.67', { linkedOrderId: 'o1' }),
    entry('e4', 'TOPUP', '5000.00', '11508.27'),
    entry('e5', 'INBOUND_FREIGHT', '3658.54', '6508.27', {
      linkedConsignmentId: 'c1',
      linkedConsignmentNumber: 'CN-2026-09-000004',
    }),
    entry('e6', 'RTO_FEE', '24.39', '10166.81'),
    entry('e7', 'STAFF_DEBIT', '0.05', '10191.20', { note: 'Rounding correction.' }),
  ],
  nextCursor: null,
};

const CHARGES = [
  { type: 'BASE_SHIPPING', amountInr: '162.60', totalAmountInr: '162.60', taxRate: null },
  { type: 'COD_FEE', amountInr: '11.80', totalAmountInr: '11.80', taxRate: null },
  { type: 'GST', amountInr: '0.00', totalAmountInr: '0.00', taxRate: '0' },
  { type: 'ADJUSTMENT', amountInr: '-25.00', totalAmountInr: '-25.00', taxRate: null },
].map((c, i) => ({
  id: `ch${i}`,
  orderId: 'o1',
  shipmentId: null,
  taxAmountInr: null,
  description: null,
  displayOrder: i,
  isVisibleToSeller: true,
  status: 'CONFIRMED',
  createdAt: '2026-09-18T10:15:00.000Z',
  ...c,
}));

function fetchMock(): ReturnType<typeof vi.fn> {
  const many = <T,>(body: T) => Array.from({ length: 20 }, () => ({ status: 200, body }));
  return buildFetchMock([
    { match: /\/api\/seller\/wallet$/, responses: many(WALLET) },
    { match: /\/api\/seller\/wallet\/entries/, responses: many(ENTRIES) },
    { match: /\/api\/seller\/orders\/money-in-flight/, responses: many(IN_FLIGHT) },
    { match: /\/api\/seller\/orders\/o1\/charges/, responses: many(CHARGES) },
  ]);
}

const DISPLAYS = [
  { name: 'rupees', value: { currency: 'INR', rate: null } },
  { name: 'taka', value: { currency: 'BDT', rate: '1.23' } },
] as const;

async function render(ui: ReactElement, display: (typeof DISPLAYS)[number]['value']) {
  const r = renderWithProviders(
    // The layout's provider, with the display the seller chose.
    <MoneyDisplayProvider value={display as never}>{ui}</MoneyDisplayProvider>,
    { fetchImpl: fetchMock() },
  );
  return r;
}

describe.each(DISPLAYS)('seller money strings — $name display', ({ value }) => {
  it('dashboard money cards', async () => {
    const r = await render(<DashboardView />, value);
    // Loaded when the balance card and both in-flight tiles show figures.
    await waitFor(() => expect(moneyStrings(r.container).shown.length).toBeGreaterThanOrEqual(3));
    await waitFor(() => expect(r.container.textContent).toContain('orders dispatched'));
    expect(moneyStrings(r.container)).toMatchSnapshot();
  });

  it('wallet ledger', async () => {
    const r = await render(<WalletPage />, value);
    await waitFor(() => expect(r.container.textContent).toContain('CN-2026-09-000004'));
    expect(moneyStrings(r.container)).toMatchSnapshot();
  });

  it('order charges band', async () => {
    const r = await render(<OrderChargesSection orderId="o1" />, value);
    await waitFor(() => expect(r.container.textContent).toContain('Total'));
    expect(moneyStrings(r.container)).toMatchSnapshot();
  });
});
