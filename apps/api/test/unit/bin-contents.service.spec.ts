import { BinType } from '@skydrop/db';
import {
  BinContentsService,
  LINES_PER_BIN,
  ONE_QUERY_LINE_LIMIT,
} from '../../src/modules/inventory-warehouse/services/bin-contents.service';
import type {
  BinStockLineRaw,
  BinStockTotals,
  StockReadService,
} from '../../src/modules/inventory-stock/services/stock-read.service';
import type { CatalogReadService } from '../../src/modules/catalog-read/services/catalog-read.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * "Where can I see what R-01-01 and D-01-01 hold?" — the all-bins view.
 *
 * The properties that matter: every bin appears (an empty one too), each
 * line carries the product, SKU, seller and batch, reserved is the
 * phase-2 figure, and names are resolved in ONE catalog call and ONE
 * seller query however many bins there are.
 */

const W = 'w-ccu';
const FLOOR = 'b-floor';
const RTO = 'b-rto';
const DMG = 'b-dmg';

function line(over: Partial<BinStockLineRaw>): BinStockLineRaw {
  return {
    stockLevelId: 'sl-1',
    binId: FLOOR,
    sellerId: 's-menev',
    variantId: 'v-kurta',
    batchId: 'bt-1',
    batchCode: 'B-2026-08',
    batchExpiresAt: null,
    qtyOnHand: 100,
    qtyReserved: 0,
    ...over,
  };
}

function makeSut(opts: {
  totals: BinStockTotals[];
  lines?: BinStockLineRaw[];
  perBin?: Record<string, BinStockLineRaw[]>;
}) {
  const prisma = {
    client: {
      warehouse: {
        findMany: jest.fn(async () => [
          {
            id: W,
            code: 'CCU-01',
            name: 'Kolkata Main',
            binTrackingEnabled: false,
            fulfilsOrders: true,
          },
        ]),
      },
      warehouseBin: {
        findMany: jest.fn(async () => [
          {
            id: DMG,
            warehouseId: W,
            code: 'D-01-01',
            type: BinType.DAMAGED,
            zone: { code: 'MAIN' },
          },
          {
            id: FLOOR,
            warehouseId: W,
            code: 'FLOOR',
            type: BinType.STORAGE,
            zone: { code: 'MAIN' },
          },
          {
            id: RTO,
            warehouseId: W,
            code: 'R-01-01',
            type: BinType.RTO_HOLD,
            zone: { code: 'MAIN' },
          },
        ]),
        findFirst: jest.fn(async () => ({
          id: FLOOR,
          code: 'FLOOR',
          type: BinType.STORAGE,
          zone: { code: 'MAIN' },
          warehouse: { id: W, code: 'CCU-01', name: 'Kolkata Main' },
        })),
      },
      seller: {
        findMany: jest.fn(async () => [{ id: 's-menev', companyName: 'Menev Store' }]),
      },
    },
  } as unknown as PrismaService;

  const totalsMap = new Map(opts.totals.map((t) => [t.binId, t]));
  const stock = {
    binTotalsForDisplay: jest.fn(async () => totalsMap),
    binLinesForDisplay: jest.fn(async (binIds: readonly string[]) => {
      if (opts.perBin !== undefined && binIds.length === 1) {
        const only = binIds[0] ?? '';
        return opts.perBin[only] ?? [];
      }
      return (opts.lines ?? []).filter((l) => binIds.includes(l.binId));
    }),
    binLastMovementForDisplay: jest.fn(
      async () => new Map([['v-kurta|bt-1', new Date('2026-09-10T08:00:00.000Z')]]),
    ),
  } as unknown as StockReadService;

  const catalog = {
    thumbnailUrlsByVariant: jest.fn(
      async () => new Map([['v-kurta', 'https://spaces.example/thumb-kurta.webp']]),
    ),
    getVariantsByIds: jest.fn(
      async () =>
        new Map([
          [
            'v-kurta',
            {
              variantId: 'v-kurta',
              productName: 'Cotton Kurta',
              skuCode: 'KRT-RED-L',
              variantLabel: 'Red / L',
            },
          ],
        ]),
    ),
  } as unknown as CatalogReadService;

  return { svc: new BinContentsService(prisma, stock, catalog), prisma, stock, catalog };
}

describe('BinContentsService.overview', () => {
  it('lists every bin — empty ones included — with totals and the lines inside', async () => {
    const { svc } = makeSut({
      totals: [{ binId: FLOOR, unitsOnHand: 307, unitsReserved: 5, skuCount: 1, lineCount: 1 }],
      lines: [line({ qtyOnHand: 307, qtyReserved: 5 })],
    });

    const out = await svc.overview();
    const wh = out.warehouses[0];
    expect(wh?.code).toBe('CCU-01');
    expect(wh?.bins.map((b) => b.code)).toEqual(['D-01-01', 'FLOOR', 'R-01-01']);

    const floor = wh?.bins.find((b) => b.code === 'FLOOR');
    expect(floor).toMatchObject({
      pickable: true,
      unitsOnHand: 307,
      unitsReserved: 5,
      skuCount: 1,
      lineCount: 1,
      linesNotShown: 0,
    });
    expect(floor?.lines[0]).toMatchObject({
      productName: 'Cotton Kurta',
      skuCode: 'KRT-RED-L',
      variantLabel: 'Red / L',
      sellerName: 'Menev Store',
      batchCode: 'B-2026-08',
      qtyOnHand: 307,
      qtyReserved: 5,
    });

    const rto = wh?.bins.find((b) => b.code === 'R-01-01');
    expect(rto).toMatchObject({ pickable: false, unitsOnHand: 0, skuCount: 0, lines: [] });
    expect(wh?.bins.find((b) => b.code === 'D-01-01')?.pickable).toBe(false);
  });

  it('resolves names in ONE catalog call and ONE seller query across every bin', async () => {
    const { svc, catalog, prisma } = makeSut({
      totals: [
        { binId: FLOOR, unitsOnHand: 10, unitsReserved: 0, skuCount: 1, lineCount: 1 },
        { binId: RTO, unitsOnHand: 2, unitsReserved: 0, skuCount: 1, lineCount: 1 },
      ],
      lines: [line({}), line({ stockLevelId: 'sl-2', binId: RTO, qtyOnHand: 2 })],
    });
    await svc.overview();
    expect(catalog.getVariantsByIds).toHaveBeenCalledTimes(1);
    expect(catalog.thumbnailUrlsByVariant).toHaveBeenCalledTimes(1);
    expect(prisma.client.seller.findMany).toHaveBeenCalledTimes(1);
  });

  it('carries the product picture, and a failed picture lookup costs only the picture', async () => {
    const { svc, catalog } = makeSut({
      totals: [{ binId: FLOOR, unitsOnHand: 10, unitsReserved: 0, skuCount: 1, lineCount: 1 }],
      lines: [line({})],
    });
    const first = await svc.overview();
    expect(first.warehouses[0]?.bins.find((b) => b.code === 'FLOOR')?.lines[0]?.thumbnailUrl).toBe(
      'https://spaces.example/thumb-kurta.webp',
    );

    (catalog.thumbnailUrlsByVariant as jest.Mock).mockRejectedValueOnce(new Error('spaces down'));
    const second = await svc.overview();
    const l = second.warehouses[0]?.bins.find((b) => b.code === 'FLOOR')?.lines[0];
    expect(l).toMatchObject({ thumbnailUrl: null, productName: 'Cotton Kurta' });
  });

  it('reads every bin in one query while the building is small', async () => {
    const { svc, stock } = makeSut({
      totals: [
        { binId: FLOOR, unitsOnHand: 10, unitsReserved: 0, skuCount: 1, lineCount: 1 },
        { binId: RTO, unitsOnHand: 2, unitsReserved: 0, skuCount: 1, lineCount: 1 },
      ],
      lines: [line({}), line({ stockLevelId: 'sl-2', binId: RTO })],
    });
    await svc.overview();
    expect(stock.binLinesForDisplay).toHaveBeenCalledTimes(1);
    expect(stock.binLinesForDisplay).toHaveBeenCalledWith([FLOOR, RTO], { take: 2 });
  });

  it('caps each bin and says how many lines are not shown once it grows', async () => {
    const big = ONE_QUERY_LINE_LIMIT + 1;
    const floorLines = Array.from({ length: LINES_PER_BIN }, (_, i) =>
      line({ stockLevelId: `sl-${i}`, variantId: `v-${i}` }),
    );
    const { svc, stock } = makeSut({
      totals: [
        { binId: FLOOR, unitsOnHand: big, unitsReserved: 0, skuCount: big, lineCount: big },
        { binId: RTO, unitsOnHand: 1, unitsReserved: 0, skuCount: 1, lineCount: 1 },
      ],
      perBin: { [FLOOR]: floorLines, [RTO]: [line({ stockLevelId: 'r', binId: RTO })] },
    });

    const out = await svc.overview();
    // Per-bin reads, each capped, so FLOOR cannot starve the hold bin.
    expect(stock.binLinesForDisplay).toHaveBeenCalledWith([FLOOR], { take: LINES_PER_BIN });
    expect(stock.binLinesForDisplay).toHaveBeenCalledWith([RTO], { take: LINES_PER_BIN });
    const bins = out.warehouses[0]?.bins ?? [];
    const floor = bins.find((b) => b.code === 'FLOOR');
    expect(floor?.lines).toHaveLength(LINES_PER_BIN);
    expect(floor?.linesNotShown).toBe(big - LINES_PER_BIN);
    expect(bins.find((b) => b.code === 'R-01-01')?.lines).toHaveLength(1);
  });

  it('keeps a line whose product was deleted — the stock is still on the shelf', async () => {
    const { svc } = makeSut({
      totals: [{ binId: FLOOR, unitsOnHand: 4, unitsReserved: 0, skuCount: 1, lineCount: 1 }],
      lines: [line({ variantId: 'v-gone', qtyOnHand: 4 })],
    });
    const floor = (await svc.overview()).warehouses[0]?.bins.find((b) => b.code === 'FLOOR');
    expect(floor?.lines[0]).toMatchObject({
      variantId: 'v-gone',
      productName: null,
      skuCode: null,
    });
  });
});

describe('BinContentsService.binContents', () => {
  it('pages one bin and adds when each line last moved', async () => {
    const { svc, stock } = makeSut({
      totals: [{ binId: FLOOR, unitsOnHand: 307, unitsReserved: 0, skuCount: 3, lineCount: 3 }],
      lines: [line({})],
    });
    const out = await svc.binContents(FLOOR, { page: 2, pageSize: 1 });
    expect(stock.binLinesForDisplay).toHaveBeenCalledWith([FLOOR], { take: 1, skip: 1 });
    expect(out.total).toBe(3);
    expect(out.bin).toMatchObject({ code: 'FLOOR', warehouseCode: 'CCU-01', pickable: true });
    expect(out.items[0]?.lastMovementAt?.toISOString()).toBe('2026-09-10T08:00:00.000Z');
    expect(out.items[0]?.sellerName).toBe('Menev Store');
  });

  it('404s a bin that does not exist', async () => {
    const { svc, prisma } = makeSut({ totals: [] });
    (prisma.client.warehouseBin.findFirst as jest.Mock).mockResolvedValueOnce(null);
    await expect(svc.binContents('nope', {})).rejects.toMatchObject({
      response: { code: 'BIN_NOT_FOUND' },
    });
  });
});
