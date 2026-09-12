import { OrderStatus } from '@skydrop/db';
import { OrderAdminOverrideService } from '../../src/modules/order/services/order-admin-override.service';
import {
  OrderLifecycleEventBus,
  type OrderLifecycleEvent,
} from '../../src/modules/lifecycle-events/order-lifecycle-event-bus.service';
import { OrderDeliveredAccrualListener } from '../../src/modules/seller-wallet-accrual/services/order-delivered-accrual-listener.service';
import { OutboundWebhookListener } from '../../src/modules/seller-webhook-delivery/services/outbound-webhook-listener.service';
import { WebhookEventMappingService } from '../../src/modules/seller-webhook-delivery/services/webhook-event-mapping.service';
import { OrderConfirmedAwbListener } from '../../src/modules/courier-awb/services/order-confirmed-awb-listener.service';
import { AwbGenerationJobService } from '../../src/modules/courier-awb/services/awb-generation-job.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * God mode (ORD-2) and the lifecycle bus, end to end in-process: the REAL
 * bus, the REAL override service, and the REAL listeners, with only their
 * outermost dependencies faked. What this pins is the thing a per-service
 * test cannot see — that a forced status change reaches every subscriber
 * through the one path a matrix transition uses.
 */

type AnyArgs = Record<string, unknown>;

const REASON = 'Ops lead: courier confirmed delivery by phone, tracking never updated';

function makeBus(): OrderLifecycleEventBus {
  const redis = {
    client: { publish: jest.fn(async () => 1) },
    createConnection: () => ({
      subscribe: jest.fn(async () => undefined),
      on: jest.fn(),
      quit: jest.fn(async () => 'OK'),
      disconnect: jest.fn(),
    }),
  } as never;
  return new OrderLifecycleEventBus(redis, { enabled: true } as never);
}

/** An override service over a one-order world whose status really moves. */
function makeGodMode(bus: OrderLifecycleEventBus, initial: OrderStatus) {
  let status = initial;
  let seq = 0;
  const tx = {
    order: {
      update: jest.fn(async (a: { data: AnyArgs }) => {
        if (a.data.status !== undefined) status = a.data.status as OrderStatus;
        return {};
      }),
    },
    shipment: { updateMany: jest.fn(async () => ({ count: 0 })) },
  };
  const client = {
    $transaction: <T>(fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
    order: {
      findFirst: jest.fn(async () => ({
        id: 'o1',
        sellerId: 's1',
        orderNumber: 'SD-2026-26-000042',
        status,
        items: [{ id: 'oi1', variantId: 'v1', quantity: 1 }],
      })),
    },
    systemSetting: { findUnique: jest.fn(async () => ({ valueString: 'wh-1' })) },
    shipment: { count: jest.fn(async () => 0) },
    orderEvent: { findMany: jest.fn(async () => []) },
  };
  const events = {
    adminAction: jest.fn(async () => ({ id: `note-${++seq}` })),
    statusChanged: jest.fn(async () => ({ id: `sc-${++seq}` })),
  };
  const refundIfCharged = jest.fn(async () => null);
  const svc = new OrderAdminOverrideService(
    { client } as unknown as PrismaService,
    events as never,
    { log: jest.fn(async () => 'a1') } as never,
    {
      reserve: jest.fn(async () => ({ id: 'r1' })),
      release: jest.fn(),
      listActiveForOrder: jest.fn(async () => []),
    } as never,
    { refundIfCharged } as never,
    bus,
  );
  const force = (targetStatus?: OrderStatus, fieldChanges?: AnyArgs): Promise<unknown> =>
    svc.forceMutate({
      orderId: 'o1',
      reason: REASON,
      acknowledgeDataIntegrityRisk: true,
      actorStaffId: 'staff-1',
      ...(targetStatus !== undefined ? { targetStatus } : {}),
      ...(fieldChanges !== undefined ? { fieldChanges } : {}),
    });
  return { force, events, refundIfCharged };
}

function record(bus: OrderLifecycleEventBus): OrderLifecycleEvent[] {
  const seen: OrderLifecycleEvent[] = [];
  bus.subscribe((e) => seen.push(e));
  return seen;
}

describe('god mode publishes the same lifecycle event a matrix transition does', () => {
  it('forced to DELIVERED: one event, and the delivery is billed once — a second forced edit does not re-bill', async () => {
    const bus = makeBus();
    const seen = record(bus);
    const accrueForDelivered = jest.fn(async () => 'EXECUTED' as const);
    const listener = new OrderDeliveredAccrualListener(
      bus,
      { accrueForDelivered } as never,
      { log: jest.fn(async () => 'a1') } as never,
    );
    listener.onApplicationBootstrap();
    // PENDING_CONFIRMATION → DELIVERED: an edge the matrix never allows.
    const god = makeGodMode(bus, OrderStatus.PENDING_CONFIRMATION);

    await god.force(OrderStatus.DELIVERED);
    await listener.drainInFlight();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      from: OrderStatus.PENDING_CONFIRMATION,
      to: OrderStatus.DELIVERED,
      statusEventId: 'sc-2',
      source: 'ADMIN_OVERRIDE',
    });
    expect(accrueForDelivered).toHaveBeenCalledTimes(1);
    expect(accrueForDelivered).toHaveBeenCalledWith('o1');

    // The order is DELIVERED now. Forcing it there again, or correcting a
    // field on it, changes no status — so nothing is announced or billed.
    await god.force(OrderStatus.DELIVERED);
    await god.force(undefined, { recipientName: 'Corrected Name' });
    await listener.drainInFlight();
    expect(seen).toHaveLength(1);
    expect(accrueForDelivered).toHaveBeenCalledTimes(1);

    await listener.onModuleDestroy();
    await bus.onModuleDestroy();
  });

  it('the outbound webhook listener receives it, keyed on the STATUS_CHANGED row', async () => {
    const bus = makeBus();
    const enqueue = jest.fn(async () => undefined);
    const prisma = {
      client: {
        sellerWebhookEndpoint: {
          findMany: jest.fn(async () => [
            { id: 'ep1', url: 'https://hooks.example.in/skydrop', secretKey: 'k' },
          ]),
        },
      },
    } as unknown as PrismaService;
    const listener = new OutboundWebhookListener(bus, new WebhookEventMappingService(), prisma, {
      enqueue,
    } as never);
    listener.onApplicationBootstrap();
    const god = makeGodMode(bus, OrderStatus.DISPATCHED);

    await god.force(OrderStatus.DELIVERED);
    await listener.drainInFlight();

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect((enqueue.mock.calls[0] as unknown as [AnyArgs])[0]).toMatchObject({
      endpointId: 'ep1',
      eventId: 'sc-2',
      eventType: new WebhookEventMappingService().resolveForOrderStatus(OrderStatus.DELIVERED),
    });

    await listener.onModuleDestroy();
    await bus.onModuleDestroy();
  });

  it('a god-mode CONFIRMED reaches the AWB listener; with no shipment the job no-ops cleanly', async () => {
    const bus = makeBus();
    const enqueueOrder = jest.fn(async () => 'job-1');
    const awb = new OrderConfirmedAwbListener(bus, { enqueueOrder } as never);
    awb.onApplicationBootstrap();
    const god = makeGodMode(bus, OrderStatus.OUT_OF_STOCK);

    await god.force(OrderStatus.CONFIRMED);
    await awb.drainInFlight();
    expect(enqueueOrder).toHaveBeenCalledTimes(1);
    expect(enqueueOrder).toHaveBeenCalledWith('o1');

    // What that job then does: god mode provisions no shipment (ORD-2),
    // so there is nothing CREATED to book. A clean return — no throw, so
    // BullMQ does not retry, and no courier is called.
    const generateForShipment = jest.fn();
    const job = new AwbGenerationJobService(
      {
        client: { orderShipment: { findFirst: jest.fn(async () => null) } },
      } as unknown as PrismaService,
      { log: jest.fn() } as never,
      {} as never,
      { generateForShipment } as never,
      {} as never,
      {} as never,
    );
    await expect(job.processOrder('o1')).resolves.toEqual({
      orderId: 'o1',
      shipmentId: null,
      result: 'NO_LIVE_SHIPMENT',
    });
    expect(generateForShipment).not.toHaveBeenCalled();

    await awb.onModuleDestroy();
    await bus.onModuleDestroy();
  });

  it('a throwing listener neither fails forceMutate nor starves the others (NOTIF-1)', async () => {
    const bus = makeBus();
    bus.subscribe(() => {
      throw new Error('listener exploded');
    });
    const seen = record(bus);
    const god = makeGodMode(bus, OrderStatus.CONFIRMED);

    await expect(god.force(OrderStatus.CANCELLED_BY_ADMIN)).resolves.toMatchObject({
      status: OrderStatus.CANCELLED_BY_ADMIN,
    });
    expect(seen).toHaveLength(1);
    // A never-dispatched order: its delivery fee goes back.
    expect(god.refundIfCharged).toHaveBeenCalledTimes(1);

    await bus.onModuleDestroy();
  });
});
