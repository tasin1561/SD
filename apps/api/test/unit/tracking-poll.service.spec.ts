import { OrderStatus, ShipmentStatus, TrackingEventSource } from '@skydrop/db';
import { TrackingPollService } from '../../src/modules/tracking-poll/services/tracking-poll.service';
import { DelhiveryTrackingService } from '../../src/modules/courier-delhivery/services/delhivery-tracking.service';
import { TrackingStatusMappingService } from '../../src/modules/tracking-events/services/tracking-status-mapping.service';
import type { DelhiveryHttpService } from '../../src/modules/courier-delhivery/services/delhivery-http.service';
import type { DelhiveryTrackingFetchService } from '../../src/modules/courier-delhivery/services/delhivery-tracking-fetch.service';
import type {
  CourierTrackingResult,
  DelhiveryRawScan,
} from '../../src/modules/courier-delhivery/types/delhivery.types';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type {
  TrackingEventAppendService,
  AppendTrackingEventInput,
  TrackingEventRow,
} from '../../src/modules/tracking-events/services/tracking-event-append.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';

const SHIP = 'ship-POLL-1';
const AWB = '38061110478225';
const ORDER = 'ord-POLL-1';

function scan(rawStatus: string, iso: string, failureReason?: string): DelhiveryRawScan {
  return {
    awbNumber: AWB,
    rawStatus,
    eventAtIso: iso,
    locationName: 'Kolkata_Hub',
    locationCity: 'Kolkata',
    locationPincode: null,
    description: `scan: ${rawStatus}`,
    failureReason: failureReason ?? null,
  };
}

function makeSvc(opts: {
  stub?: boolean;
  orderStatus?: OrderStatus;
  shipmentStatus?: ShipmentStatus;
  scans?: DelhiveryRawScan[];
  watermark?: Date | null;
  fetchThrows?: boolean;
  noShipments?: boolean;
} = {}) {
  const orderStatus = { value: opts.orderStatus ?? OrderStatus.DISPATCHED };
  const attempts: Array<{ shipmentId: string; attemptedAt: Date; attemptNumber: number; source: TrackingEventSource; failureNotes?: string }> = [];
  const appendCalls: AppendTrackingEventInput[] = [];
  const transitionCalls: Array<{ to: OrderStatus }> = [];
  let teCounter = 1;

  const shipmentFindMany = jest.fn(async () =>
    opts.noShipments
      ? []
      : [
          {
            id: SHIP,
            awbNumber: AWB,
            status: opts.shipmentStatus ?? ShipmentStatus.HANDED_TO_COURIER,
            orderShipments: [{ orderId: ORDER }],
          },
        ],
  );
  const orderFindUnique = jest.fn(async () => ({ status: orderStatus.value }));
  const deliveryAttemptFindFirst = jest.fn(async (args: { where: { shipmentId: string; attemptedAt: Date } }) =>
    attempts.find((a) => a.shipmentId === args.where.shipmentId && a.attemptedAt.getTime() === args.where.attemptedAt.getTime()) ?? null,
  );
  const deliveryAttemptCount = jest.fn(async () => attempts.length);
  const deliveryAttemptCreate = jest.fn(async (args: { data: { shipmentId: string; attemptedAt: Date; attemptNumber: number; source: TrackingEventSource; failureNotes?: string } }) => {
    attempts.push(args.data);
    return { id: `att-${attempts.length}` };
  });

  const client = {
    shipment: { findMany: shipmentFindMany },
    order: { findUnique: orderFindUnique },
    deliveryAttempt: {
      findFirst: deliveryAttemptFindFirst,
      count: deliveryAttemptCount,
      create: deliveryAttemptCreate,
    },
  };

  const http = { isStubMode: jest.fn(async () => opts.stub ?? false) };
  const fetch = {
    fetchTracking: jest.fn(async (): Promise<CourierTrackingResult[]> => {
      if (opts.fetchThrows) throw new Error('network down');
      return [{ awbNumber: AWB, scans: opts.scans ?? [] }];
    }),
  };

  const normalizer = new DelhiveryTrackingService();
  const mapping = new TrackingStatusMappingService();

  const append = {
    latestForShipment: jest.fn(async (): Promise<TrackingEventRow | null> =>
      opts.watermark
        ? ({ id: 'te-0', eventAt: opts.watermark } as unknown as TrackingEventRow)
        : null,
    ),
    append: jest.fn(async (input: AppendTrackingEventInput): Promise<TrackingEventRow> => {
      appendCalls.push(input);
      return { id: `te-${teCounter++}`, eventAt: input.eventAt } as unknown as TrackingEventRow;
    }),
  };

  const orderWrite = {
    transitionStatus: jest.fn(async (input: { to: OrderStatus }) => {
      transitionCalls.push({ to: input.to });
      const from = orderStatus.value;
      orderStatus.value = input.to;
      return { orderId: ORDER, fromStatus: from, status: input.to, reservationOutcome: null };
    }),
  };

  const svc = new TrackingPollService(
    { client } as unknown as PrismaService,
    http as unknown as DelhiveryHttpService,
    fetch as unknown as DelhiveryTrackingFetchService,
    normalizer,
    mapping,
    append as unknown as TrackingEventAppendService,
    orderWrite as unknown as OrderWriteService,
  );

  return {
    svc,
    state: { attempts, appendCalls, transitionCalls, orderStatus },
    mocks: { shipmentFindMany, fetch, append, orderWrite, deliveryAttemptCreate },
  };
}

describe('TrackingPollService.pollAll — stub-mode inertness', () => {
  it('stub mode → no DB query, no fetch; returns stubMode=true', async () => {
    const { svc, mocks } = makeSvc({ stub: true });
    const summary = await svc.pollAll();
    expect(summary.stubMode).toBe(true);
    expect(summary.shipmentsExamined).toBe(0);
    expect(mocks.shipmentFindMany).not.toHaveBeenCalled();
    expect(mocks.fetch.fetchTracking).not.toHaveBeenCalled();
  });
});

describe('TrackingPollService.pollAll — forward catch-up + UNMAPPABLE handling', () => {
  it('Manifested (UNMAPPABLE, audited, no transition) then In Transit (→ IN_TRANSIT) on a DISPATCHED order', async () => {
    const { svc, state } = makeSvc({
      orderStatus: OrderStatus.DISPATCHED,
      scans: [
        scan('Manifested', '2026-07-25T19:32:50+05:30'),
        scan('In Transit', '2026-07-26T05:00:00+05:30'),
      ],
      watermark: null,
    });
    const summary = await svc.pollAll();

    expect(summary.scansApplied).toBe(2);
    expect(summary.transitions).toBe(1);
    // Two events appended; the Manifested one is ops-only + unmappable.
    expect(state.appendCalls).toHaveLength(2);
    const manifested = state.appendCalls[0];
    expect(manifested?.source).toBe(TrackingEventSource.COURIER_POLL);
    expect(manifested?.isVisibleToCustomer).toBe(false);
    expect(manifested?.metadata).toMatchObject({ unmappable: true });
    // Exactly one transition → IN_TRANSIT.
    expect(state.transitionCalls).toEqual([{ to: OrderStatus.IN_TRANSIT }]);
    expect(state.orderStatus.value).toBe(OrderStatus.IN_TRANSIT);
  });
});

describe('TrackingPollService.pollAll — watermark dedup', () => {
  it('a scan at or before the latest tracking-event watermark is NOT re-applied', async () => {
    const { svc, state } = makeSvc({
      orderStatus: OrderStatus.IN_TRANSIT,
      scans: [scan('In Transit', '2026-07-26T05:00:00+05:30')],
      watermark: new Date('2026-07-26T05:00:00+05:30'), // == the scan time
    });
    const summary = await svc.pollAll();
    expect(summary.scansApplied).toBe(0);
    expect(state.appendCalls).toHaveLength(0);
    expect(state.transitionCalls).toHaveLength(0);
  });
});

describe('TrackingPollService.pollAll — DELIVERY_ATTEMPT saga (attempt FIRST)', () => {
  it('Undelivered scan on OUT_FOR_DELIVERY: delivery_attempts row written (source=COURIER_POLL) then transition to DELIVERY_FAILED', async () => {
    const { svc, state, mocks } = makeSvc({
      orderStatus: OrderStatus.OUT_FOR_DELIVERY,
      shipmentStatus: ShipmentStatus.OUT_FOR_DELIVERY,
      scans: [scan('Undelivered', '2026-07-27T14:00:00+05:30', 'Customer unavailable')],
      watermark: null,
    });
    const summary = await svc.pollAll();

    expect(summary.transitions).toBe(1);
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]).toMatchObject({
      shipmentId: SHIP,
      attemptNumber: 1,
      source: TrackingEventSource.COURIER_POLL,
      failureNotes: 'Customer unavailable',
    });
    expect(state.transitionCalls).toEqual([{ to: OrderStatus.DELIVERY_FAILED }]);
    // Saga ordering: attempt BEFORE the tracking_event append.
    const attemptOrder = mocks.deliveryAttemptCreate.mock.invocationCallOrder[0] ?? 0;
    const appendOrder = mocks.append.append.mock.invocationCallOrder[0] ?? 0;
    expect(attemptOrder).toBeLessThan(appendOrder);
  });

  it('duplicate attempt (same attemptedAt already present) is NOT re-written', async () => {
    const { svc, state } = makeSvc({
      orderStatus: OrderStatus.OUT_FOR_DELIVERY,
      shipmentStatus: ShipmentStatus.OUT_FOR_DELIVERY,
      scans: [scan('Undelivered', '2026-07-27T14:00:00+05:30', 'Customer unavailable')],
      watermark: null,
    });
    // Pre-seed an attempt at the same instant.
    state.attempts.push({
      shipmentId: SHIP,
      attemptedAt: new Date('2026-07-27T14:00:00+05:30'),
      attemptNumber: 1,
      source: TrackingEventSource.COURIER_POLL,
    });
    await svc.pollAll();
    // Still just the one — no duplicate.
    expect(state.attempts).toHaveLength(1);
  });
});

describe('TrackingPollService.pollAll — resilience', () => {
  it('a fetch batch failure is swallowed; the cycle completes with 0 applied', async () => {
    const { svc } = makeSvc({ fetchThrows: true, scans: [scan('In Transit', '2026-07-26T05:00:00+05:30')] });
    const summary = await svc.pollAll();
    expect(summary.stubMode).toBe(false);
    expect(summary.scansApplied).toBe(0);
    expect(summary.transitions).toBe(0);
  });

  it('no in-flight shipments → clean no-op', async () => {
    const { svc, mocks } = makeSvc({ noShipments: true });
    const summary = await svc.pollAll();
    expect(summary.shipmentsExamined).toBe(0);
    expect(mocks.fetch.fetchTracking).not.toHaveBeenCalled();
  });
});
