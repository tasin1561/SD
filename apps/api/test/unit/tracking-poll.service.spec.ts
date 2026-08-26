import { OrderStatus, ShipmentStatus, TrackingEventSource } from '@skydrop/db';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
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

/**
 * A poll scan. `statusType` defaults to 'UD' (the forward leg) because
 * the real API always sends one, and D5 made the ambiguous statuses
 * ("In Transit", "Pending", "Dispatched") require it — they mean
 * opposite directions under UD and RT.
 */
function scan(
  rawStatus: string,
  iso: string,
  failureReason?: string,
  statusType: string = 'UD',
): DelhiveryRawScan {
  return {
    awbNumber: AWB,
    rawStatus,
    statusType,
    eventAtIso: iso,
    locationName: 'Kolkata_Hub',
    locationCity: 'Kolkata',
    locationPincode: null,
    description: `scan: ${rawStatus}`,
    failureReason: failureReason ?? null,
  };
}

function makeSvc(
  opts: {
    stub?: boolean;
    orderStatus?: OrderStatus;
    shipmentStatus?: ShipmentStatus;
    scans?: DelhiveryRawScan[];
    watermark?: Date | null;
    fetchThrows?: boolean;
    noShipments?: boolean;
  } = {},
) {
  const orderStatus = { value: opts.orderStatus ?? OrderStatus.DISPATCHED };
  const attempts: Array<{
    shipmentId: string;
    attemptedAt: Date;
    attemptNumber: number;
    source: TrackingEventSource;
    failureNotes?: string;
  }> = [];
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
  const deliveryAttemptFindFirst = jest.fn(
    async (args: { where: { shipmentId: string; attemptedAt: Date } }) =>
      attempts.find(
        (a) =>
          a.shipmentId === args.where.shipmentId &&
          a.attemptedAt.getTime() === args.where.attemptedAt.getTime(),
      ) ?? null,
  );
  const deliveryAttemptCount = jest.fn(async () => attempts.length);
  const deliveryAttemptCreate = jest.fn(
    async (args: {
      data: {
        shipmentId: string;
        attemptedAt: Date;
        attemptNumber: number;
        source: TrackingEventSource;
        failureNotes?: string;
      };
    }) => {
      attempts.push(args.data);
      return { id: `att-${attempts.length}` };
    },
  );

  const client = {
    shipment: { findMany: shipmentFindMany, count: jest.fn(async () => 0) },
    systemSetting: { updateMany: jest.fn(async () => ({ count: 1 })) },
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
    latestForShipment: jest.fn(
      async (): Promise<TrackingEventRow | null> =>
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

  const audit = { log: jest.fn(async () => undefined) };

  const svc = new TrackingPollService(
    { client } as unknown as PrismaService,
    http as unknown as DelhiveryHttpService,
    fetch as unknown as DelhiveryTrackingFetchService,
    normalizer,
    mapping,
    append as unknown as TrackingEventAppendService,
    orderWrite as unknown as OrderWriteService,
    audit as unknown as AuditLogService,
  );

  return {
    svc,
    state: { attempts, appendCalls, transitionCalls, orderStatus },
    mocks: { shipmentFindMany, fetch, append, orderWrite, deliveryAttemptCreate, audit },
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
    const { svc } = makeSvc({
      fetchThrows: true,
      scans: [scan('In Transit', '2026-07-26T05:00:00+05:30')],
    });
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

describe('TrackingPollService — coverage must rotate', () => {
  it('asks for the least-recently-touched shipments first, and for enough of them', async () => {
    // Delhivery B2C pushes no webhooks, so this poller IS tracking.
    // Without an ordering, `take` returns the same arbitrary subset
    // every cycle: above the cap a parcel is not polled late, it is
    // never polled at all, while the parcel beside it updates normally.
    const { svc, mocks } = makeSvc({});
    mocks.shipmentFindMany.mockResolvedValue([]);

    await svc.pollAll();

    // The mock carries no arg types, so the call tuple is typed empty.
    const calls = mocks.shipmentFindMany.mock.calls as unknown as Array<
      [{ orderBy?: { updatedAt?: string }; take?: number }]
    >;
    const args = calls[0]?.[0];
    expect(args).toBeDefined();
    // Applying a scan touches the row, sending it to the back — so
    // attention rotates without another column to maintain.
    expect(args?.orderBy).toEqual({ updatedAt: 'asc' });

    // Their tracking limit is 750 requests / 5 min at 50 waybills each,
    // so the cap should be sized against that rather than set low out of
    // caution — a cap below real volume is the coverage hole above.
    expect(args?.take ?? 0).toBeGreaterThanOrEqual(10_000);
  });
});

describe('TrackingPollService — silence is the failure mode', () => {
  it('alarms when every batch fails, because one failing is a blip and all failing is frozen tracking', async () => {
    const { svc, mocks } = makeSvc({ fetchThrows: true });
    mocks.shipmentFindMany.mockResolvedValue([
      {
        id: 'sh-1',
        awbNumber: AWB,
        status: ShipmentStatus.IN_TRANSIT,
        orderShipments: [{ orderId: ORDER }],
      },
    ]);

    await svc.pollAll();

    // Each failure is caught and logged at warn, so an expired
    // credential repeats every cycle forever while the logs look
    // ordinary and no parcel ever moves.
    const actions = (mocks.audit.log.mock.calls as unknown as Array<[{ action: string }]>).map(
      (c) => c[0].action,
    );
    expect(actions).toContain('tracking.poll_all_batches_failed');
  });

  it('does NOT alarm when only some batches fail', async () => {
    const { svc, mocks } = makeSvc({});
    mocks.shipmentFindMany.mockResolvedValue([
      {
        id: 'sh-1',
        awbNumber: AWB,
        status: ShipmentStatus.IN_TRANSIT,
        orderShipments: [{ orderId: ORDER }],
      },
    ]);

    await svc.pollAll();

    const actions = (mocks.audit.log.mock.calls as unknown as Array<[{ action: string }]>).map(
      (c) => c[0].action,
    );
    expect(actions).not.toContain('tracking.poll_all_batches_failed');
  });

  it('alarms when stub mode is on but parcels are in flight — tracking is simply OFF', async () => {
    const { svc, mocks } = makeSvc({ stub: true });
    // Somebody cleared courier.delhivery_api_base_url. The cycle returns
    // early with no error, no failed request, nothing in the logs.
    mocks.audit.log.mockClear();
    const client = (svc as unknown as { prisma: { client: { shipment: { count: jest.Mock } } } })
      .prisma.client;
    client.shipment.count.mockResolvedValue(7);

    await svc.pollAll();

    const actions = (mocks.audit.log.mock.calls as unknown as Array<[{ action: string }]>).map(
      (c) => c[0].action,
    );
    expect(actions).toContain('tracking.poll_stub_mode_with_inflight');
  });

  it('stays quiet in stub mode when there is nothing to poll — dev and CI live here', async () => {
    const { svc, mocks } = makeSvc({ stub: true });
    mocks.audit.log.mockClear();

    await svc.pollAll();

    expect(mocks.audit.log).not.toHaveBeenCalled();
  });
});
