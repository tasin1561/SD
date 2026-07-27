import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  ActorType,
  DeliveryAttemptOutcome,
  DeliveryFailureReason,
  OrderStatus,
  ShipmentStatus,
  TrackingEventSource,
  TrackingEventType,
} from '@skydrop/db';
import { ManualTrackingService } from '../../src/modules/tracking-manual/services/manual-tracking.service';
import { TrackingStatusMappingService } from '../../src/modules/tracking-events/services/tracking-status-mapping.service';
import type {
  TrackingEventAppendService,
  AppendTrackingEventInput,
  TrackingEventRow,
} from '../../src/modules/tracking-events/services/tracking-event-append.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';

const SHIPMENT_ID = 'ship-MAN-0001';
const ORDER_ID = 'ord-MAN-0001';
const STAFF_ID = 'staff-OPS-1';
const COURIER = 'manual';

interface FakeShip {
  id: string;
  courierCode: string;
  deletedAt: Date | null;
}

interface FakeOrder {
  id: string;
  status: OrderStatus;
}

interface FakeAttempt {
  id: string;
  shipmentId: string;
  attemptNumber: number;
  attemptedAt: Date;
  outcome: DeliveryAttemptOutcome;
  failureReason: DeliveryFailureReason | null;
  source: TrackingEventSource;
}

function makeSvc(
  opts: {
    ship?: FakeShip | null;
    order?: FakeOrder | null;
    transitionThrows?: Error;
  } = {},
) {
  const ship = opts.ship ?? {
    id: SHIPMENT_ID,
    courierCode: COURIER,
    deletedAt: null,
  };
  const order = { ...(opts.order ?? { id: ORDER_ID, status: OrderStatus.DISPATCHED }) };
  const attempts: FakeAttempt[] = [];
  const appendCalls: AppendTrackingEventInput[] = [];
  let attemptCounter = 1;
  let teCounter = 1;

  const shipmentFindUnique = jest.fn(async () =>
    opts.ship === null
      ? null
      : {
          ...ship,
          orderShipments: [{ order }],
        },
  );

  const deliveryAttemptCount = jest.fn(
    async (args: { where: { shipmentId: string } }): Promise<number> =>
      attempts.filter((a) => a.shipmentId === args.where.shipmentId).length,
  );
  const deliveryAttemptCreate = jest.fn(
    async (args: {
      data: {
        shipmentId: string;
        attemptNumber: number;
        attemptedAt: Date;
        outcome: DeliveryAttemptOutcome;
        failureReason?: DeliveryFailureReason;
        source: TrackingEventSource;
      };
    }): Promise<FakeAttempt> => {
      if (
        attempts.some(
          (a) =>
            a.shipmentId === args.data.shipmentId && a.attemptNumber === args.data.attemptNumber,
        )
      ) {
        const err: Error & { code?: string } = new Error('P2002');
        err.code = 'P2002';
        throw err;
      }
      const row: FakeAttempt = {
        id: `att-${attemptCounter++}`,
        shipmentId: args.data.shipmentId,
        attemptNumber: args.data.attemptNumber,
        attemptedAt: args.data.attemptedAt,
        outcome: args.data.outcome,
        failureReason: args.data.failureReason ?? null,
        source: args.data.source,
      };
      attempts.push(row);
      return row;
    },
  );

  const client = {
    shipment: { findUnique: shipmentFindUnique },
    deliveryAttempt: { count: deliveryAttemptCount, create: deliveryAttemptCreate },
  };

  const mapping = new TrackingStatusMappingService();

  const fakeAppend = {
    append: jest.fn(async (input: AppendTrackingEventInput): Promise<TrackingEventRow> => {
      appendCalls.push(input);
      return {
        id: `te-${teCounter++}`,
        createdAt: new Date(),
        eventAt: input.eventAt,
        shipmentId: input.shipmentId,
        eventType: input.eventType,
        status: input.status,
        source: input.source,
        courierCode: input.courierCode ?? null,
        rawCourierStatus: input.rawCourierStatus ?? null,
        nslCode: input.nslCode ?? null,
        description: input.description ?? null,
        locationName: input.locationName ?? null,
        locationCity: input.locationCity ?? null,
        locationPincode: input.locationPincode ?? null,
        webhookId: input.webhookId ?? null,
        actorType: input.actorType ?? null,
        actorId: input.actorId ?? null,
        metadata: null,
        isVisibleToCustomer: input.isVisibleToCustomer ?? true,
      };
    }),
  };

  let transitionThrow = opts.transitionThrows;
  const transitionCalls: Array<{
    orderId: string;
    to: OrderStatus;
    actor?: { type: ActorType; id?: string | null };
  }> = [];
  const orderWrite = {
    transitionStatus: jest.fn(
      async (input: {
        orderId: string;
        to: OrderStatus;
        expectedFrom?: OrderStatus;
        actor: { type: ActorType; id?: string | null };
      }) => {
        transitionCalls.push({ orderId: input.orderId, to: input.to, actor: input.actor });
        if (transitionThrow) {
          const e = transitionThrow;
          transitionThrow = undefined;
          throw e;
        }
        const fromStatus = order.status;
        order.status = input.to;
        return { orderId: input.orderId, fromStatus, status: input.to, reservationOutcome: null };
      },
    ),
  };

  const svc = new ManualTrackingService(
    { client } as unknown as PrismaService,
    mapping,
    fakeAppend as unknown as TrackingEventAppendService,
    orderWrite as unknown as OrderWriteService,
  );

  return {
    svc,
    state: { attempts, appendCalls, transitionCalls, order },
    mocks: { shipmentFindUnique, deliveryAttemptCreate, fakeAppend, orderWrite },
  };
}

describe('ManualTrackingService.recordScan — happy TRANSITION (TRK-9)', () => {
  it('IN_TRANSIT scan on DISPATCHED order: append (source=MANUAL_ENTRY, actorType=STAFF, actorId=staff), then transition; actor.id is the staff', async () => {
    const { svc, state, mocks } = makeSvc();
    const out = await svc.recordScan(
      SHIPMENT_ID,
      {
        status: ShipmentStatus.IN_TRANSIT,
        eventAtIso: '2026-05-20T10:00:00.000Z',
        description: 'Hand-off confirmed by ops',
        locationCity: 'Bengaluru',
      },
      STAFF_ID,
    );
    expect(out.kind).toBe('TRANSITIONED');
    expect(state.appendCalls).toHaveLength(1);
    expect(state.appendCalls[0]).toMatchObject({
      shipmentId: SHIPMENT_ID,
      source: TrackingEventSource.MANUAL_ENTRY,
      actorType: ActorType.STAFF,
      actorId: STAFF_ID,
      eventType: TrackingEventType.IN_TRANSIT_UPDATE,
      status: ShipmentStatus.IN_TRANSIT,
    });
    // No webhookId for manual entries.
    expect(state.appendCalls[0]?.webhookId).toBeUndefined();
    expect(state.transitionCalls).toHaveLength(1);
    expect(state.transitionCalls[0]).toMatchObject({
      orderId: ORDER_ID,
      to: OrderStatus.IN_TRANSIT,
      actor: { type: ActorType.STAFF, id: STAFF_ID },
    });
    // Saga ordering: append BEFORE transition.
    const appendOrder = mocks.fakeAppend.append.mock.invocationCallOrder[0]!;
    const transitionOrder = mocks.orderWrite.transitionStatus.mock.invocationCallOrder[0]!;
    expect(appendOrder).toBeLessThan(transitionOrder);
  });
});

describe('ManualTrackingService.recordScan — DELIVERY_ATTEMPT saga (attempt FIRST)', () => {
  it('NDR scan on OUT_FOR_DELIVERY order: delivery_attempts row written BEFORE the append; failureReason passed through; transition LAST', async () => {
    const { svc, state, mocks } = makeSvc({
      order: { id: ORDER_ID, status: OrderStatus.OUT_FOR_DELIVERY },
    });
    const out = await svc.recordScan(
      SHIPMENT_ID,
      {
        status: ShipmentStatus.DELIVERY_ATTEMPTED,
        eventAtIso: '2026-05-22T14:00:00.000Z',
        description: 'Customer unavailable',
        failureReason: DeliveryFailureReason.CUSTOMER_UNAVAILABLE,
      },
      STAFF_ID,
    );
    expect(out.kind).toBe('DELIVERY_ATTEMPT_TRANSITIONED');
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]).toMatchObject({
      shipmentId: SHIPMENT_ID,
      attemptNumber: 1,
      outcome: DeliveryAttemptOutcome.FAILED,
      failureReason: DeliveryFailureReason.CUSTOMER_UNAVAILABLE,
      source: TrackingEventSource.MANUAL_ENTRY,
    });
    // Saga: attempt → append → transition.
    const attemptOrder = mocks.deliveryAttemptCreate.mock.invocationCallOrder[0]!;
    const appendOrder = mocks.fakeAppend.append.mock.invocationCallOrder[0]!;
    const transitionOrder = mocks.orderWrite.transitionStatus.mock.invocationCallOrder[0]!;
    expect(attemptOrder).toBeLessThan(appendOrder);
    expect(appendOrder).toBeLessThan(transitionOrder);
  });
});

describe('ManualTrackingService.recordScan — monotonic-forward guard (mirrors webhook processor)', () => {
  it('IN_TRANSIT scan on OUT_FOR_DELIVERY order: SKIPPED, no transition, event still recorded', async () => {
    const { svc, state } = makeSvc({
      order: { id: ORDER_ID, status: OrderStatus.OUT_FOR_DELIVERY },
    });
    const out = await svc.recordScan(
      SHIPMENT_ID,
      {
        status: ShipmentStatus.IN_TRANSIT,
        eventAtIso: '2026-05-20T10:00:00.000Z',
      },
      STAFF_ID,
    );
    expect(out.kind).toBe('TRANSITION_SKIPPED');
    expect(state.transitionCalls).toHaveLength(0);
    expect(state.appendCalls).toHaveLength(1);
  });

  it('repeat NDR scan on already-DELIVERY_FAILED order: ALREADY_AT_TARGET — attempt STILL written, transition no-op', async () => {
    const { svc, state } = makeSvc({
      order: { id: ORDER_ID, status: OrderStatus.DELIVERY_FAILED },
    });
    const out = await svc.recordScan(
      SHIPMENT_ID,
      {
        status: ShipmentStatus.DELIVERY_ATTEMPTED,
        eventAtIso: '2026-05-23T14:00:00.000Z',
        failureReason: DeliveryFailureReason.CUSTOMER_UNAVAILABLE,
      },
      STAFF_ID,
    );
    expect(out.kind).toBe('DELIVERY_ATTEMPT_SKIPPED');
    if (out.kind === 'DELIVERY_ATTEMPT_SKIPPED') {
      expect(out.reason).toBe('ALREADY_AT_TARGET');
    }
    expect(state.attempts).toHaveLength(1);
    expect(state.transitionCalls).toHaveLength(0);
  });
});

describe('ManualTrackingService.recordScan — INFORMATIONAL (RTO_DELIVERED, DAMAGED — TRK-6 boundary)', () => {
  it('RTO_DELIVERED manual scan: INFORMATIONAL — recorded but no transition (warehouse RtoReceiptService owns RTO_RECEIVED)', async () => {
    const { svc, state } = makeSvc({
      order: { id: ORDER_ID, status: OrderStatus.RTO_IN_TRANSIT },
    });
    const out = await svc.recordScan(
      SHIPMENT_ID,
      {
        status: ShipmentStatus.RTO_DELIVERED,
        eventAtIso: '2026-05-25T10:00:00.000Z',
      },
      STAFF_ID,
    );
    expect(out.kind).toBe('INFORMATIONAL');
    expect(state.appendCalls).toHaveLength(1);
    expect(state.transitionCalls).toHaveLength(0);
  });
});

describe('ManualTrackingService.recordScan — validation + 404', () => {
  it('invalid eventAtIso → 400 INVALID_EVENT_AT', async () => {
    const { svc } = makeSvc();
    await expect(
      svc.recordScan(
        SHIPMENT_ID,
        { status: ShipmentStatus.IN_TRANSIT, eventAtIso: 'not-a-date' },
        STAFF_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('non-existent shipment → 404', async () => {
    const { svc } = makeSvc({ ship: null });
    await expect(
      svc.recordScan(
        SHIPMENT_ID,
        { status: ShipmentStatus.IN_TRANSIT, eventAtIso: '2026-05-20T10:00:00.000Z' },
        STAFF_ID,
      ),
    ).rejects.toThrow(/not found/);
  });
});

describe('ManualTrackingService.recordScan — concurrent transition race', () => {
  it('transitionStatus throws ConflictException → SKIPPED (no error to caller, event recorded)', async () => {
    const { svc, state } = makeSvc({
      transitionThrows: new ConflictException({
        code: 'STALE_ORDER_STATUS',
        message: 'STALE',
      }),
    });
    const out = await svc.recordScan(
      SHIPMENT_ID,
      { status: ShipmentStatus.IN_TRANSIT, eventAtIso: '2026-05-20T10:00:00.000Z' },
      STAFF_ID,
    );
    expect(out.kind).toBe('TRANSITION_SKIPPED');
    expect(state.appendCalls).toHaveLength(1);
  });
});
