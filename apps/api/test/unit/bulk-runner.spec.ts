import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BulkRunnerService, bulkKey, runEach } from '../../src/common/bulk/bulk-runner.service';

/** In-memory stand-in for the two Redis calls the runner makes. */
function fakeRedis(opts: { down?: boolean } = {}) {
  const store = new Map<string, string>();
  const client = {
    set: jest.fn(async (k: string, v: string, ...rest: unknown[]) => {
      if (opts.down) throw new Error('ECONNREFUSED');
      if (rest.includes('NX') && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    }),
    get: jest.fn(async (k: string) => store.get(k) ?? null),
  };
  return { redis: { client } as never, store, client };
}

const actor = { type: 'SELLER', id: 'u1' };

describe('runEach — one order, one result', () => {
  it('runs sequentially and in order', async () => {
    const seen: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    await runEach(['a', 'b', 'c'], async (id) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(id);
      inFlight -= 1;
    });
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(maxInFlight).toBe(1);
  });

  it("a refusal is SKIPPED with the service's own code and words; the loop goes on", async () => {
    const r = await runEach(['a', 'b', 'c'], async (id) => {
      if (id === 'a')
        throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
      if (id === 'b')
        throw new ConflictException({ code: 'NOT_CANCELLABLE', message: 'already packed' });
      return 'Ticket TK-1 opened';
    });
    expect(r).toEqual([
      { orderId: 'a', outcome: 'SKIPPED', code: 'ORDER_NOT_FOUND', message: 'Order not found' },
      { orderId: 'b', outcome: 'SKIPPED', code: 'NOT_CANCELLABLE', message: 'already packed' },
      { orderId: 'c', outcome: 'DONE', message: 'Ticket TK-1 opened' },
    ]);
  });

  it('anything else is FAILED with a generic message, logged, and does not stop the rest', async () => {
    const logged: string[] = [];
    const r = await runEach(
      ['a', 'b'],
      async (id) => {
        if (id === 'a') throw new Error('db exploded');
      },
      (id) => logged.push(id),
    );
    expect(r[0]).toMatchObject({ orderId: 'a', outcome: 'FAILED', code: 'FAILED' });
    expect(r[0]?.message).not.toContain('db exploded');
    expect(r[1]).toEqual({ orderId: 'b', outcome: 'DONE' });
    expect(logged).toEqual(['a']);
  });

  it('a bare 4xx without a code still reads as SKIPPED', async () => {
    const r = await runEach(['a'], async () => {
      throw new BadRequestException('bad');
    });
    expect(r[0]).toMatchObject({ outcome: 'SKIPPED', code: 'HTTP_400' });
  });
});

describe('bulkKey', () => {
  it('same click + same payload → same key, order of ids irrelevant', () => {
    expect(bulkKey(actor, 'x', 'k1', ['b', 'a'], { r: 1 })).toBe(
      bulkKey(actor, 'x', 'k1', ['a', 'b'], { r: 1 }),
    );
  });
  it('a different payload, action, key or actor is a different key', () => {
    const base = bulkKey(actor, 'x', 'k1', ['a'], { r: 1 });
    expect(bulkKey(actor, 'x', 'k1', ['a'], { r: 2 })).not.toBe(base);
    expect(bulkKey(actor, 'y', 'k1', ['a'], { r: 1 })).not.toBe(base);
    expect(bulkKey(actor, 'x', 'k2', ['a'], { r: 1 })).not.toBe(base);
    expect(bulkKey({ type: 'SELLER', id: 'u2' }, 'x', 'k1', ['a'], { r: 1 })).not.toBe(base);
  });
});

describe('BulkRunnerService — a double-click runs nothing twice', () => {
  const input = { actor, action: 'seller.cancel', idempotencyKey: 'click-1', ids: ['a', 'b', 'a'] };

  it('runs once, de-duplicates ids, and a replay returns the stored result', async () => {
    const { redis } = fakeRedis();
    const svc = new BulkRunnerService(redis);
    const each = jest.fn(async () => undefined);
    const first = await svc.run(input, each);
    const second = await svc.run(input, each);
    expect(each).toHaveBeenCalledTimes(2); // a, b — once each, never on replay
    expect(first).toMatchObject({ done: 2, skipped: 0, failed: 0, replayed: false });
    expect(second).toMatchObject({ done: 2, replayed: true });
  });

  it('a replay while the first is still running is a 409, not a second run', async () => {
    const { redis, store } = fakeRedis();
    const svc = new BulkRunnerService(redis);
    store.set(bulkKey(actor, input.action, input.idempotencyKey, ['a', 'b']), '__running__');
    const each = jest.fn(async () => undefined);
    await expect(svc.run(input, each)).rejects.toBeInstanceOf(ConflictException);
    expect(each).not.toHaveBeenCalled();
  });

  it('with the guard unreachable it refuses (503) rather than run unguarded', async () => {
    const { redis } = fakeRedis({ down: true });
    const svc = new BulkRunnerService(redis);
    const each = jest.fn(async () => undefined);
    await expect(svc.run(input, each)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(each).not.toHaveBeenCalled();
  });
});
