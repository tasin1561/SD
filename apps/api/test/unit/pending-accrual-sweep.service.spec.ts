import { PendingAccrualSweepService } from '../../src/modules/seller-wallet-accrual/services/pending-accrual-sweep.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AccrualExecutionService } from '../../src/modules/seller-wallet-accrual/services/accrual-execution.service';

type AnyArgs = Record<string, unknown>;

function makeService(opts: { due?: AnyArgs[]; executeThrowsFor?: string[] } = {}) {
  const findMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(
    async () => opts.due ?? [{ id: 'pa-1', orderId: 'order-1' }],
  );
  const update = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({}));
  const client = { pendingAccrual: { findMany, update } };
  const prisma = { client } as unknown as PrismaService;

  const executeAccrual = jest.fn(async (orderId: string) => {
    if (opts.executeThrowsFor?.includes(orderId)) {
      throw new Error(`boom-${orderId}`);
    }
  });
  const execution = { executeAccrual };

  const svc = new PendingAccrualSweepService(
    prisma,
    execution as unknown as AccrualExecutionService,
  );
  return { svc, findMany, update, executeAccrual };
}

describe('PendingAccrualSweepService.sweep', () => {
  it('queries only unprocessed rows due at or before now', async () => {
    const { svc, findMany } = makeService({ due: [] });
    await svc.sweep(new Date('2026-01-01T00:00:00Z'));
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { processedAt: null, eligibleAt: { lte: new Date('2026-01-01T00:00:00Z') } },
      }),
    );
  });

  it('executes each due row then marks it processed (durable-first ordering)', async () => {
    const { svc, executeAccrual, update } = makeService({
      due: [{ id: 'pa-1', orderId: 'order-1' }],
    });
    const result = await svc.sweep();
    expect(executeAccrual).toHaveBeenCalledWith('order-1');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pa-1' }, data: { processedAt: expect.any(Date) } }),
    );
    expect(result).toEqual({ scanned: 1, processed: 1, failed: 0 });
  });

  it('per-row failure isolation: one failing order does not block the rest', async () => {
    const { svc, update } = makeService({
      due: [
        { id: 'pa-1', orderId: 'order-1' },
        { id: 'pa-2', orderId: 'order-2' },
      ],
      executeThrowsFor: ['order-1'],
    });
    const result = await svc.sweep();
    expect(result).toEqual({ scanned: 2, processed: 1, failed: 1 });
    // Only the successful row gets marked processed.
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pa-2' } }));
  });

  it('empty due set: no-op, zeroed result', async () => {
    const { svc, executeAccrual } = makeService({ due: [] });
    const result = await svc.sweep();
    expect(result).toEqual({ scanned: 0, processed: 0, failed: 0 });
    expect(executeAccrual).not.toHaveBeenCalled();
  });
});
