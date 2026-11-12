/**
 * Fixtures for /dev/order-detail. DEV ONLY — nothing imports this from a
 * production route (the page that does is `page.dev.tsx`, compiled only
 * under APPS_DEV_ROUTES=1).
 *
 * Each fixture answers every request the seller order page makes, so the
 * REAL page, hooks and dialogs run against it.
 */
export type FixtureId =
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r';
export const FIXTURE_IDS: readonly FixtureId[] = [
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
];

type Json = Record<string, unknown>;

export interface Fixture {
  readonly permissions: readonly string[];
  readonly order: Json;
  readonly journey: Json;
  readonly charges: readonly Json[];
  /** null = 404 "no invoice yet". */
  readonly invoice: Json | null;
  readonly reattempts: { requests: Json[]; canRequest: boolean };
  readonly deliveryActions: { items: Json[]; canRequest: boolean };
  readonly calls: { items: Json[] };
  /** null = 404 "never checked". */
  readonly check: Json | null;
  readonly tickets: Json[];
  /** null = 404 (not a reseller order). */
  readonly resellerMoney: Json | null;
  readonly holdReviews: Json[];
}

export const DEV_ORDER_ID = '01900000-0000-7000-8000-000000000070';

const ALL = [
  'orders.view',
  'orders.create',
  'orders.cancel',
  'charges.view',
  'tickets.create',
  'tickets.view',
  'holds.manage',
  'stores.order_money.view',
];

const ITEM = {
  id: 'it-1',
  variantId: 'v-1',
  productName: 'Aviator OG Sunglass',
  variantLabel: 'Black / Golden',
  imageUrl: null,
  skuCode: 'AVIATO-BLAC-GOLD',
  quantity: 1,
  unitWeightGrams: 500,
  unitDeclaredValueInr: '1050.00',
  unitPriceInr: '1050.00',
  qtyReserved: 1,
};

function baseOrder(over: Json = {}): Json {
  return {
    id: DEV_ORDER_ID,
    orderNumber: 'SD-2026-26-000070',
    sellerOrderRef: 'MY-Afrin-MS',
    sellerId: 'seller-1',
    storeId: null,
    storeKind: 'CHANNEL',
    status: 'CONFIRMED',
    source: 'API',
    recipientName: 'Sumon Das',
    recipientPhoneE164: '+919883596606',
    recipientAltPhoneE164: null,
    recipientEmail: null,
    recipientAddressLine1: 'Village Sovapur, P.O. Deonapur, P.S. Baishnabnagar',
    recipientAddressLine2: 'Malda',
    recipientLandmark: 'Sovapur Primary School',
    recipientCity: 'Dhulian',
    recipientStateProvince: 'West Bengal',
    recipientPostalCode: '732210',
    recipientCountryCode: 'IN',
    paymentMode: 'COD',
    codAmountInr: '1050.00',
    advanceAmountInr: null,
    deliveryFeeInr: null,
    discountInr: null,
    declaredValueInr: '1050.00',
    totalWeightGrams: 500,
    packageType: 'PARCEL',
    isUrgent: false,
    isHighRisk: false,
    hasAdminOverride: false,
    sellerNotes: null,
    csvExtras: null,
    internalNotes: null,
    callNotes: null,
    cancellationReason: null,
    cancelledAt: null,
    placedAt: '2026-11-10T09:30:00Z',
    expectedDeliveryAt: null,
    createdAt: '2026-11-10T09:30:00Z',
    updatedAt: '2026-11-12T10:48:00Z',
    chargedInr: '96.00',
    items: [ITEM],
    ...over,
  };
}

const KEYS: ReadonlyArray<[string, string, 'SKYDROP' | 'COURIER']> = [
  ['order_received', 'Order received', 'SKYDROP'],
  ['call_confirmed', 'Confirmed by phone', 'SKYDROP'],
  ['picked', 'Picked from shelf', 'SKYDROP'],
  ['packed', 'Packed', 'SKYDROP'],
  ['ready_to_dispatch', 'Ready to dispatch', 'SKYDROP'],
  ['dispatched', 'Handed to courier', 'SKYDROP'],
  ['in_transit', 'In transit', 'COURIER'],
  ['out_for_delivery', 'Out for delivery', 'COURIER'],
  ['delivered', 'Delivered', 'COURIER'],
];

function ladder(
  current: string,
  times: Record<string, string>,
  opts: { skip?: string[]; details?: Record<string, string>; eta?: string } = {},
): Json[] {
  const idx = KEYS.findIndex(([k]) => k === current);
  return KEYS.map(([key, label, owner], i) => {
    const skipped = opts.skip?.includes(key) === true;
    const state = skipped ? 'SKIPPED' : i < idx ? 'DONE' : i === idx ? 'CURRENT' : 'PENDING';
    const at = times[key] ?? (key === 'delivered' && opts.eta !== undefined ? opts.eta : null);
    return {
      key,
      label,
      owner,
      state,
      at,
      detail: opts.details?.[key] ?? null,
      estimated: key === 'delivered' && times[key] === undefined && opts.eta !== undefined,
    };
  });
}

function entry(
  at: string,
  owner: string,
  title: string,
  location: string | null = null,
  extra: Json = {},
): Json {
  return {
    at,
    owner,
    title,
    detail: null,
    location,
    nslCode: null,
    rawStatus: null,
    attempt: null,
    ...extra,
  };
}

const PARCEL: Json = {
  shipmentId: 'sh-1',
  shipmentNumber: 'SH-2026-11-000070',
  awbNumber: '38061110634966',
  courierCode: 'DELHIVERY',
  courierAccountLabel: 'Skydrop main',
  status: 'AWB_GENERATED',
  declaredWeightGrams: 500,
  chargeableWeightGrams: 500,
  dimensionsCm: '20 × 15 × 8',
  expectedDeliveryAt: '2026-11-16T12:00:00Z',
  collectableAmountInr: '1050.00',
  courierCollectableInr: '1050.00',
  paymentMode: 'COD',
  courierPickedUpAt: null,
  courierSortCode: 'KLT/MDH',
  courierStatusLine: null,
  courierStatusLocation: null,
};

function journey(
  milestones: Json[],
  timeline: Json[],
  parcels: Json[] = [PARCEL],
  status = 'CONFIRMED',
): Json {
  return {
    orderId: DEV_ORDER_ID,
    orderNumber: 'SD-2026-26-000070',
    orderStatus: status,
    milestones,
    parcels,
    timeline,
  };
}

const T_CONFIRMED = ladder(
  'call_confirmed',
  {
    order_received: '2026-11-10T09:30:00Z',
    call_confirmed: '2026-11-12T10:48:00Z',
  },
  {
    eta: '2026-11-16T12:00:00Z',
    details: { call_confirmed: 'Your customer agreed to receive it' },
  },
);

const TL_CONFIRMED = [
  entry('2026-11-12T10:50:00Z', 'SKYDROP', 'Waybill booked with Delhivery'),
  entry('2026-11-12T10:48:00Z', 'SKYDROP', 'Confirmed by phone'),
  entry('2026-11-11T15:02:00Z', 'SKYDROP', 'Call attempted — no answer'),
  entry('2026-11-10T09:30:00Z', 'SKYDROP', 'Order received'),
];

const CHARGES = [
  {
    id: 'c1',
    orderId: DEV_ORDER_ID,
    shipmentId: null,
    type: 'BASE_SHIPPING',
    amountInr: '60.00',
    taxRate: null,
    taxAmountInr: null,
    totalAmountInr: '60.00',
    description: null,
    displayOrder: 1,
    isVisibleToSeller: true,
    status: 'ESTIMATED',
    createdAt: '2026-11-12T10:50:00Z',
  },
  {
    id: 'c2',
    orderId: DEV_ORDER_ID,
    shipmentId: null,
    type: 'COD_FEE',
    amountInr: '30.00',
    taxRate: null,
    taxAmountInr: null,
    totalAmountInr: '30.00',
    description: 'Cash on delivery fee',
    displayOrder: 2,
    isVisibleToSeller: true,
    status: 'ESTIMATED',
    createdAt: '2026-11-12T10:50:00Z',
  },
  {
    id: 'c3',
    orderId: DEV_ORDER_ID,
    shipmentId: null,
    type: 'FUEL_SURCHARGE',
    amountInr: '6.00',
    taxRate: null,
    taxAmountInr: null,
    totalAmountInr: '6.00',
    description: null,
    displayOrder: 3,
    isVisibleToSeller: true,
    status: 'CONFIRMED',
    createdAt: '2026-11-12T10:50:00Z',
  },
];

function check(over: Json = {}): Json {
  return {
    available: true,
    status: 'ok',
    action: 'approve',
    score: 93,
    poConfidence: 'high',
    completedAddress:
      'Village Sovapur, P.O. Deonapur, P.S. Baishnabnagar, Dhulian, Malda, West Bengal 732210',
    issues: [
      {
        code: 'landmark_vague',
        message: 'The landmark is a school — add the nearest shop or road name',
      },
      { code: 'house_missing', message: 'No house or flat number found' },
    ],
    suggestions: [],
    extracted: {
      village_city: 'Sovapur',
      post_office: 'Deonapur',
      police_station: 'Baishnabnagar',
      district: 'Malda',
      state: 'West Bengal',
      pincode: '732210',
    },
    fieldSource: {
      village_city: 'customer',
      post_office: 'customer',
      police_station: 'customer',
      district: 'pincode',
      state: 'pincode',
      pincode: 'customer',
    },
    rtoRisk: null,
    rtoRiskStatus: null,
    rechecked: false,
    questions: [],
    providersUsed: ['solustation'],
    ...over,
  };
}

const TICKET = (id: string, subject: string, status: string): Json => ({
  id,
  ticketNumber: `TK-2026-0000${id}`,
  openedBy: 'SELLER',
  ticketType: 'ORDER_ISSUE',
  status,
  sellerId: 'seller-1',
  orderId: DEV_ORDER_ID,
  orderNumber: 'SD-2026-26-000070',
  subject,
  createdAt: '2026-11-12T08:00:00Z',
  updatedAt: '2026-11-12T08:30:00Z',
});

const empty = {
  reattempts: { requests: [], canRequest: false },
  deliveryActions: { items: [], canRequest: false },
  calls: { items: [] },
  tickets: [] as Json[],
  resellerMoney: null,
  holdReviews: [] as Json[],
};

const DELIVERED_STEPS = ladder(
  'delivered',
  {
    order_received: '2026-11-04T09:30:00Z',
    call_confirmed: '2026-11-04T11:00:00Z',
    picked: '2026-11-05T10:00:00Z',
    packed: '2026-11-05T10:20:00Z',
    dispatched: '2026-11-05T14:00:00Z',
    in_transit: '2026-11-06T08:00:00Z',
    out_for_delivery: '2026-11-08T09:00:00Z',
    delivered: '2026-11-08T13:15:00Z',
  },
  { skip: ['ready_to_dispatch'] },
);

const RTO_STEPS: Json[] = [
  ...ladder(
    'out_for_delivery',
    {
      order_received: '2026-11-04T09:30:00Z',
      call_confirmed: '2026-11-04T11:00:00Z',
      picked: '2026-11-05T10:00:00Z',
      packed: '2026-11-05T10:20:00Z',
      dispatched: '2026-11-05T14:00:00Z',
      in_transit: '2026-11-06T08:00:00Z',
      out_for_delivery: '2026-11-08T09:00:00Z',
    },
    { skip: ['ready_to_dispatch'] },
  ).slice(0, 8),
  {
    key: 'returning',
    label: 'Coming back to us',
    owner: 'COURIER',
    state: 'DONE',
    at: '2026-11-09T10:00:00Z',
    detail: 'Kolkata Hub',
    estimated: false,
  },
  {
    key: 'rto_received',
    label: 'Back in our warehouse',
    owner: 'SKYDROP',
    state: 'CURRENT',
    at: '2026-11-11T12:00:00Z',
    detail: null,
    estimated: false,
  },
  {
    key: 'rto_settled',
    label: 'Back in your stock',
    owner: 'SKYDROP',
    state: 'PENDING',
    at: null,
    detail: null,
    estimated: false,
  },
];

export function fixture(id: FixtureId): Fixture {
  const common = { permissions: ALL, charges: CHARGES, invoice: null, check: check(), ...empty };
  switch (id) {
    case 'b':
      return {
        ...common,
        order: baseOrder({
          status: 'PENDING_CONFIRMATION',
          updatedAt: '2026-11-10T09:30:00Z',
          chargedInr: null,
        }),
        journey: journey(
          ladder('order_received', { order_received: '2026-11-10T09:30:00Z' }),
          [entry('2026-11-10T09:30:00Z', 'SKYDROP', 'Order received')],
          [],
          'PENDING_CONFIRMATION',
        ),
        charges: [],
        check: check({
          action: 'confirm_with_customer',
          score: 61,
          issues: [{ code: 'pin_mismatch', message: 'The pincode and district do not agree' }],
          rtoRisk: 0.18,
          rtoRiskStatus: 'shown',
        }),
      };
    case 'c':
      return {
        ...common,
        order: baseOrder({ status: 'DELIVERED', updatedAt: '2026-11-08T13:15:00Z' }),
        journey: journey(
          DELIVERED_STEPS,
          [
            entry('2026-11-08T13:15:00Z', 'COURIER', 'Delivered', 'Malda'),
            entry('2026-11-08T09:00:00Z', 'COURIER', 'Out for delivery', 'Malda'),
            entry('2026-11-05T14:00:00Z', 'SKYDROP', 'Handed to courier'),
          ],
          [{ ...PARCEL, status: 'DELIVERED', courierPickedUpAt: '2026-11-05T14:30:00Z' }],
          'DELIVERED',
        ),
        invoice: {
          invoiceNumber: 'INV-2026-000231',
          invoiceDate: '2026-11-08T13:20:00Z',
          totalInr: '96.00',
          pdfUrl: 'https://example.invalid/x.pdf',
        },
      };
    case 'd': {
      const attempt = (n: number, at: string): Json =>
        entry(at, 'COURIER', `Delivery attempt ${n} failed`, 'Malda', {
          attempt: {
            number: n,
            reason: 'CUSTOMER_UNAVAILABLE',
            notes: 'Phone switched off, neighbours say the family is away',
            nextAttemptAt: n < 3 ? '2026-11-10T10:00:00Z' : null,
            agentName: 'Rafiq',
            agentPhone: '+919800000001',
            contactedCustomer: n === 2,
            customerResponse: n === 2 ? 'Come back tomorrow' : null,
            nsl: {
              code: 'EOD-74',
              plain: 'Customer not available',
              reAttemptable: true,
              reschedulable: false,
            },
          },
        });
      return {
        ...common,
        order: baseOrder({ status: 'RTO_RECEIVED', updatedAt: '2026-11-11T12:00:00Z' }),
        journey: journey(
          RTO_STEPS,
          [
            attempt(3, '2026-11-09T09:00:00Z'),
            attempt(2, '2026-11-08T09:00:00Z'),
            attempt(1, '2026-11-07T09:00:00Z'),
            entry('2026-11-05T14:00:00Z', 'SKYDROP', 'Handed to courier'),
            entry('2026-11-04T09:30:00Z', 'SKYDROP', 'Order received'),
            entry('2026-11-11T12:00:00Z', 'SKYDROP', 'Back in our warehouse'),
            entry('2026-11-09T10:00:00Z', 'COURIER', 'Coming back to us'),
            entry('2026-11-06T08:00:00Z', 'COURIER', 'In transit'),
            entry('2026-11-05T16:00:00Z', 'COURIER', 'Picked up'),
          ],
          [{ ...PARCEL, status: 'RTO_RECEIVED' }],
          'RTO_RECEIVED',
        ),
        calls: {
          items: [
            {
              id: 'k1',
              calledAt: '2026-11-08T11:00:00Z',
              outcome: 'NO_ANSWER',
              notes: 'Rang four times, switched off.',
              customerSaidName: null,
              customerSaidAddress: null,
              rescheduledFor: null,
            },
            {
              id: 'k2',
              calledAt: '2026-11-09T12:30:00Z',
              outcome: 'CALL_BACK_LATER',
              notes: 'Customer is travelling until Friday.',
              customerSaidName: null,
              customerSaidAddress: null,
              rescheduledFor: '2026-11-14T10:00:00Z',
            },
            {
              id: 'k3',
              calledAt: '2026-11-09T15:00:00Z',
              outcome: 'ADDRESS_CORRECTION',
              notes: 'Gave a nearby market as the drop point.',
              customerSaidName: null,
              customerSaidAddress: 'Near Kaliachak market, Malda',
              rescheduledFor: null,
            },
          ],
        },
        deliveryActions: {
          canRequest: false,
          items: [
            {
              id: 'da1',
              action: 'REATTEMPT',
              reason: 'Customer says they will be home on Thursday.',
              status: 'EXECUTED',
              decisionNote: 'Asked the courier to try again.',
              decidedAt: '2026-11-09T09:00:00Z',
              executedAt: '2026-11-09T09:05:00Z',
              executionError: null,
              createdAt: '2026-11-08T17:00:00Z',
            },
            {
              id: 'da2',
              action: 'RECALL',
              reason: 'Please ring again before sending back.',
              status: 'FAILED',
              decisionNote: null,
              decidedAt: null,
              executedAt: null,
              executionError: 'The courier would not take the instruction',
              createdAt: '2026-11-09T11:00:00Z',
            },
          ],
        },
      };
    }
    case 'e':
      return {
        ...common,
        order: baseOrder({ status: 'IN_TRANSIT' }),
        journey: journey(
          ladder(
            'in_transit',
            {
              order_received: '2026-11-10T09:30:00Z',
              call_confirmed: '2026-11-10T11:00:00Z',
              picked: '2026-11-11T10:00:00Z',
              packed: '2026-11-11T10:20:00Z',
              dispatched: '2026-11-11T14:00:00Z',
              in_transit: '2026-11-12T08:00:00Z',
            },
            {
              skip: ['ready_to_dispatch'],
              eta: '2026-11-14T12:00:00Z',
              details: { in_transit: 'Kolkata Panihati' },
            },
          ),
          [
            entry('2026-11-12T08:00:00Z', 'COURIER', 'In transit', 'Kolkata Panihati'),
            entry('2026-11-11T14:00:00Z', 'SKYDROP', 'Handed to courier'),
          ],
          [
            {
              ...PARCEL,
              status: 'IN_TRANSIT',
              courierStatusLine: 'Bag scanned at hub',
              courierStatusLocation: 'Kolkata Panihati',
            },
          ],
          'IN_TRANSIT',
        ),
        deliveryActions: { items: [], canRequest: true },
        tickets: [
          TICKET('1', 'Parcel looks delayed — please chase the courier', 'OPEN'),
          TICKET('2', 'Customer changed the phone number', 'RESOLVED_REFUND'),
        ],
      };
    case 'f':
      return {
        ...common,
        order: baseOrder({
          status: 'CANCELLED',
          cancellationReason: 'SELLER_REQUEST',
          cancelledAt: '2026-11-11T09:00:00Z',
          updatedAt: '2026-11-11T09:00:00Z',
        }),
        journey: journey(
          ladder('order_received', { order_received: '2026-11-10T09:30:00Z' }),
          [
            entry('2026-11-11T09:00:00Z', 'SKYDROP', 'Order cancelled'),
            entry('2026-11-10T09:30:00Z', 'SKYDROP', 'Order received'),
          ],
          [],
          'CANCELLED',
        ),
        charges: [],
      };
    case 'g':
      return {
        ...common,
        order: baseOrder({
          paymentMode: 'PREPAID',
          codAmountInr: null,
          declaredValueInr: '1400.00',
        }),
        journey: journey(T_CONFIRMED, TL_CONFIRMED, [
          {
            ...PARCEL,
            paymentMode: 'PREPAID',
            collectableAmountInr: null,
            courierCollectableInr: null,
          },
        ]),
      };
    case 'h': {
      const items = Array.from({ length: 6 }, (_, i) => ({
        ...ITEM,
        id: `it-${i}`,
        skuCode: `LONG-SKU-CODE-WITH-MANY-SEGMENTS-${i + 1}-XXL-BLACK`,
        productName:
          'A very long product name that keeps going to test how the table wraps on a narrow phone screen without any sideways scroll',
        variantLabel: 'Extra Large / Midnight Black / Limited Edition',
        quantity: i + 1,
      }));
      return {
        ...common,
        order: baseOrder({
          recipientName: 'Abdur Rahman Mohammad Khairul Bashar Chowdhury Al-Mamun',
          recipientEmail:
            'abdur.rahman.mohammad.khairul.bashar.chowdhury@very-long-domain-name-example.co.in',
          recipientAddressLine1:
            'House 14/B, Flat 3C, Mukherjee Apartments, Behind the old Rathtala Market near the big banyan tree and Kali temple, Ward 12',
          recipientAddressLine2:
            'Via Kaliachak-Sujapur Road, Post Office Sujapur, Police Station Kaliachak, Sub-division Malda Sadar',
          recipientAltPhoneE164: '+919883596607',
          items,
          totalWeightGrams: 21000,
        }),
        journey: journey(T_CONFIRMED, TL_CONFIRMED, [
          {
            ...PARCEL,
            courierCode: 'DELHIVERY',
            courierAccountLabel: 'Skydrop main with a rather long account label',
          },
        ]),
        check: check({
          completedAddress:
            'House 14/B, Flat 3C, Mukherjee Apartments, Behind the old Rathtala Market near the big banyan tree and Kali temple, Ward 12, Via Kaliachak-Sujapur Road, Sujapur, Malda, West Bengal 732201',
        }),
      };
    }
    case 'i':
      return {
        ...common,
        order: baseOrder({ status: 'PENDING_CONFIRMATION' }),
        journey: journey(
          ladder('order_received', { order_received: '2026-11-10T09:30:00Z' }),
          [entry('2026-11-10T09:30:00Z', 'SKYDROP', 'Order received')],
          [],
          'PENDING_CONFIRMATION',
        ),
        check: check({
          action: 'confirm_with_customer',
          score: 61,
          poConfidence: 'medium',
          completedAddress: null,
          rtoRisk: 0.22,
          rtoRiskStatus: 'shown',
          issues: [
            { code: 'po_unclear', message: 'Post office name could be Deonapur or Deonagar' },
            { code: 'district_pin', message: 'The district and the pincode disagree' },
          ],
          suggestions: [
            { field: 'post_office', candidates: ['Deonapur', 'Deonagar', 'Devipur'] },
            {
              field: 'district',
              candidates: ['Uttar Dinajpur'],
              reason: 'The pincode says Uttar Dinajpur.',
            },
          ],
          questions: [
            {
              field: 'post_office',
              text: 'Which is your post office?',
              options: ['Deonapur', 'Deonagar', 'Devipur'],
            },
            { field: 'house', text: 'What is the house or flat number?' },
          ],
        }),
      };
    case 'j':
      return {
        ...common,
        order: baseOrder({
          storeKind: 'RESELLER',
          storeId: 'store-1',
          storeNameSnapshot: 'Rina Fashion House',
        }),
        journey: journey(T_CONFIRMED, TL_CONFIRMED),
        resellerMoney: {
          orderId: DEV_ORDER_ID,
          orderNumber: 'SD-2026-26-000070',
          paymentMode: 'COD',
          codInr: '1050.00',
          transferTotalInr: '800.00',
          retailTotalInr: '1050.00',
          termsVersionId: 'tv-1',
          storePercents: { delivery: '50', return: '50' },
          parties: [
            {
              party: 'SELLER',
              trigger: 'DELIVERED',
              days: 7,
              timing: '7 days after delivery',
              status: 'WAITING',
              dueAt: null,
              creditedAt: null,
              reversedAt: null,
              skippedReason: null,
              grossInr: '800.00',
              transferInr: '800.00',
              taxShareInr: '0.00',
              codFeeShareInr: '15.00',
              instantFeeShareInr: '0.00',
              netInr: '785.00',
            },
          ],
          fees: [{ fee: 'DELIVERY', storeInr: '30.00', sellerInr: '30.00', totalInr: '60.00' }],
          storeLines: null,
          sellerLines: [],
          storeNetInr: null,
          sellerNetInr: '785.00',
        },
      };
    case 'k':
      return {
        ...common,
        order: baseOrder({ status: 'AWAITING_SELLER_DECISION' }),
        journey: journey(
          ladder('order_received', { order_received: '2026-11-10T09:30:00Z' }),
          [
            entry('2026-11-11T12:00:00Z', 'SKYDROP', 'We could not reach your customer'),
            entry('2026-11-10T09:30:00Z', 'SKYDROP', 'Order received'),
          ],
          [],
          'AWAITING_SELLER_DECISION',
        ),
        holdReviews: [
          {
            id: 'rev-1',
            orderId: DEV_ORDER_ID,
            orderNumber: 'SD-2026-26-000070',
            status: 'OPEN',
            attemptCount: 3,
            heldQty: 1,
            createdAt: '2026-11-11T12:00:00Z',
            expiresAt: '2026-11-14T12:00:00Z',
          },
        ],
      };
    case 'l':
      return {
        ...common,
        order: baseOrder({ status: 'REJECTED_BY_CUSTOMER' }),
        journey: journey(
          ladder('call_confirmed', {
            order_received: '2026-11-10T09:30:00Z',
            call_confirmed: '2026-11-11T10:00:00Z',
          }),
          [entry('2026-11-11T10:00:00Z', 'SKYDROP', 'Customer declined on the call')],
          [],
          'REJECTED_BY_CUSTOMER',
        ),
        reattempts: {
          canRequest: false,
          requests: [
            {
              id: 'ra1',
              orderId: DEV_ORDER_ID,
              orderNumber: 'SD-2026-26-000070',
              reason: 'He told me he had a network problem and wants the sunglasses.',
              status: 'PENDING',
              decisionNote: null,
              decidedAt: null,
              createdAt: '2026-11-12T09:00:00Z',
            },
          ],
        },
      };
    case 'm':
      return {
        ...common,
        order: baseOrder({ status: 'REJECTED_BY_CUSTOMER' }),
        journey: journey(
          ladder('call_confirmed', {
            order_received: '2026-11-10T09:30:00Z',
            call_confirmed: '2026-11-11T10:00:00Z',
          }),
          [entry('2026-11-11T10:00:00Z', 'SKYDROP', 'Customer declined on the call')],
          [],
          'REJECTED_BY_CUSTOMER',
        ),
        reattempts: {
          canRequest: true,
          requests: [
            {
              id: 'ra1',
              orderId: DEV_ORDER_ID,
              orderNumber: 'SD-2026-26-000070',
              reason: 'He wants it after all.',
              status: 'REJECTED',
              decisionNote: 'We rang twice and the customer was clear that they do not want it.',
              decidedAt: '2026-11-12T09:30:00Z',
              createdAt: '2026-11-12T09:00:00Z',
            },
          ],
        },
      };
    case 'n':
      return {
        ...common,
        order: baseOrder({
          sellerNotes:
            'Gift wrap please. Customer asked to deliver after 5 pm only — call before arriving.',
          csvExtras: {
            v: 1,
            rows: [
              {
                row: 2,
                unused: [
                  {
                    header: 'Transport Mode',
                    value: 'Express',
                    reason:
                      'we choose the courier and the service level, per your courier settings',
                  },
                ],
                unrecognised: [{ header: 'Gift Wrap Colour', value: 'Red' }],
              },
            ],
          },
        }),
        journey: journey(T_CONFIRMED, TL_CONFIRMED),
      };
    case 'o':
      return {
        ...common,
        order: baseOrder({ status: 'DELIVERED', updatedAt: '2026-11-08T13:15:00Z' }),
        journey: journey(
          DELIVERED_STEPS,
          [entry('2026-11-08T13:15:00Z', 'COURIER', 'Delivered', 'Malda')],
          [{ ...PARCEL, status: 'DELIVERED' }],
          'DELIVERED',
        ),
        invoice: null,
      };
    case 'p':
      return {
        ...common,
        order: baseOrder(),
        journey: journey(T_CONFIRMED, TL_CONFIRMED, [
          { ...PARCEL, courierCollectableInr: '1200.00' },
        ]),
      };
    case 'q':
      return {
        ...common,
        order: baseOrder(),
        journey: journey(T_CONFIRMED, TL_CONFIRMED),
        check: null,
      };
    case 'r':
      return {
        ...common,
        order: baseOrder(),
        journey: journey(T_CONFIRMED, TL_CONFIRMED, []),
      };
    case 'a':
    default:
      return {
        ...common,
        order: baseOrder(),
        journey: journey(T_CONFIRMED, TL_CONFIRMED),
      };
  }
}
