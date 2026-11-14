'use client';

import { Suspense, type ReactElement } from 'react';
import { useSearchParams } from 'next/navigation';
import { CourierAccountsIndex } from '../../../(authed)/courier-accounts/_components/courier-accounts-index';
import { DelhiveryOpsIndex } from '../../../(authed)/delhivery/_components/delhivery-ops-index';
import { ShiprocketOpsIndex } from '../../../(authed)/shiprocket/_components/shiprocket-ops-index';
import { CourierEscalationIndex } from '../../../(authed)/courier-escalation/_components/courier-escalation-index';
import { CourierThreadsIndex } from '../../../(authed)/courier-escalation/threads/_components/threads-index';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * Test page for the courier screens, with invented but realistic data.
 *
 *   ?fixture=a  courier accounts (three accounts, one paused)
 *   b           Delhivery (waybill pool running low, tracking poll stale)
 *   c           Shiprocket (two accounts, nine recent bookings)
 *   d           courier messages waiting to be sent by hand
 *   e           conversations with couriers
 *
 * Every write is refused: this page changes nothing.
 */
const FIXTURES = ['a', 'b', 'c', 'd', 'e'] as const;
type F = (typeof FIXTURES)[number];

const ACCOUNTS = [
  [
    'ca1',
    'delhivery',
    'Delhivery — primary surface account',
    'Kolkata Fulfilment Centre',
    true,
    true,
  ],
  ['ca2', 'shiprocket', 'Shiprocket — backup for remote pin codes', 'Kolkata FC (SR)', false, true],
  [
    'ca3',
    'delhivery',
    'Delhivery — heavy parcels above 10 kg',
    'Kolkata Fulfilment Centre',
    false,
    false,
  ],
].map(([id, courierCode, label, pickupLocationName, isDefault, isActive]) => ({
  id,
  courierCode,
  environment: 'PRODUCTION',
  label,
  isDefault,
  isActive,
  pickupLocationName,
  payoutBankAccountId: id === 'ca1' ? 'bank1' : null,
  notes: id === 'ca3' ? 'Paused until the heavy-parcel rate card is renewed.' : null,
  createdAt: ago(60 * 24 * 90),
  updatedAt: ago(60 * 24 * 3),
}));

const COURIERS = [
  ['delhivery', 'Delhivery'],
  ['shiprocket', 'Shiprocket'],
].map(([code, name]) => ({
  code,
  name,
  isActive: true,
  supportsCod: true,
  supportsPrepaid: true,
  integrationType: 'API',
}));

const BOOKING_STATES = [
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'RTO_IN_TRANSIT',
  'DELIVERY_ATTEMPTED',
  'PICKED_UP',
  'DELIVERED',
  'RTO_DELIVERED',
  'BOOKED',
];

const QUEUE = [0, 1, 2].map((i) => ({
  id: `q${i}`,
  escalationId: `esc${i}`,
  kind: i === 2 ? 'RAISE_TICKET' : 'COMMENT',
  status: ['PENDING', 'SENT_UNCONFIRMED', 'FAILED'][i],
  body: [
    'Customer confirms she is at home today and tomorrow between 10 am and 6 pm. Please attempt delivery again and call 98XXXXXX21 before reaching.',
    'The address is correct. Landmark: opposite City Centre mall, second lane. Please reattempt.',
    'Parcel marked delivered but the customer has not received it. Please share proof of delivery.',
  ][i],
  categoryId: ['reattempt', 'address', 'fake-delivery'][i],
  awbNumber: `2946101234567${i}`,
  externalTicketId: i === 1 ? 'DLV-TKT-88213' : null,
  orderId: `ord${i}`,
  sellerId: 's1',
  sellerName: i === 1 ? 'Chittagong Home & Lifestyle Exports Private Limited' : 'Dhaka Threads Ltd',
  deepLink: 'https://example.com/courier-panel',
  courierCode: 'delhivery',
  courierName: 'Delhivery',
  supportPanelUrl: 'https://example.com/courier-panel',
  supportEmail: 'support@courier.example.com',
  supportEmailSettingKey: 'courier.delhivery.support_email',
  supportHowTo: 'Open the courier panel, find the waybill, and paste the message as a comment.',
  claimedByStaffId: null,
  claimExpiresAt: null,
  createdAt: ago(60 * (i + 1) * 5),
  lastError: i === 2 ? 'The courier panel did not accept the message. Try again.' : null,
}));

const THREADS = [0, 1, 2, 3].map((i) => ({
  id: `esc${i}`,
  awbNumber: `2946101234567${i}`,
  externalTicketId: i % 2 === 0 ? `DLV-TKT-8821${i}` : null,
  courierCode: i === 3 ? 'shiprocket' : 'delhivery',
  courierName: i === 3 ? 'Shiprocket' : 'Delhivery',
  state: ['OPEN', 'WAITING_COURIER', 'RESOLVED', 'OPEN'][i],
  lastMessageAt: ago(60 * (i + 1) * 9),
  needsReviewAt: i === 0 ? ago(30) : null,
  sellerName: i === 1 ? 'Chittagong Home & Lifestyle Exports Private Limited' : 'Dhaka Threads Ltd',
  messageCount: [5, 2, 8, 1][i],
}));

const respond: Respond<F> = (_fixture, req) => {
  if (req.method !== 'GET')
    return json({ code: 'DEV_PAGE', message: 'This is a test page. Nothing was changed.' }, 409);
  const p = req.path;
  if (p.startsWith('/api/admin/courier-accounts')) return json(ACCOUNTS);
  if (p.startsWith('/api/admin/couriers')) return json({ couriers: COURIERS });
  if (p === '/api/admin/delhivery/status') {
    return json({
      liveMode: true,
      liveWritesEnabled: true,
      waybillPool: { available: 180, usableNow: 164, assigned: 46, used: 12840, void: 37 },
      rateBudgets: [
        ['Waybill fetch (bulk) — package creation', 750, 12],
        ['Tracking — pull by waybill', 750, 520],
        ['Pickup request', 4000, 3991],
        ['Pin code serviceability', 4500, 4020],
      ].map(([endpoint, budget, remaining]) => ({ endpoint, budget, remaining })),
    });
  }
  if (p === '/api/admin/tracking/poll/health') {
    return json({
      lastRunAtIso: ago(95),
      minutesSinceLastRun: 95,
      cronPattern: '*/30 * * * *',
      stale: true,
    });
  }
  if (p === '/api/admin/shiprocket/status') {
    return json({
      liveMode: true,
      liveWritesEnabled: true,
      intakeEnabled: true,
      returnAddressConfigured: false,
      accounts: [
        [
          'ca2',
          'Shiprocket — backup for remote pin codes',
          true,
          'Kolkata FC (SR)',
          '18420.50',
          ago(42),
        ],
        ['ca4', 'Shiprocket — second login for heavy parcels', false, null, null, null],
      ].map(([courierAccountId, label, isActive, pickupLocationName, walletBalanceInr, at]) => ({
        courierAccountId,
        label,
        isActive,
        pickupLocationName,
        walletBalanceInr,
        walletBalanceAt: at,
      })),
      lastWalletSync: { at: ago(42), ok: true },
      lastInvoiceCheck: { at: ago(60 * 26), ok: false },
      recentBookings: BOOKING_STATES.map((status, i) => ({
        shipmentId: `sh${i}`,
        shipmentNumber: `SH-2026-11-0000${40 + i}`,
        awbNumber: i === 8 ? null : `SRKA00012345${i}`,
        carrierName: ['Xpressbees Surface', 'Delhivery Surface 2 kg', 'Ekart Logistics'][i % 3],
        status,
        bookedAt: i === 8 ? null : ago(60 * (i + 1) * 3),
        createdAt: ago(60 * (i + 1) * 3 + 10),
      })),
    });
  }
  if (p === '/api/admin/courier-escalation/outbox') return json(QUEUE);
  if (p === '/api/admin/courier-escalation/escalations') return json(THREADS);
  if (p === '/api/admin/courier-escalation/channel') {
    return json({
      settings: {
        courierCode: 'delhivery',
        writeMode: 'SUPERVISED',
        portalMode: 'SHADOW',
        autoCategories: ['reattempt'],
        pausedUntil: null,
        pauseReason: null,
        effectivelyPaused: false,
        updatedAt: ago(60 * 24),
      },
      capabilities: { comment: true, raiseTicket: true },
      lockedCategoryLabels: ['Claims / Finance', 'Behaviour complaint against staff'],
      counts: { pending: 1, sending: 0, sentUnconfirmed: 1, confirmedToday: 14, failedToday: 1 },
    });
  }
  return json([]);
};

function Screen(): ReactElement | null {
  const fixture = useSearchParams().get('fixture') ?? 'a';
  switch (fixture) {
    case 'a':
      return <CourierAccountsIndex />;
    case 'b':
      return <DelhiveryOpsIndex />;
    case 'c':
      return <ShiprocketOpsIndex />;
    case 'd':
      return <CourierEscalationIndex />;
    case 'e':
      return <CourierThreadsIndex />;
    default:
      return null;
  }
}

export default function CourierHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => [
        'courier.accounts.manage',
        'courier.accounts.view',
        'courier.ops.view',
        'courier.ops.write',
        'money.view',
        'money.treasury.manage',
        'orders.tracking.run_poll',
        'orders.view',
        'sellers.view',
      ]}
    >
      <Suspense fallback={null}>
        <Screen />
      </Suspense>
    </EasyHarness>
  );
}
