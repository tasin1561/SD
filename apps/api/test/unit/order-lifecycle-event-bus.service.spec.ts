import { ActorType, OrderStatus } from '@skydrop/db';

/**
 * A bus that behaves as the listening instance.
 *
 * `enabled: true` is the single-instance case and the one every existing
 * test was written against — in-process delivery, no broker on the path.
 * The cross-instance path has its own tests below.
 */
function makeBus(enabled = true): OrderLifecycleEventBus {
  const redis = {
    client: { publish: jest.fn(async () => 1) },
    createConnection: () => ({
      subscribe: jest.fn(async () => undefined),
      on: jest.fn(),
      quit: jest.fn(async () => 'OK'),
      disconnect: jest.fn(),
    }),
  } as never;
  return new OrderLifecycleEventBus(redis, { enabled } as never);
}

import {
  OrderLifecycleEventBus,
  type OrderLifecycleEvent,
} from '../../src/modules/lifecycle-events/order-lifecycle-event-bus.service';

function evt(partial: Partial<OrderLifecycleEvent> = {}): OrderLifecycleEvent {
  return {
    orderId: partial.orderId ?? 'order-1',
    sellerId: partial.sellerId ?? 'seller-1',
    from: partial.from ?? OrderStatus.PENDING_DISPATCH,
    to: partial.to ?? OrderStatus.DISPATCHED,
    statusEventId: partial.statusEventId ?? 'evt-uuid-1',
    actorType: partial.actorType ?? ActorType.SYSTEM,
    actorId: partial.actorId ?? null,
    occurredAt: partial.occurredAt ?? new Date('2026-05-26T12:00:00Z'),
  };
}

describe('OrderLifecycleEventBus (M11 R3 primitive)', () => {
  describe('emit → subscribe delivery', () => {
    it('delivers each emit to all subscribers in order', () => {
      const bus = makeBus();
      const a: OrderLifecycleEvent[] = [];
      const b: OrderLifecycleEvent[] = [];
      const subA = bus.subscribe((e) => a.push(e));
      const subB = bus.subscribe((e) => b.push(e));

      bus.emit(evt({ statusEventId: 'evt-1' }));
      bus.emit(evt({ statusEventId: 'evt-2' }));

      expect(a.map((e) => e.statusEventId)).toEqual(['evt-1', 'evt-2']);
      expect(b.map((e) => e.statusEventId)).toEqual(['evt-1', 'evt-2']);

      subA.unsubscribe();
      subB.unsubscribe();
      bus.onModuleDestroy();
    });

    it('emit with no subscribers is a silent no-op', () => {
      const bus = makeBus();
      expect(() => bus.emit(evt())).not.toThrow();
      bus.onModuleDestroy();
    });
  });

  describe('NOTIF-1 / NOTIF-5 — emit never propagates a subscriber throw', () => {
    it('subscriber that throws does NOT propagate the error to emit()', () => {
      const bus = makeBus();
      const errorThrower = jest.fn((_e: OrderLifecycleEvent) => {
        throw new Error('listener kaboom');
      });
      const goodListener = jest.fn();

      bus.subscribe(errorThrower);
      bus.subscribe(goodListener);

      // Critical NOTIF-1 / NOTIF-5 invariant: emit() returns
      // normally even when a subscriber throws. The order
      // transition must NEVER be blocked by a listener's failure.
      expect(() => bus.emit(evt())).not.toThrow();

      // The throwing subscriber was called (and its throw caught).
      expect(errorThrower).toHaveBeenCalledTimes(1);
      // The OTHER subscriber still received the event — the
      // subscribe()-wrapper isolates per-subscriber throws so one
      // bad listener cannot starve the others.
      expect(goodListener).toHaveBeenCalledTimes(1);

      bus.onModuleDestroy();
    });

    it('emit() is a noop on a completed bus (Nest teardown safe)', () => {
      const bus = makeBus();
      bus.onModuleDestroy();
      expect(() => bus.emit(evt())).not.toThrow();
    });
  });
});

describe('OrderLifecycleEventBus — across instances', () => {
  const EVENT = {
    orderId: 'o1',
    sellerId: 's1',
    from: 'OUT_FOR_DELIVERY',
    to: 'DELIVERED',
    statusEventId: 'se1',
    actorType: 'SYSTEM',
    actorId: null,
    occurredAt: new Date('2026-08-28T10:00:00.000Z'),
  } as never;

  function harness(enabled: boolean) {
    const publish = jest.fn(async () => 1);
    const subscribe = jest.fn(async () => undefined);
    const handlers: Array<(c: string, m: string) => void> = [];
    const redis = {
      client: { publish },
      createConnection: () => ({
        subscribe,
        on: (_e: string, cb: (c: string, m: string) => void) => handlers.push(cb),
        quit: jest.fn(async () => 'OK'),
        disconnect: jest.fn(),
      }),
    } as never;
    const bus = new OrderLifecycleEventBus(redis, { enabled } as never);
    return { bus, publish, subscribe, handlers };
  }

  it('the listening instance delivers in-process and never touches Redis', async () => {
    // The single-instance deployment must not gain a dependency on a
    // broker. An event lost because Redis blinked would be a regression
    // against the behaviour this bus has always had.
    const h = harness(true);
    h.bus.onApplicationBootstrap();
    const seen: unknown[] = [];
    h.bus.subscribe((e) => seen.push(e));

    h.bus.emit(EVENT);

    expect(seen).toHaveLength(1);
    expect(h.publish).not.toHaveBeenCalled();
    await h.bus.onModuleDestroy();
  });

  it('an HTTP-only instance publishes instead of dropping the event', async () => {
    // This is the bug being fixed: a second instance used to emit into
    // its own void — the order transitioned and nothing downstream ever
    // heard about it.
    const h = harness(false);
    h.bus.onApplicationBootstrap();
    const seen: unknown[] = [];
    h.bus.subscribe((e) => seen.push(e));

    h.bus.emit(EVENT);

    expect(h.publish).toHaveBeenCalledTimes(1);
    // Nothing runs here — the listeners live on the worker instance.
    expect(seen).toHaveLength(0);
    // And it does not subscribe, or it would handle its own publishes.
    expect(h.subscribe).not.toHaveBeenCalled();
  });

  it('an event arriving from another instance reaches local subscribers', async () => {
    const h = harness(true);
    h.bus.onApplicationBootstrap();
    const seen: Array<{ orderId: string; occurredAt: Date }> = [];
    h.bus.subscribe((e) => seen.push(e as never));

    h.handlers[0]?.('skydrop:order-lifecycle', JSON.stringify(EVENT));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.orderId).toBe('o1');
    // Revived as a Date — JSON gives back a string, and a listener
    // calling .toISOString() on it would throw.
    expect(seen[0]?.occurredAt).toBeInstanceOf(Date);
    await h.bus.onModuleDestroy();
  });

  it('an unreadable message is dropped without taking the subscriber down', async () => {
    const h = harness(true);
    h.bus.onApplicationBootstrap();
    const seen: unknown[] = [];
    h.bus.subscribe((e) => seen.push(e));

    expect(() => h.handlers[0]?.('skydrop:order-lifecycle', 'not json')).not.toThrow();
    h.handlers[0]?.('skydrop:order-lifecycle', JSON.stringify(EVENT));
    expect(seen).toHaveLength(1);
    await h.bus.onModuleDestroy();
  });
});
