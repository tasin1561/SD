import { StockAvailabilityService } from '../../src/modules/inventory-shared/stock-availability.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type AggArgs = { where: Record<string, unknown>; _sum: Record<string, boolean> };
type GroupArgs = {
  by: string[];
  where: Record<string, unknown>;
  _sum: Record<string, boolean>;
};

function makeSut(opts: {
  onHand?: number | null;
  reserved?: number | null;
  levels?: Array<{ variantId: string; _sum: { qtyOnHand: number | null } }>;
  reservations?: Array<{ variantId: string; _sum: { qtyReserved: number | null } }>;
}) {
  const levelAgg = jest.fn(async (_a: AggArgs) => ({ _sum: { qtyOnHand: opts.onHand ?? null } }));
  const resvAgg = jest.fn(async (_a: AggArgs) => ({
    _sum: { qtyReserved: opts.reserved ?? null },
  }));
  const levelGroup = jest.fn(async (_a: GroupArgs) => opts.levels ?? []);
  const resvGroup = jest.fn(async (_a: GroupArgs) => opts.reservations ?? []);
  const client = {
    stockLevel: { aggregate: levelAgg, groupBy: levelGroup },
    stockReservation: { aggregate: resvAgg, groupBy: resvGroup },
  };
  const prisma = { client } as unknown as PrismaService;
  const svc = new StockAvailabilityService(prisma);
  return { svc, levelAgg, resvAgg, levelGroup, resvGroup };
}

describe('StockAvailabilityService.compute (INV-3 scalar)', () => {
  it('returns 0 when there is no stock and no reservations', async () => {
    const { svc } = makeSut({ onHand: null, reserved: null });
    expect(await svc.compute({ sellerId: 's1', variantId: 'v1', warehouseId: 'w1' })).toBe(0);
  });

  it('computes onHand − ACTIVE reserved for the mixed case', async () => {
    const { svc } = makeSut({ onHand: 30, reserved: 12 });
    expect(await svc.compute({ sellerId: 's1', variantId: 'v1', warehouseId: 'w1' })).toBe(18);
  });

  it('clamps a transient over-reservation to 0 (never negative)', async () => {
    const { svc } = makeSut({ onHand: 5, reserved: 9 });
    expect(await svc.compute({ sellerId: 's1', variantId: 'v1', warehouseId: 'w1' })).toBe(0);
  });

  it('only counts ACTIVE reservations, scoped to the one (seller,variant,warehouse)', async () => {
    const { svc, levelAgg, resvAgg } = makeSut({ onHand: 10, reserved: 4 });
    await svc.compute({ sellerId: 's1', variantId: 'v1', warehouseId: 'w1' });
    expect(levelAgg.mock.calls[0]?.[0].where).toEqual({
      sellerId: 's1',
      variantId: 'v1',
      warehouseId: 'w1',
    });
    expect(resvAgg.mock.calls[0]?.[0].where).toEqual({
      sellerId: 's1',
      variantId: 'v1',
      warehouseId: 'w1',
      status: 'ACTIVE',
    });
  });

  it('uses the supplied tx client instead of the singleton when given', async () => {
    const { svc, levelAgg, resvAgg } = makeSut({ onHand: 99, reserved: 0 });
    const txLevel = jest.fn(async () => ({ _sum: { qtyOnHand: 7 } }));
    const txResv = jest.fn(async () => ({ _sum: { qtyReserved: 2 } }));
    const tx = {
      stockLevel: { aggregate: txLevel },
      stockReservation: { aggregate: txResv },
    } as unknown as Parameters<typeof svc.compute>[0]['tx'];

    const r = await svc.compute({ sellerId: 's1', variantId: 'v1', warehouseId: 'w1', tx });

    expect(r).toBe(5); // 7 − 2, read via tx
    expect(txLevel).toHaveBeenCalledTimes(1);
    expect(txResv).toHaveBeenCalledTimes(1);
    expect(levelAgg).not.toHaveBeenCalled();
    expect(resvAgg).not.toHaveBeenCalled();
  });
});

describe('StockAvailabilityService.computeBulk', () => {
  it('returns every requested variant (missing → 0) via two GROUP BY queries, no N+1', async () => {
    const { svc, levelGroup, resvGroup } = makeSut({
      levels: [
        { variantId: 'v1', _sum: { qtyOnHand: 20 } },
        { variantId: 'v2', _sum: { qtyOnHand: 3 } },
      ],
      reservations: [
        { variantId: 'v1', _sum: { qtyReserved: 5 } },
        { variantId: 'v2', _sum: { qtyReserved: 9 } }, // over-reserved → clamp
      ],
    });
    const map = await svc.computeBulk({
      sellerId: 's1',
      variantIds: ['v1', 'v2', 'v3'],
      warehouseId: 'w1',
    });
    expect(map.get('v1')).toBe(15); // 20 − 5
    expect(map.get('v2')).toBe(0); // 3 − 9 clamped
    expect(map.get('v3')).toBe(0); // no footprint
    expect(map.size).toBe(3);
    expect(levelGroup).toHaveBeenCalledTimes(1);
    expect(resvGroup).toHaveBeenCalledTimes(1);
    expect(resvGroup.mock.calls[0]?.[0].where).toMatchObject({
      sellerId: 's1',
      warehouseId: 'w1',
      status: 'ACTIVE',
      variantId: { in: ['v1', 'v2', 'v3'] },
    });
  });

  it('short-circuits to an empty map with no DB calls for an empty id list', async () => {
    const { svc, levelGroup, resvGroup } = makeSut({});
    const map = await svc.computeBulk({ sellerId: 's1', variantIds: [], warehouseId: 'w1' });
    expect(map.size).toBe(0);
    expect(levelGroup).not.toHaveBeenCalled();
    expect(resvGroup).not.toHaveBeenCalled();
  });
});
