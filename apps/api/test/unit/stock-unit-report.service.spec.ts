import { SettingValueType, StockUnitStatus } from '@skydrop/db';
import { StockUnitReportService } from '../../src/modules/inventory-unit/services/stock-unit-report.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SettingsResolverService } from '../../src/modules/settings/services/settings-resolver.service';

type AnyArgs = Record<string, unknown>;

const SELLER = 'seller-1';
const WH = 'wh-1';

function unit(over: AnyArgs = {}): AnyArgs {
  return {
    id: 'u-1',
    serialBarcode: 'S1',
    variantId: 'v-1',
    status: StockUnitStatus.PICKED,
    warehouseId: WH,
    updatedAt: new Date(Date.now() - 72 * 3600_000),
    lastScanAt: new Date(Date.now() - 72 * 3600_000),
    variant: { skuCode: 'SKU-1' },
    shipmentItem: { shipmentId: 'ship-1' },
    ...over,
  };
}

function makeSut(opts: {
  findManyResults?: AnyArgs[][];
  grouped?: Array<{ variantId: string; warehouseId: string; _count: { _all: number } }>;
  qtyOnHand?: number;
  settingsThrows?: boolean;
} = {}) {
  const queue = [...(opts.findManyResults ?? [[], [], []])];
  const unitFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(
    async () => queue.shift() ?? [],
  );
  const groupBy = jest.fn(async () => opts.grouped ?? []);
  const aggregate = jest.fn<Promise<{ _sum: { qtyOnHand: number } }>, [AnyArgs]>(
    async () => ({ _sum: { qtyOnHand: opts.qtyOnHand ?? 0 } }),
  );
  const variantFindMany = jest.fn(async () => [{ id: 'v-1', skuCode: 'SKU-1' }]);

  const prisma = {
    client: {
      stockUnit: { findMany: unitFindMany, groupBy, findUnique: jest.fn() },
      stockLevel: { aggregate },
      productVariant: { findMany: variantFindMany },
    },
  } as unknown as PrismaService;

  const resolve = jest.fn(async (_s: string, key: string) => {
    if (opts.settingsThrows) throw new Error('down');
    return {
      key,
      valueType: SettingValueType.INT,
      value: key.endsWith('sla_hours') ? 24 : 14,
      source: 'SYSTEM_DEFAULT' as const,
    };
  });
  const settings = { resolve } as unknown as SettingsResolverService;

  return {
    svc: new StockUnitReportService(prisma, settings),
    unitFindMany,
    aggregate,
  };
}

describe('StockUnitReportService.forSeller', () => {
  it('reports configured thresholds and buckets each finding separately', async () => {
    const sut = makeSut({
      findManyResults: [
        [unit({ id: 'u-1', status: StockUnitStatus.PICKED })],
        [unit({ id: 'u-2', status: StockUnitStatus.DISPATCHED })],
        [unit({ id: 'u-3', status: StockUnitStatus.LOST })],
      ],
    });
    const r = await sut.svc.forSeller(SELLER);
    expect(r.thresholds).toEqual({
      stuckSlaHours: 24,
      dispatchedUnresolvedDays: 14,
    });
    expect(r.stuckUnits.map((u) => u.stockUnitId)).toEqual(['u-1']);
    expect(r.unresolvedDispatched.map((u) => u.stockUnitId)).toEqual(['u-2']);
    expect(r.retiredUnits.map((u) => u.stockUnitId)).toEqual(['u-3']);
    expect(r.stuckUnits[0]).toMatchObject({
      serialBarcode: 'S1',
      skuCode: 'SKU-1',
      shipmentId: 'ship-1',
    });
    // hoursInStatus is derived, so a stuck unit is actionable at a glance.
    expect(r.stuckUnits[0]?.hoursInStatus).toBeGreaterThan(70);
  });

  it('falls back to seeded thresholds when settings are unreadable', async () => {
    const sut = makeSut({ settingsThrows: true });
    const r = await sut.svc.forSeller(SELLER);
    expect(r.thresholds).toEqual({
      stuckSlaHours: 48,
      dispatchedUnresolvedDays: 30,
    });
  });

  it('scopes to one warehouse when asked', async () => {
    const sut = makeSut();
    await sut.svc.forSeller(SELLER, { warehouseId: WH });
    for (const call of sut.unitFindMany.mock.calls) {
      expect(call[0]['where']).toMatchObject({
        sellerId: SELLER,
        warehouseId: WH,
      });
    }
  });
});

describe('StockUnitReportService.countMismatches', () => {
  it('reports a delta when the unit ledger and qtyOnHand disagree', async () => {
    const sut = makeSut({
      grouped: [{ variantId: 'v-1', warehouseId: WH, _count: { _all: 7 } }],
      qtyOnHand: 9,
    });
    const rows = await sut.svc.countMismatches(SELLER);
    expect(rows).toEqual([
      {
        variantId: 'v-1',
        skuCode: 'SKU-1',
        warehouseId: WH,
        unitsInStock: 7,
        qtyOnHand: 9,
        delta: -2,
      },
    ]);
  });

  it('stays silent when the two agree', async () => {
    const sut = makeSut({
      grouped: [{ variantId: 'v-1', warehouseId: WH, _count: { _all: 5 } }],
      qtyOnHand: 5,
    });
    await expect(sut.svc.countMismatches(SELLER)).resolves.toEqual([]);
  });

  it('short-circuits (no aggregate query) when the seller has no serialized stock', async () => {
    const sut = makeSut({ grouped: [] });
    await expect(sut.svc.countMismatches(SELLER)).resolves.toEqual([]);
    expect(sut.aggregate).not.toHaveBeenCalled();
  });

  it('compares against qtyOnHand, NOT availability — reserved stock is still on the shelf', async () => {
    const sut = makeSut({
      grouped: [{ variantId: 'v-1', warehouseId: WH, _count: { _all: 5 } }],
      qtyOnHand: 5,
    });
    await sut.svc.countMismatches(SELLER);
    const args = sut.aggregate.mock.calls[0]![0];
    expect(args['_sum']).toEqual({ qtyOnHand: true });
    // No reservation term anywhere in the comparison.
    expect(JSON.stringify(args)).not.toContain('qtyReserved');
  });
});
