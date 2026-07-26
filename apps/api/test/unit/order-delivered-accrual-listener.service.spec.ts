import { ActorType, OrderStatus } from '@skydrop/db';
import { OrderDeliveredAccrualListener } from '../../src/modules/seller-wallet-accrual/services/order-delivered-accrual-listener.service';
import type { OrderLifecycleEvent, OrderLifecycleEventBus } from '../../src/modules/lifecycle-events/order-lifecycle-event-bus.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AccrualExecutionService } from '../../src/modules/seller-wallet-accrual/services/accrual-execution.service';
import type { PendingAccrualSchedulerService } from '../../src/modules/seller-wallet-accrual/services/pending-accrual-scheduler.service';
import type { SettingsResolverService } from '../../src/modules/settings/services/settings-resolver.service';

type AnyArgs = Record<string, unknown>;

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

function makeService(
  opts: {
    order?: AnyArgs | null;
    tier?: string;
  } = {},
) {
  const orderFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.order === undefined ? { id: 'order-1', sellerId: 'seller-1' } : opts.order,
  );
  const client = { order: { findUnique: orderFindUnique } };
  const prisma = { client } as unknown as PrismaService;

  const bus = { subscribe: jest.fn() } as unknown as OrderLifecycleEventBus;

  const resolve = jest.fn(async () => ({
    key: 'wallet.accrual_timing_tier',
    valueType: 'STRING',
    value: opts.tier ?? 'INSTANT',
    source: 'SYSTEM_DEFAULT' as const,
  }));
  const settings = { resolve };

  const executeAccrual = jest.fn(async () => undefined);
  const execution = { executeAccrual };

  const scheduleIfNeeded = jest.fn(async () => undefined);
  const scheduler = { scheduleIfNeeded };

  const listener = new OrderDeliveredAccrualListener(
    bus,
    prisma,
    settings as unknown as SettingsResolverService,
    execution as unknown as AccrualExecutionService,
    scheduler as unknown as PendingAccrualSchedulerService,
  );
  return { listener, orderFindUnique, resolve, executeAccrual, scheduleIfNeeded };
}

describe('OrderDeliveredAccrualListener.handle', () => {
  it('ignores every transition except DELIVERED', async () => {
    const { listener, executeAccrual, scheduleIfNeeded } = makeService();
    await listener.handle(lifecycleEvent(OrderStatus.DISPATCHED));
    await listener.handle(lifecycleEvent(OrderStatus.OUT_FOR_DELIVERY));
    expect(executeAccrual).not.toHaveBeenCalled();
    expect(scheduleIfNeeded).not.toHaveBeenCalled();
  });

  it('INSTANT tier (default): DELIVERED executes the accrual immediately', async () => {
    const { listener, executeAccrual, scheduleIfNeeded, resolve } = makeService({ tier: 'INSTANT' });
    await listener.handle(lifecycleEvent(OrderStatus.DELIVERED));
    expect(resolve).toHaveBeenCalledWith('seller-1', 'wallet.accrual_timing_tier');
    expect(executeAccrual).toHaveBeenCalledWith('order-1');
    expect(scheduleIfNeeded).not.toHaveBeenCalled();
  });

  it('T_PLUS_N tier: DELIVERED schedules a PendingAccrual instead of executing', async () => {
    const { listener, executeAccrual, scheduleIfNeeded } = makeService({ tier: 'T_PLUS_N' });
    await listener.handle(lifecycleEvent(OrderStatus.DELIVERED));
    expect(scheduleIfNeeded).toHaveBeenCalledWith('order-1', 'seller-1');
    expect(executeAccrual).not.toHaveBeenCalled();
  });

  it('order vanished between emit and handle: logs + returns, no writes, no throw', async () => {
    const { listener, executeAccrual, scheduleIfNeeded } = makeService({ order: null });
    await expect(listener.handle(lifecycleEvent(OrderStatus.DELIVERED))).resolves.toBeUndefined();
    expect(executeAccrual).not.toHaveBeenCalled();
    expect(scheduleIfNeeded).not.toHaveBeenCalled();
  });
});
