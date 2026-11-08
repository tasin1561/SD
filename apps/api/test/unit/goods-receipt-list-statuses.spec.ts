import type { GoodsReceiptStatus } from '@skydrop/db';
import { GoodsReceiptService } from '../../src/modules/inventory-receipt/services/goods-receipt.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type Row = { id: string; status: GoodsReceiptStatus };
type Where = {
  status?: GoodsReceiptStatus | { in: GoodsReceiptStatus[] };
  AND?: Where[];
};

const matches = (r: Row, w: Where): boolean => {
  if (w.status !== undefined) {
    const ok =
      typeof w.status === 'string' ? r.status === w.status : w.status.in.includes(r.status);
    if (!ok) return false;
  }
  return (w.AND ?? []).every((c) => matches(r, c));
};

const ROWS: Row[] = (['PENDING', 'ARRIVING', 'COMPLETED', 'CANCELLED'] as const).flatMap((s) => [
  { id: `${s}-1`, status: s as GoodsReceiptStatus },
  { id: `${s}-2`, status: s as GoodsReceiptStatus },
]);

function makeSvc(): GoodsReceiptService {
  const client = {
    goodsReceipt: {
      findMany: async (a: { where: Where; take: number; skip: number }) =>
        ROWS.filter((r) => matches(r, a.where)).slice(a.skip, a.skip + a.take),
      count: async (a: { where: Where }) => ROWS.filter((r) => matches(r, a.where)).length,
    },
  };
  const svc = Object.create(GoodsReceiptService.prototype) as GoodsReceiptService;
  (svc as unknown as { prisma: PrismaService }).prisma = { client } as unknown as PrismaService;
  return svc;
}

describe('GoodsReceiptService.listForAdmin — statuses filter', () => {
  it('PENDING+ARRIVING returns exactly those two statuses and total reflects them', async () => {
    const res = await makeSvc().listForAdmin({
      statuses: ['PENDING', 'ARRIVING'] as GoodsReceiptStatus[],
    });
    expect(res.items.map((i) => i.status).sort()).toEqual([
      'ARRIVING',
      'ARRIVING',
      'PENDING',
      'PENDING',
    ]);
    expect(res.total).toBe(4);
  });

  it('total stays honest when the page is smaller than the match set', async () => {
    const res = await makeSvc().listForAdmin({
      statuses: ['PENDING', 'ARRIVING'] as GoodsReceiptStatus[],
      pageSize: 3,
    });
    expect(res.items).toHaveLength(3);
    expect(res.total).toBe(4);
  });

  it('single status still works and no filter returns everything', async () => {
    const one = await makeSvc().listForAdmin({ status: 'COMPLETED' as GoodsReceiptStatus });
    expect(one.total).toBe(2);
    const all = await makeSvc().listForAdmin({});
    expect(all.total).toBe(8);
  });
});
