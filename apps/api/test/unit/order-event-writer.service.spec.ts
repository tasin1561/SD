import { ActorType, OrderEventType, OrderStatus, Prisma } from '@skydrop/db';
import { OrderEventWriterService } from '../../src/modules/order/services/order-event-writer.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

function makeService() {
  const create = jest.fn(async (args: { data: Record<string, unknown> }) => ({
    id: 'evt-1',
    ...args.data,
  }));
  const createMany = jest.fn(async (_args: { data: unknown[] }) => ({ count: 0 }));
  const client = {
    orderEvent: { create, createMany },
  } as unknown as PrismaService['client'];
  const svc = new OrderEventWriterService();
  return { svc, client, create, createMany };
}

const SELLER: { type: ActorType; id: string } = { type: ActorType.SELLER, id: 's1' };

describe('OrderEventWriterService', () => {
  it('is append-only — exposes no update/delete surface', () => {
    const svc = new OrderEventWriterService();
    const names = new Set(Object.getOwnPropertyNames(Object.getPrototypeOf(svc)));
    for (const forbidden of ['update', 'delete', 'remove', 'deleteMany', 'updateMany']) {
      expect(names.has(forbidden)).toBe(false);
    }
  });

  it('write() maps fields and applies defaults', async () => {
    const { svc, client, create } = makeService();
    await svc.write(client, {
      orderId: 'o1',
      type: OrderEventType.STATUS_CHANGED,
      fromStatus: OrderStatus.DRAFT,
      toStatus: OrderStatus.PENDING_CONFIRMATION,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].data).toEqual({
      orderId: 'o1',
      type: OrderEventType.STATUS_CHANGED,
      fromStatus: OrderStatus.DRAFT,
      toStatus: OrderStatus.PENDING_CONFIRMATION,
      description: null,
      data: Prisma.JsonNull,
      actorType: null,
      actorId: null,
      isVisibleToSeller: false,
    });
  });

  it('writeMany() no-ops on empty and bulk-inserts otherwise', async () => {
    const { svc, client, create, createMany } = makeService();
    await svc.writeMany(client, []);
    expect(createMany).not.toHaveBeenCalled();

    await svc.writeMany(client, [
      { orderId: 'o1', type: OrderEventType.STOCK_RESERVED },
      { orderId: 'o1', type: OrderEventType.STATUS_CHANGED, toStatus: OrderStatus.CONFIRMED },
    ]);
    expect(create).not.toHaveBeenCalled();
    expect(createMany).toHaveBeenCalledTimes(1);
    const rows = createMany.mock.calls[0]![0].data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[1]!.toStatus).toBe(OrderStatus.CONFIRMED);
  });

  it('created() → CREATED, DRAFT, seller-visible', async () => {
    const { svc, client, create } = makeService();
    await svc.created(client, 'o1', SELLER, { source: 'MANUAL' });
    const d = create.mock.calls[0]![0].data;
    expect(d.type).toBe(OrderEventType.CREATED);
    expect(d.toStatus).toBe(OrderStatus.DRAFT);
    expect(d.isVisibleToSeller).toBe(true);
    expect(d.actorType).toBe(ActorType.SELLER);
    expect(d.data).toEqual({ source: 'MANUAL' });
  });

  it('statusChanged() defaults description + seller-visible', async () => {
    const { svc, client, create } = makeService();
    await svc.statusChanged(client, {
      orderId: 'o1',
      from: OrderStatus.CONFIRMED,
      to: OrderStatus.CANCELLED,
      actor: SELLER,
    });
    const d = create.mock.calls[0]![0].data;
    expect(d.type).toBe(OrderEventType.STATUS_CHANGED);
    expect(d.description).toBe(`Status ${OrderStatus.CONFIRMED} → ${OrderStatus.CANCELLED}`);
    expect(d.isVisibleToSeller).toBe(true);
  });

  it('stockReserved/stockReleased use the right enum types', async () => {
    const { svc, client, create } = makeService();
    await svc.stockReserved(client, 'o1', { type: ActorType.SYSTEM }, { reservations: 3 });
    await svc.stockReleased(client, 'o1', { type: ActorType.SYSTEM }, { released: 3 });
    expect(create.mock.calls[0]![0].data.type).toBe(OrderEventType.STOCK_RESERVED);
    expect(create.mock.calls[1]![0].data.type).toBe(OrderEventType.STOCK_RELEASED);
  });

  it('note() defaults to internal (not seller-visible)', async () => {
    const { svc, client, create } = makeService();
    await svc.note(client, 'o1', 'internal note', { type: ActorType.STAFF, id: 'a1' });
    expect(create.mock.calls[0]![0].data.isVisibleToSeller).toBe(false);
    expect(create.mock.calls[0]![0].data.type).toBe(OrderEventType.NOTE_ADDED);
  });

  it('adminAction() encodes action discriminator + STAFF actor', async () => {
    const { svc, client, create } = makeService();
    await svc.adminAction(client, {
      orderId: 'o1',
      action: 'admin_force_mutation',
      reason: 'data fix for incident 1234',
      from: OrderStatus.DRAFT,
      to: OrderStatus.DISPATCHED,
      data: { sideEffectsAttempted: [] },
      actorId: 'staff-9',
    });
    const d = create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(d.type).toBe(OrderEventType.NOTE_ADDED);
    expect(d.actorType).toBe(ActorType.STAFF);
    expect(d.actorId).toBe('staff-9');
    expect(d.fromStatus).toBe(OrderStatus.DRAFT);
    expect(d.toStatus).toBe(OrderStatus.DISPATCHED);
    expect(d.description).toBe('[admin_force_mutation] data fix for incident 1234');
    expect(d.data).toEqual({
      action: 'admin_force_mutation',
      reason: 'data fix for incident 1234',
      sideEffectsAttempted: [],
    });
  });
});
