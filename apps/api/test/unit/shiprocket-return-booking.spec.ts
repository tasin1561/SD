import { ShiprocketClientService } from '../../src/modules/courier-shiprocket/services/shiprocket-client.service';
import type { ShiprocketAwbRequest } from '../../src/modules/courier-shiprocket/types/shiprocket.types';

/**
 * Shiprocket's RETURN leg (2026-09-19).
 *
 * Before this, `CourierAwbDispatchService` answered
 * `REVERSE_NOT_SUPPORTED` for a reverse booking, so a customer return on
 * a Shiprocket parcel could never be collected: the booking service
 * raised a HIGH issue and the goods stayed with the customer. The
 * owner's decision is that the courier who delivered it collects it.
 *
 * ── WHAT THESE TESTS ARE FOR ────────────────────────────────────────
 * No return has ever been booked on this account, so they cannot prove
 * the wire contract. What they DO pin is the part that is ours to get
 * right and is catastrophic to get wrong: which end of the journey each
 * address block describes. Their return create inverts the naming of
 * their forward create — `pickup_*` is the CUSTOMER and `shipping_*` is
 * US — and a swapped pair does not error. It books a van to our own
 * warehouse to collect from ourselves while the customer keeps the
 * goods, which is exactly the outcome the old refusal was avoiding.
 */

const RETURN_ADDRESS = {
  name: 'Skydrop Bangalore',
  addressLine1: '12 Hosur Road',
  addressLine2: 'Unit 4',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560068',
  phone: '+919812345678',
  email: 'returns@skydrop.test',
};

function request(over: Partial<ShiprocketAwbRequest> = {}): ShiprocketAwbRequest {
  return {
    isReverse: true,
    shipmentId: 'sh-1',
    orderNumber: 'SH-2026-09-000001-RVP',
    recipient: {
      name: 'Asha Verma',
      addressLine1: '44 Nehru Nagar',
      addressLine2: 'Near the water tank',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
      phoneE164: '+919900112233',
      email: 'asha@example.test',
    },
    items: [{ name: 'Kurta', sku: 'KUR-01', quantity: 2, unitPriceInr: 499 }],
    paymentMode: 'COD',
    subTotalInr: 998,
    weightGrams: 600,
    lengthCm: 20,
    breadthCm: 15,
    heightCm: 10,
    ...over,
  };
}

interface Captured {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

function client(opts: {
  returnAddress?: unknown;
  assign?: Record<string, unknown>;
}): { svc: ShiprocketClientService; calls: Captured[] } {
  const calls: Captured[] = [];
  const http = {
    isStubMode: jest.fn().mockResolvedValue(false),
    request: jest.fn(async (o: { path: string; body?: Record<string, unknown> }) => {
      calls.push({ path: o.path, body: o.body ?? {} });
      if (o.path.endsWith('/orders/create/return')) return { order_id: 77, shipment_id: 88 };
      return (
        opts.assign ?? {
          awb_assign_status: 1,
          response: { data: { awb_code: 'SRR-1', courier_name: 'Blue Dart Surface' } },
        }
      );
    }),
  };
  const prisma = {
    client: {
      courierAccount: { findUnique: jest.fn().mockResolvedValue({ pickupLocationName: 'BLR' }) },
      systemSetting: {
        findUnique: jest.fn(async (a: { where: { key: string } }) =>
          a.where.key === 'courier.shiprocket_return_address'
            ? { valueJson: opts.returnAddress ?? RETURN_ADDRESS }
            : { valueString: 'BLR' },
        ),
      },
    },
  };
  const svc = new ShiprocketClientService(
    http as never,
    { assertWritable: jest.fn().mockResolvedValue(undefined) } as never,
    prisma as never,
  );
  return { svc, calls };
}

describe('a Shiprocket return is booked on the RETURN endpoint', () => {
  it('uses orders/create/return, never the forward adhoc create', async () => {
    const { svc, calls } = client({});
    await svc.generateAwb(request(), 'acc-1');
    expect(calls.map((c) => c.path)).toEqual([
      '/v1/external/orders/create/return',
      '/v1/external/courier/assign/awb',
    ]);
  });

  /**
   * THE ONE THAT MATTERS. Their naming inverts against the forward
   * create, and getting it backwards does not error.
   */
  it('collects from the CUSTOMER and delivers to US', async () => {
    const { svc, calls } = client({});
    await svc.generateAwb(request(), 'acc-1');
    const body = calls[0]?.body ?? {};

    // pickup_* = where the van goes = the customer.
    expect(body.pickup_customer_name).toBe('Asha');
    expect(body.pickup_address).toBe('44 Nehru Nagar');
    expect(body.pickup_city).toBe('Pune');
    expect(body.pickup_pincode).toBe(411001);
    // A bare ten-digit number, as on the forward create.
    expect(body.pickup_phone).toBe('9900112233');

    // shipping_* = where it ends up = our warehouse.
    expect(body.shipping_customer_name).toBe('Skydrop');
    expect(body.shipping_address).toBe('12 Hosur Road');
    expect(body.shipping_city).toBe('Bengaluru');
    expect(body.shipping_pincode).toBe(560068);
    expect(body.shipping_phone).toBe('9812345678');
  });

  it('collects nothing from the customer, whatever the outbound leg was', async () => {
    // The request carries paymentMode COD — the forward leg's. Sending
    // that here would ask them to pay for their own return.
    const { svc, calls } = client({});
    await svc.generateAwb(request(), 'acc-1');
    expect(calls[0]?.body.payment_method).toBe('PREPAID');
  });

  it('declares the parcel’s own lines, with QC off', async () => {
    const { svc, calls } = client({});
    await svc.generateAwb(request(), 'acc-1');
    expect(calls[0]?.body.order_items).toEqual([
      { name: 'Kurta', sku: 'KUR-01', units: 2, selling_price: 499, discount: '0', qc_enable: false },
    ]);
  });

  it('marks the assign as a return', async () => {
    const { svc, calls } = client({});
    await svc.generateAwb(request(), 'acc-1');
    expect(calls[1]?.body.is_return).toBe(1);
    expect(calls[1]?.body.shipment_id).toBe(88);
  });

  it('carries back the waybill, their ids, and WHICH carrier took it', async () => {
    const { svc } = client({});
    const r = await svc.generateAwb(request(), 'acc-1');
    expect(r).toMatchObject({
      ok: true,
      awbNumber: 'SRR-1',
      courierShipmentId: '88',
      courierOrderId: '77',
      courierName: 'Blue Dart Surface',
    });
  });
});

describe('a return refuses rather than guessing what it does not know', () => {
  /**
   * A guessed return address is a van delivering somebody's goods to a
   * place that does not exist. TRANSIENT because it is a SETUP gap, not
   * an opinion about the parcel — so it neither fails over nor pushes
   * the order to manual placement, and a retry after somebody fills the
   * setting in simply works.
   */
  it('names the missing return address, and calls nobody', async () => {
    const { svc, calls } = client({ returnAddress: {} });
    const r = await svc.generateAwb(request(), 'acc-1');
    expect(r).toMatchObject({ ok: false, failure: 'TRANSIENT' });
    expect(String((r as { message: string }).message)).toContain(
      'SHIPROCKET_RETURN_ADDRESS_NOT_CONFIGURED',
    );
    expect(calls).toHaveLength(0);
  });

  it('refuses a HALF-filled address the same way', async () => {
    // Their endpoint would refuse it too, but on one field — and the
    // real answer is that the SETTING is incomplete.
    const { svc, calls } = client({
      returnAddress: { ...RETURN_ADDRESS, pincode: '', phone: '' },
    });
    const r = await svc.generateAwb(request(), 'acc-1');
    expect(r).toMatchObject({ ok: false, failure: 'TRANSIENT' });
    expect(calls).toHaveLength(0);
  });

  it('names an empty line list rather than letting their field error explain it', async () => {
    const { svc, calls } = client({});
    const r = await svc.generateAwb(request({ items: [] }), 'acc-1');
    expect(String((r as { message: string }).message)).toContain('SHIPROCKET_RETURN_NEEDS_ITEMS');
    expect(calls).toHaveLength(0);
  });

  it('does NOT demand a pickup location — a return does not use one', async () => {
    // The forward path refuses without one. Demanding it here would
    // refuse a collection for a setting that has nothing to do with it.
    const calls: Captured[] = [];
    const http = {
      isStubMode: jest.fn().mockResolvedValue(false),
      request: jest.fn(async (o: { path: string; body?: Record<string, unknown> }) => {
        calls.push({ path: o.path, body: o.body ?? {} });
        if (o.path.endsWith('/orders/create/return')) return { order_id: 1, shipment_id: 2 };
        return { awb_assign_status: 1, response: { data: { awb_code: 'X' } } };
      }),
    };
    const prisma = {
      client: {
        // No pickup location anywhere.
        courierAccount: { findUnique: jest.fn().mockResolvedValue({ pickupLocationName: '' }) },
        systemSetting: {
          findUnique: jest.fn(async (a: { where: { key: string } }) =>
            a.where.key === 'courier.shiprocket_return_address'
              ? { valueJson: RETURN_ADDRESS }
              : { valueString: '' },
          ),
        },
      },
    };
    const svc = new ShiprocketClientService(
      http as never,
      { assertWritable: jest.fn().mockResolvedValue(undefined) } as never,
      prisma as never,
    );
    await expect(svc.generateAwb(request(), 'acc-1')).resolves.toMatchObject({ ok: true });
    expect(calls).toHaveLength(2);
  });
});
