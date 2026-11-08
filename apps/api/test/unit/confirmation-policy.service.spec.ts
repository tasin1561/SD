import { ConfirmationPolicyService } from '../../src/modules/confirmation-policy/confirmation-policy.service';

function make(opts: { required?: boolean; ttl?: number; settingThrows?: boolean } = {}) {
  const orderFindUnique = jest.fn(async () => ({ sellerId: 'client-1' }));
  const orderUpdateMany = jest.fn(async (_a: Record<string, unknown>) => ({ count: 1 }));
  const resolve = jest.fn(async (_sellerId: string, key: string) => {
    if (opts.settingThrows) throw new Error('boom');
    return key === 'ops.call_confirmation_required'
      ? { value: opts.required ?? true }
      : { value: opts.ttl ?? 24 };
  });
  const enqueueOrder = jest.fn(async () => ({ entry: {}, created: true }));
  const svc = new ConfirmationPolicyService(
    { client: { order: { findUnique: orderFindUnique, updateMany: orderUpdateMany } } } as never,
    { enqueueOrder } as never,
    { resolve } as never,
  );
  return { svc, orderUpdateMany, resolve, enqueueOrder };
}

describe('ConfirmationPolicyService.enqueueOrDefer', () => {
  it('calls ON (default): enqueues exactly as before and clears any stale deadline', async () => {
    const { svc, enqueueOrder, orderUpdateMany } = make();
    await expect(svc.enqueueOrDefer('o1')).resolves.toBe('ENQUEUED');
    expect(enqueueOrder).toHaveBeenCalledWith('o1', undefined);
    expect(orderUpdateMany.mock.calls[0]![0]['data']).toEqual({ confirmationDeadlineAt: null });
  });

  it('calls OFF: no enqueue, deadline = now + ttl on a PENDING_CONFIRMATION order', async () => {
    const { svc, enqueueOrder, orderUpdateMany } = make({ required: false, ttl: 6 });
    const before = Date.now();
    await expect(svc.enqueueOrDefer('o1')).resolves.toBe('DEFERRED');
    expect(enqueueOrder).not.toHaveBeenCalled();
    const arg = orderUpdateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: { confirmationDeadlineAt: Date };
    };
    expect(arg.where).toMatchObject({ id: 'o1', status: 'PENDING_CONFIRMATION' });
    const ms = arg.data.confirmationDeadlineAt.getTime() - before;
    expect(ms).toBeGreaterThanOrEqual(6 * 3_600_000);
    expect(ms).toBeLessThan(6 * 3_600_000 + 5_000);
  });

  it("resolves the CLIENT's setting (orders.seller_id), never the store's — a member-store order", async () => {
    const { svc, resolve } = make({ required: false });
    await svc.enqueueOrDefer('o1');
    expect(resolve).toHaveBeenCalledWith('client-1', 'ops.call_confirmation_required');
    expect(resolve.mock.calls.every(([id]) => id === 'client-1')).toBe(true);
  });

  it('an unreadable setting fails safe to calls ON', async () => {
    const { svc, enqueueOrder } = make({ settingThrows: true });
    await expect(svc.enqueueOrDefer('o1')).resolves.toBe('ENQUEUED');
    expect(enqueueOrder).toHaveBeenCalled();
  });

  it('re-entry recomputes the deadline from now (each call sets a fresh one)', async () => {
    const { svc, orderUpdateMany } = make({ required: false, ttl: 1 });
    await svc.enqueueOrDefer('o1');
    await svc.enqueueOrDefer('o1');
    expect(orderUpdateMany).toHaveBeenCalledTimes(2);
  });
});

describe('ConfirmationPolicyService.queueForCall', () => {
  function makeQ(enqueue: () => Promise<{ created: boolean }>, prev: Date | null) {
    const order: string[] = [];
    const updateMany = jest.fn(async (a: { data: Record<string, unknown> }) => {
      order.push(a.data['confirmationDeadlineAt'] === null ? 'clear' : 'restore');
      return { count: 1 };
    });
    const enqueueOrder = jest.fn(async () => {
      order.push('enqueue');
      return enqueue();
    });
    const svc = new ConfirmationPolicyService(
      {
        client: {
          order: {
            findUnique: jest.fn(async () => ({ confirmationDeadlineAt: prev })),
            updateMany,
          },
        },
      } as never,
      { enqueueOrder } as never,
      {} as never,
    );
    return { svc, order };
  }

  it('clears the deadline BEFORE it enqueues, so a sweep can never claim the order', async () => {
    const { svc, order } = makeQ(async () => ({ created: true }), new Date());
    await expect(svc.queueForCall('o1')).resolves.toEqual({ created: true });
    expect(order).toEqual(['clear', 'enqueue']);
  });

  it('puts the previous deadline back when the enqueue fails, and rethrows', async () => {
    const { svc, order } = makeQ(async () => {
      throw new Error('queue down');
    }, new Date());
    await expect(svc.queueForCall('o1')).rejects.toThrow('queue down');
    expect(order).toEqual(['clear', 'enqueue', 'restore']);
  });
});
