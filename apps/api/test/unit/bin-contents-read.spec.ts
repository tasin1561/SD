import type { WarehouseResolverService } from '../../src/modules/inventory-shared/warehouse-resolver.service';
import 'reflect-metadata';
import { REQUIRE_PERMISSIONS_KEY } from '../../src/common/auth/require-permissions.decorator';
import { AdminBinContentsController } from '../../src/modules/inventory-warehouse/admin-bin-contents.controller';
import { AdminWarehouseController } from '../../src/modules/inventory-warehouse/admin-warehouse.controller';
import { StockReadService } from '../../src/modules/inventory-stock/services/stock-read.service';
import type { StockCacheService } from '../../src/modules/inventory-shared/stock-cache.service';
import type { CatalogReadService } from '../../src/modules/catalog-read/services/catalog-read.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * The stock side of the bin view (StockReadService's per-bin display
 * reads) and the permission it sits behind.
 */

describe('bin contents — permission', () => {
  it('needs warehouse.view, the same permission as the bins list', () => {
    const contents: unknown = Reflect.getMetadata(
      REQUIRE_PERMISSIONS_KEY,
      AdminBinContentsController,
    );
    const bins: unknown = Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, AdminWarehouseController);
    expect(contents).toEqual(['warehouse.view']);
    expect(contents).toEqual(bins);
  });

  it('declares no handler that widens or bypasses it', () => {
    for (const name of ['overview', 'contents'] as const) {
      const handler = AdminBinContentsController.prototype[name];
      expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler)).toBeUndefined();
    }
  });
});

function makeSut(opts: { groups?: unknown[]; rows?: unknown[]; movementGroups?: unknown[] }) {
  const stockLevel = {
    groupBy: jest.fn(async () => opts.groups ?? []),
    findMany: jest.fn(async () => opts.rows ?? []),
  };
  const stockMovement = { groupBy: jest.fn(async () => opts.movementGroups ?? []) };
  const prisma = { client: { stockLevel, stockMovement } } as unknown as PrismaService;
  const svc = new StockReadService(
    prisma,
    {} as unknown as StockCacheService,
    {} as unknown as CatalogReadService,
    {} as unknown as WarehouseResolverService,
  );
  return { svc, stockLevel, stockMovement };
}

const HOLDS = { OR: [{ qtyOnHand: { gt: 0 } }, { qtyReserved: { gt: 0 } }] };

describe('StockReadService.binTotalsForDisplay', () => {
  it('sums on hand and phase-2 reserved per bin and counts distinct SKUs', async () => {
    const { svc, stockLevel } = makeSut({
      groups: [
        {
          binId: 'floor',
          variantId: 'v1',
          _sum: { qtyOnHand: 200, qtyReserved: 3 },
          _count: { _all: 2 },
        },
        {
          binId: 'floor',
          variantId: 'v2',
          _sum: { qtyOnHand: 107, qtyReserved: 0 },
          _count: { _all: 1 },
        },
        // Fully reserved but nothing left on hand still counts as held.
        {
          binId: 'hold',
          variantId: 'v3',
          _sum: { qtyOnHand: 0, qtyReserved: 1 },
          _count: { _all: 1 },
        },
      ],
    });
    const out = await svc.binTotalsForDisplay(['floor', 'hold', 'empty']);
    expect(out.get('floor')).toEqual({
      binId: 'floor',
      unitsOnHand: 307,
      unitsReserved: 3,
      skuCount: 2,
      lineCount: 3,
    });
    expect(out.get('hold')).toMatchObject({ unitsOnHand: 0, unitsReserved: 1, skuCount: 1 });
    expect(out.has('empty')).toBe(false);
    // Zero rows are excluded IN THE QUERY, not filtered after.
    expect(stockLevel.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { binId: { in: ['floor', 'hold', 'empty'] }, ...HOLDS } }),
    );
  });

  it('asks nothing for no bins', async () => {
    const { svc, stockLevel } = makeSut({});
    expect((await svc.binTotalsForDisplay([])).size).toBe(0);
    expect(stockLevel.groupBy).not.toHaveBeenCalled();
  });
});

describe('StockReadService.binLinesForDisplay', () => {
  it('returns rows that hold something, fullest first, with the batch resolved', async () => {
    const { svc, stockLevel } = makeSut({
      rows: [
        {
          id: 'sl1',
          binId: 'floor',
          sellerId: 's1',
          variantId: 'v1',
          batchId: 'bt1',
          qtyOnHand: 5,
          qtyReserved: 2,
          batch: { batchCode: 'B-1', expiresAt: new Date('2027-01-01T00:00:00.000Z') },
        },
      ],
    });
    const out = await svc.binLinesForDisplay(['floor'], { take: 50, skip: 50 });
    expect(out).toEqual([
      {
        stockLevelId: 'sl1',
        binId: 'floor',
        sellerId: 's1',
        variantId: 'v1',
        batchId: 'bt1',
        batchCode: 'B-1',
        batchExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
        qtyOnHand: 5,
        qtyReserved: 2,
      },
    ]);
    expect(stockLevel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { binId: { in: ['floor'] }, ...HOLDS },
        orderBy: [{ binId: 'asc' }, { qtyOnHand: 'desc' }, { id: 'asc' }],
        take: 50,
        skip: 50,
      }),
    );
  });
});

describe('StockReadService.binLastMovementForDisplay', () => {
  it('keys the latest movement per variant and batch, bounded to the page’s variants', async () => {
    const at = new Date('2026-09-10T08:00:00.000Z');
    const { svc, stockMovement } = makeSut({
      movementGroups: [
        { variantId: 'v1', batchId: 'bt1', _max: { createdAt: at } },
        { variantId: 'v2', batchId: null, _max: { createdAt: at } },
      ],
    });
    const out = await svc.binLastMovementForDisplay('floor', ['v1', 'v2', 'v1']);
    expect(out.get('v1|bt1')).toEqual(at);
    expect(out.size).toBe(1);
    expect(stockMovement.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { binId: 'floor', variantId: { in: ['v1', 'v2'] } } }),
    );
  });
});
