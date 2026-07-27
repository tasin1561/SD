import { VariantStatus } from '@skydrop/db';
import { StockReadService } from '../../src/modules/inventory-stock/services/stock-read.service';
import type { StockCacheService } from '../../src/modules/inventory-shared/stock-cache.service';
import type { CatalogReadService } from '../../src/modules/catalog-read/services/catalog-read.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

function resolved(over: Record<string, unknown> = {}) {
  return {
    variantId: 'v1',
    productId: 'p1',
    sellerId: 's1',
    categoryId: 'c1',
    skuCode: 'SKU-1',
    variantLabel: 'Red / L',
    status: VariantStatus.ACTIVE,
    attributes: {},
    weightGrams: null,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    declaredValueInr: null,
    hsCode: null,
    gstRate: { toString: () => '18' },
    lowStockThreshold: null,
    ...over,
  };
}

function makeSut(opts: {
  levels?: Array<{ variantId: string; _sum: { qtyOnHand: number | null } }>;
  reservations?: Array<{ variantId: string; _sum: { qtyReserved: number | null } }>;
  liveOnHand?: number;
  liveReserved?: number;
  sellerDefault?: number | null;
  catalog?: Map<string, ReturnType<typeof resolved>>;
  detailCacheHit?: unknown;
  aggCacheHit?: unknown;
}) {
  const stockLevel = {
    aggregate: jest.fn(async () => ({ _sum: { qtyOnHand: opts.liveOnHand ?? 0 } })),
    groupBy: jest.fn(async () => opts.levels ?? []),
  };
  const stockReservation = {
    aggregate: jest.fn(async () => ({ _sum: { qtyReserved: opts.liveReserved ?? 0 } })),
    groupBy: jest.fn(async () => opts.reservations ?? []),
  };
  const seller = {
    findUnique: jest.fn(async () => ({
      defaultLowStockThreshold: opts.sellerDefault ?? null,
    })),
  };
  const prisma = {
    client: { stockLevel, stockReservation, seller },
  } as unknown as PrismaService;

  const cache = {
    getDetail: jest.fn(async () => opts.detailCacheHit ?? null),
    setDetail: jest.fn(async () => undefined),
    getAggregate: jest.fn(async () => opts.aggCacheHit ?? null),
    setAggregate: jest.fn(async () => undefined),
    invalidate: jest.fn(async () => undefined),
  } as unknown as StockCacheService;

  const map = opts.catalog ?? new Map();
  const catalog = {
    getVariantsByIds: jest.fn(async () => map),
    getVariantById: jest.fn(async (id: string) => map.get(id) ?? null),
  } as unknown as CatalogReadService;

  const svc = new StockReadService(prisma, cache, catalog);
  return { svc, stockLevel, stockReservation, cache, catalog };
}

describe('StockReadService — live path (INV-2/INV-3)', () => {
  it('computes qtyAvailable = onHand - activeReserved WITHOUT touching cache', async () => {
    const { svc, cache, stockLevel } = makeSut({ liveOnHand: 30, liveReserved: 12 });
    const live = await svc.getVariantStockLive('s1', 'v1', 'w1');
    expect(live).toEqual({
      sellerId: 's1',
      variantId: 'v1',
      warehouseId: 'w1',
      qtyOnHand: 30,
      qtyReservedActive: 12,
      qtyAvailable: 18,
    });
    expect(cache.getDetail).not.toHaveBeenCalled();
    expect(cache.getAggregate).not.toHaveBeenCalled();
    expect(stockLevel.aggregate).toHaveBeenCalledTimes(1);
  });
});

describe('StockReadService — display path (cache-backed)', () => {
  it('serves a detail cache hit without hitting the DB', async () => {
    const hit = {
      sellerId: 's1',
      warehouseId: 'w1',
      generatedAt: 'x',
      variants: [
        {
          variantId: 'v1',
          productId: 'p1',
          categoryId: 'c1',
          skuCode: 'SKU-1',
          variantLabel: null,
          status: VariantStatus.ACTIVE,
          qtyOnHand: 5,
          qtyReserved: 1,
          qtyAvailable: 4,
          lowStockThreshold: null,
          isLowStock: false,
        },
      ],
    };
    const { svc, stockLevel } = makeSut({ detailCacheHit: hit });
    const res = await svc.listStockForDisplay('s1', 'w1', {});
    expect(res.total).toBe(1);
    expect(res.items[0]?.variantId).toBe('v1');
    expect(stockLevel.groupBy).not.toHaveBeenCalled();
  });

  it('builds + caches the snapshot on a miss; effective threshold and isLowStock', async () => {
    const catalog = new Map([
      ['v1', resolved({ variantId: 'v1', skuCode: 'A', lowStockThreshold: 10 })],
      ['v2', resolved({ variantId: 'v2', skuCode: 'B', lowStockThreshold: null })],
    ]);
    const { svc, cache } = makeSut({
      levels: [
        { variantId: 'v1', _sum: { qtyOnHand: 8 } },
        { variantId: 'v2', _sum: { qtyOnHand: 50 } },
      ],
      reservations: [{ variantId: 'v1', _sum: { qtyReserved: 0 } }],
      sellerDefault: 5,
      catalog,
    });
    const res = await svc.listStockForDisplay('s1', 'w1', {});
    expect(res.total).toBe(2);
    const v1 = res.items.find((v) => v.variantId === 'v1')!;
    const v2 = res.items.find((v) => v.variantId === 'v2')!;
    // v1: variant override threshold 10, available 8 -> low
    expect(v1.lowStockThreshold).toBe(10);
    expect(v1.isLowStock).toBe(true);
    // v2: no variant override -> seller default 5, available 50 -> not low
    expect(v2.lowStockThreshold).toBe(5);
    expect(v2.isLowStock).toBe(false);
    expect(cache.setDetail).toHaveBeenCalledTimes(1);
    expect(cache.setAggregate).toHaveBeenCalledTimes(1);
  });

  it('filters by category and paginates the cached set', async () => {
    const catalog = new Map([
      ['v1', resolved({ variantId: 'v1', skuCode: 'A', categoryId: 'c1' })],
      ['v2', resolved({ variantId: 'v2', skuCode: 'B', categoryId: 'c2' })],
    ]);
    const { svc } = makeSut({
      levels: [
        { variantId: 'v1', _sum: { qtyOnHand: 1 } },
        { variantId: 'v2', _sum: { qtyOnHand: 2 } },
      ],
      catalog,
    });
    const res = await svc.listStockForDisplay('s1', 'w1', { categoryId: 'c2' });
    expect(res.total).toBe(1);
    expect(res.items[0]?.variantId).toBe('v2');
  });

  it('getVariantStockForDisplay returns a zeroed view for a stockless seller variant, null for foreign', async () => {
    const catalog = new Map([['v9', resolved({ variantId: 'v9', sellerId: 's1', skuCode: 'Z' })]]);
    const { svc } = makeSut({ catalog, sellerDefault: 3 });
    const zero = await svc.getVariantStockForDisplay('s1', 'v9', 'w1');
    expect(zero).toMatchObject({
      variantId: 'v9',
      qtyOnHand: 0,
      qtyAvailable: 0,
      lowStockThreshold: 3,
      isLowStock: true,
    });

    const foreign = await svc.getVariantStockForDisplay('s1', 'missing', 'w1');
    expect(foreign).toBeNull();
  });
});
