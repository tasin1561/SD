import { ConflictException } from '@nestjs/common';
import { ActorType, OrderStatus, QueueClosureReason } from '@skydrop/db';
import {
  AwaitingConfirmationService,
  CONFIRMED_WITHOUT_CALL_AUDIT_ACTION,
  CONFIRMED_WITHOUT_CALL_EVENT_TEXT,
} from '../../src/modules/order/services/awaiting-confirmation.service';

function make(order: { status: OrderStatus; sellerId: string } | null) {
  const findFirst = jest.fn(async (a: { where: { sellerId?: string } }) =>
    order && (!a.where.sellerId || a.where.sellerId === order.sellerId) ? order : null,
  );
  const enqueueOrder = jest.fn(async (_orderId?: string) => ({ entry: {}, created: true }));
  const clearDeadline = jest.fn(async (_orderId?: string) => undefined);
  // The policy owns clear-then-enqueue now (no sweep window); the stub keeps
  // the observable pair so the assertions below still read the same.
  const queueForCall = jest.fn(async (id: string) => {
    await clearDeadline(id);
    return enqueueOrder(id);
  });
  const transitionStatus = jest.fn(
    async (
      _input: Record<string, unknown>,
    ): Promise<{ orderId: string; fromStatus: OrderStatus; status: OrderStatus }> => ({
      orderId: 'o1',
      fromStatus: OrderStatus.PENDING_CONFIRMATION,
      status: OrderStatus.CONFIRMED,
    }),
  );
  const dequeueOrder = jest.fn(async () => ({ dequeued: 1, preemptedAssigned: false }));
  const log = jest.fn(async (_entry: Record<string, unknown>) => 'audit-id');
  const svc = new AwaitingConfirmationService(
    { client: { order: { findFirst } } } as never,
    { queueForCall } as never,
    { transitionStatus } as never,
    { dequeueOrder } as never,
    { log } as never,
  );
  return { svc, enqueueOrder, clearDeadline, transitionStatus, dequeueOrder, log };
}

const STAFF = { type: ActorType.STAFF, id: 'staff-1' };

describe('AwaitingConfirmationService.sendToAgents', () => {
  it('enqueues a PENDING_CONFIRMATION order and clears its TTL clock', async () => {
    const { svc, enqueueOrder, clearDeadline } = make({
      status: OrderStatus.PENDING_CONFIRMATION,
      sellerId: 'c1',
    });
    const r = await svc.sendToAgents(['o1'], { scopeSellerId: 'c1' });
    expect(r.results).toEqual([{ orderId: 'o1', outcome: 'QUEUED' }]);
    expect(enqueueOrder).toHaveBeenCalledTimes(1);
    expect(clearDeadline).toHaveBeenCalledWith('o1');
  });

  it("a seller cannot enqueue another client's order: NOT_FOUND, nothing queued", async () => {
    const { svc, enqueueOrder, clearDeadline } = make({
      status: OrderStatus.PENDING_CONFIRMATION,
      sellerId: 'other-client',
    });
    const r = await svc.sendToAgents(['o1'], { scopeSellerId: 'c1' });
    expect(r.results).toEqual([{ orderId: 'o1', outcome: 'NOT_FOUND' }]);
    expect(enqueueOrder).not.toHaveBeenCalled();
    expect(clearDeadline).not.toHaveBeenCalled();
  });

  it("admin (no scope) can send any client's order", async () => {
    const { svc, enqueueOrder } = make({
      status: OrderStatus.PENDING_CONFIRMATION,
      sellerId: 'other-client',
    });
    await svc.sendToAgents(['o1'], {});
    expect(enqueueOrder).toHaveBeenCalled();
  });

  it('an order that already moved on is reported, not queued', async () => {
    const { svc, enqueueOrder } = make({ status: OrderStatus.CONFIRMED, sellerId: 'c1' });
    const r = await svc.sendToAgents(['o1'], { scopeSellerId: 'c1' });
    expect(r.results[0]!.outcome).toBe('NOT_PENDING_CONFIRMATION');
    expect(enqueueOrder).not.toHaveBeenCalled();
  });

  it('is idempotent: an existing OPEN entry reports ALREADY_QUEUED; duplicate ids collapse', async () => {
    const { svc, enqueueOrder } = make({
      status: OrderStatus.PENDING_CONFIRMATION,
      sellerId: 'c1',
    });
    enqueueOrder.mockResolvedValueOnce({ entry: {}, created: false });
    const r = await svc.sendToAgents(['o1', 'o1'], { scopeSellerId: 'c1' });
    expect(r.results).toEqual([{ orderId: 'o1', outcome: 'ALREADY_QUEUED' }]);
  });
});

describe('AwaitingConfirmationService.confirmWithoutCall', () => {
  it('goes through transitionStatus with expectedFrom and WITHOUT autoConfirmClaim', async () => {
    const { svc, transitionStatus } = make({
      status: OrderStatus.PENDING_CONFIRMATION,
      sellerId: 'c1',
    });
    const r = await svc.confirmWithoutCall(['o1'], { actor: STAFF });
    expect(r.results).toEqual([
      { orderId: 'o1', outcome: 'CONFIRMED', landedStatus: OrderStatus.CONFIRMED },
    ]);
    const input = transitionStatus.mock.calls[0]![0];
    expect(input.to).toBe(OrderStatus.CONFIRMED);
    expect(input.expectedFrom).toBe(OrderStatus.PENDING_CONFIRMATION);
    expect(input).not.toHaveProperty('autoConfirmClaim');
    expect(input.actor).toEqual(STAFF);
    expect(input.reason).toBe(CONFIRMED_WITHOUT_CALL_EVENT_TEXT);
  });

  it('closes any open call-queue entry through CallQueueService', async () => {
    const { svc, dequeueOrder } = make({
      status: OrderStatus.PENDING_CONFIRMATION,
      sellerId: 'c1',
    });
    await svc.confirmWithoutCall(['o1'], { actor: STAFF });
    expect(dequeueOrder).toHaveBeenCalledWith('o1', QueueClosureReason.ORDER_CONFIRMED, undefined);
  });

  it('a failed queue close never turns a confirmed order into a failure', async () => {
    const { svc, dequeueOrder } = make({
      status: OrderStatus.PENDING_CONFIRMATION,
      sellerId: 'c1',
    });
    dequeueOrder.mockRejectedValueOnce(new Error('redis down'));
    const r = await svc.confirmWithoutCall(['o1'], { actor: STAFF });
    expect(r.results[0]!.outcome).toBe('CONFIRMED');
  });

  it('audits the REAL human actor under its own action name, never SYSTEM', async () => {
    const { svc, log } = make({ status: OrderStatus.PENDING_CONFIRMATION, sellerId: 'c1' });
    await svc.confirmWithoutCall(['o1'], { actor: STAFF });
    const entry = log.mock.calls[0]![0];
    expect(entry.action).toBe(CONFIRMED_WITHOUT_CALL_AUDIT_ACTION);
    expect(entry.action).not.toBe('order.auto_confirmed_ttl');
    expect(entry.actorType).toBe(ActorType.STAFF);
    expect(entry.actorType).not.toBe(ActorType.SYSTEM);
    expect(entry.actorId).toBe('staff-1');
    expect(entry.staffUserId).toBe('staff-1');
    expect(entry.sellerId).toBe('c1');
  });

  it('a seller actor is audited as the seller user', async () => {
    const { svc, log } = make({ status: OrderStatus.PENDING_CONFIRMATION, sellerId: 'c1' });
    await svc.confirmWithoutCall(['o1'], {
      actor: { type: ActorType.SELLER, id: 'seller-user-1' },
      scopeSellerId: 'c1',
    });
    const entry = log.mock.calls[0]![0];
    expect(entry.actorType).toBe(ActorType.SELLER);
    expect(entry.actorId).toBe('seller-user-1');
    expect(entry).not.toHaveProperty('staffUserId');
  });

  it('a reserve-failed landing is reported OUT_OF_STOCK, not as a success', async () => {
    const { svc, transitionStatus } = make({
      status: OrderStatus.PENDING_CONFIRMATION,
      sellerId: 'c1',
    });
    transitionStatus.mockResolvedValueOnce({
      orderId: 'o1',
      fromStatus: OrderStatus.PENDING_CONFIRMATION,
      status: OrderStatus.OUT_OF_STOCK,
    });
    const r = await svc.confirmWithoutCall(['o1'], { actor: STAFF });
    expect(r.results[0]).toEqual({
      orderId: 'o1',
      outcome: 'OUT_OF_STOCK',
      landedStatus: OrderStatus.OUT_OF_STOCK,
    });
  });

  it("a seller cannot confirm another client's order: NOT_FOUND, no transition", async () => {
    const { svc, transitionStatus } = make({
      status: OrderStatus.PENDING_CONFIRMATION,
      sellerId: 'other-client',
    });
    const r = await svc.confirmWithoutCall(['o1'], {
      actor: { type: ActorType.SELLER, id: 'u1' },
      scopeSellerId: 'c1',
    });
    expect(r.results).toEqual([{ orderId: 'o1', outcome: 'NOT_FOUND' }]);
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('an order that already moved on is reported, not confirmed', async () => {
    const { svc, transitionStatus } = make({ status: OrderStatus.PICKED, sellerId: 'c1' });
    const r = await svc.confirmWithoutCall(['o1'], { actor: STAFF });
    expect(r.results[0]!.outcome).toBe('NOT_PENDING_CONFIRMATION');
    expect(r.results[0]!.message).toContain(OrderStatus.PICKED);
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('a bulk call with one failing order returns a PARTIAL result and confirms the rest', async () => {
    const { svc, transitionStatus } = make({
      status: OrderStatus.PENDING_CONFIRMATION,
      sellerId: 'c1',
    });
    transitionStatus.mockRejectedValueOnce(
      new ConflictException({
        code: 'STALE_ORDER_STATUS',
        message: 'Expected order to be pending_confirmation but it is confirmed',
      }),
    );
    const r = await svc.confirmWithoutCall(['o1', 'o2', 'o3'], { actor: STAFF });
    expect(r.results).toHaveLength(3);
    expect(r.results[0]).toEqual({
      orderId: 'o1',
      outcome: 'REFUSED',
      code: 'STALE_ORDER_STATUS',
      message: 'Expected order to be pending_confirmation but it is confirmed',
    });
    expect(r.results[1]!.outcome).toBe('CONFIRMED');
    expect(r.results[2]!.outcome).toBe('CONFIRMED');
  });
});
