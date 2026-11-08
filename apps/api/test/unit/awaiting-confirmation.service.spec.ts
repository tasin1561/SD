import { OrderStatus } from '@skydrop/db';
import { AwaitingConfirmationService } from '../../src/modules/order/services/awaiting-confirmation.service';

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
  const svc = new AwaitingConfirmationService(
    { client: { order: { findFirst } } } as never,
    { queueForCall } as never,
  );
  return { svc, enqueueOrder, clearDeadline };
}

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
