import { OrderReadService } from '../../src/modules/order/services/order-read.service';
import { Prisma } from '@skydrop/db';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type AnyArgs = Record<string, unknown>;
const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

/**
 * The two figures between "sold" and "paid", on the seller's own
 * dashboard.
 */
function makeSut(
  moving: Array<{ codAmountInr: Prisma.Decimal | null }>,
  delivered: Array<{ codAmountInr: Prisma.Decimal | null }>,
) {
  const findMany = jest
    .fn<Promise<AnyArgs[]>, [AnyArgs]>()
    .mockResolvedValueOnce(moving)
    .mockResolvedValueOnce(delivered);
  const prisma = { client: { order: { findMany } } } as unknown as PrismaService;
  return { svc: new OrderReadService(prisma), findMany };
}

describe('OrderReadService.moneyInFlight', () => {
  it('totals the gross COD of each set', async () => {
    const { svc } = makeSut(
      [{ codAmountInr: D('1000') }, { codAmountInr: D('1490') }],
      [{ codAmountInr: D('1500') }],
    );
    const out = await svc.moneyInFlight('s-1');
    expect(out.inTransit).toEqual({ count: 2, codInr: '2490.00' });
    expect(out.processing).toEqual({ count: 1, codInr: '1500.00' });
  });

  it('counts only the FORWARD journey as in transit', async () => {
    const { svc, findMany } = makeSut([], []);
    await svc.moneyInFlight('s-1');
    const statuses = ((findMany.mock.calls[0]?.[0] as AnyArgs)['where'] as AnyArgs)['status'] as {
      in: string[];
    };
    // A parcel coming back or gone missing is "confirmed and not
    // delivered" by the letter of it, and is not money on its way.
    expect(statuses.in).not.toContain('RTO_IN_TRANSIT');
    expect(statuses.in).not.toContain('RTO_RECEIVED');
    expect(statuses.in).not.toContain('LOST_IN_TRANSIT');
    expect(statuses.in).not.toContain('DELIVERED');
    expect(statuses.in).toContain('IN_TRANSIT');
    // A failed attempt still re-attempts.
    expect(statuses.in).toContain('DELIVERY_FAILED');
  });

  it('counts as processing only what is DELIVERED and not yet credited', async () => {
    const { svc, findMany } = makeSut([], []);
    await svc.moneyInFlight('s-1');
    const where = (findMany.mock.calls[1]?.[0] as AnyArgs)['where'] as AnyArgs;
    expect(where['status']).toBe('DELIVERED');
    // The wallet entry is the evidence the money arrived; its absence is
    // what "processing" means.
    expect(where['walletEntries']).toEqual({
      none: { direction: 'COD_COLLECTION' },
    });
  });

  it('excludes PREPAID from both — nothing is owed on money already held', async () => {
    const { svc, findMany } = makeSut([], []);
    await svc.moneyInFlight('s-1');
    for (const call of findMany.mock.calls) {
      expect((call[0]['where'] as AnyArgs)['paymentMode']).toBe('COD');
    }
  });

  it('treats a null COD as zero rather than breaking the total', async () => {
    // A COD order with no amount is a data oddity, not a reason to show
    // the seller nothing.
    const { svc } = makeSut([{ codAmountInr: null }, { codAmountInr: D('500') }], []);
    const out = await svc.moneyInFlight('s-1');
    expect(out.inTransit).toEqual({ count: 2, codInr: '500.00' });
  });
});
