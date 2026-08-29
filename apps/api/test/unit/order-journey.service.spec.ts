import { OrderStatus, ShipmentStatus } from '@skydrop/db';
import { OrderJourneyService } from '../../src/modules/order-journey/services/order-journey.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { NslInterpretationService } from '../../src/modules/tracking-events/services/nsl-interpretation.service';

type AnyArgs = any;

const PLACED = new Date('2026-08-27T10:00:00Z');

function makeService(over: AnyArgs = {}) {
  const findFirst = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () =>
    over === null
      ? null
      : {
          id: 'order-1',
          orderNumber: 'SD-2026-08-000042',
          status: OrderStatus.IN_TRANSIT,
          paymentMode: 'COD',
          codAmountInr: { toFixed: () => '1100.00' },
          placedAt: PLACED,
          createdAt: PLACED,
          events: [],
          orderShipments: [],
          ...over,
        },
  );
  const svc = new OrderJourneyService(
    { client: { order: { findFirst } } } as unknown as PrismaService,
    // The real interpreter: the codes it recognises are Delhivery's own
    // published list, so mocking it would test nothing.
    new NslInterpretationService(),
  );
  return { svc, findFirst };
}

function shipment(over: AnyArgs = {}) {
  return {
    shipment: {
      id: 'ship-1',
      shipmentNumber: 'SH-1',
      awbNumber: '38061110524263',
      courierCode: 'delhivery',
      status: ShipmentStatus.IN_TRANSIT,
      declaredWeightGrams: 250,
      totalWeightGrams: 250,
      chargeableWeightGrams: 110,
      lengthCm: { toString: () => '15' },
      widthCm: { toString: () => '5' },
      heightCm: { toString: () => '5' },
      codAmountInr: { toFixed: () => '1100.00' },
      expectedDeliveryAt: new Date('2026-09-04T00:00:00Z'),
      pickCompletedAt: null,
      packCompletedAt: null,
      awbGeneratedAt: null,
      trackingEvents: [],
      ...over,
    },
  };
}

function scan(status: ShipmentStatus, at: string, over: AnyArgs = {}) {
  return {
    eventAt: new Date(at),
    status,
    description: 'Bag Received at Facility',
    locationName: 'Guwahati_KaliPahar_GW (Assam)',
    locationCity: 'Guwahati',
    nslCode: null,
    rawCourierStatus: null,
    isVisibleToCustomer: true,
    ...over,
  };
}

describe('OrderJourneyService — the ladder', () => {
  it('marks the last stage with a real time as CURRENT and later ones PENDING', async () => {
    const { svc } = makeService({
      events: [
        {
          type: 'STATUS_CHANGED',
          toStatus: OrderStatus.CONFIRMED,
          description: null,
          createdAt: new Date('2026-08-27T11:00:00Z'),
        },
        {
          type: 'STATUS_CHANGED',
          toStatus: OrderStatus.DISPATCHED,
          description: null,
          createdAt: new Date('2026-08-27T13:00:00Z'),
        },
      ],
      orderShipments: [
        shipment({ trackingEvents: [scan(ShipmentStatus.IN_TRANSIT, '2026-08-27T15:00:00Z')] }),
      ],
    });

    const j = await svc.forOrder('order-1', 'seller-1');
    const by = Object.fromEntries(j.milestones.map((m) => [m.key, m]));

    expect(by['order_received']?.state).toBe('DONE');
    expect(by['call_confirmed']?.state).toBe('DONE');
    expect(by['in_transit']?.state).toBe('CURRENT');
    expect(by['out_for_delivery']?.state).toBe('PENDING');
    expect(by['delivered']?.state).toBe('PENDING');
  });

  it('a stage a LATER stage overtook is SKIPPED, not pending forever', async () => {
    const { svc } = makeService({
      // Confirmed by an admin override — there was never a call, and
      // never will be. Showing it as pending would mean the ladder
      // never completes.
      events: [
        {
          type: 'STATUS_CHANGED',
          toStatus: OrderStatus.DISPATCHED,
          description: null,
          createdAt: new Date('2026-08-27T13:00:00Z'),
        },
      ],
      orderShipments: [shipment()],
    });

    const j = await svc.forOrder('order-1', 'seller-1');
    const by = Object.fromEntries(j.milestones.map((m) => [m.key, m]));

    expect(by['call_confirmed']?.state).toBe('SKIPPED');
    expect(by['dispatched']?.state).toBe('CURRENT');
  });

  it("carries the courier's ETA on Delivered, flagged as an estimate", async () => {
    const { svc } = makeService({ orderShipments: [shipment()] });
    const j = await svc.forOrder('order-1', 'seller-1');
    const delivered = j.milestones.find((m) => m.key === 'delivered');

    // The question a seller actually opens the page to ask.
    expect(delivered?.at).toEqual(new Date('2026-09-04T00:00:00Z'));
    // …but it has not happened, and the UI must be able to say so
    // rather than showing a delivery date as fact.
    expect(delivered?.estimated).toBe(true);
    expect(delivered?.state).toBe('PENDING');
  });

  it('reports the courier weight separately from the declared one', async () => {
    const { svc } = makeService({ orderShipments: [shipment()] });
    const p = (await svc.forOrder('order-1', 'seller-1')).parcels[0];

    // 250 is what the seller said; 110 is what Delhivery weighed and
    // will bill on. Showing only one of them hides the discrepancy that
    // explains the invoice.
    expect(p?.declaredWeightGrams).toBe(250);
    expect(p?.chargeableWeightGrams).toBe(110);
    expect(p?.dimensionsCm).toBe('15 × 5 × 5');
    expect(p?.collectableAmountInr).toBe('1100.00');
  });

  it('merges our events and their scans into one list, newest first', async () => {
    const { svc } = makeService({
      events: [
        {
          type: 'STATUS_CHANGED',
          toStatus: OrderStatus.PACKED,
          description: 'Packed',
          createdAt: new Date('2026-08-27T12:00:00Z'),
        },
      ],
      orderShipments: [
        shipment({ trackingEvents: [scan(ShipmentStatus.IN_TRANSIT, '2026-08-27T15:00:00Z')] }),
      ],
    });

    const j = await svc.forOrder('order-1', 'seller-1');

    expect(j.timeline).toHaveLength(2);
    // One story, newest first — not two panels the reader reconciles.
    expect(j.timeline[0]?.owner).toBe('COURIER');
    expect(j.timeline[1]?.owner).toBe('SKYDROP');
    expect(j.timeline[0]?.at.getTime()).toBeGreaterThan(j.timeline[1]!.at.getTime());
  });

  it('hides scans the processor marked invisible', async () => {
    const { svc } = makeService({
      orderShipments: [
        shipment({
          trackingEvents: [
            scan(ShipmentStatus.IN_TRANSIT, '2026-08-27T15:00:00Z'),
            // UNMAPPABLE / audit-only: recorded for us, not a story
            // beat for a seller.
            scan(ShipmentStatus.IN_TRANSIT, '2026-08-27T16:00:00Z', { isVisibleToCustomer: false }),
          ],
        }),
      ],
    });

    const j = await svc.forOrder('order-1', 'seller-1');
    expect(j.timeline).toHaveLength(1);
  });

  it('attaches a failed delivery to its scan instead of printing it twice', async () => {
    const at = '2026-08-28T09:00:00Z';
    const { svc } = makeService({
      orderShipments: [
        shipment({
          trackingEvents: [
            scan(ShipmentStatus.DELIVERY_ATTEMPTED, at, { description: 'Delivery attempted' }),
          ],
          deliveryAttempts: [
            {
              attemptNumber: 2,
              attemptedAt: new Date(at),
              failureReason: 'CUSTOMER_UNAVAILABLE',
              failureNotes: 'Nobody at the flat',
              nextAttemptScheduledAt: new Date('2026-08-29T09:00:00Z'),
              agentName: 'R. Das',
              agentPhone: '+919812345678',
              contactedCustomer: true,
              customerResponse: 'Asked for tomorrow',
              courierNslCode: 'EOD-74',
            },
          ],
        }),
      ],
    });

    const j = await svc.forOrder('order-1', 'seller-1');

    // The processor writes the attempt row AND the scan for the same
    // moment (TRK-2); two lines would print every failed delivery twice.
    expect(j.timeline).toHaveLength(1);
    const a = j.timeline[0]?.attempt;
    expect(a?.number).toBe(2);
    expect(a?.agentPhone).toBe('+919812345678');
    expect(a?.customerResponse).toBe('Asked for tomorrow');
    expect(a?.contactedCustomer).toBe(true);
    // Interpreted, and the actionable half is what leads.
    expect(a?.nsl?.code).toBe('EOD-74');
    expect(a?.nsl?.reAttemptable).toBe(true);
  });

  it('still shows an attempt that has no scan to attach to', async () => {
    const { svc } = makeService({
      orderShipments: [
        shipment({
          trackingEvents: [],
          deliveryAttempts: [
            {
              attemptNumber: 1,
              attemptedAt: new Date('2026-08-28T09:00:00Z'),
              failureReason: 'CUSTOMER_REFUSED',
              failureNotes: null,
              nextAttemptScheduledAt: null,
              agentName: null,
              agentPhone: null,
              contactedCustomer: null,
              customerResponse: null,
              courierNslCode: null,
            },
          ],
        }),
      ],
    });

    // A manually-recorded attempt (TRK-9) has no scan by construction,
    // and dropping it would lose the reason a delivery failed.
    const j = await svc.forOrder('order-1', 'seller-1');
    expect(j.timeline).toHaveLength(1);
    expect(j.timeline[0]?.attempt?.number).toBe(1);
  });

  it('scopes to the seller IN THE QUERY, so another seller sees a 404', async () => {
    const { svc, findFirst } = makeService({ orderShipments: [shipment()] });
    await svc.forOrder('order-1', 'seller-1');

    const where = (findFirst.mock.calls[0]?.[0] as AnyArgs).where;
    // Checked after the read, a foreign order would 403 — which
    // confirms it exists. In the query it is simply not found.
    expect(where.sellerId).toBe('seller-1');
  });

  it('a SELLER sees only events marked visible to them', async () => {
    const { svc, findFirst } = makeService({ orderShipments: [shipment()] });
    await svc.forOrder('order-1', 'seller-1');

    // isVisibleToSeller DEFAULTS TO FALSE, so an unfiltered read is not
    // a slightly wider view — it is every internal note and override we
    // ever wrote about the order.
    const sel = (findFirst.mock.calls[0]?.[0] as AnyArgs).select;
    expect(sel.events.where).toEqual({ isVisibleToSeller: true });
  });

  it('STAFF see every event, including the internal ones', async () => {
    const { svc, findFirst } = makeService({ orderShipments: [shipment()] });
    await svc.forOrder('order-1', null);

    // The whole point of the admin view: an agent needs the events the
    // seller is deliberately not shown.
    const sel = (findFirst.mock.calls[0]?.[0] as AnyArgs).select;
    expect(sel.events.where).toBeUndefined();
  });

  it('admin passes no seller scope', async () => {
    const { svc, findFirst } = makeService({ orderShipments: [shipment()] });
    await svc.forOrder('order-1', null);

    const where = (findFirst.mock.calls[0]?.[0] as AnyArgs).where;
    expect(where.sellerId).toBeUndefined();
  });
});
