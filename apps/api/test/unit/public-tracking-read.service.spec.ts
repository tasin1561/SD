import { NotFoundException } from '@nestjs/common';
import { ShipmentStatus } from '@skydrop/db';
import { PublicTrackingReadService } from '../../src/modules/tracking-public/services/public-tracking-read.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type EventRow = {
  eventAt: Date;
  status: ShipmentStatus;
  description: string | null;
  locationCity: string | null;
};

type ShipRow = {
  id: string;
  awbNumber: string;
  status: ShipmentStatus;
  deletedAt: Date | null;
  destCity: string;
  expectedDeliveryAt: Date | null;
  createdAt: Date;
  manualCourierName: string | null;
  courier: {
    displayName: string;
    deletedAt: Date | null;
  };
};

function makeService(
  opts: {
    ship?: ShipRow | null;
    events?: EventRow[];
  } = {},
) {
  const events: EventRow[] = opts.events ?? [];
  const shipFindUnique = jest.fn(async () => opts.ship ?? null);
  const trackingEventFindMany = jest.fn(
    async (args: {
      where: { isVisibleToCustomer: boolean };
      orderBy: { eventAt: 'desc' | 'asc' };
    }): Promise<EventRow[]> => {
      // Mirror the service's isVisibleToCustomer=true filter; tests
      // pass only visible events (invisible ones don't reach here).
      void args;
      const sorted = [...events].sort((a, b) => b.eventAt.getTime() - a.eventAt.getTime());
      return sorted;
    },
  );
  const client = {
    shipment: { findUnique: shipFindUnique },
    trackingEvent: { findMany: trackingEventFindMany },
  };
  const svc = new PublicTrackingReadService({ client } as unknown as PrismaService);
  return { svc, shipFindUnique, trackingEventFindMany };
}

const AWB = 'DLV-AWB-PUB-0001';
const SHIPMENT_ID = 'ship-zzz-9999';

function defaultShip(over: Partial<ShipRow> = {}): ShipRow {
  return {
    id: SHIPMENT_ID,
    awbNumber: AWB,
    status: ShipmentStatus.IN_TRANSIT,
    deletedAt: null,
    destCity: 'Bengaluru',
    expectedDeliveryAt: new Date('2026-05-25T18:00:00.000Z'),
    createdAt: new Date('2026-05-18T00:00:00.000Z'),
    manualCourierName: null,
    courier: { displayName: 'Delhivery', deletedAt: null },
    ...over,
  };
}

describe('PublicTrackingReadService.findByAwb — happy path projection (TRK-8)', () => {
  it('returns a customer-safe projection: NO internal IDs, NO PII, NO cross-order data; current status derived from latest scan by eventAt', async () => {
    const { svc } = makeService({
      ship: defaultShip(),
      events: [
        {
          eventAt: new Date('2026-05-22T14:00:00.000Z'),
          status: ShipmentStatus.OUT_FOR_DELIVERY,
          description: 'Out for delivery',
          locationCity: 'Bengaluru',
        },
        {
          eventAt: new Date('2026-05-20T10:00:00.000Z'),
          status: ShipmentStatus.IN_TRANSIT,
          description: 'In transit',
          locationCity: 'Chennai',
        },
      ],
    });

    const r = await svc.findByAwb(AWB);

    // Top-level customer-safe shape.
    expect(r).toEqual({
      awbNumber: AWB,
      courierDisplayName: 'Delhivery',
      currentStatus: 'out_for_delivery',
      currentStatusAt: '2026-05-22T14:00:00.000Z',
      destinationCity: 'Bengaluru',
      estimatedDeliveryAt: '2026-05-25T18:00:00.000Z',
      timeline: [
        {
          status: 'out_for_delivery',
          eventAt: '2026-05-22T14:00:00.000Z',
          description: 'Out for delivery',
          locationCity: 'Bengaluru',
        },
        {
          status: 'in_transit',
          eventAt: '2026-05-20T10:00:00.000Z',
          description: 'In transit',
          locationCity: 'Chennai',
        },
      ],
    });

    // Defensive: the response carries NO internal IDs (orderId,
    // shipmentId, webhookId, courierCode), NO recipient PII, NO
    // precise coordinates. We pin this by asserting key set exactly.
    const keys = Object.keys(r).sort();
    expect(keys).toEqual(
      [
        'awbNumber',
        'courierDisplayName',
        'currentStatus',
        'currentStatusAt',
        'destinationCity',
        'estimatedDeliveryAt',
        'timeline',
      ].sort(),
    );
    for (const ev of r.timeline) {
      // Each timeline entry's keys must be exactly four — adding a
      // field by accident (recipient_name, raw_status, internal id)
      // would surface here, NOT in a passing-by-default test.
      expect(Object.keys(ev).sort()).toEqual(
        ['status', 'eventAt', 'description', 'locationCity'].sort(),
      );
    }
  });
});

describe('PublicTrackingReadService.findByAwb — current-status fallback when no scans', () => {
  it('zero visible scans → currentStatus derived from shipment.status; currentStatusAt = createdAt', async () => {
    const { svc } = makeService({
      ship: defaultShip({ status: ShipmentStatus.CREATED }),
      events: [],
    });
    const r = await svc.findByAwb(AWB);
    expect(r.currentStatus).toBe('processing'); // pre-dispatch bucket
    expect(r.currentStatusAt).toBe('2026-05-18T00:00:00.000Z');
    expect(r.timeline).toEqual([]);
  });
});

describe('PublicTrackingReadService.findByAwb — 404 anti-enumeration discipline (TRK-8)', () => {
  it.each([
    ['empty AWB', '', null],
    ['unknown AWB', 'DLV-NOPE', null],
    ['soft-deleted shipment', AWB, defaultShip({ deletedAt: new Date() })],
    [
      'soft-deleted courier',
      AWB,
      defaultShip({ courier: { displayName: 'X', deletedAt: new Date() } }),
    ],
    [
      'shipment without an AWB (data anomaly)',
      AWB,
      defaultShip({ awbNumber: null as unknown as string }),
    ],
  ])(
    '%s → 404 with SAME generic message + code (no signal leakage)',
    async (_label, lookupAwb, ship) => {
      const { svc } = makeService({ ship });
      let err: unknown;
      try {
        await svc.findByAwb(lookupAwb);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(NotFoundException);
      const res = (err as NotFoundException).getResponse();
      expect(res).toMatchObject({
        code: 'TRACKING_NOT_FOUND',
        message: 'No tracking information found for the provided number.',
      });
    },
  );
});

describe('PublicTrackingReadService.findByAwb — projection collapses internal pre-dispatch statuses to "processing"', () => {
  it.each([
    ShipmentStatus.CREATED,
    ShipmentStatus.AWB_PENDING,
    ShipmentStatus.AWB_GENERATED,
    ShipmentStatus.FAILED_AT_CREATION,
    ShipmentStatus.HANDED_TO_COURIER,
    ShipmentStatus.AT_HUB,
  ])(
    'shipment.status = %s → public currentStatus = "processing" (no leakage of internal lifecycle)',
    async (status) => {
      const { svc } = makeService({
        ship: defaultShip({ status }),
        events: [],
      });
      const r = await svc.findByAwb(AWB);
      expect(r.currentStatus).toBe('processing');
    },
  );

  it.each([
    [ShipmentStatus.IN_TRANSIT, 'in_transit'],
    [ShipmentStatus.OUT_FOR_DELIVERY, 'out_for_delivery'],
    [ShipmentStatus.DELIVERY_ATTEMPTED, 'delivery_attempted'],
    [ShipmentStatus.DELIVERED, 'delivered'],
    [ShipmentStatus.RTO_INITIATED, 'return_initiated'],
    [ShipmentStatus.RTO_IN_TRANSIT, 'returning'],
    [ShipmentStatus.RTO_DELIVERED, 'returned'],
    [ShipmentStatus.LOST, 'lost'],
    [ShipmentStatus.DAMAGED, 'damaged'],
    [ShipmentStatus.CANCELLED, 'cancelled'],
  ])('shipment.status = %s → public currentStatus = "%s"', async (status, expected) => {
    const { svc } = makeService({
      ship: defaultShip({ status }),
      events: [],
    });
    const r = await svc.findByAwb(AWB);
    expect(r.currentStatus).toBe(expected);
  });
});

describe('PublicTrackingReadService.findByAwb — event filter contract', () => {
  it('queries tracking_events with isVisibleToCustomer=true filter — invisible scans NEVER reach the projection', async () => {
    const { svc, trackingEventFindMany } = makeService({
      ship: defaultShip(),
      events: [
        {
          eventAt: new Date('2026-05-20T10:00:00.000Z'),
          status: ShipmentStatus.IN_TRANSIT,
          description: 'In transit',
          locationCity: 'Chennai',
        },
      ],
    });
    await svc.findByAwb(AWB);
    expect(trackingEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isVisibleToCustomer: true }),
        orderBy: { eventAt: 'desc' },
        // Select MUST NOT include webhookId, actorType, actorId,
        // rawCourierStatus, metadata — leakage paths if added.
        select: {
          eventAt: true,
          status: true,
          description: true,
          locationCity: true,
        },
      }),
    );
  });
});

describe('PublicTrackingReadService — who the customer is told has their parcel', () => {
  it('names the REAL carrier on a manually-placed parcel, not the placeholder', async () => {
    // A manual placement is filed under the generic 'manual' courier row
    // (CUR-8), whose display name is not a company the customer has ever
    // heard of. They are checking who holds their parcel; the honest
    // answer is the carrier that actually has it.
    const { svc } = makeService({
      ship: defaultShip({
        manualCourierName: 'Bluedart',
        courier: { displayName: 'Manual placement', deletedAt: null },
      }),
    });
    const out = await svc.findByAwb(AWB);
    expect(out.courierDisplayName).toBe('Bluedart');
  });

  it('falls back to the courier display name when no manual carrier is recorded', async () => {
    // Every integrated parcel, and the manual ones predating the column.
    const { svc } = makeService({ ship: defaultShip({ manualCourierName: null }) });
    const out = await svc.findByAwb(AWB);
    expect(out.courierDisplayName).toBe('Delhivery');
  });

  it('treats a whitespace-only carrier as absent rather than rendering blank', async () => {
    const { svc } = makeService({ ship: defaultShip({ manualCourierName: '   ' }) });
    const out = await svc.findByAwb(AWB);
    expect(out.courierDisplayName).toBe('Delhivery');
  });

  it('still leaks nothing internal — the carrier name is a company, not PII', async () => {
    const { svc } = makeService({
      ship: defaultShip({
        manualCourierName: 'Sundarban',
        courier: { displayName: 'Manual placement', deletedAt: null },
      }),
    });
    const out = await svc.findByAwb(AWB);
    const keys = Object.keys(out);
    expect(keys).not.toContain('shipmentId');
    expect(keys).not.toContain('orderId');
    expect(keys).not.toContain('manualCourierName');
  });
});
