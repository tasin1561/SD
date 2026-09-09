import type { CourierWriteGuardService } from '../../src/modules/courier-shared/services/courier-write-guard.service';
import { ShiprocketClientService } from '../../src/modules/courier-shiprocket/services/shiprocket-client.service';
import type { ShiprocketHttpService } from '../../src/modules/courier-shiprocket/services/shiprocket-http.service';
import type { ShiprocketAwbRequest } from '../../src/modules/courier-shiprocket/types/shiprocket.types';

type Call = { path: string; body?: unknown; method: string };

function makeSut(
  opts: {
    stub?: boolean;
    responses?: Record<string, unknown>;
    throwOn?: string;
    throwWith?: string;
  } = {},
) {
  const calls: Call[] = [];
  const http = {
    isStubMode: async () => opts.stub ?? false,
    request: async (o: { method: string; path: string; body?: unknown }) => {
      calls.push({ path: o.path, body: o.body, method: o.method });
      if (opts.throwOn !== undefined && o.path.includes(opts.throwOn)) {
        throw new Error(opts.throwWith ?? 'boom');
      }
      const hit = Object.entries(opts.responses ?? {}).find(([k]) => o.path.includes(k));
      return hit?.[1] ?? {};
    },
  } as unknown as ShiprocketHttpService;
  // Every write now passes the courier write guard, exactly as the
  // Delhivery paths do. These tests exercise the wire marshalling with
  // the guard permitting — a guard-refuses case belongs with the guard's
  // own suite, which already covers it for both couriers.
  const assertWritable = jest.fn(async () => undefined);
  const writeGuard = { assertWritable } as unknown as CourierWriteGuardService;
  return { svc: new ShiprocketClientService(http, writeGuard), calls, assertWritable };
}

const REQ: ShiprocketAwbRequest = {
  shipmentId: '01930000-0000-7000-8000-000000000042',
  orderNumber: 'SD-2026-08-000042',
  pickupLocationName: 'BLR-01',
  recipient: {
    name: 'Pooja Sharma',
    addressLine1: '12 MG Road',
    addressLine2: 'Near the temple',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
    phoneE164: '+919876543210',
    email: 'pooja@example.in',
  },
  items: [{ name: 'Kurta', sku: 'KUR-1', quantity: 2, unitPriceInr: 499 }],
  paymentMode: 'COD',
  subTotalInr: 998,
  weightGrams: 750,
  lengthCm: 20,
  breadthCm: 15,
  heightCm: 8,
};

const OK_CREATE = { order_id: 8811, shipment_id: 9911, status: 'NEW', status_code: 1 };
const OK_ASSIGN = {
  awb_assign_status: 1,
  response: { data: { awb_code: 'SR12345678', courier_name: 'Bluedart Surface' } },
};

describe('ShiprocketClientService.generateAwb — two calls, one waybill', () => {
  it('creates the order FIRST, then assigns the AWB against their shipment id', async () => {
    // Delhivery manifests and returns a waybill in one call. Shiprocket
    // takes two, and the AWB saga must not learn that — hiding it is
    // the adapter's whole job.
    const sut = makeSut({
      responses: { 'orders/create/adhoc': OK_CREATE, 'courier/assign/awb': OK_ASSIGN },
    });

    const r = await sut.svc.generateAwb(REQ, 'acct-1');

    expect(sut.calls.map((c) => c.path)).toEqual([
      '/v1/external/orders/create/adhoc',
      '/v1/external/courier/assign/awb',
    ]);
    expect((sut.calls[1]?.body as { shipment_id: number }).shipment_id).toBe(9911);
    expect(r).toMatchObject({
      ok: true,
      awbNumber: 'SR12345678',
      // THEIR id, kept — label, pickup and cancel all key on it rather
      // than on the AWB.
      courierShipmentId: '9911',
      courierOrderId: '8811',
    });
  });

  it('converts grams to KILOGRAMS, because their API takes kg', async () => {
    const sut = makeSut({
      responses: { 'orders/create/adhoc': OK_CREATE, 'courier/assign/awb': OK_ASSIGN },
    });
    await sut.svc.generateAwb(REQ, 'acct-1');
    expect((sut.calls[0]?.body as { weight: number }).weight).toBe(0.75);
  });

  it('sends a bare 10-digit phone, not E.164', async () => {
    const sut = makeSut({
      responses: { 'orders/create/adhoc': OK_CREATE, 'courier/assign/awb': OK_ASSIGN },
    });
    await sut.svc.generateAwb(REQ, 'acct-1');
    expect((sut.calls[0]?.body as { billing_phone: string }).billing_phone).toBe('9876543210');
  });

  it('does NOT retry the create when the assign fails', async () => {
    // A retry would make a second order for the same parcel — their
    // adhoc order_id is not enforced unique. An orphaned order in their
    // dashboard is recoverable; a duplicate shipment is not.
    const sut = makeSut({
      responses: { 'orders/create/adhoc': OK_CREATE },
      throwOn: 'courier/assign/awb',
      throwWith: 'Shiprocket 503',
    });

    const r = await sut.svc.generateAwb(REQ, 'acct-1');

    expect(r).toMatchObject({ ok: false, failure: 'TRANSIENT' });
    expect(sut.calls.filter((c) => c.path.includes('create/adhoc'))).toHaveLength(1);
  });

  it('reads "not serviceable" out of their message so the saga supersedes', async () => {
    // The distinction decides whether the AWB job routes to manual
    // placement or leaves it for the next retry (CUR-2b).
    const sut = makeSut({
      responses: {
        'orders/create/adhoc': OK_CREATE,
        'courier/assign/awb': { awb_assign_status: 0, message: 'Pincode not serviceable' },
      },
    });
    const r = await sut.svc.generateAwb(REQ, 'acct-1');
    expect(r).toMatchObject({ ok: false, failure: 'NON_SERVICEABLE' });
  });

  it('treats an unrecognised refusal as TRANSIENT, not permanent', async () => {
    // Biased on purpose: retrying a parcel that could never ship wastes
    // a job; superseding one that would have shipped costs an operator
    // a manual placement.
    const sut = makeSut({
      responses: {
        'orders/create/adhoc': OK_CREATE,
        'courier/assign/awb': { awb_assign_status: 0, message: 'Wallet balance low' },
      },
    });
    const r = await sut.svc.generateAwb(REQ, 'acct-1');
    expect(r).toMatchObject({ ok: false, failure: 'TRANSIENT' });
  });
});

describe('ShiprocketClientService.normalizeScan', () => {
  it('maps their vocabulary to ours', async () => {
    const { svc } = makeSut({ stub: true });
    expect(svc.normalizeScan({ rawStatus: 'Delivered' })).toEqual({
      kind: 'NORMALIZED',
      shipmentStatus: 'DELIVERED',
    });
    expect(svc.normalizeScan({ rawStatus: 'RTO Initiated' })).toEqual({
      kind: 'NORMALIZED',
      shipmentStatus: 'RTO_INITIATED',
    });
  });

  it('reports an unknown status as UNMAPPABLE rather than guessing', async () => {
    // Inventing a DELIVERED from an unknown string is how a parcel gets
    // marked arrived because somebody changed a case label.
    const { svc } = makeSut({ stub: true });
    expect(svc.normalizeScan({ rawStatus: 'Held At Customs Depot' })).toMatchObject({
      kind: 'UNMAPPABLE',
    });
  });

  it('their pickup states are not IN_TRANSIT — the parcel is still ours', async () => {
    const { svc } = makeSut({ stub: true });
    expect(svc.normalizeScan({ rawStatus: 'Pickup Scheduled' })).toEqual({
      kind: 'NORMALIZED',
      shipmentStatus: 'HANDED_TO_COURIER',
    });
  });
});

describe('ShiprocketClientService — stub mode', () => {
  it('is deterministic and keyed the same way Delhivery’s stub is', async () => {
    const { svc } = makeSut({ stub: true });
    await expect(
      svc.generateAwb({ ...REQ, recipient: { ...REQ.recipient, pincode: '999999' } }, 'a'),
    ).resolves.toMatchObject({ ok: false, failure: 'TRANSIENT' });
    await expect(
      svc.generateAwb({ ...REQ, recipient: { ...REQ.recipient, pincode: '000000' } }, 'a'),
    ).resolves.toMatchObject({ ok: false, failure: 'NON_SERVICEABLE' });
    await expect(svc.generateAwb(REQ, 'a')).resolves.toMatchObject({ ok: true });
  });

  it('makes no network call at all', async () => {
    const sut = makeSut({ stub: true });
    await sut.svc.generateAwb(REQ, 'a');
    await sut.svc.fetchLabel('9911', 'a');
    await sut.svc.fetchTracking(['SR1'], 'a');
    expect(sut.calls).toHaveLength(0);
  });
});

describe('ShiprocketClientService.checkServiceability', () => {
  it('a list of BLOCKED couriers is still a no', async () => {
    const sut = makeSut({
      responses: {
        'courier/serviceability': {
          data: {
            available_courier_companies: [{ courier_company_id: 1, courier_name: 'X', blocked: 1 }],
          },
        },
      },
    });
    const r = await sut.svc.checkServiceability(
      { pickupPincode: '110042', deliveryPincode: '560001', weightGrams: 500, isCod: true },
      'acct-1',
    );
    expect(r.serviceable).toBe(false);
  });
});

/**
 * CUR-13, applied to Shiprocket (2026-09-09).
 *
 * The classifier defaulted every unrecognised message to TRANSIENT —
 * exactly the shape Delhivery's had before 2026-09-02, and wrong for
 * the same reason: a refusal handed the answer a timeout gets is
 * retried forever, never fails over, and nobody is told.
 *
 * A LIVE booking found it. Shiprocket answered
 * `422 {"message":"Phone number is in invalid format"}` and we called
 * that TRANSIENT, so BullMQ would have retried a call that fails
 * identically every time. No unit test could have caught it first: in
 * stub mode the adapter never calls out.
 */
describe('ShiprocketClientService — a refusal is not a timeout', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reaching a private for the classification table itself
  const classify = (msg: string): string => (makeSut().svc as any).classify(msg);

  it('a 422 validation refusal is PERMANENT, not retryable', () => {
    expect(
      classify(
        'Shiprocket POST /v1/external/orders/create/adhoc failed (422): {"message":"Phone number is in invalid format"}',
      ),
    ).toBe('NON_SERVICEABLE');
  });

  it('every other 4xx is a refusal too — they formed an opinion about this parcel', () => {
    for (const code of [400, 403, 404, 422]) {
      expect(classify(`Shiprocket POST /x failed (${code}): nope`)).toBe('NON_SERVICEABLE');
    }
  });

  it('408 and 429 genuinely mean LATER', () => {
    // The two 4xx that are about timing rather than about the parcel.
    for (const code of [408, 429]) {
      expect(classify(`Shiprocket POST /x failed (${code}): slow down`)).toBe('TRANSIENT');
    }
  });

  it('a 5xx is their problem, not the parcel’s', () => {
    for (const code of [500, 502, 503]) {
      expect(classify(`Shiprocket POST /x failed (${code}): boom`)).toBe('TRANSIENT');
    }
  });

  it('an error with no status falls back to the words, not to a guess', () => {
    // A socket timeout carries no status at all; the wording is all
    // there is. Kept as a FALLBACK only — classifying on which words an
    // opinion used is what CUR-13 says not to do.
    expect(classify('fetch failed: ETIMEDOUT')).toBe('TRANSIENT');
    expect(classify('pincode not serviceable')).toBe('NON_SERVICEABLE');
  });
});
