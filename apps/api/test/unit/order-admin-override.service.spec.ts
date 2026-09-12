import { NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@skydrop/db';
import { OrderAdminOverrideService } from '../../src/modules/order/services/order-admin-override.service';
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
  const shipmentUpdateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(async () => ({
    count: opts.shipmentsMatched ?? 1,
  }));
  const txClient = {
    order: { update: orderUpdate },
    shipment: { updateMany: shipmentUpdateMany },
  };
  const orderFindFirst = jest.fn(async () => order);
  const systemSettingFindUnique = jest.fn(async () => ({ valueString: 'wh-1' }));

  const client = {} as {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
    order: { findFirst: typeof orderFindFirst };
    systemSetting: { findUnique: typeof systemSettingFindUnique };
  };
  client.$transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(txClient);
  client.order = { findFirst: orderFindFirst };
  client.systemSetting = { findUnique: systemSettingFindUnique };

  const events = {
    adminAction: jest.fn<Promise<{ id: string }>, [unknown, AnyArgs]>(async () => ({
      id: 'e1',
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
  const accrueForDelivered = jest.fn(async () => 'EXECUTED');
  const deliveredAccrual = { accrueForDelivered };

  const svc = new OrderAdminOverrideService(
    { client } as unknown as PrismaService,
    events as never,
    audit as never,
    reservations as never,
    deliveredAccrual as never,
  );
  return {
    svc,
    accrueForDelivered,
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

// God mode is the one writer of DELIVERED that emits NO lifecycle event,
// so the bus listener that bills a delivery never hears about it. Before
// this, SD-TEST-SR-9711128000 (forced dispatched → delivered, 2026-09-11)
// sat unbilled for seven hours until the backfill happened to run.
describe('forceMutate — a god-mode DELIVERED takes the delivery-time money', () => {
  const dispatched = {
    id: 'o1',
    sellerId: 's1',
    orderNumber: 'SD-TEST-SR-9711128000',
    status: OrderStatus.DISPATCHED,
    items: [{ id: 'oi1', variantId: 'v1', quantity: 1 }],
  };

  it('forced to DELIVERED: runs the shared accrual once, AFTER the override commits', async () => {
    const { svc, accrueForDelivered, orderUpdate } = makeService({ order: dispatched });
    await svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.DELIVERED });
    expect(accrueForDelivered).toHaveBeenCalledTimes(1);
    expect(accrueForDelivered).toHaveBeenCalledWith('o1');
    // Post-commit: the status write happened first.
    expect(orderUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      accrueForDelivered.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('any other target — including LOST_IN_TRANSIT, which is not charged — takes nothing', async () => {
    for (const target of [
      OrderStatus.OUT_FOR_DELIVERY,
      OrderStatus.LOST_IN_TRANSIT,
      OrderStatus.CANCELLED_BY_ADMIN,
    ]) {
      const { svc, accrueForDelivered } = makeService({ order: dispatched });
      await svc.forceMutate({ ...baseInput, targetStatus: target });
      expect(accrueForDelivered).not.toHaveBeenCalled();
    }
  });

  it('a field-only edit on an order already DELIVERED does not re-run it', async () => {
    const { svc, accrueForDelivered } = makeService({
      order: { ...dispatched, status: OrderStatus.DELIVERED },
    });
    await svc.forceMutate({ ...baseInput, fieldChanges: { recipientName: 'Corrected Name' } });
    expect(accrueForDelivered).not.toHaveBeenCalled();
  });

  it('an accrual failure never undoes the override — it audits HIGH and names the order', async () => {
    const { svc, accrueForDelivered, audit } = makeService({ order: dispatched });
    accrueForDelivered.mockRejectedValueOnce(new Error('wallet down'));
    const res = await svc.forceMutate({ ...baseInput, targetStatus: OrderStatus.DELIVERED });
    expect(res.status).toBe(OrderStatus.DELIVERED);
    const failed = audit.log.mock.calls.find(
      ([a]) => (a as { action?: string }).action === 'wallet.delivered_accrual_failed',
    );
    expect(failed?.[0]).toMatchObject({ severity: 'HIGH', entityId: 'o1', sellerId: 's1' });
  });
});
