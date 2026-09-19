import { ActorType, OrderStatus } from '@skydrop/db';
import {
  deliveredAccrualFailedKey,
  OrderDeliveredAccrualListener,
} from '../../src/modules/seller-wallet-accrual/services/order-delivered-accrual-listener.service';
import type {
  OrderLifecycleEvent,
  OrderLifecycleEventBus,
} from '../../src/modules/lifecycle-events/order-lifecycle-event-bus.service';
import type { DeliveredAccrualService } from '../../src/modules/seller-wallet-accrual/services/delivered-accrual.service';

function lifecycleEvent(
  to: OrderStatus,
  orderId = 'order-1',
  extra: Partial<OrderLifecycleEvent> = {},
): OrderLifecycleEvent {
  return {
    orderId,
    sellerId: 'seller-1',
    from: OrderStatus.OUT_FOR_DELIVERY,
    to,
    statusEventId: 'evt-1',
    actorType: ActorType.SYSTEM,
    actorId: null,
    occurredAt: new Date(),
    ...extra,
  };
}

function makeListener() {
  const accrueForDelivered = jest.fn(async () => 'EXECUTED' as const);
  const auditLog = jest.fn(async () => 'a1');
  const raise = jest.fn(async (_i: Record<string, unknown>) => undefined);
  const resolveByKey = jest.fn(async (_k: string, _n: string) => 0);
  const bus = { subscribe: jest.fn() } as unknown as OrderLifecycleEventBus;
  const listener = new OrderDeliveredAccrualListener(
    bus,
    { accrueForDelivered } as unknown as DeliveredAccrualService,
    { log: auditLog } as never,
    { raise, resolveByKey } as never,
  );
  return { listener, accrueForDelivered, auditLog, raise, resolveByKey };
}

// The tier dispatch itself is pinned in delivered-accrual.service.spec.ts;
// this is the BUS half — every transition to DELIVERED reaches it, whether
// the matrix moved the order or god mode forced it.
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

  it('a god-mode DELIVERED bills exactly like a matrix one — even from an edge the matrix forbids', async () => {
    const { listener, accrueForDelivered } = makeListener();
    await listener.handle(
      lifecycleEvent(OrderStatus.DELIVERED, 'order-1', {
        from: OrderStatus.PENDING_CONFIRMATION,
        actorType: ActorType.STAFF,
        actorId: 'staff-1',
        source: 'ADMIN_OVERRIDE',
      }),
    );
    expect(accrueForDelivered).toHaveBeenCalledTimes(1);
  });

  it('a failure is swallowed but LOUD — HIGH audit naming the order and which writer delivered it', async () => {
    const { listener, accrueForDelivered, auditLog } = makeListener();
    accrueForDelivered.mockRejectedValueOnce(new Error('wallet down'));
    await expect(
      listener.handle(
        lifecycleEvent(OrderStatus.DELIVERED, 'order-1', { source: 'ADMIN_OVERRIDE' }),
      ),
    ).resolves.toBeUndefined();
    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditLog.mock.calls[0]).toEqual([
      expect.objectContaining({
        action: 'wallet.delivered_accrual_failed',
        severity: 'HIGH',
        entityId: 'order-1',
        sellerId: 'seller-1',
        metadata: expect.objectContaining({ trigger: 'force_mutation', error: 'wallet down' }),
      }),
    ]);
  });

  it('a matrix-transition failure is attributed to the transition', async () => {
    const { listener, accrueForDelivered, auditLog } = makeListener();
    accrueForDelivered.mockRejectedValueOnce(new Error('boom'));
    await listener.handle(lifecycleEvent(OrderStatus.DELIVERED));
    expect(auditLog.mock.calls[0]).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({ trigger: 'lifecycle_transition' }),
      }),
    ]);
  });
});

/**
 * WAL-8 (2026-09-19) — a delivered order that was NOT billed is RAISED.
 *
 * The failure was a HIGH `wallet.delivered_accrual_failed` audit row and
 * nothing else, and nothing reads audit rows: the delivery charge, an
 * Instant Pay seller's COD credit and the inbound-freight share could
 * all silently not happen, with the first sign being a figure somebody
 * queried weeks later. Same defect, same fix as the reseller re-pricing.
 */
describe('OrderDeliveredAccrualListener — an unbilled delivery is RAISED, not just audited', () => {
  it('raises a HIGH MONEY issue keyed on the order, and never rethrows into the bus', async () => {
    const h = makeListener();
    h.accrueForDelivered.mockRejectedValueOnce(new Error('wallet lock timeout'));
    await expect(h.listener.handle(lifecycleEvent(OrderStatus.DELIVERED))).resolves.toBeUndefined();
    expect(h.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'MONEY',
        severity: 'HIGH',
        dedupeKey: deliveredAccrualFailedKey('order-1'),
      }),
    );
    // The audit row survives — it is the history, not the alarm.
    expect(h.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'wallet.delivered_accrual_failed' }),
    );
  });

  it('a successful accrual clears the alarm — re-running it is the fix', async () => {
    const h = makeListener();
    await h.listener.handle(lifecycleEvent(OrderStatus.DELIVERED));
    expect(h.raise).not.toHaveBeenCalled();
    expect(h.resolveByKey).toHaveBeenCalledWith(
      deliveredAccrualFailedKey('order-1'),
      expect.any(String),
    );
  });
});
