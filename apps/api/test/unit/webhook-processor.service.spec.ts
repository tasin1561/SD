import { ConflictException } from '@nestjs/common';
import {
  ActorType,
  DeliveryAttemptOutcome,
  OrderStatus,
  ShipmentStatus,
  TrackingEventSource,
  TrackingEventType,
  WebhookStatus,
} from '@skydrop/db';
import { WebhookProcessorService } from '../../src/modules/tracking-ingestion/services/webhook-processor.service';
import { TrackingStatusMappingService } from '../../src/modules/tracking-events/services/tracking-status-mapping.service';
import type {
  TrackingEventAppendService,
  AppendTrackingEventInput,
  TrackingEventRow,
} from '../../src/modules/tracking-events/services/tracking-event-append.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { DelhiveryTrackingService } from '../../src/modules/courier-delhivery/services/delhivery-tracking.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { NormalizedScan } from '../../src/modules/courier-delhivery/types/delhivery.types';

const COURIER = 'delhivery';
const SHIPMENT_ID = 'ship-AAA-0001';
const ORDER_ID = 'ord-AAA-0001';
const AWB = 'DLV-AWB-0001';
const WH_ID = 'wh-INC-0001';

interface FakeWebhook {
  id: string;
  courierCode: string;
  rawBody: string;
  parsedBody: unknown;
  status: WebhookStatus;
  shipmentId: string | null;
  awbNumber: string | null;
  trackingEventId: string | null;
  processedAt: Date | null;
  errorMessage: string | null;
}

interface FakeShipment {
  id: string;
  awbNumber: string;
  status: ShipmentStatus;
  orderId: string;
}

interface FakeOrder {
  id: string;
  status: OrderStatus;
}

interface FakeTrackingEvent {
  id: string;
  webhookId: string | null;
  eventType: TrackingEventType;
  shipmentId: string;
  eventAt: Date;
  status: ShipmentStatus;
  source: TrackingEventSource;
  metadata: unknown;
  isVisibleToCustomer: boolean;
}

interface FakeDeliveryAttempt {
  id: string;
  webhookId: string;
  shipmentId: string;
  attemptNumber: number;
  outcome: DeliveryAttemptOutcome;
  attemptedAt: Date;
}

interface Setup {
  webhooks?: FakeWebhook[];
  shipment?: FakeShipment;
  order?: FakeOrder;
  normalized?: NormalizedScan;
  /** When set, transitionStatus throws this on first call. */
  transitionThrows?: Error;
}

function defaultScanBody() {
  return {
    awb_number: AWB,
    raw_status: 'DLV-IN-TRANSIT',
    event_at: '2026-05-20T10:00:00.000Z',
    description: 'In transit at hub',
    location: { name: 'BLR_HUB', city: 'Bengaluru', pincode: '560037' },
  };
}

function ndrBody(eventAtIso: string) {
  return {
    awb_number: AWB,
    raw_status: 'DLV-NDR',
    event_at: eventAtIso,
    description: 'Customer unavailable',
    failure_reason: 'CUSTOMER_UNAVAILABLE',
  };
}

function defaultWebhook(over: Partial<FakeWebhook> = {}): FakeWebhook {
  return {
    id: WH_ID,
    courierCode: COURIER,
    rawBody: JSON.stringify(defaultScanBody()),
    parsedBody: defaultScanBody(),
    status: WebhookStatus.RECEIVED,
    shipmentId: null,
    awbNumber: null,
    trackingEventId: null,
    processedAt: null,
    errorMessage: null,
    ...over,
  };
}

function defaultShipment(over: Partial<FakeShipment> = {}): FakeShipment {
  return {
    id: SHIPMENT_ID,
    awbNumber: AWB,
    status: ShipmentStatus.IN_TRANSIT,
    orderId: ORDER_ID,
    ...over,
  };
}

function defaultOrder(over: Partial<FakeOrder> = {}): FakeOrder {
  return {
    id: ORDER_ID,
    status: OrderStatus.DISPATCHED,
    ...over,
  };
}

function makeProcessor(setup: Setup = {}) {
  const webhooks: FakeWebhook[] = setup.webhooks ?? [defaultWebhook()];
  const ship = setup.shipment ?? defaultShipment();
  const order = setup.order ?? defaultOrder();
  const trackingEvents: FakeTrackingEvent[] = [];
  const attempts: FakeDeliveryAttempt[] = [];
  let teId = 1;
  let attemptId = 1;

  const orderState = { ...order };

  const courierWebhookFindUnique = jest.fn(
    async (args: { where: { id: string } }): Promise<FakeWebhook | null> => {
      return webhooks.find((w) => w.id === args.where.id) ?? null;
    },
  );
  const courierWebhookUpdate = jest.fn(
    async (args: {
      where: { id: string };
      data: Partial<FakeWebhook>;
    }): Promise<FakeWebhook> => {
      const wh = webhooks.find((w) => w.id === args.where.id);
      if (!wh) throw new Error('webhook not found');
      Object.assign(wh, args.data);
      return wh;
    },
  );
  const courierWebhookUpdateMany = jest.fn(
    async (args: {
      where: { id: string; status: WebhookStatus };
      data: Partial<FakeWebhook>;
    }): Promise<{ count: number }> => {
      const wh = webhooks.find(
        (w) => w.id === args.where.id && w.status === args.where.status,
      );
      if (!wh) return { count: 0 };
      Object.assign(wh, args.data);
      return { count: 1 };
    },
  );

  const shipmentFindUnique = jest.fn(async () =>
    ship.awbNumber === AWB
      ? {
          id: ship.id,
          status: ship.status,
          orderShipments: [{ order: orderState }],
        }
      : null,
  );

  const trackingEventFindFirst = jest.fn(
    async (args: {
      where: { webhookId: string; eventType: TrackingEventType };
    }): Promise<FakeTrackingEvent | null> => {
      const found = trackingEvents.find(
        (t) =>
          t.webhookId === args.where.webhookId &&
          t.eventType === args.where.eventType,
      );
      return found ?? null;
    },
  );

  const deliveryAttemptFindFirst = jest.fn(
    async (args: {
      where: { webhookId: string };
    }): Promise<FakeDeliveryAttempt | null> => {
      return attempts.find((a) => a.webhookId === args.where.webhookId) ?? null;
    },
  );
  const deliveryAttemptCount = jest.fn(
    async (args: { where: { shipmentId: string } }): Promise<number> => {
      return attempts.filter((a) => a.shipmentId === args.where.shipmentId)
        .length;
    },
  );
  const deliveryAttemptCreate = jest.fn(
    async (args: {
      data: {
        shipmentId: string;
        attemptNumber: number;
        attemptedAt: Date;
        outcome: DeliveryAttemptOutcome;
        webhookId: string;
      };
    }): Promise<FakeDeliveryAttempt> => {
      // Enforce the @@unique([shipmentId, attemptNumber]).
      if (
        attempts.some(
          (a) =>
            a.shipmentId === args.data.shipmentId &&
            a.attemptNumber === args.data.attemptNumber,
        )
      ) {
        throw new Error('Unique constraint failed: (shipmentId, attemptNumber)');
      }
      const row: FakeDeliveryAttempt = {
        id: `att-${attemptId++}`,
        webhookId: args.data.webhookId,
        shipmentId: args.data.shipmentId,
        attemptNumber: args.data.attemptNumber,
        outcome: args.data.outcome,
        attemptedAt: args.data.attemptedAt,
      };
      attempts.push(row);
      return row;
    },
  );

  const $executeRaw = jest.fn(async () => 0); // advisory lock no-op

  // tx mirrors the client surface for the deliveryAttempt subset + raw SQL.
  const txLike = {
    deliveryAttempt: {
      findFirst: deliveryAttemptFindFirst,
      count: deliveryAttemptCount,
      create: deliveryAttemptCreate,
    },
    $executeRaw,
  };
  const $transaction = jest.fn(
    async <T>(fn: (tx: typeof txLike) => Promise<T>): Promise<T> => fn(txLike),
  );

  const client = {
    courierWebhook: {
      findUnique: courierWebhookFindUnique,
      update: courierWebhookUpdate,
      updateMany: courierWebhookUpdateMany,
    },
    shipment: { findUnique: shipmentFindUnique },
    trackingEvent: { findFirst: trackingEventFindFirst },
    $transaction,
  };

  // Real TrackingStatusMappingService — the test uses production mapping.
  const mapping = new TrackingStatusMappingService();

  // append delegates to a fake recording the input.
  const appendCalls: AppendTrackingEventInput[] = [];
  const fakeAppend = {
    append: jest.fn(
      async (input: AppendTrackingEventInput): Promise<TrackingEventRow> => {
        appendCalls.push(input);
        const row: FakeTrackingEvent = {
          id: `te-${teId++}`,
          webhookId: input.webhookId ?? null,
          eventType: input.eventType,
          shipmentId: input.shipmentId,
          eventAt: input.eventAt,
          status: input.status,
          source: input.source,
          metadata: input.metadata ?? null,
          isVisibleToCustomer: input.isVisibleToCustomer ?? true,
        };
        trackingEvents.push(row);
        // Map to the cross-module TrackingEventRow shape.
        return {
          id: row.id,
          createdAt: new Date(),
          eventAt: row.eventAt,
          shipmentId: row.shipmentId,
          eventType: row.eventType,
          status: row.status,
          source: row.source,
          courierCode: input.courierCode ?? null,
          rawCourierStatus: input.rawCourierStatus ?? null,
          description: input.description ?? null,
          locationName: input.locationName ?? null,
          locationCity: input.locationCity ?? null,
          locationPincode: input.locationPincode ?? null,
          webhookId: input.webhookId ?? null,
          actorType: input.actorType ?? null,
          actorId: input.actorId ?? null,
          // The Prisma JsonValue / InputJsonValue split: InputJsonValue
          // accepts class instances at the type level but JsonValue is
          // structural. The test payload is plain JSON-compatible, so
          // a structural cast is the right move here.
          metadata: (input.metadata ?? null) as TrackingEventRow['metadata'],
          isVisibleToCustomer: row.isVisibleToCustomer,
        };
      },
    ),
  };

  const courierDelhivery = {
    normalizeScan: jest.fn(
      (): NormalizedScan =>
        setup.normalized ?? {
          kind: 'NORMALIZED',
          shipmentStatus: ShipmentStatus.IN_TRANSIT,
        },
    ),
  };

  const transitionCalls: Array<{
    orderId: string;
    to: OrderStatus;
    expectedFrom?: OrderStatus;
  }> = [];
  let transitionThrow = setup.transitionThrows;
  const orderWrite = {
    transitionStatus: jest.fn(
      async (input: {
        orderId: string;
        to: OrderStatus;
        expectedFrom?: OrderStatus;
      }) => {
        transitionCalls.push(input);
        if (transitionThrow) {
          const err = transitionThrow;
          transitionThrow = undefined;
          throw err;
        }
        const fromStatus = orderState.status;
        orderState.status = input.to;
        return {
          orderId: input.orderId,
          fromStatus,
          status: input.to,
          reservationOutcome: null,
        };
      },
    ),
  };

  const auditLog = { log: jest.fn(async () => 'audit-id-1') };

  const svc = new WebhookProcessorService(
    { client } as unknown as PrismaService,
    courierDelhivery as unknown as DelhiveryTrackingService,
    mapping,
    fakeAppend as unknown as TrackingEventAppendService,
    orderWrite as unknown as OrderWriteService,
    auditLog as unknown as AuditLogService,
  );

  return {
    svc,
    state: {
      webhooks,
      shipment: ship,
      order: orderState,
      trackingEvents,
      attempts,
      appendCalls,
      transitionCalls,
    },
    mocks: {
      courierWebhookFindUnique,
      courierWebhookUpdate,
      courierWebhookUpdateMany,
      trackingEventFindFirst,
      deliveryAttemptCreate,
      deliveryAttemptFindFirst,
      fakeAppend,
      courierDelhivery,
      orderWrite,
      auditLog,
      $executeRaw,
    },
  };
}

function confictWithCode(code: string): ConflictException {
  return new ConflictException({ code, message: code });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('WebhookProcessorService.process — master idempotency (TRK-2)', () => {
  it('already PROCESSED → no-op (no append, no transition)', async () => {
    const { svc, mocks } = makeProcessor({
      webhooks: [defaultWebhook({ status: WebhookStatus.PROCESSED })],
    });
    const out = await svc.process(WH_ID);
    expect(out.kind).toBe('ALREADY_PROCESSED');
    expect(mocks.fakeAppend.append).not.toHaveBeenCalled();
    expect(mocks.orderWrite.transitionStatus).not.toHaveBeenCalled();
    expect(mocks.deliveryAttemptCreate).not.toHaveBeenCalled();
  });
});

describe('WebhookProcessorService.process — happy TRANSITION (saga: append then transition)', () => {
  it('IN_TRANSIT scan on DISPATCHED order → append + transition + PROCESSED', async () => {
    const { svc, state, mocks } = makeProcessor();
    const out = await svc.process(WH_ID);
    expect(out.kind).toBe('TRANSITIONED');
    expect(state.trackingEvents).toHaveLength(1);
    expect(state.trackingEvents[0]?.eventType).toBe(
      TrackingEventType.IN_TRANSIT_UPDATE,
    );
    expect(state.trackingEvents[0]?.isVisibleToCustomer).toBe(true);
    expect(state.transitionCalls).toHaveLength(1);
    expect(state.transitionCalls[0]).toMatchObject({
      orderId: ORDER_ID,
      to: OrderStatus.IN_TRANSIT,
      expectedFrom: OrderStatus.DISPATCHED,
    });
    // Append happens BEFORE transition (call order matters — visible-vs-silent).
    const appendCallOrder = mocks.fakeAppend.append.mock.invocationCallOrder[0]!;
    const transitionCallOrder =
      mocks.orderWrite.transitionStatus.mock.invocationCallOrder[0]!;
    expect(appendCallOrder).toBeLessThan(transitionCallOrder);
    expect(state.webhooks[0]?.status).toBe(WebhookStatus.PROCESSED);
    expect(state.webhooks[0]?.trackingEventId).toBe(state.trackingEvents[0]?.id);
  });
});

describe('WebhookProcessorService.process — DELIVERY_ATTEMPT saga (delivery_attempts FIRST, transition LAST)', () => {
  it('NDR on OUT_FOR_DELIVERY order: attempt row written BEFORE transition; tracking_event written; order → DELIVERY_FAILED', async () => {
    const { svc, state, mocks } = makeProcessor({
      webhooks: [
        defaultWebhook({
          rawBody: JSON.stringify(ndrBody('2026-05-20T10:00:00.000Z')),
          parsedBody: ndrBody('2026-05-20T10:00:00.000Z'),
        }),
      ],
      shipment: defaultShipment({ status: ShipmentStatus.OUT_FOR_DELIVERY }),
      order: defaultOrder({ status: OrderStatus.OUT_FOR_DELIVERY }),
      normalized: {
        kind: 'NORMALIZED',
        shipmentStatus: ShipmentStatus.DELIVERY_ATTEMPTED,
      },
    });
    const out = await svc.process(WH_ID);
    expect(out.kind).toBe('DELIVERY_ATTEMPT_TRANSITIONED');
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]).toMatchObject({
      webhookId: WH_ID,
      shipmentId: SHIPMENT_ID,
      attemptNumber: 1,
      outcome: DeliveryAttemptOutcome.FAILED,
    });
    expect(state.trackingEvents).toHaveLength(1);
    expect(state.trackingEvents[0]?.eventType).toBe(
      TrackingEventType.DELIVERY_ATTEMPTED,
    );
    expect(state.transitionCalls).toHaveLength(1);
    expect(state.transitionCalls[0]?.to).toBe(OrderStatus.DELIVERY_FAILED);

    // Saga ordering: attempt → tracking_event → transition.
    const attemptOrder = mocks.deliveryAttemptCreate.mock.invocationCallOrder[0]!;
    const appendOrder = mocks.fakeAppend.append.mock.invocationCallOrder[0]!;
    const transitionOrder =
      mocks.orderWrite.transitionStatus.mock.invocationCallOrder[0]!;
    expect(attemptOrder).toBeLessThan(appendOrder);
    expect(appendOrder).toBeLessThan(transitionOrder);
  });
});

describe('WebhookProcessorService.process — monotonic-forward guard', () => {
  it('IN_TRANSIT scan on OUT_FOR_DELIVERY order: skips transition (CURRENT_NOT_IN_ALLOWED_FROM); STILL appends tracking_event; PROCESSED', async () => {
    const { svc, state } = makeProcessor({
      shipment: defaultShipment({ status: ShipmentStatus.OUT_FOR_DELIVERY }),
      order: defaultOrder({ status: OrderStatus.OUT_FOR_DELIVERY }),
    });
    const out = await svc.process(WH_ID);
    expect(out.kind).toBe('TRANSITION_SKIPPED');
    if (out.kind === 'TRANSITION_SKIPPED') {
      expect(out.reason).toBe('CURRENT_NOT_IN_ALLOWED_FROM');
    }
    expect(state.trackingEvents).toHaveLength(1);
    expect(state.transitionCalls).toHaveLength(0);
    expect(state.webhooks[0]?.status).toBe(WebhookStatus.PROCESSED);
  });

  it('IN_TRANSIT scan on DELIVERED order (stale-backward): skipped + recorded + PROCESSED', async () => {
    const { svc, state } = makeProcessor({
      shipment: defaultShipment({ status: ShipmentStatus.DELIVERED }),
      order: defaultOrder({ status: OrderStatus.DELIVERED }),
    });
    const out = await svc.process(WH_ID);
    expect(out.kind).toBe('TRANSITION_SKIPPED');
    expect(state.transitionCalls).toHaveLength(0);
    expect(state.trackingEvents).toHaveLength(1);
  });
});

describe('WebhookProcessorService.process — DELIVERY_FAILED retry cycle (TRK-2 + NDR idempotency)', () => {
  it('three distinct NDR webhooks → 3 delivery_attempts rows with attempt_number 1,2,3; tracking_events written for each; ALREADY_AT_TARGET no-op transitions on the second/third', async () => {
    const wh1 = defaultWebhook({
      id: 'wh-NDR-1',
      rawBody: JSON.stringify(ndrBody('2026-05-20T10:00:00.000Z')),
      parsedBody: ndrBody('2026-05-20T10:00:00.000Z'),
    });
    const wh2 = defaultWebhook({
      id: 'wh-NDR-2',
      rawBody: JSON.stringify(ndrBody('2026-05-21T10:00:00.000Z')),
      parsedBody: ndrBody('2026-05-21T10:00:00.000Z'),
    });
    const wh3 = defaultWebhook({
      id: 'wh-NDR-3',
      rawBody: JSON.stringify(ndrBody('2026-05-22T10:00:00.000Z')),
      parsedBody: ndrBody('2026-05-22T10:00:00.000Z'),
    });
    const { svc, state } = makeProcessor({
      webhooks: [wh1, wh2, wh3],
      shipment: defaultShipment({ status: ShipmentStatus.OUT_FOR_DELIVERY }),
      order: defaultOrder({ status: OrderStatus.OUT_FOR_DELIVERY }),
      normalized: {
        kind: 'NORMALIZED',
        shipmentStatus: ShipmentStatus.DELIVERY_ATTEMPTED,
      },
    });

    const r1 = await svc.process('wh-NDR-1');
    // After r1, order is DELIVERY_FAILED.
    const r2 = await svc.process('wh-NDR-2');
    const r3 = await svc.process('wh-NDR-3');

    expect(r1.kind).toBe('DELIVERY_ATTEMPT_TRANSITIONED');
    // Subsequent NDRs land in ALREADY_AT_TARGET (current === DELIVERY_FAILED).
    expect(r2.kind).toBe('DELIVERY_ATTEMPT_SKIPPED');
    expect(r3.kind).toBe('DELIVERY_ATTEMPT_SKIPPED');
    if (r2.kind === 'DELIVERY_ATTEMPT_SKIPPED') {
      expect(r2.reason).toBe('ALREADY_AT_TARGET');
    }

    // CRITICAL: each NDR records a NEW attempt row regardless of the skip.
    expect(state.attempts).toHaveLength(3);
    expect(state.attempts.map((a) => a.attemptNumber)).toEqual([1, 2, 3]);
    expect(state.attempts.map((a) => a.webhookId)).toEqual([
      'wh-NDR-1',
      'wh-NDR-2',
      'wh-NDR-3',
    ]);

    // Three tracking_events.
    expect(state.trackingEvents).toHaveLength(3);
    // Only the first transition happened.
    expect(state.transitionCalls).toHaveLength(1);
    expect(state.order.status).toBe(OrderStatus.DELIVERY_FAILED);
  });
});

describe('WebhookProcessorService.process — webhook reprocess dedup (BullMQ retry)', () => {
  it('process(same webhookId) twice: second call no-ops cleanly (NO double tracking_event, NO double attempt, NO double transition)', async () => {
    const { svc, state, mocks } = makeProcessor({
      webhooks: [
        defaultWebhook({
          rawBody: JSON.stringify(ndrBody('2026-05-20T10:00:00.000Z')),
          parsedBody: ndrBody('2026-05-20T10:00:00.000Z'),
        }),
      ],
      shipment: defaultShipment({ status: ShipmentStatus.OUT_FOR_DELIVERY }),
      order: defaultOrder({ status: OrderStatus.OUT_FOR_DELIVERY }),
      normalized: {
        kind: 'NORMALIZED',
        shipmentStatus: ShipmentStatus.DELIVERY_ATTEMPTED,
      },
    });

    const r1 = await svc.process(WH_ID);
    expect(r1.kind).toBe('DELIVERY_ATTEMPT_TRANSITIONED');
    // Webhook was marked PROCESSED — second call hits master gate.
    const r2 = await svc.process(WH_ID);
    expect(r2.kind).toBe('ALREADY_PROCESSED');

    expect(state.attempts).toHaveLength(1);
    expect(state.trackingEvents).toHaveLength(1);
    expect(state.transitionCalls).toHaveLength(1);
    // append + create called exactly once on the live path.
    expect(mocks.fakeAppend.append).toHaveBeenCalledTimes(1);
    expect(mocks.deliveryAttemptCreate).toHaveBeenCalledTimes(1);
  });

  it('simulated mid-saga retry: a webhook left in RECEIVED with the TE + attempt already present (the post-attempt-but-pre-mark crash) re-enters and short-circuits — no double-write', async () => {
    const { svc, state, mocks } = makeProcessor({
      webhooks: [
        defaultWebhook({
          rawBody: JSON.stringify(ndrBody('2026-05-20T10:00:00.000Z')),
          parsedBody: ndrBody('2026-05-20T10:00:00.000Z'),
        }),
      ],
      shipment: defaultShipment({ status: ShipmentStatus.OUT_FOR_DELIVERY }),
      order: defaultOrder({ status: OrderStatus.OUT_FOR_DELIVERY }),
      normalized: {
        kind: 'NORMALIZED',
        shipmentStatus: ShipmentStatus.DELIVERY_ATTEMPTED,
      },
    });

    // Simulate a partial first run: attempt + tracking_event already exist
    // for this webhookId; webhook still RECEIVED (mark never happened).
    state.attempts.push({
      id: 'att-pre',
      webhookId: WH_ID,
      shipmentId: SHIPMENT_ID,
      attemptNumber: 1,
      outcome: DeliveryAttemptOutcome.FAILED,
      attemptedAt: new Date('2026-05-20T10:00:00.000Z'),
    });
    state.trackingEvents.push({
      id: 'te-pre',
      webhookId: WH_ID,
      eventType: TrackingEventType.DELIVERY_ATTEMPTED,
      shipmentId: SHIPMENT_ID,
      eventAt: new Date('2026-05-20T10:00:00.000Z'),
      status: ShipmentStatus.DELIVERY_ATTEMPTED,
      source: TrackingEventSource.COURIER_WEBHOOK,
      metadata: null,
      isVisibleToCustomer: true,
    });

    const out = await svc.process(WH_ID);
    expect(out.kind).toBe('DELIVERY_ATTEMPT_TRANSITIONED');

    // No second attempt — dedup hit on (webhookId).
    expect(state.attempts).toHaveLength(1);
    expect(mocks.deliveryAttemptCreate).not.toHaveBeenCalled();
    // No second tracking_event — dedup hit on (webhookId, eventType).
    expect(state.trackingEvents).toHaveLength(1);
    expect(mocks.fakeAppend.append).not.toHaveBeenCalled();
    // The transition was re-attempted (idempotent).
    expect(state.transitionCalls).toHaveLength(1);
    expect(state.webhooks[0]?.status).toBe(WebhookStatus.PROCESSED);
  });
});

describe('WebhookProcessorService.process — UNMAPPABLE + REJECT (no transitions)', () => {
  it('UNMAPPABLE: records tracking_event as STATUS_SYNC w/ metadata.unmappable, isVisibleToCustomer=false, marks PROCESSED, NO transition', async () => {
    const { svc, state, mocks } = makeProcessor({
      normalized: { kind: 'UNMAPPABLE', reason: 'STUB_UNKNOWN_CODE' },
    });
    const out = await svc.process(WH_ID);
    expect(out.kind).toBe('UNMAPPABLE');
    expect(state.trackingEvents).toHaveLength(1);
    expect(state.trackingEvents[0]?.eventType).toBe(
      TrackingEventType.STATUS_SYNC,
    );
    expect(state.trackingEvents[0]?.isVisibleToCustomer).toBe(false);
    expect(state.trackingEvents[0]?.metadata).toMatchObject({
      unmappable: true,
      reason: 'STUB_UNKNOWN_CODE',
    });
    expect(state.transitionCalls).toHaveLength(0);
    expect(state.webhooks[0]?.status).toBe(WebhookStatus.PROCESSED);
    expect(mocks.auditLog.log).not.toHaveBeenCalled();
  });

  it('REJECT: NOT_A_COURIER_SCAN_OUTCOME → IGNORED, audit HIGH, NO transition', async () => {
    const { svc, state, mocks } = makeProcessor({
      normalized: {
        kind: 'NORMALIZED',
        shipmentStatus: ShipmentStatus.CANCELLED, // mapping → REJECT
      },
    });
    const out = await svc.process(WH_ID);
    expect(out.kind).toBe('REJECT');
    expect(state.transitionCalls).toHaveLength(0);
    expect(state.webhooks[0]?.status).toBe(WebhookStatus.IGNORED);
    expect(mocks.auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tracking.webhook_scan_rejected',
        severity: 'HIGH',
        actorType: ActorType.SYSTEM,
      }),
    );
  });
});

describe('WebhookProcessorService.process — informational (RTO_DELIVERED, DAMAGED) — TRK-6/F6', () => {
  it('RTO_DELIVERED scan: INFORMATIONAL — records tracking_event, NO transition (TRK-6 warehouse boundary)', async () => {
    const { svc, state } = makeProcessor({
      normalized: {
        kind: 'NORMALIZED',
        shipmentStatus: ShipmentStatus.RTO_DELIVERED,
      },
      shipment: defaultShipment({ status: ShipmentStatus.RTO_IN_TRANSIT }),
      order: defaultOrder({ status: OrderStatus.RTO_IN_TRANSIT }),
    });
    const out = await svc.process(WH_ID);
    expect(out.kind).toBe('INFORMATIONAL');
    expect(state.trackingEvents).toHaveLength(1);
    expect(state.trackingEvents[0]?.eventType).toBe(
      TrackingEventType.RTO_DELIVERED,
    );
    expect(state.transitionCalls).toHaveLength(0);
    expect(state.webhooks[0]?.status).toBe(WebhookStatus.PROCESSED);
  });
});

describe('WebhookProcessorService.process — terminal-ignore branches', () => {
  it('NO_MATCHING_SHIPMENT: marks IGNORED, no append/attempt/transition', async () => {
    const { svc, state, mocks } = makeProcessor({
      shipment: defaultShipment({ awbNumber: 'DIFFERENT_AWB' }),
    });
    const out = await svc.process(WH_ID);
    expect(out.kind).toBe('NO_MATCHING_SHIPMENT');
    expect(state.webhooks[0]?.status).toBe(WebhookStatus.IGNORED);
    expect(mocks.fakeAppend.append).not.toHaveBeenCalled();
    expect(mocks.orderWrite.transitionStatus).not.toHaveBeenCalled();
  });

  it('PARSE_FAILED: marks IGNORED', async () => {
    const { svc, state } = makeProcessor({
      webhooks: [
        defaultWebhook({
          rawBody: '{}',
          parsedBody: {},
        }),
      ],
    });
    const out = await svc.process(WH_ID);
    expect(out.kind).toBe('PARSE_FAILED');
    expect(state.webhooks[0]?.status).toBe(WebhookStatus.IGNORED);
  });
});

describe('WebhookProcessorService.process — transitionStatus 409 race', () => {
  it('concurrent transition (STALE_ORDER_STATUS) → SKIPPED, PROCESSED, no throw', async () => {
    const { svc, state } = makeProcessor({
      transitionThrows: confictWithCode('STALE_ORDER_STATUS'),
    });
    const out = await svc.process(WH_ID);
    expect(out.kind).toBe('TRANSITION_SKIPPED');
    expect(state.trackingEvents).toHaveLength(1);
    expect(state.webhooks[0]?.status).toBe(WebhookStatus.PROCESSED);
  });
});
