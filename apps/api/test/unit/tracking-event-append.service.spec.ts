import {
  ActorType,
  ShipmentStatus,
  TrackingEventSource,
  TrackingEventType,
} from '@skydrop/db';
import { TrackingEventAppendService } from '../../src/modules/tracking-events/services/tracking-event-append.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

interface FakeRow {
  id: string;
  createdAt: Date;
  eventAt: Date;
  shipmentId: string;
  eventType: TrackingEventType;
  status: ShipmentStatus;
  source: TrackingEventSource;
  courierCode: string | null;
  rawCourierStatus: string | null;
  description: string | null;
  locationName: string | null;
  locationCity: string | null;
  locationPincode: string | null;
  webhookId: string | null;
  actorType: ActorType | null;
  actorId: string | null;
  metadata: unknown;
  isVisibleToCustomer: boolean;
}

interface FakeStore {
  rows: FakeRow[];
}

function makeService(initial: FakeRow[] = []) {
  const store: FakeStore = { rows: [...initial] };
  let nextId = 100;
  const nowBase = new Date('2026-05-25T12:00:00.000Z').getTime();

  const trackingEvent = {
    create: jest.fn(
      async (args: {
        data: Partial<FakeRow>;
        select: Record<string, true>;
      }): Promise<FakeRow> => {
        const id = `te-${nextId++}`;
        const row: FakeRow = {
          id,
          // Auto-stamped — distinct from eventAt to prove the service
          // never confuses the two.
          createdAt: new Date(nowBase + store.rows.length * 1_000),
          eventAt: args.data.eventAt as Date,
          shipmentId: args.data.shipmentId as string,
          eventType: args.data.eventType as TrackingEventType,
          status: args.data.status as ShipmentStatus,
          source: args.data.source as TrackingEventSource,
          courierCode: (args.data.courierCode ?? null) as string | null,
          rawCourierStatus: (args.data.rawCourierStatus ?? null) as
            | string
            | null,
          description: (args.data.description ?? null) as string | null,
          locationName: (args.data.locationName ?? null) as string | null,
          locationCity: (args.data.locationCity ?? null) as string | null,
          locationPincode: (args.data.locationPincode ?? null) as
            | string
            | null,
          webhookId: (args.data.webhookId ?? null) as string | null,
          actorType: (args.data.actorType ?? null) as ActorType | null,
          actorId: (args.data.actorId ?? null) as string | null,
          metadata: args.data.metadata ?? null,
          isVisibleToCustomer:
            (args.data.isVisibleToCustomer as boolean | undefined) ?? true,
        };
        store.rows.push(row);
        return row;
      },
    ),
    findFirst: jest.fn(
      async (args: {
        where: { shipmentId: string };
        orderBy: { eventAt: 'desc' | 'asc' };
        select: Record<string, true>;
      }): Promise<FakeRow | null> => {
        const candidates = store.rows.filter(
          (r) => r.shipmentId === args.where.shipmentId,
        );
        if (candidates.length === 0) return null;
        const dir = args.orderBy.eventAt === 'desc' ? -1 : 1;
        candidates.sort(
          (a, b) => dir * (a.eventAt.getTime() - b.eventAt.getTime()),
        );
        return candidates[0] ?? null;
      },
    ),
  };

  const client = { trackingEvent };
  const svc = new TrackingEventAppendService(
    { client } as unknown as PrismaService,
  );
  return { svc, trackingEvent, store };
}

const SHIPMENT_A = 'ship-AAA-0001';

describe('TrackingEventAppendService.append (TRK-3)', () => {
  it('webhook entry: stamps eventAt from the supplied scan time + passes webhookId + source=COURIER_WEBHOOK', async () => {
    const { svc, trackingEvent } = makeService();
    const eventAt = new Date('2026-05-20T10:00:00.000Z');
    const row = await svc.append({
      shipmentId: SHIPMENT_A,
      eventAt,
      eventType: TrackingEventType.IN_TRANSIT_UPDATE,
      status: ShipmentStatus.IN_TRANSIT,
      source: TrackingEventSource.COURIER_WEBHOOK,
      courierCode: 'delhivery',
      rawCourierStatus: 'DLV-IN-TRANSIT',
      webhookId: 'wh-001',
      description: 'In transit',
      locationCity: 'Bengaluru',
    });
    expect(row.eventAt.toISOString()).toBe(eventAt.toISOString());
    expect(row.source).toBe(TrackingEventSource.COURIER_WEBHOOK);
    expect(row.webhookId).toBe('wh-001');
    expect(row.actorType).toBeNull();
    expect(row.isVisibleToCustomer).toBe(true);
    expect(trackingEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventAt,
          source: TrackingEventSource.COURIER_WEBHOOK,
          webhookId: 'wh-001',
          courierCode: 'delhivery',
          rawCourierStatus: 'DLV-IN-TRANSIT',
        }),
      }),
    );
  });

  it('manual entry: passes actorType=STAFF + actorId + source=MANUAL_ENTRY; eventAt is the operator-supplied scan time', async () => {
    const { svc } = makeService();
    const operatorScan = new Date('2026-05-18T08:30:00.000Z');
    const row = await svc.append({
      shipmentId: SHIPMENT_A,
      eventAt: operatorScan,
      eventType: TrackingEventType.MANUAL_UPDATE,
      status: ShipmentStatus.IN_TRANSIT,
      source: TrackingEventSource.MANUAL_ENTRY,
      actorType: ActorType.STAFF,
      actorId: 'staff-OPS-1',
      description: 'Manual courier handoff confirmed by phone',
    });
    expect(row.eventAt.toISOString()).toBe(operatorScan.toISOString());
    expect(row.source).toBe(TrackingEventSource.MANUAL_ENTRY);
    expect(row.actorType).toBe(ActorType.STAFF);
    expect(row.actorId).toBe('staff-OPS-1');
    expect(row.webhookId).toBeNull();
  });

  it('eventAt is preserved exactly — never replaced with createdAt (TRK-3 receive-time ≠ scan-time)', async () => {
    const { svc } = makeService();
    const scanAt = new Date('2025-12-31T23:59:59.000Z'); // far in the past — proves no "now" substitution
    const row = await svc.append({
      shipmentId: SHIPMENT_A,
      eventAt: scanAt,
      eventType: TrackingEventType.DELIVERED,
      status: ShipmentStatus.DELIVERED,
      source: TrackingEventSource.COURIER_WEBHOOK,
    });
    expect(row.eventAt.toISOString()).toBe(scanAt.toISOString());
    // createdAt is the fake's auto-stamp (now-ish 2026-05-25) — distinct
    // from eventAt. This pins the two-clock discipline.
    expect(row.createdAt.toISOString()).not.toBe(scanAt.toISOString());
    expect(row.createdAt.getTime()).toBeGreaterThan(row.eventAt.getTime());
  });

  it('isVisibleToCustomer defaults to true; explicit false is honored', async () => {
    const { svc } = makeService();
    const visible = await svc.append({
      shipmentId: SHIPMENT_A,
      eventAt: new Date('2026-05-20T10:00:00.000Z'),
      eventType: TrackingEventType.IN_TRANSIT_UPDATE,
      status: ShipmentStatus.IN_TRANSIT,
      source: TrackingEventSource.COURIER_WEBHOOK,
    });
    expect(visible.isVisibleToCustomer).toBe(true);

    const hidden = await svc.append({
      shipmentId: SHIPMENT_A,
      eventAt: new Date('2026-05-20T10:01:00.000Z'),
      eventType: TrackingEventType.STATUS_SYNC,
      status: ShipmentStatus.IN_TRANSIT,
      source: TrackingEventSource.SYSTEM,
      isVisibleToCustomer: false,
    });
    expect(hidden.isVisibleToCustomer).toBe(false);
  });
});

describe('TrackingEventAppendService.latestForShipment (TRK-3 — eventAt-ordered read)', () => {
  it('returns null when the shipment has no events', async () => {
    const { svc } = makeService();
    const r = await svc.latestForShipment(SHIPMENT_A);
    expect(r).toBeNull();
  });

  it('returns the row with the LATEST eventAt — NOT the latest createdAt (proves the orderBy uses eventAt, the TRK-3 invariant)', async () => {
    const { svc } = makeService();
    // Append in this order:
    //   A: createdAt=t0, eventAt=2026-05-20 (newest scan)
    //   B: createdAt=t1, eventAt=2026-05-18 (older scan, arrived late)
    //   C: createdAt=t2, eventAt=2026-05-19 (mid scan, arrived last)
    // If the service ordered by createdAt desc it would return C.
    // If it correctly orders by eventAt desc it returns A.
    await svc.append({
      shipmentId: SHIPMENT_A,
      eventAt: new Date('2026-05-20T10:00:00.000Z'),
      eventType: TrackingEventType.OUT_FOR_DELIVERY,
      status: ShipmentStatus.OUT_FOR_DELIVERY,
      source: TrackingEventSource.COURIER_WEBHOOK,
      description: 'A',
    });
    await svc.append({
      shipmentId: SHIPMENT_A,
      eventAt: new Date('2026-05-18T08:00:00.000Z'),
      eventType: TrackingEventType.IN_TRANSIT_UPDATE,
      status: ShipmentStatus.IN_TRANSIT,
      source: TrackingEventSource.COURIER_WEBHOOK,
      description: 'B',
    });
    await svc.append({
      shipmentId: SHIPMENT_A,
      eventAt: new Date('2026-05-19T12:00:00.000Z'),
      eventType: TrackingEventType.IN_TRANSIT_UPDATE,
      status: ShipmentStatus.IN_TRANSIT,
      source: TrackingEventSource.COURIER_WEBHOOK,
      description: 'C',
    });

    const latest = await svc.latestForShipment(SHIPMENT_A);
    expect(latest?.description).toBe('A');
    expect(latest?.eventAt.toISOString()).toBe('2026-05-20T10:00:00.000Z');
  });

  it('scopes by shipmentId — does not leak across shipments', async () => {
    const { svc } = makeService();
    await svc.append({
      shipmentId: 'ship-OTHER',
      eventAt: new Date('2026-06-01T00:00:00.000Z'),
      eventType: TrackingEventType.DELIVERED,
      status: ShipmentStatus.DELIVERED,
      source: TrackingEventSource.COURIER_WEBHOOK,
      description: 'other-ship newer scan',
    });
    await svc.append({
      shipmentId: SHIPMENT_A,
      eventAt: new Date('2026-05-20T10:00:00.000Z'),
      eventType: TrackingEventType.IN_TRANSIT_UPDATE,
      status: ShipmentStatus.IN_TRANSIT,
      source: TrackingEventSource.COURIER_WEBHOOK,
      description: 'A under test',
    });
    const latest = await svc.latestForShipment(SHIPMENT_A);
    expect(latest?.description).toBe('A under test');
    expect(latest?.shipmentId).toBe(SHIPMENT_A);
  });
});
