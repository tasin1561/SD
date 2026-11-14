'use client';

import type { ReactElement } from 'react';
import { SellerDetailView } from '../../../(authed)/sellers/_components/seller-detail';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * Test page for one client's detail screen, with invented but realistic
 * data: a long company name, bank details on file, overridden settings,
 * two courier accounts linked, an account hold.
 *
 *   ?fixture=a  approved client, some settings overridden, courier split
 *   b           suspended client with an account hold in force
 *   c           new client waiting for approval, nothing set yet
 *
 * Every write is refused: this page changes nothing.
 */
const FIXTURES = ['a', 'b', 'c'] as const;
type F = (typeof FIXTURES)[number];

const SELLER = {
  id: '01a1cf45-0000-73cf-8f7e-aaaaaaaaaaa2',
  email: 'accounts.payable.department@chittagong-home-lifestyle.example.com',
  emailDisplay: 'accounts.payable.department@chittagong-home-lifestyle.example.com',
  companyName: 'Chittagong Home & Lifestyle Exports Private Limited',
  initials: 'CHL',
  contactPersonName: 'Md. Abdullah Al Mamun Chowdhury',
  phone: '+8801712345678',
  whatsapp: '+8801812345678',
  approvedAt: ago(60 * 24 * 40),
  displayCurrency: 'BDT',
  displayLanguage: 'bn',
  countryCode: 'BD',
  emailVerifiedAt: ago(60 * 24 * 41),
  createdAt: ago(60 * 24 * 42),
  bankName: 'Dutch-Bangla Bank PLC',
  bankBranchName: 'Agrabad Commercial Area Branch, Chattogram',
  bankAccountName: 'Chittagong Home & Lifestyle Exports Private Limited',
  bankAccountNumberMasked: '••••••••4471',
  bankRoutingNumber: '090151234',
  bankSwiftCode: 'DBBLBDDH',
};

/** [key, type, system default, this client's override or undefined] */
const SETTINGS: ReadonlyArray<readonly [string, string, unknown, unknown?]> = [
  ['pricing.flat_delivery_fee', 'DECIMAL', '85.00', '79.00'],
  ['pricing.flat_delivery_fee_currency', 'STRING', 'INR'],
  ['pricing.flat_rto_fee', 'DECIMAL', '60.00'],
  ['pricing.flat_rto_fee_currency', 'STRING', 'INR'],
  ['pricing.customer_return_fee', 'DECIMAL', '70.00'],
  ['pricing.customer_return_fee_currency', 'STRING', 'INR'],
  ['wallet.cod_credit_mode', 'STRING', 'ON_SETTLEMENT', 'ON_DELIVERY'],
  ['wallet.cod_gst_percent', 'DECIMAL', '18.00'],
  ['wallet.cod_collection_fee_percent', 'DECIMAL', '2.00', '1.50'],
  ['wallet.instant_pay_fee_percent', 'DECIMAL', '1.00'],
  ['wallet.courier_fee_deduction_timing', 'STRING', 'ON_DISPATCH'],
  ['wallet.accrual_timing_tier', 'STRING', 'STANDARD'],
  ['wallet.accrual_delay_days', 'INTEGER', 7],
  ['wallet.minimum_balance_inr', 'DECIMAL', '0.00', '2000.00'],
  ['wallet.negative_balance_limit_inr', 'DECIMAL', '0.00'],
  ['wallet.withdrawal_min_threshold_inr', 'DECIMAL', '500.00'],
  ['wallet.withdrawal_max_per_day', 'INTEGER', 1],
  ['wallet.withdrawal_max_per_month', 'INTEGER', 8],
  ['wallet.auto_withdraw_enabled', 'BOOLEAN', false, true],
  ['wallet.auto_withdraw_hour_local', 'INTEGER', 10],
  ['wallet.auto_withdraw_keep_balance_inr', 'DECIMAL', '0.00'],
  ['wallet.auto_reject_unpayable_withdrawals', 'BOOLEAN', true],
  ['wallet.negative_balance_stock_backed', 'BOOLEAN', false],
  ['wallet.inbound_freight_mode', 'STRING', 'PAY_NOW'],
  ['wallet.inbound_freight_service_charge_percent', 'DECIMAL', '5.00'],
  ['ops.call_max_attempts_before_ndr', 'INTEGER', 3],
  ['ops.call_confirmation_required', 'BOOLEAN', true],
  ['ops.call_auto_confirm_ttl_hours', 'INTEGER', 24, 12],
  ['ops.call_retry_interval_hours', 'INTEGER', 4],
  ['ops.default_courier_code', 'STRING', 'delhivery'],
  ['ops.stock_reservation_ttl_hours', 'INTEGER', 48],
  ['reseller.orders_enabled', 'BOOLEAN', false, true],
  ['reseller.credit_after_confirmation_enabled', 'BOOLEAN', false],
  ['reseller.store_negative_limit_cap_inr', 'DECIMAL', '5000.00'],
  ['reseller.stock_reorder_days', 'INTEGER', 14],
  ['reseller.stock_forecast_window_days', 'INTEGER', 30],
];

const COURIER_ACCOUNTS = [
  ['ca1', 'delhivery', 'Delhivery — primary surface account', 'Kolkata Fulfilment Centre', true],
  ['ca2', 'shiprocket', 'Shiprocket — backup for remote pin codes', 'Kolkata FC (SR)', false],
  ['ca3', 'delhivery', 'Delhivery — heavy parcels', 'Kolkata Fulfilment Centre', false],
].map(([id, courierCode, label, pickupLocationName, isDefault]) => ({
  id,
  courierCode,
  environment: 'PRODUCTION',
  label,
  isDefault,
  isActive: true,
  pickupLocationName,
  payoutBankAccountId: null,
  notes: null,
  createdAt: ago(60 * 24 * 90),
  updatedAt: ago(60 * 24 * 3),
}));

const respond: Respond<F> = (fixture, req) => {
  if (req.method !== 'GET')
    return json({ code: 'DEV_PAGE', message: 'This is a test page. Nothing was changed.' }, 409);
  const p = req.path;
  if (/\/sellers\/[^/]+\/restriction$/.test(p)) {
    return json(
      fixture === 'b'
        ? {
            id: 'r1',
            blockedCapabilities: ['NEW_ORDERS', 'WITHDRAWALS'],
            clearAtBalanceInr: '0.00',
            balanceInr: '-12450.75',
            shortfallInr: '12450.75',
            reason: 'Wallet has been negative for 21 days after three returned COD parcels.',
            createdAt: ago(60 * 24 * 2),
          }
        : null,
    );
  }
  if (/\/sellers\/[^/]+\/settings$/.test(p)) {
    return json(
      SETTINGS.map(([key, valueType, systemDefault, override]) => {
        const overridden = fixture !== 'c' && override !== undefined;
        return {
          key,
          valueType,
          value: overridden ? override : systemDefault,
          source: overridden ? 'SELLER_OVERRIDE' : 'SYSTEM_DEFAULT',
          systemDefault,
          updatedAt: overridden ? ago(60 * 24 * 5) : null,
          setByStaffId: overridden ? 'staff-1' : null,
          setBySellerId: null,
        };
      }),
    );
  }
  if (/\/sellers\/[^/]+\/courier-accounts$/.test(p)) {
    return json(
      fixture === 'c'
        ? []
        : [
            ['l1', 'ca1', 70, true],
            ['l2', 'ca2', 30, true],
            ['l3', 'ca3', 0, false],
          ].map(([id, courierAccountId, distributionWeight, isActive]) => ({
            id,
            sellerId: SELLER.id,
            courierAccountId,
            distributionWeight,
            isActive,
            createdAt: ago(60 * 24 * 30),
          })),
    );
  }
  if (p.startsWith('/api/admin/courier-accounts')) return json(COURIER_ACCOUNTS);
  if (p.endsWith('/reseller-credit-after-confirmation')) {
    return json({
      sellerId: SELLER.id,
      enabled: fixture === 'a',
      source: fixture === 'a' ? 'SELLER_OVERRIDE' : 'SYSTEM_DEFAULT',
      flaggedStores:
        fixture === 'a'
          ? [{ storeId: 'st1', storeName: 'Rupa Boutique — Sylhet', version: 3 }]
          : [],
    });
  }
  if (/\/api\/admin\/sellers\/[^/]+$/.test(p)) {
    return json({
      ...SELLER,
      status: fixture === 'b' ? 'SUSPENDED' : fixture === 'c' ? 'PENDING' : 'APPROVED',
      approvedAt: fixture === 'c' ? null : SELLER.approvedAt,
      whatsapp: fixture === 'c' ? null : SELLER.whatsapp,
    });
  }
  return json([]);
};

export default function ClientHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => [
        'sellers.view',
        'sellers.approve',
        'sellers.suspend',
        'sellers.invite',
        'sellers.bank_account.reveal',
        'sellers.courier_links.manage',
        'courier.accounts.view',
        'money.view',
        'money.wallet.transfer',
        'support.impersonate',
        'callcenter.queue.manage',
        'reseller.credit_after_confirmation.enable',
        'settings.view',
        'settings.manage',
        'orders.view',
      ]}
    >
      <SellerDetailView sellerId={SELLER.id} />
    </EasyHarness>
  );
}
