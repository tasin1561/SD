'use client';

import type { ReactElement } from 'react';
import { TreasuryIndex } from '../../../(authed)/treasury/_components/treasury-index';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * /dev/easy/treasury — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1). Invented
 * accounts and movements; every write is refused, so nothing here can
 * reach a real bank book.
 *
 *   ?fixture=a  three accounts, eight movements   b  nothing recorded yet
 */
const FIXTURES = ['a', 'b'] as const;
type F = (typeof FIXTURES)[number];

const ACCOUNTS = [
  [
    'HDFC — COD receiving account for courier payouts',
    'HDFC Bank',
    'INR',
    '625000.00',
    '549006.00',
    '75994.00',
  ],
  ['City Bank — owner capital', 'City Bank PLC', 'BDT', '13226900.00', '10345888.00', '2881012.00'],
  ['ICICI — expenses', 'ICICI Bank', 'INR', '48250.50', '48250.50', '0.00'],
].map(([label, bankName, currency, total, capital, sellerHeld], i) => ({
  accountId: `acc${i}`,
  label,
  bankName,
  purpose: i === 0 ? 'Courier COD payouts' : null,
  courierAccountLabel: i === 0 ? 'Delhivery — primary, Shiprocket — primary' : null,
  currency,
  total,
  capital,
  sellerHeld,
  bySeller:
    i === 2
      ? []
      : [
          { sellerId: 's1', companyName: 'Dhaka Threads Ltd', amount: '51210.00' },
          {
            sellerId: 's2',
            companyName: 'Chittagong Home & Lifestyle Exports Private Limited',
            amount: '24784.00',
          },
        ],
}));

const OVERVIEW = {
  accounts: ACCOUNTS,
  totals: {
    byCurrency: [
      { currency: 'INR', total: '673250.50', capital: '597256.50', sellerHeld: '75994.00' },
      { currency: 'BDT', total: '13226900.00', capital: '10345888.00', sellerHeld: '2881012.00' },
    ],
  },
  clientMoney: {
    owedToSellersInr: '2418280.00',
    heldForSellersInr: '2418280.00',
    gapInr: '0.00',
    covered: true,
  },
  courierWallets: {
    accounts: [
      {
        courierAccountId: 'c1',
        label: 'Delhivery — primary',
        balanceInr: '9031.53',
        capturedAt: ago(30),
      },
    ],
    totalInr: '9031.53',
  },
};

const TYPES = [
  'COD_SETTLEMENT',
  'REMITTANCE',
  'EXPENSE',
  'OWNER_INVESTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'COURIER_TOPUP',
  'RECONCILIATION',
];

const ENTRIES = TYPES.map((type, i) => ({
  id: `e${i}`,
  accountLabel: ACCOUNTS[i % 3]?.label,
  type,
  signedAmount: `${i % 2 === 0 ? '' : '-'}${(i + 1) * 12500}.00`,
  currency: i % 3 === 1 ? 'BDT' : 'INR',
  ownerKind: i % 2 === 0 ? 'SELLER' : 'CAPITAL',
  sellerName: i % 2 === 0 ? 'Chittagong Home & Lifestyle Exports Private Limited' : null,
  categoryName: type === 'EXPENSE' ? 'Warehouse rent and utilities' : null,
  categoryCode: type === 'EXPENSE' ? 'RENT' : null,
  reference: i === 1 ? 'UTR202611130000123456789' : null,
  note: i === 2 ? 'November rent for the Kolkata warehouse, paid by bank transfer.' : null,
  occurredAt: ago(60 * 20 * (i + 1)),
  recordedByName: 'finance@skydrop.global',
  recordedAt: ago(60 * 20 * (i + 1) - 10),
  inboundFreightChargeId: null,
  isOpeningBalance: false,
}));

const respond: Respond<F> = (fixture, req) => {
  if (req.method !== 'GET')
    return json({ code: 'DEV_PAGE', message: 'This is a test page. Nothing was changed.' }, 409);
  if (req.path === '/api/admin/treasury/overview')
    return json(
      fixture === 'b'
        ? { ...OVERVIEW, accounts: [], courierWallets: { accounts: [], totalInr: '0.00' } }
        : OVERVIEW,
    );
  if (req.path === '/api/admin/treasury/entries') {
    const items = fixture === 'b' ? [] : ENTRIES;
    return json({ items, total: items.length, nextCursor: null });
  }
  return json([]);
};

export default function TreasuryHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => [
        'money.treasury.view',
        'money.treasury.manage',
        'money.view',
        'sellers.view',
      ]}
    >
      <TreasuryIndex />
    </EasyHarness>
  );
}
