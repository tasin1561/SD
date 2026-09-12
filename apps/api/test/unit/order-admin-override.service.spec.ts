import { NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@skydrop/db';
import { OrderAdminOverrideService } from '../../src/modules/order/services/order-admin-override.service';
import { OrderPostCommitHooksService } from '../../src/modules/order/services/order-post-commit-hooks.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { InsufficientStockError } from '../../src/modules/inventory-stock/services/stock-reservation.service';

type AnyArgs = Record<string, unknown>;

const LONG_REASON =
  'Customer escalation #4821 — courier lost the parcel, manual override agreed by ops lead';

function makeService(
  opts: {
    order?: AnyArgs | null;
    reserveThrows?: boolean;
    /** Nth reserve call onwards throws InsufficientStockError. */
    insufficientAfter?: number;
    shipmentsMatched?: number;
    active?: Array<{ id: string; orderItemId: string; qtyReserved: number }>;
    /** Shipments on the order that a courier has had. */
    handedOver?: number;
    /** STATUS_CHANGED rows past the dividing line (their `data`). */
    history?: Array<{ data: unknown }>;
    emitThrows?: boolean;
    /** The order's status moved between the override's read and write. */
    staleStatus?: boolean;
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

  // Guarded on the status the override READ: 0 rows ⇒ STALE_ORDER_STATUS.
  const orderUpdate = jest.fn(async (_a: { where: AnyArgs; data: AnyArgs }) => ({
    count: opts.staleStatus ? 0 : 1,
  }));
  const shipmentUpdateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(async () => ({
    count: opts.shipmentsMatched ?? 1,
  }));
  const txClient = {
    order: { updateMany: orderUpdate },
    shipment: { updateMany: shipmentUpdateMany },
  };
  const orderFindFirst = jest.fn(async () => order);
  const systemSettingFindUnique = jest.fn(async () => ({ valueString: 'wh-1' }));

  const shipmentCount = jest.fn<Promise<number>, [AnyArgs]>(async () => opts.handedOver ?? 0);
  const orderEventFindMany = jest.fn<Promise<Array<{ data: unknown }>>, [AnyArgs]>(
    async () => opts.history ?? [],
  );

  const client = {} as {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
    order: { findFirst: typeof orderFindFirst };
    systemSetting: { findUnique: typeof systemSettingFindUnique };
    shipment: { count: typeof shipmentCount };
    orderEvent: { findMany: typeof orderEventFindMany };
  };
  client.$transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(txClient);
  client.order = { findFirst: orderFindFirst };
  client.systemSetting = { findUnique: systemSettingFindUnique };
  client.shipment = { count: shipmentCount };
  client.orderEvent = { findMany: orderEventFindMany };

  const events = {
    adminAction: jest.fn<Promise<{ id: string }>, [unknown, AnyArgs]>(async () => ({
      id: 'e1',
    })),
    statusChanged: jest.fn<Promise<{ id: string }>, [unknown, AnyArgs]>(async () => ({
      id: 'sc1',
    })),
  };
  const audit = {
    log: jest.fn<Promise<string>, [AnyArgs, unknown?]>(async () => 'a1'),
  };
  const reserve = jest.fn(async (i: { orderItemId: string }) => {
    // `insufficientAfter` makes the Nth line the one that runs out, so
    // the all-or-nothing rollback has something partial to undo.
    if (
      opts.insufficientAfter !== undefined &&
      reserve.mock.calls.length > opts.insufficientAfter
    ) {
      throw new InsufficientStockError(1, 0);
    }
    if (opts.reserveThrows) throw new Error('INSUFFICIENT_STOCK');
    return { id: `r-${i.orderItemId}` };
  });
  const release = jest.fn(async (id: string) => ({
    reservationId: id,
    qtyReleased: 2,
    status: 'RELEASED',
    alreadyInactive: false,
  }));
  const listActiveForOrder = jest.fn(async () => opts.active ?? []);
  const reservations = { reserve, release, listActiveForOrder };
  const refundIfCharged = jest.fn(async () => null);
  const emit = jest.fn((_e: AnyArgs) => {
    if (opts.emitThrows) throw new Error('bus exploded');
  });

  const enqueueOrder = jest.fn<Promise<unknown>, [string, unknown?]>(async () => ({
    created: true,
  }));
  const dequeueOrder = jest.fn<Promise<unknown>, [string, string, unknown?]>(async () => ({
    dequeued: 1,
  }));
  const provisionFromSnapshot = jest.fn<Promise<unknown>, [AnyArgs, unknown, unknown?]>(
    async () => ({ shipmentId: 'ship-new', created: true }),
  );
  const voidForOrder = jest.fn<Promise<{ voided: number }>, [string, string, unknown, unknown?]>(
    async () => ({ voided: 1 }),
  );

  // The REAL shared hooks service — the one transitionStatus runs — over
  // the same mocks, so what is asserted is what god mode actually does.
  // SET-1: the provisioned courier is resolved per seller.
  const settingsResolve = jest.fn(async (_sellerId: string, key: string) => ({
    key,
    valueType: 'STRING',
    value: 'delhivery' as unknown,
    source: 'SYSTEM_DEFAULT' as 'SYSTEM_DEFAULT' | 'SELLER_OVERRIDE',
  }));
  const postCommit = new OrderPostCommitHooksService(
    { client } as unknown as PrismaService,
    audit as never,
    { enqueueOrder, dequeueOrder } as never,
    { provisionFromSnapshot, voidForOrder } as never,
    { refundIfCharged } as never,
    { emit } as never,
    { resolve: settingsResolve } as never,
    // Ended-order money (retire the deferred accrual, undo an uncovered
    // Instant Pay credit) and the issue board — inert here.
    {
      retirePendingAccrual: jest.fn(async () => 0),
      reverseUncoveredInstantPayCredit: jest.fn(async () => ({ reversed: false })),
    } as never,
    { raise: jest.fn(async () => undefined), resolveByKey: jest.fn(async () => 0) } as never,
  );
  const svc = new OrderAdminOverrideService(
    { client } as unknown as PrismaService,
    events as never,
    audit as never,
    reservations as never,
    postCommit,
  );
  return {
    svc,
    settingsResolve,
    refundIfCharged,
    emit,
    enqueueOrder,
    dequeueOrder,
    provisionFromSnapshot,
    voidForOrder,
    shipmentCount,
    orderEventFindMany,
    orderUpdate,
    shipmentUpdateMany,
    orderFindFirst,
    events,
    audit,
    reserve,
    release,
    listActiveForOrder,
  };
}

const baseInput = {
  orderId: 'o1',
  reason: LONG_REASON,
  acknowledgeDataIntegrityRisk: true as const,
  actorStaffId: 'staff-1',
  ctx: { ipAddress: '1.2.3.4', userAgent: 'jest', requestId: 'req-1' },
};

describe('OrderAdminOverrideService.forceMutate — guardrails', () => {
  it('rejects a reason shorter than 30 chars', async () => {
    const { svc } = makeService();
    await expect(
      svc.forceMutate({ ...baseInput, reason: 'too short', targetStatus: OrderStatus.CONFIRMED }),
    ).rejects.toMatchObject({ response: { code: 'FORCE_MUTATION_REASON_TOO_SHORT' } });
  });

  it('rejects when acknowledgeDataIntegrityRisk is not literal true', async () => {
    const { svc } = makeService();
    await expect(
      svc.forceMutate({
        ...baseInput,
        acknowledgeDataIntegrityRisk: false as unknown as true,
        targetStatus: OrderStatus.CONFIRMED,
      }),
    ).rejects.toMatchObject({ response: { code: 'FORCE_MUTATION_RISK_NOT_ACKNOWLEDGED' } });
  });

  it('rejects when neither fieldChanges nor targetStatus is supplied', async () => {
    const { svc } = makeService();
    await expect(svc.forceMutate({ ...baseInput })).rejects.toMatchObject({
      response: { code: 'FORCE_MUTATION_NOOP' },
    });
  });

  it('404s a missing order', async () => {
    const { svc } = makeService({ order: null });
    await expect(
      svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.DELIVERED }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OrderAdminOverrideService.forceMutate — a stale force', () => {
  it('writes only if the order is STILL what it read, and 409s STALE_ORDER_STATUS otherwise', async () => {
    // An operator's form open while an agent confirmed the order: the
    // forced cancel must not land on the order the confirm just gave a
    // shipment (which then books a real waybill on a cancelled order).
    const { svc, orderUpdate, emit, voidForOrder } = makeService({ staleStatus: true });
    await expect(
      svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.CANCELLED_BY_ADMIN }),
    ).rejects.toMatchObject({ response: { code: 'STALE_ORDER_STATUS' } });
    expect(orderUpdate.mock.calls[0]![0].where).toMatchObject({
      id: 'o1',
      status: OrderStatus.PENDING_CONFIRMATION,
    });
    // Nothing downstream of a write that did not happen.
    expect(emit).not.toHaveBeenCalled();
    expect(voidForOrder).not.toHaveBeenCalled();
  });
});

describe('OrderAdminOverrideService.forceMutate — behaviour', () => {
  it('sets hasAdminOverride=true, writes the event + CRITICAL audit', async () => {
    const { svc, orderUpdate, events, audit } = makeService();
    const res = await svc.forceMutate({
      ...baseInput,
      fieldChanges: { recipientCity: 'Pune', codAmountInr: 555 },
      targetStatus: OrderStatus.DELIVERED,
    });

    const data = orderUpdate.mock.calls[0]![0].data as AnyArgs;
    expect(data.hasAdminOverride).toBe(true);
    expect(data.recipientCity).toBe('Pune');
    expect(String(data.codAmountInr)).toBe('555'); // Decimal-coerced
    expect(data.status).toBe(OrderStatus.DELIVERED);
    expect(res.hasAdminOverride).toBe(true);
    expect(res.fieldChangesApplied).toEqual(
      expect.arrayContaining(['recipientCity', 'codAmountInr', 'status']),
    );

    expect(events.adminAction).toHaveBeenCalledTimes(1);
    const evt = events.adminAction.mock.calls[0]![1] as AnyArgs;
    expect(evt.action).toBe('admin_force_mutation');
    expect(evt.reason).toContain('Customer escalation');
    expect((evt.data as AnyArgs).requestId).toBe('req-1');

    expect(audit.log).toHaveBeenCalledTimes(1);
    const auditArg = audit.log.mock.calls[0]![0] as AnyArgs;
    expect(auditArg.severity).toBe('CRITICAL');
    expect(auditArg.action).toBe('order.force_mutation');
  });

  it('attempts reservations on → CONFIRMED and records outcomes', async () => {
    const { svc, reserve } = makeService();
    const res = await svc.forceMutate({
      ...baseInput,
      targetStatus: OrderStatus.CONFIRMED,
    });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(res.reserveOutcomes).toEqual([{ orderItemId: 'oi1', ok: true, reservationId: 'r-oi1' }]);
  });

  it('does NOT block when a god-mode reserve attempt fails', async () => {
    const { svc, orderUpdate } = makeService({ reserveThrows: true });
    const res = await svc.forceMutate({
      ...baseInput,
      targetStatus: OrderStatus.CONFIRMED,
    });
    // Mutation still committed; failure recorded, not thrown.
    expect(orderUpdate).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(OrderStatus.CONFIRMED);
    expect(res.reserveOutcomes![0]).toMatchObject({ orderItemId: 'oi1', ok: false });
    expect(res.reserveOutcomes![0]!.error).toContain('INSUFFICIENT_STOCK');
  });

  it('leaves reservations intact when transitioning AWAY from CONFIRMED', async () => {
    const { svc, reserve, release } = makeService({
      order: {
        id: 'o1',
        sellerId: 's1',
        orderNumber: 'SD-1',
        status: OrderStatus.CONFIRMED,
        items: [{ id: 'oi1', variantId: 'v1', quantity: 1 }],
      },
    });
    const res = await svc.forceMutate({
      ...baseInput,
      targetStatus: OrderStatus.CANCELLED_BY_ADMIN,
    });
    expect(reserve).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled(); // cleanup is the separate endpoint
    expect(res.reserveOutcomes).toBeNull();
  });
});

describe('OrderAdminOverrideService.releaseReservations', () => {
  it('releases every ACTIVE reservation, audits HIGH, writes the event', async () => {
    const { svc, release, events, audit } = makeService({
      active: [
        { id: 'r1', orderItemId: 'oi1', qtyReserved: 2 },
        { id: 'r2', orderItemId: 'oi2', qtyReserved: 1 },
      ],
    });
    const res = await svc.releaseReservations({
      orderId: 'o1',
      reason: 'Post god-mode cleanup',
      actorStaffId: 'staff-1',
      ctx: baseInput.ctx,
    });
    expect(release).toHaveBeenCalledTimes(2);
    expect(res.releasedCount).toBe(2);
    expect(res.released[0]).toMatchObject({ reservationId: 'r1', qtyReleased: 2 });
    expect(events.adminAction).toHaveBeenCalledTimes(1);
    expect(events.adminAction.mock.calls[0]![1].action).toBe('admin_release_reservations');
    expect(audit.log.mock.calls[0]![0].severity).toBe('HIGH');
  });

  it('is idempotent — no ACTIVE reservations → releasedCount 0 (still audited)', async () => {
    const { svc, release, audit } = makeService({ active: [] });
    const res = await svc.releaseReservations({
      orderId: 'o1',
      actorStaffId: 'staff-1',
    });
    expect(release).not.toHaveBeenCalled();
    expect(res.releasedCount).toBe(0);
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('404s a missing order', async () => {
    const { svc } = makeService({ order: null });
    await expect(
      svc.releaseReservations({ orderId: 'gone', actorStaffId: 'staff-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('forceMutate — recipient changes reach the shipment snapshot', () => {
  it('syncs the dest* snapshot of a live shipment, in the same tx', async () => {
    const { svc, shipmentUpdateMany } = makeService();
    const r = await svc.forceMutate({
      orderId: 'o1',
      reason: LONG_REASON,
      acknowledgeDataIntegrityRisk: true,
      fieldChanges: { recipientPhoneE164: '+919860028043', recipientName: 'Rahul Sharma' },
      actorStaffId: 'st1',
    });
    expect(r.shipmentsSynced).toBe(1);
    expect(shipmentUpdateMany).toHaveBeenCalledTimes(1);
    const call = shipmentUpdateMany.mock.calls[0]?.[0] as unknown as {
      where: AnyArgs;
      data: AnyArgs;
    };
    expect(call.data).toEqual({
      destRecipientPhoneE164: '+919860028043',
      destRecipientName: 'Rahul Sharma',
    });
  });

  it('GUARDS on the three conditions that mean nobody has been told yet', async () => {
    // The whole safety of this propagation is the WHERE clause, not a
    // prior read — so it is asserted directly. A shipment that gains an
    // AWB concurrently simply stops matching.
    const { svc, shipmentUpdateMany } = makeService();
    await svc.forceMutate({
      orderId: 'o1',
      reason: LONG_REASON,
      acknowledgeDataIntegrityRisk: true,
      fieldChanges: { recipientPhoneE164: '+919860028043' },
      actorStaffId: 'st1',
    });
    const call = shipmentUpdateMany.mock.calls[0]?.[0] as unknown as { where: AnyArgs };
    expect(call.where).toMatchObject({
      status: 'CREATED',
      awbNumber: null,
      supersededAt: null,
      deletedAt: null,
      orderShipments: { some: { orderId: 'o1' } },
    });
  });

  it('does NOT touch shipments when no recipient field changed', async () => {
    // A COD-amount correction has nothing to do with the destination;
    // firing an updateMany for it would bump updatedAt on a parcel
    // nobody edited.
    const { svc, shipmentUpdateMany } = makeService();
    const r = await svc.forceMutate({
      orderId: 'o1',
      reason: LONG_REASON,
      acknowledgeDataIntegrityRisk: true,
      fieldChanges: { codAmountInr: 250 },
      actorStaffId: 'st1',
    });
    expect(shipmentUpdateMany).not.toHaveBeenCalled();
    expect(r.shipmentsSynced).toBe(0);
  });

  it('reports 0 rather than failing when the parcel already has an AWB', async () => {
    // Zero is the CORRECT answer once a courier holds the address, and
    // it is the signal that the correction now belongs at courier-ops'
    // edit endpoint. It must be visible, not swallowed.
    const { svc } = makeService({ shipmentsMatched: 0 });
    const r = await svc.forceMutate({
      orderId: 'o1',
      reason: LONG_REASON,
      acknowledgeDataIntegrityRisk: true,
      fieldChanges: { recipientPhoneE164: '+919860028043' },
      actorStaffId: 'st1',
    });
    expect(r.shipmentsSynced).toBe(0);
  });

  it('records the sync count on the audit row', async () => {
    const { svc, audit } = makeService();
    await svc.forceMutate({
      orderId: 'o1',
      reason: LONG_REASON,
      acknowledgeDataIntegrityRisk: true,
      fieldChanges: { recipientCity: 'Kolkata' },
      actorStaffId: 'st1',
    });
    const entry = audit.log.mock.calls[0]?.[0] as unknown as { changes: AnyArgs };
    expect(entry.changes).toMatchObject({ shipmentsSynced: 1 });
  });
});

/**
 * Restoring a stock claim the TTL sweep took away.
 *
 * Until 2026-09-08 the sweep expired ANY reservation past its date
 * without looking at the order, so an order already at CONFIRMED or
 * beyond lost its claim while staying in the queue. The sweep is fixed;
 * the orders it already happened to are unpickable until somebody gives
 * the stock back, which is what this does.
 */
describe('OrderAdminOverrideService.restoreReservations', () => {
  const committed = {
    id: 'o1',
    sellerId: 's1',
    orderNumber: 'SD-2026-26-000003',
    status: OrderStatus.PENDING_PICK,
    items: [
      { id: 'oi1', variantId: 'v1', quantity: 1 },
      { id: 'oi2', variantId: 'v2', quantity: 1 },
    ],
  };

  it('re-reserves every line and audits it', async () => {
    const { svc, reserve, audit } = makeService({ order: committed, active: [] });
    const res = await svc.restoreReservations({ orderId: 'o1', actorStaffId: 'staff-1' });
    expect(res.reservedCount).toBe(2);
    expect(res.shortfall).toBeNull();
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'order.restore_reservations', severity: 'HIGH' }),
      expect.anything(),
    );
  });

  it('REFUSES an order that already holds a claim', async () => {
    // Restoring one of these does not repair it, it DOUBLES it — the
    // same stock claimed twice, the second copy silently unavailable to
    // every other order.
    const { svc, reserve } = makeService({
      order: committed,
      active: [{ id: 'r1', orderItemId: 'oi1', qtyReserved: 1 }],
    });
    await expect(
      svc.restoreReservations({ orderId: 'o1', actorStaffId: 'staff-1' }),
    ).rejects.toThrow(/already holds/i);
    expect(reserve).not.toHaveBeenCalled();
  });

  it('REFUSES an order that is past packing', async () => {
    // From PACKED the reservation was consumed by fulfill() and the
    // stock has already left; re-reserving would decrement twice.
    const { svc } = makeService({
      order: { ...committed, status: OrderStatus.DISPATCHED },
      active: [],
    });
    await expect(
      svc.restoreReservations({ orderId: 'o1', actorStaffId: 'staff-1' }),
    ).rejects.toThrow(/DISPATCHED/);
  });

  it('gives back what it took when stock runs out part-way', async () => {
    // All or nothing: a half-restored order prints some lines and sends
    // a picker walking for a box that still cannot be filled.
    const { svc, release } = makeService({
      order: committed,
      active: [],
      insufficientAfter: 1,
    });
    const res = await svc.restoreReservations({ orderId: 'o1', actorStaffId: 'staff-1' });
    expect(res.reservedCount).toBe(0);
    expect(res.shortfall).toMatch(/only 0 available/i);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith('r-oi1', expect.anything(), expect.anything());
  });
});

// God mode used to be the one writer of orders.status that emitted NO
// lifecycle event, so every bus subscriber — notifications, webhooks,
// invoices, the delivery-time money — missed a forced change. It now
// writes a real STATUS_CHANGED row and emits the same event, once.
describe('forceMutate — a forced status change is announced like any other', () => {
  const dispatched = {
    id: 'o1',
    sellerId: 's1',
    orderNumber: 'SD-TEST-SR-9711128000',
    status: OrderStatus.DISPATCHED,
    items: [{ id: 'oi1', variantId: 'v1', quantity: 1 }],
  };

  it('writes a STATUS_CHANGED row stamped ADMIN_OVERRIDE in the same tx, and emits it once, post-commit', async () => {
    const { svc, events, emit, orderUpdate } = makeService({ order: dispatched });
    await svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.DELIVERED });

    expect(events.statusChanged).toHaveBeenCalledTimes(1);
    expect(events.statusChanged.mock.calls[0]![1]).toMatchObject({
      orderId: 'o1',
      from: OrderStatus.DISPATCHED,
      to: OrderStatus.DELIVERED,
      actor: { id: 'staff-1' },
      data: { source: 'ADMIN_OVERRIDE', adminActionEventId: 'e1' },
    });
    // The staff-only note (reason + outcomes) is still written.
    expect(events.adminAction).toHaveBeenCalledTimes(1);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0]).toMatchObject({
      orderId: 'o1',
      sellerId: 's1',
      from: OrderStatus.DISPATCHED,
      to: OrderStatus.DELIVERED,
      // NOTIF-2's `order_status:<statusEventId>` dedup key is the row above.
      statusEventId: 'sc1',
      actorId: 'staff-1',
      source: 'ADMIN_OVERRIDE',
    });
    // Post-commit: the status write happened first.
    expect(orderUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      emit.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('a field-only edit, or forcing an order to where it already is, announces nothing', async () => {
    const a = makeService({ order: { ...dispatched, status: OrderStatus.DELIVERED } });
    await a.svc.forceMutate({ ...baseInput, fieldChanges: { recipientName: 'Corrected Name' } });
    await a.svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.DELIVERED });
    expect(a.events.statusChanged).not.toHaveBeenCalled();
    expect(a.emit).not.toHaveBeenCalled();
    expect(a.refundIfCharged).not.toHaveBeenCalled();
  });

  it('a throwing bus never fails the override (NOTIF-1)', async () => {
    const { svc, orderUpdate } = makeService({ order: dispatched, emitThrows: true });
    const res = await svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.DELIVERED });
    expect(res.status).toBe(OrderStatus.DELIVERED);
    expect(orderUpdate).toHaveBeenCalledTimes(1);
  });

  it('no longer bills a delivery itself — the bus listener is the one path', () => {
    // By construction: the service has no DeliveredAccrualService to call
    // (prisma, events, audit, reservations, the shared post-commit hooks).
    expect(OrderAdminOverrideService.length).toBe(5);
    expect(Object.getOwnPropertyNames(OrderAdminOverrideService.prototype)).not.toContain(
      'accrueDelivered',
    );
  });
});

// A god-mode cancel gives the delivery fee back EXACTLY when a normal cancel
// would — when the parcel never left with a courier — judged on history,
// never on the forced `from`.
describe('forceMutate — the cancel-time ORDER_CHARGES refund', () => {
  const at = (status: OrderStatus) => ({
    id: 'o1',
    sellerId: 's1',
    orderNumber: 'SD-2026-26-000009',
    status,
    items: [{ id: 'oi1', variantId: 'v1', quantity: 1 }],
  });

  it('a never-dispatched order is refunded once, before the event goes out', async () => {
    const { svc, refundIfCharged, emit } = makeService({ order: at(OrderStatus.CONFIRMED) });
    await svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.CANCELLED_BY_ADMIN });
    expect(refundIfCharged).toHaveBeenCalledTimes(1);
    expect(refundIfCharged).toHaveBeenCalledWith('o1', 's1', expect.stringContaining('admin'));
    expect(refundIfCharged.mock.invocationCallOrder[0]).toBeLessThan(
      emit.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('a genuinely DELIVERED order is NOT refunded — that carriage happened', async () => {
    // A real (matrix) STATUS_CHANGED into DELIVERED: no ADMIN_OVERRIDE stamp.
    const { svc, refundIfCharged } = makeService({
      order: at(OrderStatus.DELIVERED),
      history: [{ data: null }],
    });
    await svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.CANCELLED_BY_ADMIN });
    expect(refundIfCharged).not.toHaveBeenCalled();
  });

  it('a parcel handed to a courier is NOT refunded, whatever the history says', async () => {
    const { svc, refundIfCharged } = makeService({
      order: at(OrderStatus.PENDING_MANUAL_PLACEMENT),
      handedOver: 1,
    });
    await svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.CANCELLED });
    expect(refundIfCharged).not.toHaveBeenCalled();
  });

  it('an order god mode only PRETENDED was delivered IS refunded — its forced DELIVERED proves nothing', async () => {
    const { svc, refundIfCharged } = makeService({
      order: at(OrderStatus.DELIVERED),
      history: [{ data: { source: 'ADMIN_OVERRIDE', adminActionEventId: 'e0' } }],
    });
    await svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.CANCELLED_BY_ADMIN });
    expect(refundIfCharged).toHaveBeenCalledTimes(1);
  });

  it('asks history about the statuses past the dividing line only', async () => {
    const { svc, orderEventFindMany } = makeService({ order: at(OrderStatus.CONFIRMED) });
    await svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.REJECTED });
    const where = orderEventFindMany.mock.calls[0]![0].where as {
      type: string;
      toStatus: { in: OrderStatus[] };
    };
    expect(where.type).toBe('STATUS_CHANGED');
    expect(where.toStatus.in).toEqual(
      expect.arrayContaining([
        OrderStatus.DISPATCHED,
        OrderStatus.IN_TRANSIT,
        OrderStatus.DELIVERED,
        OrderStatus.RTO_RECEIVED,
        OrderStatus.LOST_IN_TRANSIT,
      ]),
    );
    for (const refundable of [
      OrderStatus.CONFIRMED,
      OrderStatus.PACKED,
      OrderStatus.PENDING_DISPATCH,
      OrderStatus.CANCELLED,
      OrderStatus.REJECTED_NDR,
    ]) {
      expect(where.toStatus.in).not.toContain(refundable);
    }
  });

  it('only a landing in the cancel/reject family refunds', async () => {
    const { svc, refundIfCharged, shipmentCount } = makeService({
      order: at(OrderStatus.CONFIRMED),
    });
    await svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.PENDING_PICK });
    expect(refundIfCharged).not.toHaveBeenCalled();
    expect(shipmentCount).not.toHaveBeenCalled();
  });

  it('a refund failure never undoes the override — it audits HIGH and names the order', async () => {
    const { svc, refundIfCharged, audit, emit } = makeService({ order: at(OrderStatus.CONFIRMED) });
    refundIfCharged.mockRejectedValueOnce(new Error('wallet down'));
    const res = await svc.forceMutate({
      ...baseInput,
      targetStatus: OrderStatus.CANCELLED_BY_ADMIN,
    });
    expect(res.status).toBe(OrderStatus.CANCELLED_BY_ADMIN);
    const failed = audit.log.mock.calls.find(
      ([a]) => (a as { action?: string }).action === 'wallet.order_charges_refund_failed',
    );
    expect(failed?.[0]).toMatchObject({ severity: 'HIGH', entityId: 'o1', sellerId: 's1' });
    // And the change is still announced.
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

// God mode runs the SAME non-stock post-commit hooks transitionStatus
// runs, through the one shared method (2026-09-12). Each case is a hole
// that existed before: a forced CONFIRMED with no shipment, a forced exit
// from PENDING_CONFIRMATION left in the call queue, a forced cancel with a
// live shipment behind it.
describe('forceMutate — the post-commit hooks a matrix transition runs', () => {
  const at = (status: OrderStatus) => ({
    id: 'o1',
    sellerId: 's1',
    orderNumber: 'SD-2026-26-000077',
    status,
    items: [{ id: 'oi1', variantId: 'v1', quantity: 1 }],
  });
  const ctx = baseInput.ctx;

  it('→ CONFIRMED provisions a shipment from the COMMITTED order, before the event goes out', async () => {
    const { svc, provisionFromSnapshot, emit, orderFindFirst, orderUpdate } = makeService({
      order: at(OrderStatus.OUT_OF_STOCK),
    });
    await svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.CONFIRMED });

    expect(provisionFromSnapshot).toHaveBeenCalledTimes(1);
    expect(provisionFromSnapshot.mock.calls[0]![0]).toMatchObject({ orderId: 'o1' });
    // The snapshot is re-read AFTER the write, so a recipient corrected in
    // the same forced edit is what the courier is handed.
    const reread = orderFindFirst.mock.calls.at(-1) as unknown as [
      { select?: Record<string, unknown> },
    ];
    expect(reread[0].select).toMatchObject({ recipientName: true, items: expect.anything() });
    expect(orderUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      provisionFromSnapshot.mock.invocationCallOrder[0] ?? 0,
    );
    // The AWB listener (CUR-2b) hears CONFIRMED only once the shipment exists.
    expect(emit).toHaveBeenCalledTimes(1);
    expect(provisionFromSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
      emit.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("→ CONFIRMED (god mode) provisions with the SELLER's default courier — the same shared hook", async () => {
    const { svc, provisionFromSnapshot, settingsResolve } = makeService({
      order: at(OrderStatus.OUT_OF_STOCK),
    });
    settingsResolve.mockResolvedValueOnce({
      key: 'ops.default_courier_code',
      valueType: 'STRING',
      value: 'manual',
      source: 'SELLER_OVERRIDE',
    });
    await svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.CONFIRMED });

    expect(settingsResolve).toHaveBeenCalledWith('s1', 'ops.default_courier_code');
    expect(provisionFromSnapshot.mock.calls[0]![0]).toMatchObject({
      orderId: 'o1',
      courierCode: 'manual',
    });
  });

  it('→ PENDING_CONFIRMATION puts the order back in the call queue (CC-6)', async () => {
    const { svc, enqueueOrder, dequeueOrder } = makeService({
      order: at(OrderStatus.OUT_OF_STOCK),
    });
    await svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.PENDING_CONFIRMATION });
    expect(enqueueOrder).toHaveBeenCalledWith('o1', ctx);
    expect(dequeueOrder).not.toHaveBeenCalled();
  });

  it('leaving PENDING_CONFIRMATION takes it out of the call queue, whatever the landing', async () => {
    const a = makeService(); // default: PENDING_CONFIRMATION
    await a.svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.DISPATCHED });
    expect(a.dequeueOrder).toHaveBeenCalledWith('o1', 'ADMIN_CLOSED', ctx);
    expect(a.enqueueOrder).not.toHaveBeenCalled();

    const b = makeService();
    await b.svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.CANCELLED_BY_ADMIN });
    expect(b.dequeueOrder).toHaveBeenCalledWith('o1', 'ORDER_CANCELLED', ctx);
  });

  it('→ a cancel/reject terminal voids the shipment, then refunds, then announces', async () => {
    const { svc, voidForOrder, refundIfCharged, emit, provisionFromSnapshot } = makeService({
      order: at(OrderStatus.CONFIRMED),
    });
    await svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.REJECTED_BY_CUSTOMER });
    expect(voidForOrder).toHaveBeenCalledTimes(1);
    expect(voidForOrder.mock.calls[0]![0]).toBe('o1');
    expect(voidForOrder.mock.calls[0]![1]).toBe('Order transitioned to REJECTED_BY_CUSTOMER');
    expect(provisionFromSnapshot).not.toHaveBeenCalled();
    expect(voidForOrder.mock.invocationCallOrder[0]).toBeLessThan(
      refundIfCharged.mock.invocationCallOrder[0] ?? 0,
    );
    expect(refundIfCharged.mock.invocationCallOrder[0]).toBeLessThan(
      emit.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('→ PICKED writes the pack-eligible audit', async () => {
    const { svc, audit } = makeService({ order: at(OrderStatus.CONFIRMED) });
    await svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.PICKED });
    const eligible = audit.log.mock.calls.filter(([a]) => a['action'] === 'pack_queue.eligible');
    expect(eligible).toHaveLength(1);
    expect(eligible[0]![0]).toMatchObject({ entityId: 'o1', severity: 'LOW' });
  });

  it('a field-only edit runs NO hook at all', async () => {
    const m = makeService({ order: at(OrderStatus.PENDING_CONFIRMATION) });
    await m.svc.forceMutate({ ...baseInput, fieldChanges: { recipientName: 'Corrected Name' } });
    expect(m.enqueueOrder).not.toHaveBeenCalled();
    expect(m.dequeueOrder).not.toHaveBeenCalled();
    expect(m.provisionFromSnapshot).not.toHaveBeenCalled();
    expect(m.voidForOrder).not.toHaveBeenCalled();
    expect(m.refundIfCharged).not.toHaveBeenCalled();
    expect(m.emit).not.toHaveBeenCalled();
    expect(m.audit.log.mock.calls.map(([a]) => a['action'])).toEqual(['order.force_mutation']);
  });

  it('a throwing hook never fails the override, and the rest still run', async () => {
    const m = makeService(); // PENDING_CONFIRMATION → CONFIRMED: dequeue + provision + emit
    m.dequeueOrder.mockRejectedValueOnce(new Error('redis down'));
    m.provisionFromSnapshot.mockRejectedValueOnce(new Error('numbering sequence missing'));
    const res = await m.svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.CONFIRMED });
    expect(res.status).toBe(OrderStatus.CONFIRMED);
    expect(m.provisionFromSnapshot).toHaveBeenCalledTimes(1);
    expect(m.emit).toHaveBeenCalledTimes(1);
  });

  it('stock stays opted out: a forced PICKED → PACKED reserves and releases nothing', async () => {
    const m = makeService({ order: at(OrderStatus.PICKED) });
    await m.svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.PACKED });
    expect(m.reserve).not.toHaveBeenCalled();
    expect(m.release).not.toHaveBeenCalled();
  });
});
