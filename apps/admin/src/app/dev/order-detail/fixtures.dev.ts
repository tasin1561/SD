/**
 * Fixtures for /dev/order-detail. DEV ONLY — nothing imports this from a
 * production route (the page that does is `page.dev.tsx`, compiled only
 * under APPS_DEV_ROUTES=1).
 *
 * (a) is the SD-2026-26-000065 shape from the owner's mock: a prepaid
 * order in transit with address-check issues.
 */
export type FixtureId = 'a' | 'b' | 'c' | 'd' | 'e' | 'f';
export const FIXTURE_IDS: readonly FixtureId[] = ['a', 'b', 'c', 'd', 'e', 'f'];

export interface Fixture {
  readonly permissions: readonly string[];
  readonly order: Record<string, unknown>;
  readonly shipments: ReadonlyArray<Record<string, unknown>>;
  readonly journey: Record<string, unknown>;
  readonly check: Record<string, unknown> | null;
  readonly consignee: Record<string, unknown> | { error: string };
  readonly charges: ReadonlyArray<Record<string, unknown>>;
  readonly audit: Record<string, unknown>;
}

const ALL = [
  'orders.view',
  'orders.cancel',
  'orders.override',
  'orders.charges.view',
  'orders.charges.compute',
  'courier.ops.write',
  'money.treasury.manage',
];
const LIMITED = ['orders.view', 'orders.cancel', 'orders.charges.view'];

const ORDER_ID = 'ord-dev-1';

function baseOrder(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ORDER_ID,
    orderNumber: 'SD-2026-26-000065',
    sellerOrderRef: 'MY Afrin MS',
    sellerId: 'seller-1',
    storeId: null,
    status: 'IN_TRANSIT',
    source: 'API',
    recipientName: 'SCo MY Afrin MS',
    recipientPhoneE164: '+919883596606',
    recipientAltPhoneE164: null,
    recipientEmail: null,
    recipientAddressLine1: 'Village Sovapur, P.O. Deonapur, P.S. Baishnabnagar, Malda',
    recipientAddressLine2: null,
    recipientLandmark: 'Sovapur Primary School',
    recipientCity: 'Dhulian',
    recipientStateProvince: 'West Bengal',
    recipientPostalCode: '732210',
    recipientCountryCode: 'IN',
    paymentMode: 'PREPAID',
    codAmountInr: null,
    advanceAmountInr: null,
    deliveryFeeInr: null,
    discountInr: null,
    declaredValueInr: '1400.00',
    totalWeightGrams: 170,
    packageType: 'PARCEL',
    isUrgent: false,
    isHighRisk: false,
    hasAdminOverride: false,
    sellerNotes: null,
    internalNotes: null,
    callNotes: null,
    cancellationReason: null,
    cancelledAt: null,
    placedAt: '2026-11-09T09:30:00.000Z',
    expectedDeliveryAt: '2026-11-15T12:00:00.000Z',
    createdAt: '2026-11-09T09:30:00.000Z',
    updatedAt: '2026-11-12T11:10:00.000Z',
    items: [
      {
        id: 'it-1',
        variantId: 'v-1',
        productName: 'Coffee',
        variantLabel: 'Elite Collagen',
        imageUrl: null,
        skuCode: 'COF-COLL-01',
        quantity: 1,
        unitWeightGrams: 170,
        unitDeclaredValueInr: '1400.00',
        unitPriceInr: '1400.00',
        qtyReserved: 1,
      },
    ],
    ...over,
  };
}

type Step = readonly [
  key: string,
  label: string,
  owner: string,
  state: string,
  at: string | null,
  detail?: string | undefined,
  estimated?: boolean,
];

function milestones(steps: readonly Step[]): Array<Record<string, unknown>> {
  return steps.map(([key, label, owner, state, at, detail, estimated]) => ({
    key,
    label,
    owner,
    state,
    at,
    detail: detail ?? null,
    estimated: estimated ?? false,
  }));
}

const TRANSIT_STEPS: readonly Step[] = [
  ['received', 'Received', 'SKYDROP', 'DONE', '2026-11-09T09:30:00Z'],
  ['confirmed', 'Confirmed by phone', 'SKYDROP', 'DONE', '2026-11-09T10:48:00Z'],
  ['picked', 'Picked', 'SKYDROP', 'DONE', '2026-11-12T10:50:00Z'],
  ['ready', 'Ready to dispatch', 'SKYDROP', 'SKIPPED', null],
  ['packed', 'Packed', 'SKYDROP', 'DONE', '2026-11-12T10:52:00Z'],
  ['handed', 'Handed to courier', 'SKYDROP', 'DONE', '2026-11-12T10:56:00Z'],
  ['transit', 'In transit', 'COURIER', 'CURRENT', '2026-11-12T11:10:00Z', 'Kolkata Panihati'],
  ['ofd', 'Out for delivery', 'COURIER', 'PENDING', null],
  ['delivered', 'Delivered', 'COURIER', 'PENDING', '2026-11-15T12:00:00Z', undefined, true],
];

function entry(at: string, owner: string, title: string, location: string | null = null) {
  return {
    at,
    owner,
    title,
    detail: null,
    location,
    nslCode: null,
    rawStatus: null,
    attempt: null,
  };
}

const TIMELINE = [
  entry('2026-11-12T11:10:00Z', 'COURIER', 'In transit', 'Dankuni GW'),
  entry('2026-11-12T11:02:00Z', 'COURIER', 'Shipment picked up', 'Delhi Hub'),
  entry('2026-11-12T10:56:00Z', 'SKYDROP', 'Handed to courier'),
  entry('2026-11-12T10:52:00Z', 'SKYDROP', 'Packed'),
  entry('2026-11-11T08:00:00Z', 'SELLER', 'Order edited by client'),
  entry('2026-11-10T14:20:00Z', 'COURIER', 'Manifested', 'Delhi'),
  entry('2026-11-10T09:00:00Z', 'SKYDROP', 'Label generated'),
  entry('2026-11-09T10:48:00Z', 'SKYDROP', 'Confirmed by phone'),
  entry('2026-11-09T09:40:00Z', 'SKYDROP', 'Call attempted'),
  entry('2026-11-09T09:30:00Z', 'SELLER', 'Order placed'),
];

function auditEvent(
  i: number,
  kind: string,
  at: string,
  name: string,
  detail: object | null = null,
) {
  return {
    key: `ev-${i}`,
    kind,
    atIso: at,
    atApproximate: false,
    actor: { kind: 'STAFF', name },
    shipmentId: 'sh-1',
    shipmentNumber: 'SH-2026-11-000060',
    awbNumber: '38061110627406',
    detail,
  };
}

const AUDIT_EVENTS = [
  auditEvent(1, 'COURIER_PICKED_UP', '2026-11-12T11:00:00Z', 'Tasin Sti'),
  auditEvent(2, 'HANDOVER_SCANNED', '2026-11-12T10:56:00Z', 'Tasin Sti'),
  auditEvent(3, 'MANIFEST_CLOSED', '2026-11-12T10:55:00Z', 'Tasin Sti', {
    manifestNumber: 'MF-0021',
  }),
  auditEvent(4, 'PACKED', '2026-11-12T10:52:00Z', 'Tasin Sti'),
  auditEvent(5, 'PACK_BOX_CLOSED', '2026-11-12T10:51:00Z', 'Tasin Sti'),
  auditEvent(6, 'PICKED', '2026-11-12T10:50:00Z', 'Rakib Hasan'),
  auditEvent(7, 'PICK_CLAIMED', '2026-11-12T10:44:00Z', 'Rakib Hasan'),
  auditEvent(8, 'PICK_BATCH_CREATED', '2026-11-12T10:40:00Z', 'Rakib Hasan', {
    batchNumber: 'PB-0107',
  }),
  auditEvent(9, 'LABEL_PRINTED', '2026-11-10T09:05:00Z', 'Tasin Sti', { printed: 2 }),
  auditEvent(10, 'LABEL_GENERATED', '2026-11-10T09:00:00Z', 'Tasin Sti', { version: 1 }),
];

const PARCEL = {
  shipmentId: 'sh-1',
  shipmentNumber: 'SH-2026-11-000060',
  awbNumber: '38061110627406',
  courierCode: 'DELHIVERY',
  courierAccountLabel: 'primary',
  status: 'IN_TRANSIT',
  declaredWeightGrams: 170,
  chargeableWeightGrams: 170,
  dimensionsCm: '18×13×3',
  expectedDeliveryAt: '2026-11-15T12:00:00Z',
  collectableAmountInr: null,
  courierCollectableInr: null,
  paymentMode: 'PREPAID',
  courierPickedUpAt: '2026-11-11T11:00:00Z',
  courierSortCode: null,
  courierStatusLine: 'In transit',
  courierStatusLocation: 'Kolkata Panihati',
};

function shipment(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sh-1',
    shipmentNumber: 'SH-2026-11-000060',
    status: 'IN_TRANSIT',
    awbNumber: '38061110627406',
    courierCode: 'DELHIVERY',
    courierAccountLabel: 'primary',
    carrierName: null,
    isManualCourier: false,
    manualCourierName: null,
    createdAt: '2026-11-09T10:48:00.000Z',
    supersedesShipmentId: null,
    courierCancelledAt: null,
    ...over,
  };
}

const OPTIONS = [
  'Krishnapur',
  'Nandalalpur',
  'Lakshmipur',
  'Raniganj',
  'Bhatapara',
  'Maheshpur',
  'Hariharpara',
  'Kaliachak',
];

const CHECK = {
  available: true,
  status: 'needs_review',
  action: 'confirm_with_customer',
  score: 58,
  poConfidence: null,
  completedAddress: null,
  issues: [
    { code: 'no_house', message: 'No house or flat number' },
    { code: 'no_street', message: 'No street or road name' },
    { code: 'po_mismatch', message: 'Deonapur is not a post office of 732210' },
  ],
  suggestions: [
    {
      field: 'post_office',
      candidates: OPTIONS,
      reason: 'Pincode 732210 covers these post offices',
    },
  ],
  extracted: {
    village_city: 'Sovapur',
    post_office: 'Deonapur',
    police_station: 'Baishnabnagar',
    district: 'Malda',
    state: 'West Bengal',
    pincode: '732210',
    landmark: 'Sovapur Primary School',
  },
  fieldSource: {
    village_city: 'customer',
    post_office: 'customer',
    police_station: 'customer',
    district: 'pincode',
    state: 'pincode',
    pincode: 'customer',
    landmark: 'customer',
  },
  rtoRisk: null,
  rtoRiskStatus: 'model_not_ready',
  rechecked: false,
  questions: [{ field: 'post_office', text: 'Which is your post office?', options: OPTIONS }],
  providersUsed: ['ola'],
};

const CHARGES = [
  {
    id: 'ch-1',
    type: 'BASE_SHIPPING',
    description: 'Base shipping',
    status: 'ESTIMATED',
    isVisibleToSeller: true,
    totalAmountInr: '162.60',
  },
];

const EDITABLE = {
  editable: true,
  reason: 'The courier allows a change until pickup.',
  currentName: 'SCo MY Afrin MS',
  currentPhone: '+919883596606',
  currentAddressLine1: 'Village Sovapur, P.O. Deonapur, P.S. Baishnabnagar, Malda',
  city: 'Dhulian',
  stateProvince: 'West Bengal',
  postalCode: '732210',
};

const AUDIT = { orderId: ORDER_ID, orderNumber: 'SD-2026-26-000065', parcels: [], events: [] };

function journey(steps: readonly Step[], parcels: unknown[], timeline: unknown[]) {
  return {
    orderId: ORDER_ID,
    orderNumber: 'SD-2026-26-000065',
    orderStatus: 'IN_TRANSIT',
    milestones: milestones(steps),
    parcels,
    timeline,
  };
}

export function fixture(id: FixtureId): Fixture {
  const auditFor = (events: unknown[]) => ({
    ...AUDIT,
    parcels: [
      {
        shipmentId: 'sh-1',
        shipmentNumber: 'SH-2026-11-000060',
        awbNumber: '38061110627406',
        superseded: false,
        lastTouch: events[0] ?? null,
      },
    ],
    events,
  });
  switch (id) {
    case 'b':
      return {
        permissions: ALL,
        order: baseOrder({
          orderNumber: 'SD-2026-26-000071',
          status: 'CONFIRMED',
          paymentMode: 'COD',
          codAmountInr: '2150.00',
          declaredValueInr: '2150.00',
          totalWeightGrams: 420,
          sellerOrderRef: 'ORD-8841',
          expectedDeliveryAt: null,
        }),
        shipments: [],
        journey: journey(
          [
            ['received', 'Received', 'SKYDROP', 'DONE', '2026-11-12T08:00:00Z'],
            ['confirmed', 'Confirmed by phone', 'SKYDROP', 'CURRENT', '2026-11-12T09:15:00Z'],
            ['picked', 'Picked', 'SKYDROP', 'PENDING', null],
            ['packed', 'Packed', 'SKYDROP', 'PENDING', null],
            ['ready', 'Ready to dispatch', 'SKYDROP', 'PENDING', null],
            ['handed', 'Handed to courier', 'SKYDROP', 'PENDING', null],
            ['transit', 'In transit', 'COURIER', 'PENDING', null],
            ['ofd', 'Out for delivery', 'COURIER', 'PENDING', null],
            ['delivered', 'Delivered', 'COURIER', 'PENDING', null],
          ],
          [],
          TIMELINE.slice(7),
        ),
        check: null,
        consignee: { error: 'NO_LIVE_PARCEL' },
        charges: [],
        audit: { ...AUDIT, events: [] },
      };
    case 'c':
      return {
        permissions: ALL,
        order: baseOrder({ status: 'RTO_IN_TRANSIT', isHighRisk: true }),
        shipments: [shipment({ status: 'RTO_IN_TRANSIT' })],
        journey: journey(
          [
            ['received', 'Received', 'SKYDROP', 'DONE', '2026-11-09T09:30:00Z'],
            ['confirmed', 'Confirmed by phone', 'SKYDROP', 'DONE', '2026-11-09T10:48:00Z'],
            ['picked', 'Picked', 'SKYDROP', 'DONE', '2026-11-10T10:50:00Z'],
            ['packed', 'Packed', 'SKYDROP', 'DONE', '2026-11-10T10:52:00Z'],
            ['handed', 'Handed to courier', 'SKYDROP', 'DONE', '2026-11-10T10:56:00Z'],
            ['transit', 'In transit', 'COURIER', 'DONE', '2026-11-11T11:10:00Z'],
            ['attempt', 'Delivery attempted', 'COURIER', 'DONE', '2026-11-13T11:10:00Z'],
            [
              'rto',
              'Returning to origin',
              'COURIER',
              'CURRENT',
              '2026-11-14T08:00:00Z',
              'Kolkata Panihati',
            ],
            ['rtod', 'Returned', 'COURIER', 'PENDING', null],
          ],
          [{ ...PARCEL, status: 'RTO_IN_TRANSIT' }],
          [
            entry('2026-11-14T08:00:00Z', 'COURIER', 'RTO initiated', 'Kolkata Panihati'),
            entry(
              '2026-11-13T11:10:00Z',
              'COURIER',
              'Delivery attempted: customer refused',
              'Malda',
            ),
            ...TIMELINE.slice(1),
          ],
        ),
        check: CHECK,
        consignee: {
          ...EDITABLE,
          editable: false,
          reason: 'The courier has the parcel on the van.',
        },
        charges: CHARGES,
        audit: auditFor(AUDIT_EVENTS),
      };
    case 'd':
      return {
        permissions: ALL,
        order: baseOrder({ totalWeightGrams: 340 }),
        shipments: [
          shipment({
            id: 'sh-0',
            shipmentNumber: 'SH-2026-11-000058',
            status: 'CANCELLED',
            awbNumber: '38061110627111',
            courierCancelledAt: '2026-11-10T12:00:00.000Z',
          }),
          shipment({ supersedesShipmentId: 'sh-0' }),
        ],
        journey: journey(
          TRANSIT_STEPS,
          [
            {
              ...PARCEL,
              shipmentId: 'sh-0',
              shipmentNumber: 'SH-2026-11-000058',
              status: 'CANCELLED',
              awbNumber: '38061110627111',
            },
            PARCEL,
          ],
          TIMELINE,
        ),
        check: CHECK,
        consignee: EDITABLE,
        charges: CHARGES,
        audit: auditFor(AUDIT_EVENTS),
      };
    case 'e':
      return {
        permissions: ALL,
        order: baseOrder({
          recipientName:
            'Mohammad Abdul Rahman Chowdhury Al-Hasan Siddique-Ur-Rahman Bin Abdullah Mahmud Hossain Sheikh',
          recipientAddressLine1:
            'Flat 4B, Shanti Kunj Apartments, Behind the old Municipal Corporation Water Tank near Rabindra Sarani Crossing, Opposite Hanuman Mandir Gate Number 3',
          recipientAddressLine2:
            'Sector V Extension Phase II, Block C, Salt Lake Electronics Complex Road',
          recipientLandmark:
            'Beside the blue three-storey building with the big banyan tree outside',
          sellerOrderRef: 'CLIENT-REF-WITH-A-VERY-LONG-IDENTIFIER-2026-11-12-0000042',
          recipientEmail: 'mohammad.abdul.rahman.chowdhury.alhasan@example-long-domain-name.co.in',
          sellerNotes:
            'Please call before delivery; the gate guard does not accept parcels after 6pm.',
        }),
        shipments: [shipment()],
        journey: journey(TRANSIT_STEPS, [PARCEL], TIMELINE),
        check: CHECK,
        consignee: EDITABLE,
        charges: CHARGES,
        audit: auditFor(AUDIT_EVENTS),
      };
    case 'f':
      return {
        permissions: LIMITED,
        order: baseOrder(),
        shipments: [shipment()],
        journey: journey(TRANSIT_STEPS, [PARCEL], TIMELINE),
        check: CHECK,
        consignee: EDITABLE,
        charges: CHARGES,
        audit: auditFor(AUDIT_EVENTS),
      };
    default:
      return {
        permissions: ALL,
        order: baseOrder(),
        shipments: [shipment()],
        journey: journey(TRANSIT_STEPS, [PARCEL], TIMELINE),
        check: CHECK,
        consignee: EDITABLE,
        charges: CHARGES,
        audit: auditFor(AUDIT_EVENTS),
      };
  }
}

export const DEV_ORDER_ID = ORDER_ID;
