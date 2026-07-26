import { PendingAccrualSchedulerService } from '../../src/modules/seller-wallet-accrual/services/pending-accrual-scheduler.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SettingsResolverService } from '../../src/modules/settings/services/settings-resolver.service';

type AnyArgs = Record<string, unknown>;

function makeService(opts: { existing?: AnyArgs | null; delayDays?: number } = {}) {
  const findUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(
    async () => (opts.existing === undefined ? null : opts.existing),
  );
  const create = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (a) => ({ id: 'pa-1', ...(a.data as AnyArgs) }));
  const client = { pendingAccrual: { findUnique, create } };
  const prisma = { client } as unknown as PrismaService;

  const resolve = jest.fn(async () => ({
    key: 'wallet.accrual_delay_days',
    valueType: 'INT',
    value: opts.delayDays ?? 2,
    source: 'SYSTEM_DEFAULT' as const,
  }));
  const settings = { resolve };

  const svc = new PendingAccrualSchedulerService(prisma, settings as unknown as SettingsResolverService);
  return { svc, findUnique, create, resolve };
}

describe('PendingAccrualSchedulerService.scheduleIfNeeded', () => {
  it('creates a row with eligibleAt = now + delayDays', async () => {
    const before = Date.now();
    const { svc, create, resolve } = makeService({ delayDays: 3 });
    await svc.scheduleIfNeeded('order-1', 'seller-1');
    expect(resolve).toHaveBeenCalledWith('seller-1', 'wallet.accrual_delay_days');
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0]![0]!.data as { orderId: string; sellerId: string; eligibleAt: Date };
    expect(data.orderId).toBe('order-1');
    expect(data.sellerId).toBe('seller-1');
    const expectedMs = 3 * 24 * 60 * 60 * 1000;
    expect(data.eligibleAt.getTime()).toBeGreaterThanOrEqual(before + expectedMs);
    expect(data.eligibleAt.getTime()).toBeLessThan(before + expectedMs + 5000);
  });

  it('is idempotent: does not reset the clock when a row already exists', async () => {
    const { svc, create } = makeService({ existing: { id: 'pa-existing' } });
    await svc.scheduleIfNeeded('order-1', 'seller-1');
    expect(create).not.toHaveBeenCalled();
  });
});
