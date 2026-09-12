import { ActorType, OrderStatus } from '@skydrop/db';
import { OrderDeliveredAccrualListener } from '../../src/modules/seller-wallet-accrual/services/order-delivered-accrual-listener.service';
import type {
  OrderLifecycleEvent,
  OrderLifecycleEventBus,
} from '../../src/modules/lifecycle-events/order-lifecycle-event-bus.service';
import type { DeliveredAccrualService } from '../../src/modules/seller-wallet-accrual/services/delivered-accrual.service';

function lifecycleEvent(to: OrderStatus, orderId = 'order-1'): OrderLifecycleEvent {
  return {
    orderId,
    sellerId: 'seller-1',
    from: OrderStatus.OUT_FOR_DELIVERY,
    to,
    statusEventId: 'evt-1',
    actorType: ActorType.SYSTEM,
    actorId: null,
    occurredAt: new Date(),
  };
}

function makeListener() {
  const accrueForDelivered = jest.fn(async () => 'EXECUTED' as const);
  const bus = { subscribe: jest.fn() } as unknown as OrderLifecycleEventBus;
  const listener = new OrderDeliveredAccrualListener(bus, {
    accrueForDelivered,
  } as unknown as DeliveredAccrualService);
  return { listener, accrueForDelivered };
}

// The tier dispatch itself is pinned in delivered-accrual.service.spec.ts;
// this is the BUS half — every matrix transition to DELIVERED reaches it.
describe('OrderDeliveredAccrualListener.handle', () => {
  it('ignores every transition except DELIVERED', async () => {
    const { listener, accrueForDelivered } = makeListener();
    await listener.handle(lifecycleEvent(OrderStatus.DISPATCHED));
    await listener.handle(lifecycleEvent(OrderStatus.OUT_FOR_DELIVERY));
    // A lost parcel is not charged (TRE-6, the founder 2026-09-12).
    await listener.handle(lifecycleEvent(OrderStatus.LOST_IN_TRANSIT));
    expect(accrueForDelivered).not.toHaveBeenCalled();
  });

  it('DELIVERED hands the order to the shared delivery-time accrual', async () => {
    const { listener, accrueForDelivered } = makeListener();
    await listener.handle(lifecycleEvent(OrderStatus.DELIVERED));
    expect(accrueForDelivered).toHaveBeenCalledTimes(1);
    expect(accrueForDelivered).toHaveBeenCalledWith('order-1');
  });
});
