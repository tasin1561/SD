import { DeliveredAccrualService } from '../../src/modules/seller-wallet-accrual/services/delivered-accrual.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AccrualExecutionService } from '../../src/modules/seller-wallet-accrual/services/accrual-execution.service';
import type { PendingAccrualSchedulerService } from '../../src/modules/seller-wallet-accrual/services/pending-accrual-scheduler.service';
import type { SettingsResolverService } from '../../src/modules/settings/services/settings-resolver.service';

type AnyArgs = Record<string, unknown>;

function makeService(opts: { order?: AnyArgs | null; tier?: string } = {}) {
  const orderFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.order === undefined ? { id: 'order-1', sellerId: 'seller-1' } : opts.order,
  );
  const prisma = { client: { order: { findUnique: orderFindUnique } } } as unknown as PrismaService;
  const resolve = jest.fn(async () => ({
    key: 'wallet.accrual_timing_tier',
    valueType: 'STRING',
    // Mirrors the seeded system default (T_PLUS_N since 2026-07-26).
    value: opts.tier ?? 'T_PLUS_N',
    source: 'SYSTEM_DEFAULT' as const,
  }));
  const executeAccrual = jest.fn(async () => undefined);
  const scheduleIfNeeded = jest.fn(async () => undefined);
  const svc = new DeliveredAccrualService(
    prisma,
    { resolve } as unknown as SettingsResolverService,
    { executeAccrual } as unknown as AccrualExecutionService,
    { scheduleIfNeeded } as unknown as PendingAccrualSchedulerService,
  );
  return { svc, resolve, executeAccrual, scheduleIfNeeded };
}

describe('DeliveredAccrualService.accrueForDelivered — the one dispatch every DELIVERED writer calls', () => {
  it('INSTANT tier: executes the accrual (charges debit, Instant Pay COD, freight) immediately', async () => {
    const { svc, resolve, executeAccrual, scheduleIfNeeded } = makeService({ tier: 'INSTANT' });
    await expect(svc.accrueForDelivered('order-1')).resolves.toBe('EXECUTED');
    expect(resolve).toHaveBeenCalledWith('seller-1', 'wallet.accrual_timing_tier');
    expect(executeAccrual).toHaveBeenCalledWith('order-1');
    expect(scheduleIfNeeded).not.toHaveBeenCalled();
  });

  it('T_PLUS_N tier: schedules a PendingAccrual instead of executing', async () => {
    const { svc, executeAccrual, scheduleIfNeeded } = makeService({ tier: 'T_PLUS_N' });
    await expect(svc.accrueForDelivered('order-1')).resolves.toBe('SCHEDULED');
    expect(scheduleIfNeeded).toHaveBeenCalledWith('order-1', 'seller-1');
    expect(executeAccrual).not.toHaveBeenCalled();
  });

  it('order vanished: returns ORDER_NOT_FOUND, no writes, no throw', async () => {
    const { svc, executeAccrual, scheduleIfNeeded } = makeService({ order: null });
    await expect(svc.accrueForDelivered('order-1')).resolves.toBe('ORDER_NOT_FOUND');
    expect(executeAccrual).not.toHaveBeenCalled();
    expect(scheduleIfNeeded).not.toHaveBeenCalled();
  });

  it('propagates an execution failure — the CALLER decides how loud it is', async () => {
    const { svc, executeAccrual } = makeService({ tier: 'INSTANT' });
    executeAccrual.mockRejectedValueOnce(new Error('wallet down'));
    await expect(svc.accrueForDelivered('order-1')).rejects.toThrow('wallet down');
  });
});
