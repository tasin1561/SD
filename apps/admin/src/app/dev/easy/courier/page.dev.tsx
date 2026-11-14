'use client';

import { Suspense, type ReactElement } from 'react';
import { useSearchParams } from 'next/navigation';
import { CourierAccountsIndex } from '../../../(authed)/courier-accounts/_components/courier-accounts-index';
import { DelhiveryOpsIndex } from '../../../(authed)/delhivery/_components/delhivery-ops-index';
import { ShiprocketOpsIndex } from '../../../(authed)/shiprocket/_components/shiprocket-ops-index';
import { CourierEscalationIndex } from '../../../(authed)/courier-escalation/_components/courier-escalation-index';
import { CostSyncIndex } from '../../../(authed)/cost-sync/_components/cost-sync-index';
import { CourierPortalIndex } from '../../../(authed)/courier-escalation/portal/_components/portal-index';
import { CourierTemplatesIndex } from '../../../(authed)/courier-escalation/templates/_components/templates-index';
import { CourierWalletIndex } from '../../../(authed)/courier-wallet/_components/courier-wallet-index';
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
 *   f           cost sync (wallet ledger runs, Shiprocket runs and parcels)
 *   g           courier portal (runs and their ticket categories)
 *   h           reply templates (live patterns and new messages seen)
 *   i           courier wallet (payments to match, balances, recharges)
 *
 * Every write is refused: this page changes nothing.
 */
const FIXTURES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] as const;
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

/** One wallet-ledger sync account result; `bad` is a run that failed. */
const syncAccount = (bad: boolean): Record<string, unknown> => ({
  label: 'Delhivery — primary surface account',
  courierAccountId: 'ca1',
  error: bad ? 'The courier portal asked for a sign-in code and none arrived in time.' : null,
  fileBytes: bad ? null : 184_220,
  rowsRead: bad ? null : 1284,
  awbsInFile: bad ? null : 1190,
  unknownAwbs: bad ? null : 3,
  forwardWritten: bad ? null : 212,
  rtoWritten: bad ? null : 18,
  revised: bad ? null : 4,
  unchanged: bad ? null : 953,
  sumInr: bad ? null : '148220.50',
  statedTotalInr: bad ? null : '148220.50',
  totalsAgree: bad ? null : true,
  periodFrom: bad ? null : ago(60 * 24 * 7),
  periodTo: bad ? null : ago(60),
  coveredDays: bad ? null : 7,
  rangeApplied: bad ? null : true,
  dryRun: false,
  writes: [],
  writesTruncated: 0,
  txnsMissing: 0,
  failureArtifact: null,
});

const SYNC_RUNS = Array.from({ length: 20 }, (_, i) => ({
  at: ago(60 * 12 * (i + 1)),
  ok: i !== 2 && i !== 9,
  skipped: i === 5 ? 'Another run was still in progress.' : null,
  wrote: i !== 2 && i !== 5 && i !== 9,
  windowDays: 7,
  accounts: i === 5 ? [] : [syncAccount(i === 2 || i === 9)],
}));

const SR_COST_RUNS = Array.from({ length: 6 }, (_, i) => ({
  at: ago(60 * 6 * (i + 1)),
  ok: i !== 3,
  trigger: i === 0 ? 'manual' : 'schedule',
  skipped: null,
  error: i === 3 ? 'Shiprocket answered 429 (too many requests). The next run retries.' : null,
  accounts:
    i === 3
      ? []
      : [
          {
            label: 'Shiprocket — backup for remote pin codes',
            courierAccountId: 'ca2',
            error: null,
            balanceInr: '18420.50',
            previousBalanceInr: '19960.50',
            balanceChangeInr: '-1540.00',
            parcelChargeChangeInr: '-1480.00',
            unexplainedInr: '-60.00',
            parcelsRead: 46,
            readingsStored: 46,
            unreadable: 0,
            failed: 0,
            finalCount: 31,
            provisionalOnly: 15,
            ledgerAgrees: 29,
            ledgerDisagrees: 1,
            ledgerUncovered: 1,
            disagreements: [],
          },
        ],
}));

const SR_PARCELS = Array.from({ length: 8 }, (_, i) => ({
  shipmentId: `sh${i}`,
  orderNumber: `SD-2026-26-0000${70 + i}`,
  awbNumber: i === 7 ? null : `SRKA00012345${i}`,
  theirStatus: ['DELIVERED', 'IN TRANSIT', 'RTO DELIVERED', 'OUT FOR DELIVERY'][i % 4],
  provisionalInr: ['62.00', '74.50', '118.00', '62.00'][i % 4],
  billedInr: i % 3 === 0 ? ['62.00', '74.50', '121.40', '62.00'][i % 4] : null,
  recordedForwardInr: i % 2 === 0 ? '62.00' : null,
  recordedRtoInr: i % 4 === 2 ? '56.00' : null,
  readAt: ago(60 * (i + 1)),
  readings: i + 1,
}));

const PORTAL_RUNS = Array.from({ length: 30 }, (_, i) => ({
  id: `run${i}`,
  kind: ['READ_TICKETS', 'POST_COMMENT', 'RAISE_TICKET', 'READ_CATEGORIES'][i % 4],
  mode: i % 5 === 0 ? 'LIVE' : 'SHADOW',
  outcome: i % 7 === 3 ? 'FAILED' : i % 6 === 4 ? 'SKIPPED' : 'OK',
  detail:
    i % 7 === 3
      ? 'The ticket page did not finish loading within 45 seconds; nothing was posted.'
      : i % 6 === 4
        ? 'Channel was paused.'
        : null,
  startedAt: ago(30 * (i + 1)),
}));

const TAXONOMY = [
  ['behaviour-complaint', 'Behaviour complaint against delivery staff', true],
  ['claims-finance', 'Claims / Finance (disputes and lost-parcel claims)', true],
  ['reattempt', 'Request a delivery re-attempt', false],
  ['address-update', 'Address or phone number update', false],
  ['fake-attempt', 'Delivery attempt marked but customer was not contacted', false],
  ['pickup-delay', 'Pickup not done on the scheduled day', false],
].map(([externalId, label, isHumanOnly], i) => ({
  externalId,
  label,
  isHumanOnly,
  lastSeenAt: ago(60 * 24 * (i + 1)),
}));

const TEMPLATES = [
  ['REQ_ALT_PHONE', 'alternate (contact|phone) number', 'WAITING_US', 'ASK_SELLER_PHONE', 10],
  ['OFD_TODAY', 'out for delivery today', 'WAITING_COURIER', null, 20],
  ['BEHAVIOUR_ACK', 'we regret the inconvenience.*escalated', 'WAITING_COURIER', null, 30],
  ['POD_SHARED', 'proof of delivery (is )?attached', 'RESOLVED', 'CLOSE', 40],
].map(([code, pattern, state, action, priority], i) => ({
  id: `tpl${i}`,
  code,
  pattern,
  state,
  action,
  priority,
  isActive: i !== 2,
}));

const CANDIDATES = [
  'Dear customer, your shipment has been rescheduled for delivery on the next working day. Kindly ensure availability at the address.',
  'We have forwarded your concern to the delivery centre. You will receive an update within 24 to 48 hours.',
  'Consignee refused to accept the shipment. Please confirm whether to reattempt or return to origin.',
].map((body, i) => ({
  id: `cand${i}`,
  body,
  seenCount: [14, 6, 3][i],
  status: 'NEW',
  suggestedRegex: i === 2 ? 'consignee refused' : null,
  suggestedState: i === 2 ? 'WAITING_US' : null,
  firstSeenAt: ago(60 * 24 * (9 - i)),
  lastSeenAt: ago(60 * (i + 2)),
}));

const WALLET_ACCOUNTS = [
  ['ca1', 'Delhivery — primary surface account', 'delhivery', '9031.53', 2, 1],
  ['ca2', 'Shiprocket — backup for remote pin codes', 'shiprocket', '18420.50', 0, 0],
].map(([courierAccountId, label, courierCode, balanceInr, unrecordedCount, mismatchCount]) => ({
  courierAccountId,
  label,
  courierCode,
  balanceInr,
  capturedAt: ago(42),
  statedCreditInr: '250000.00',
  statedDebitInr: '231579.50',
  unrecordedCount,
  mismatchCount,
}));

const RECHARGES = Array.from({ length: 14 }, (_, i) => ({
  id: `rc${i}`,
  courierAccountId: i % 3 === 2 ? 'ca2' : 'ca1',
  accountLabel:
    i % 3 === 2
      ? 'Shiprocket — backup for remote pin codes'
      : 'Delhivery — primary surface account',
  externalTxnId: `TXN2611${String(13000 + i * 37)}`,
  bankTxnRef: i % 4 === 0 ? null : `UTR26111${String(40000 + i * 91)}`,
  amountInr: ['25000.00', '50000.00', '10000.00', '25000.00'][i % 4],
  status: 'SUCCESS',
  occurredAt: ago(60 * 20 * (i + 1)),
  matchState: (['UNRECORDED', 'MATCHED', 'AMOUNT_MISMATCH', 'MATCHED', 'RESOLVED'] as const)[i % 5],
  bankEntryId: i % 5 === 0 ? null : `be${i}`,
  bankAmountInr:
    i % 5 === 2
      ? '24990.00'
      : i % 5 === 0
        ? null
        : ['25000.00', '50000.00', '10000.00', '25000.00'][i % 4],
  bankAccountLabel: i % 5 === 0 ? null : 'ICICI — expenses',
  resolutionNote: i % 5 === 4 ? 'Bank charged ₹10 on the transfer; accepted as is.' : null,
  resolvedAt: i % 5 === 4 ? ago(60 * 3) : null,
}));

const UNMATCHED = [0, 1, 2].map((i) => ({
  bankEntryId: `ube${i}`,
  accountLabel: 'ICICI — expenses',
  amountInr: ['25000.00', '10000.00', '50000.00'][i],
  reference: i === 1 ? null : `UTR26111${String(70000 + i * 13)}`,
  occurredAt: ago(60 * 24 * (i + 1)),
  note: i === 2 ? 'Recharge for the Diwali week volume.' : null,
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
  if (p === '/api/admin/courier-portal/wallet-sync') {
    return json({
      enabled: true,
      writesEnabled: true,
      windowDays: 7,
      schedule: 'Every 12 hours',
      last: SYNC_RUNS[0],
      history: SYNC_RUNS,
      cost: {
        dispatched: 1284,
        withForwardCost: 1241,
        returned: 96,
        withRtoCost: 88,
        forwardTotalInr: '92840.50',
        rtoTotalInr: '6120.00',
      },
    });
  }
  if (p === '/api/admin/courier-cost/shiprocket') {
    return json({
      enabled: true,
      writesEnabled: true,
      stubMode: false,
      schedule: 'Every 6 hours',
      balances: [
        {
          courierAccountId: 'ca2',
          label: 'Shiprocket — backup for remote pin codes',
          balanceInr: '18420.50',
          capturedAt: ago(42),
        },
      ],
      last: SR_COST_RUNS[0],
      history: SR_COST_RUNS,
      parcels: SR_PARCELS,
      portalProbe: null,
      walletSyncs: [],
      invoiceChecks: [],
      egress: {
        proxy: null,
        checked: true,
        expectedCountry: 'IN',
        status: 'UP',
        publicIp: '203.0.113.24',
        country: 'IN',
        summary: 'Reached Shiprocket from India.',
        countryMismatch: false,
      },
    });
  }
  if (p === '/api/admin/courier-escalation/portal-runs') return json(PORTAL_RUNS);
  if (p === '/api/admin/courier-escalation/taxonomy') return json(TAXONOMY);
  if (p === '/api/admin/courier-escalation/templates') return json(TEMPLATES);
  if (p === '/api/admin/courier-escalation/template-candidates') return json(CANDIDATES);
  if (p === '/api/admin/courier-wallet/accounts') return json({ accounts: WALLET_ACCOUNTS });
  if (p.startsWith('/api/admin/courier-wallet/recharges')) return json({ recharges: RECHARGES });
  if (p === '/api/admin/courier-wallet/unmatched-payments') return json({ payments: UNMATCHED });
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
    case 'f':
      return <CostSyncIndex />;
    case 'g':
      return <CourierPortalIndex />;
    case 'h':
      return <CourierTemplatesIndex />;
    case 'i':
      return <CourierWalletIndex />;
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
        'money.treasury.view',
      ]}
    >
      <Suspense fallback={null}>
        <Screen />
      </Suspense>
    </EasyHarness>
  );
}
