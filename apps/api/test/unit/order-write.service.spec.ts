import { ConflictException, NotFoundException } from '@nestjs/common';
import { ActorType, OrderStatus, QueueClosureReason } from '@skydrop/db';
import { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import { OrderStateMachineService } from '../../src/modules/order/services/order-state-machine.service';
import { InsufficientStockError } from '../../src/modules/inventory-stock/services/stock-reservation.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type AnyArgs = Record<string, unknown>;

const ACTOR = { type: ActorType.STAFF, id: 'staff-1' };

function makeService(
  opts: {
    order?: AnyArgs | null;
    reserveThrows?: boolean;
    statusTxThrows?: boolean;
    active?: Array<{ id: string; orderItemId: string; qtyReserved: number }>;
    /** Phase-2 reservation rows for the DISPATCH_STOCK handler. */
    activeWithLocations?: Array<AnyArgs>;
    /** Live OrderShipment for the order ({ shipmentId } or null). */
    liveOrderShipment?: { shipmentId: string } | null;
    /** Pre-existing DISPATCH movement → the gate fires. */
    existingDispatchMovement?: boolean;
  } = {},
) {
  const order =
    opts.order === undefined
      ? {
          id: 'o1',
          sellerId: 's1',
          orderNumber: 'SD-2026-26-000001',
          status: OrderStatus.PENDING_CONFIRMATION,
          items: [{ id: 'oi1', variantId: 'v1', quantity: 2 }],
        }
      : opts.order;

  const orderUpdate = jest.fn(async (a: { data: AnyArgs }) => ({ id: 'o1', ...a.data }));
  const txClient = { order: { update: orderUpdate } };
  const orderFindFirst = jest.fn(async () => order);
  const systemSettingFindUnique = jest.fn(async () => ({ valueString: 'wh-1' }));

  const orderShipmentFindFirst = jest.fn(async () =>
    opts.liveOrderShipment === undefined
      ? { shipmentId: 'ship-1' }
      : opts.liveOrderShipment,
  );
  const stockMovementFindFirst = jest.fn(async () =>
    opts.existingDispatchMovement ? { id: 'mv-prior' } : null,
  );

  const client = {} as {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
    order: { findFirst: typeof orderFindFirst };
    systemSetting: { findUnique: typeof systemSettingFindUnique };
    orderShipment: { findFirst: typeof orderShipmentFindFirst };
    stockMovement: { findFirst: typeof stockMovementFindFirst };
  };
  client.$transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    if (opts.statusTxThrows) throw new Error('status tx boom');
    return fn(txClient);
  };
  client.order = { findFirst: orderFindFirst };
  client.systemSetting = { findUnique: systemSettingFindUnique };
  client.orderShipment = { findFirst: orderShipmentFindFirst };
  client.stockMovement = { findFirst: stockMovementFindFirst };

  const stateMachine = new OrderStateMachineService();
  const events = {
    statusChanged: jest.fn(async () => ({ id: 'e1' })),
    stockReserved: jest.fn(async () => ({ id: 'e2' })),
  };
  const audit = { log: jest.fn(async () => 'a1') };
  const reserve = jest.fn(async (i: { orderItemId: string }) => {
    if (opts.reserveThrows) throw new InsufficientStockError(2, 0);
    return { id: `r-${i.orderItemId}` };
  });
  const release = jest.fn(async () => ({ alreadyInactive: false }));
  const fulfill = jest.fn(async () => ({ alreadyInactive: false }));
  const listActiveForOrder = jest.fn(async () => opts.active ?? []);
  const listActiveForOrderWithLocations = jest.fn(
    async () => opts.activeWithLocations ?? [],
  );
  const reservations = {
    reserve,
    release,
    fulfill,
    listActiveForOrder,
    listActiveForOrderWithLocations,
  };

  const mutationApply = jest.fn(async () => ({ movementId: 'mv-1' }));
  const runWithRetry = jest.fn(
    async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  );
  const mutation = { apply: mutationApply, runWithRetry };

  const enqueueOrder = jest.fn(async () => ({ entry: {}, created: true }));
  const dequeueOrder = jest.fn(async () => ({ dequeued: 0, preemptedAssigned: false }));
  const callQueue = { enqueueOrder, dequeueOrder };

  const provisionFromSnapshot = jest.fn(async () => ({
    shipmentId: 'ship-new',
    created: true,
  }));
  const voidForOrder = jest.fn(async () => ({ voided: 0 }));
  const shipmentProvision = { provisionFromSnapshot, voidForOrder };

  const svc = new OrderWriteService(
    { client } as unknown as PrismaService,
    stateMachine,
    events as never,
    audit as never,
    reservations as never,
    callQueue as never,
    shipmentProvision as never,
    mutation as never,
  );
  return {
    svc,
    orderUpdate,
    orderFindFirst,
    orderShipmentFindFirst,
    stockMovementFindFirst,
    listActiveForOrderWithLocations,
    mutationApply,
    runWithRetry,
    events,
    audit,
    reserve,
    release,
    fulfill,
    listActiveForOrder,
    enqueueOrder,
    dequeueOrder,
    provisionFromSnapshot,
    voidForOrder,
  };
}

describe('OrderWriteService.transitionStatus', () => {
  it('reserves per line then commits CONFIRMED (RESERVE pre-tx)', async () => {
    const { svc, orderUpdate, reserve, events } = makeService();
    const res = await svc.transitionStatus({
      orderId: 'o1',
      to: OrderStatus.CONFIRMED,
      actor: ACTOR,
    });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(res.reservationOutcome).toBe('RESERVED');
    const data = orderUpdate.mock.calls[0]![0].data as AnyArgs;
    expect(data.status).toBe(OrderStatus.CONFIRMED);
    expect(data.confirmedAt).toBeInstanceOf(Date);
    expect(events.stockReserved).toHaveBeenCalledTimes(1);
  });

  it('lands OUT_OF_STOCK on InsufficientStockError and rolls back partials', async () => {
    const { svc, orderUpdate, release } = makeService({ reserveThrows: true });
    const res = await svc.transitionStatus({
      orderId: 'o1',
      to: OrderStatus.CONFIRMED,
      actor: ACTOR,
    });
    expect(res.reservationOutcome).toBe('OUT_OF_STOCK');
    expect(res.status).toBe(OrderStatus.OUT_OF_STOCK);
    expect((orderUpdate.mock.calls[0]![0].data as AnyArgs).status).toBe(
      OrderStatus.OUT_OF_STOCK,
    );
    // No reservation succeeded (threw on the first) → nothing to release.
    expect(release).not.toHaveBeenCalled();
  });

  it('compensates with release when the status tx fails after reserve', async () => {
    const { svc, release } = makeService({ statusTxThrows: true });
    await expect(
      svc.transitionStatus({ orderId: 'o1', to: OrderStatus.CONFIRMED, actor: ACTOR }),
    ).rejects.toThrow('status tx boom');
    expect(release).toHaveBeenCalledTimes(1); // the one created reservation
  });

  it('RELEASE runs POST-commit, idempotent, per active reservation', async () => {
    const { svc, orderUpdate, release, listActiveForOrder } = makeService({
      order: {
        id: 'o1',
        sellerId: 's1',
        orderNumber: 'SD-1',
        status: OrderStatus.CONFIRMED,
        items: [{ id: 'oi1', variantId: 'v1', quantity: 2 }],
      },
      active: [{ id: 'r1', orderItemId: 'oi1', qtyReserved: 2 }],
    });
    const res = await svc.transitionStatus({
      orderId: 'o1',
      to: OrderStatus.CANCELLED,
      actor: ACTOR,
    });
    // status tx ran before the stock settle
    expect(orderUpdate).toHaveBeenCalledTimes(1);
    expect(listActiveForOrder).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(res.reservationOutcome).toBe('RELEASED');
    const data = orderUpdate.mock.calls[0]![0].data as AnyArgs;
    expect(data.status).toBe(OrderStatus.CANCELLED);
    expect(data.cancelledAt).toBeInstanceOf(Date);
  });

  it('OUT_FOR_DELIVERY → DELIVERED is STOCK-NEUTRAL (M9 Model A — no fulfill)', async () => {
    const { svc, fulfill, mutationApply, orderUpdate } = makeService({
      order: {
        id: 'o1',
        sellerId: 's1',
        orderNumber: 'SD-1',
        status: OrderStatus.OUT_FOR_DELIVERY,
        items: [{ id: 'oi1', variantId: 'v1', quantity: 1 }],
      },
      active: [{ id: 'r1', orderItemId: 'oi1', qtyReserved: 1 }],
    });
    const res = await svc.transitionStatus({
      orderId: 'o1',
      to: OrderStatus.DELIVERED,
      actor: ACTOR,
    });
    // Model A: qtyOnHand was decremented + the reservation FULFILLED at
    // DISPATCH; DELIVERED touches no stock.
    expect(fulfill).not.toHaveBeenCalled();
    expect(mutationApply).not.toHaveBeenCalled();
    expect(orderUpdate).toHaveBeenCalledTimes(1); // plain transition
    expect(res.status).toBe(OrderStatus.DELIVERED);
    expect(res.reservationOutcome).toBeNull();
  });

  it('rejects an invalid transition', async () => {
    const { svc } = makeService({
      order: {
        id: 'o1',
        sellerId: 's1',
        orderNumber: 'SD-1',
        status: OrderStatus.DELIVERED,
        items: [],
      },
    });
    await expect(
      svc.transitionStatus({ orderId: 'o1', to: OrderStatus.CONFIRMED, actor: ACTOR }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('enforces the optimistic expectedFrom guard', async () => {
    const { svc } = makeService();
    await expect(
      svc.transitionStatus({
        orderId: 'o1',
        to: OrderStatus.CONFIRMED,
        actor: ACTOR,
        expectedFrom: OrderStatus.DRAFT,
      }),
    ).rejects.toMatchObject({ response: { code: 'STALE_ORDER_STATUS' } });
  });

  it('404s a missing order', async () => {
    const { svc } = makeService({ order: null });
    await expect(
      svc.transitionStatus({ orderId: 'o1', to: OrderStatus.CONFIRMED, actor: ACTOR }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('plain transition (no stock side-effect) → outcome null', async () => {
    const { svc, release, fulfill, reserve } = makeService({
      order: {
        id: 'o1',
        sellerId: 's1',
        orderNumber: 'SD-1',
        status: OrderStatus.CONFIRMED,
        items: [],
      },
    });
    const res = await svc.transitionStatus({
      orderId: 'o1',
      to: OrderStatus.PENDING_PICK,
      actor: ACTOR,
    });
    expect(res.reservationOutcome).toBeNull();
    expect(reserve).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(fulfill).not.toHaveBeenCalled();
  });

  it('matrix-declared self-loop (CALL_NO_RESPONSE→CALL_NO_RESPONSE) proceeds: STATUS_CHANGED event, no side-effects', async () => {
    const { svc, orderUpdate, events, reserve, release, fulfill } = makeService({
      order: {
        id: 'o1',
        sellerId: 's1',
        orderNumber: 'SD-1',
        status: OrderStatus.CALL_NO_RESPONSE,
        items: [],
      },
    });
    const res = await svc.transitionStatus({
      orderId: 'o1',
      to: OrderStatus.CALL_NO_RESPONSE,
      actor: ACTOR,
    });
    expect(res.status).toBe(OrderStatus.CALL_NO_RESPONSE);
    expect(res.reservationOutcome).toBeNull();
    expect(orderUpdate).toHaveBeenCalled();
    expect(events.statusChanged).toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(fulfill).not.toHaveBeenCalled();
  });

  it('still 409 NOOP_TRANSITION for a from===to the matrix does NOT declare', async () => {
    const { svc } = makeService({
      order: {
        id: 'o1',
        sellerId: 's1',
        orderNumber: 'SD-1',
        status: OrderStatus.CONFIRMED,
        items: [],
      },
    });
    await expect(
      svc.transitionStatus({ orderId: 'o1', to: OrderStatus.CONFIRMED, actor: ACTOR }),
    ).rejects.toMatchObject({ response: { code: 'NOOP_TRANSITION' } });
  });

  it('CC-6: a transition INTO PENDING_CONFIRMATION enqueues the call (post-commit)', async () => {
    const { svc, enqueueOrder } = makeService({
      order: {
        id: 'o1',
        sellerId: 's1',
        orderNumber: 'SD-1',
        status: OrderStatus.OUT_OF_STOCK,
        items: [],
      },
    });
    const res = await svc.transitionStatus({
      orderId: 'o1',
      to: OrderStatus.PENDING_CONFIRMATION,
      actor: ACTOR,
    });
    expect(res.status).toBe(OrderStatus.PENDING_CONFIRMATION);
    expect(enqueueOrder).toHaveBeenCalledWith('o1', undefined);
  });

  it('CC-6: a non-PENDING_CONFIRMATION transition does NOT enqueue', async () => {
    const { svc, enqueueOrder, dequeueOrder } = makeService({
      order: {
        id: 'o1',
        sellerId: 's1',
        orderNumber: 'SD-1',
        status: OrderStatus.CONFIRMED,
        items: [],
      },
    });
    await svc.transitionStatus({
      orderId: 'o1',
      to: OrderStatus.PENDING_PICK,
      actor: ACTOR,
    });
    expect(enqueueOrder).not.toHaveBeenCalled();
    expect(dequeueOrder).not.toHaveBeenCalled(); // not leaving PENDING_CONFIRMATION
  });

  it('CC-6: PENDING_CONFIRMATION → CONFIRMED dequeues (ORDER_CONFIRMED)', async () => {
    const { svc, dequeueOrder } = makeService(); // default reserve → CONFIRMED
    const r = await svc.transitionStatus({
      orderId: 'o1',
      to: OrderStatus.CONFIRMED,
      actor: ACTOR,
    });
    expect(r.status).toBe(OrderStatus.CONFIRMED);
    expect(dequeueOrder).toHaveBeenCalledWith(
      'o1',
      QueueClosureReason.ORDER_CONFIRMED,
      undefined,
    );
  });

  it('CC-6: PENDING_CONFIRMATION → REJECTED_NDR dequeues (MAX_ATTEMPTS_EXCEEDED)', async () => {
    const { svc, dequeueOrder } = makeService({
      order: {
        id: 'o1',
        sellerId: 's1',
        orderNumber: 'SD-1',
        status: OrderStatus.PENDING_CONFIRMATION,
        items: [],
      },
    });
    await svc.transitionStatus({
      orderId: 'o1',
      to: OrderStatus.REJECTED_NDR,
      actor: ACTOR,
    });
    expect(dequeueOrder).toHaveBeenCalledWith(
      'o1',
      QueueClosureReason.MAX_ATTEMPTS_EXCEEDED,
      undefined,
    );
  });

  it('CC-6: PENDING_CONFIRMATION → CANCELLED dequeues (ORDER_CANCELLED)', async () => {
    const { svc, dequeueOrder } = makeService({
      order: {
        id: 'o1',
        sellerId: 's1',
        orderNumber: 'SD-1',
        status: OrderStatus.PENDING_CONFIRMATION,
        items: [],
      },
    });
    await svc.transitionStatus({
      orderId: 'o1',
      to: OrderStatus.CANCELLED,
      actor: ACTOR,
    });
    expect(dequeueOrder).toHaveBeenCalledWith(
      'o1',
      QueueClosureReason.ORDER_CANCELLED,
      undefined,
    );
  });
});

describe('OrderWriteService.transitionStatus — DISPATCH_STOCK (M9 bug-1 fix)', () => {
  const dispatchOrder = {
    id: 'o1',
    sellerId: 's1',
    orderNumber: 'SD-2026-26-000001',
    status: OrderStatus.PENDING_DISPATCH,
    items: [{ id: 'oi1', variantId: 'v1', quantity: 2 }],
  };
  const phase2 = [
    {
      id: 'r1',
      orderItemId: 'oi1',
      qtyReserved: 2,
      sellerId: 's1',
      variantId: 'v1',
      warehouseId: 'wh-1',
      binId: 'bin-1',
      batchId: 'bat-1',
    },
  ];

  it('PENDING_DISPATCH → DISPATCHED: DISPATCH movement (−qty) then fulfill', async () => {
    const { svc, mutationApply, runWithRetry, orderUpdate, fulfill } =
      makeService({
        order: dispatchOrder,
        activeWithLocations: phase2,
        active: [{ id: 'r1', orderItemId: 'oi1', qtyReserved: 2 }],
      });
    const res = await svc.transitionStatus({
      orderId: 'o1',
      to: OrderStatus.DISPATCHED,
      actor: ACTOR,
    });
    expect(res.status).toBe(OrderStatus.DISPATCHED);
    // Movement applied: DISPATCH, −2, shipment-grained.
    expect(runWithRetry).toHaveBeenCalledTimes(1);
    expect(mutationApply).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        type: 'DISPATCH',
        qtyChange: -2,
        binId: 'bin-1',
        batchId: 'bat-1',
        shipmentId: 'ship-1',
      }),
    );
    // Movement applied BEFORE the status tx (visible-vs-silent).
    expect(mutationApply.mock.invocationCallOrder[0]).toBeLessThan(
      orderUpdate.mock.invocationCallOrder[0] ?? Infinity,
    );
    // Post-commit fulfill.
    expect(fulfill).toHaveBeenCalledWith('r1', ACTOR);
    expect(res.reservationOutcome).toBe('FULFILLED');
  });

  it('idempotency gate: a pre-existing DISPATCH movement skips re-application', async () => {
    const { svc, runWithRetry, mutationApply, orderUpdate } = makeService({
      order: dispatchOrder,
      activeWithLocations: phase2,
      active: [{ id: 'r1', orderItemId: 'oi1', qtyReserved: 2 }],
      existingDispatchMovement: true,
    });
    const res = await svc.transitionStatus({
      orderId: 'o1',
      to: OrderStatus.DISPATCHED,
      actor: ACTOR,
    });
    expect(runWithRetry).not.toHaveBeenCalled(); // gate fired — no re-decrement
    expect(mutationApply).not.toHaveBeenCalled();
    expect(orderUpdate).toHaveBeenCalled(); // transition still runs
    expect(res.status).toBe(OrderStatus.DISPATCHED);
  });

  it('skips phase-1 residual reservations (null bin/batch) — no movement', async () => {
    const { svc, mutationApply, runWithRetry } = makeService({
      order: dispatchOrder,
      activeWithLocations: [
        {
          id: 'r1',
          orderItemId: 'oi1',
          qtyReserved: 2,
          sellerId: 's1',
          variantId: 'v1',
          warehouseId: 'wh-1',
          binId: null,
          batchId: null,
        },
      ],
      active: [{ id: 'r1', orderItemId: 'oi1', qtyReserved: 2 }],
    });
    await svc.transitionStatus({
      orderId: 'o1',
      to: OrderStatus.DISPATCHED,
      actor: ACTOR,
    });
    expect(runWithRetry).not.toHaveBeenCalled(); // no phase-2 rows
    expect(mutationApply).not.toHaveBeenCalled();
  });
});
