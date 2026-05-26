import { ActorType, OrderStatus } from '@skydrop/db';
import { OrderLifecycleEventBus, type OrderLifecycleEvent } from '../../src/modules/lifecycle-events/order-lifecycle-event-bus.service';

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
      const bus = new OrderLifecycleEventBus();
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
      const bus = new OrderLifecycleEventBus();
      expect(() => bus.emit(evt())).not.toThrow();
      bus.onModuleDestroy();
    });
  });

  describe('NOTIF-1 / NOTIF-5 — emit never propagates a subscriber throw', () => {
    it('subscriber that throws does NOT propagate the error to emit()', () => {
      const bus = new OrderLifecycleEventBus();
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
      const bus = new OrderLifecycleEventBus();
      bus.onModuleDestroy();
      expect(() => bus.emit(evt())).not.toThrow();
    });
  });
});
