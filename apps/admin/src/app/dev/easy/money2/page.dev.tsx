'use client';

import { Suspense, useEffect, useState, type ReactElement } from 'react';
import { SellerWalletsIndex } from '../../../(authed)/seller-wallets/_components/seller-wallets-index';
import { SettlementsIndex } from '../../../(authed)/settlements/_components/settlements-index';
import { WalletTransfersIndex } from '../../../(authed)/wallet-transfers/_components/wallet-transfers-index';
import { ResellerStoreWalletsIndex } from '../../../(authed)/reseller-store-wallets/_components/reseller-store-wallets-index';
import { TreasuryIndex } from '../../../(authed)/treasury/_components/treasury-index';
import { CourierWalletIndex } from '../../../(authed)/courier-wallet/_components/courier-wallet-index';
import { PnlIndex } from '../../../(authed)/pnl/_components/pnl-index';
import { CarryForwardIndex } from '../../../(authed)/pnl/carry-forward/_components/carry-forward-index';
import { ExpensesIndex } from '../../../(authed)/expenses/_components/expenses-index';
import { ExpenseCategoriesIndex } from '../../../(authed)/expenses/categories/_components/expense-categories-index';
import { LiabilitiesIndex } from '../../../(authed)/liabilities/_components/liabilities-index';
import { InstantPayAdvances } from '../../../(authed)/liabilities/instant-pay/_components/instant-pay-advances';
import { BankAccountsPanel } from '../../../(authed)/bank-accounts/_bank-accounts-panel';
import { BankAccountHistoryIndex } from '../../../(authed)/bank-accounts/history/_components/bank-account-history-index';
import { RemittancesIndex } from '../../../(authed)/remittances/_components/remittances-index';
import { BankChangesIndex } from '../../../(authed)/bank-changes/_components/bank-changes-index';
import { FreightIndex } from '../../../(authed)/freight/_components/freight-index';
import { MarginIndex } from '../../../(authed)/margin/_components/margin-index';
import { PricingIndex } from '../../../(authed)/pricing/_components/pricing-index';
import { FxRatesIndex } from '../../../(authed)/fx/_components/fx-rates-index';
import { EasyHarness, json, type Respond } from '../harness';

/**
 * /dev/easy/money2 — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1). Mock data
 * only, EMPTY lists: headers, filters and forms, for a phone-size check.
 * Every write is refused, so nothing here can reach a real wallet.
 *
 *   a  SellerWalletsIndex
 *   b  SettlementsIndex
 *   c  WalletTransfersIndex
 *   d  ResellerStoreWalletsIndex
 *   e  TreasuryIndex
 *   f  CourierWalletIndex
 *   g  PnlIndex
 *   h  CarryForwardIndex
 *   i  ExpensesIndex
 *   j  ExpenseCategoriesIndex
 *   k  LiabilitiesIndex
 *   l  InstantPayAdvances
 *   m  BankAccountsPanel
 *   n  BankAccountHistoryIndex
 *   o  RemittancesIndex
 *   p  BankChangesIndex
 *   q  FreightIndex
 *   r  MarginIndex
 *   s  PricingIndex
 *   t  FxRatesIndex
 */
const FIXTURES = [
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'q',
  'r',
  's',
  't',
] as const;
type F = (typeof FIXTURES)[number];

const PERMISSIONS = [
  'fx.manage',
  'fx.view',
  'inventory.view',
  'money.bank_accounts.manage',
  'money.freight.manage',
  'money.pnl.close',
  'money.remittances.manage',
  'money.settlements.record',
  'money.topups.review',
  'money.treasury.manage',
  'money.treasury.view',
  'money.view',
  'money.wallets.reconcile',
  'money.withdrawals.review',
  'orders.charges.compute',
  'sellers.bank_change.approve',
  'sellers.view',
];

/** Screens whose data is not a plain list: they are shown in their "could
 *  not load" state, which still draws the header, filters and actions. */
const NOT_MOCKED: ReadonlySet<string> = new Set(['a', 'b', 'e', 'f', 'g', 'h', 'k', 'r']);

/** Screens whose lists arrive as a bare array. */
const ARRAYS: ReadonlySet<string> = new Set(['d', 'i', 'j', 'm', 'n', 'q', 't']);

const respond: Respond<F> = (fixture, req) => {
  if (req.method !== 'GET')
    return json({ code: 'DEV_PAGE', message: 'This is a test page. Nothing was changed.' }, 409);
  if (NOT_MOCKED.has(fixture)) return undefined;
  if (ARRAYS.has(fixture)) return json([]);
  return json({ items: [], total: 0, page: 1, pageSize: 20 });
};

function Screen(): ReactElement | null {
  const [fixture, setFixture] = useState<string | null>(null);
  useEffect(() => {
    setFixture(new URLSearchParams(window.location.search).get('fixture') ?? 'a');
  }, []);
  switch (fixture) {
    case null:
      return null;
    case 'a':
      return <SellerWalletsIndex />;
    case 'b':
      return <SettlementsIndex />;
    case 'c':
      return <WalletTransfersIndex initialSellerId={null} />;
    case 'd':
      return <ResellerStoreWalletsIndex />;
    case 'e':
      return <TreasuryIndex />;
    case 'f':
      return <CourierWalletIndex />;
    case 'g':
      return <PnlIndex />;
    case 'h':
      return <CarryForwardIndex />;
    case 'i':
      return <ExpensesIndex />;
    case 'j':
      return <ExpenseCategoriesIndex />;
    case 'k':
      return <LiabilitiesIndex />;
    case 'l':
      return <InstantPayAdvances initialSellerId="" initialCourierAccountId="" />;
    case 'm':
      return <BankAccountsPanel />;
    case 'n':
      return <BankAccountHistoryIndex />;
    case 'o':
      return <RemittancesIndex />;
    case 'p':
      return <BankChangesIndex />;
    case 'q':
      return <FreightIndex />;
    case 'r':
      return <MarginIndex />;
    case 's':
      return <PricingIndex />;
    case 't':
      return <FxRatesIndex />;
    default:
      return null;
  }
}

export default function Money2Harness(): ReactElement {
  return (
    <EasyHarness fixtures={FIXTURES} respond={respond} permissions={() => PERMISSIONS}>
      <Suspense fallback={null}>
        <Screen />
      </Suspense>
    </EasyHarness>
  );
}
