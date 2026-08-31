import { Prisma } from '@skydrop/db';
import { SellerStockService } from '../../src/modules/inventory-stock/services/seller-stock.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

/**
 * What the stock is worth, split where it stands.
 *
 * The split must match the UNIT count's definition exactly. Two
 * separately-written notions of "in transit" is how a page comes to
 * show 201 units worth nothing.
 */
function makeSut(
  levels: Array<{
    qtyOnHand: number;
    warehouseId: string;
    bin: { type: string } | null;
    batch: { unitCostInr: Prisma.Decimal | null } | null;
  }>,
) {
  const svc = Object.create(SellerStockService.prototype) as SellerStockService;
  Object.assign(svc, {
    prisma: {
      client: { stockLevel: { findMany: jest.fn(async () => levels) } },
    } as unknown as PrismaService,
    // India fulfils; Dhaka takes goods in and sells nothing.
    warehousesByRole: jest.fn(async () => ({ fulfilling: ['in-1'], intakeOnly: ['bd-1'] })),
  });
  // `stockValue` is private, and the point of these tests is the split
  // rather than the caller. Cast once, here, so no assertion below has
  // to know that.
  return svc as unknown as { stockValue: (sellerId: string) => Promise<StockValue> };
}

interface StockValue {
  valueAtWarehouseInr: string;
  valueInTransitInr: string;
  valueUnknownUnits: number;
}

describe('SellerStockService stock valuation', () => {
  it('values the Indian shelf apart from everything not sellable', async () => {
    const svc = makeSut([
      {
        qtyOnHand: 50,
        warehouseId: 'in-1',
        bin: { type: 'FLOOR' },
        batch: { unitCostInr: D('10') },
      },
      // In the air, booked to a TRANSIT bin in the destination.
      {
        qtyOnHand: 20,
        warehouseId: 'in-1',
        bin: { type: 'TRANSIT' },
        batch: { unitCostInr: D('10') },
      },
      // Still sitting in Dhaka.
      {
        qtyOnHand: 30,
        warehouseId: 'bd-1',
        bin: { type: 'FLOOR' },
        batch: { unitCostInr: D('10') },
      },
    ]);
    const out = await svc.stockValue('s-1');
    expect(out.valueAtWarehouseInr).toBe('500.00');
    // 20 in the air + 30 in Dhaka, both not sellable from where they are.
    expect(out.valueInTransitInr).toBe('500.00');
  });

  it('reports unpriced units rather than valuing them at zero', async () => {
    // A silent omission makes the total look complete and small, and
    // the seller cannot tell cheap stock from unpriced stock (TRE-7).
    const svc = makeSut([
      {
        qtyOnHand: 10,
        warehouseId: 'in-1',
        bin: { type: 'FLOOR' },
        batch: { unitCostInr: D('25') },
      },
      { qtyOnHand: 7, warehouseId: 'in-1', bin: { type: 'FLOOR' }, batch: { unitCostInr: null } },
      { qtyOnHand: 3, warehouseId: 'in-1', bin: { type: 'FLOOR' }, batch: null },
    ]);
    const out = await svc.stockValue('s-1');
    expect(out.valueAtWarehouseInr).toBe('250.00');
    expect(out.valueUnknownUnits).toBe(10);
  });

  it('treats a TRANSIT bin in a fulfilling warehouse as not at the warehouse', async () => {
    // The bin lives in the DESTINATION (CNS-1), so warehouse id alone
    // would count goods still in the air as Indian shelf stock.
    const svc = makeSut([
      {
        qtyOnHand: 5,
        warehouseId: 'in-1',
        bin: { type: 'TRANSIT' },
        batch: { unitCostInr: D('100') },
      },
    ]);
    const out = await svc.stockValue('s-1');
    expect(out.valueAtWarehouseInr).toBe('0.00');
    expect(out.valueInTransitInr).toBe('500.00');
  });

  it('is zero on both sides when there is no stock', async () => {
    const out = await makeSut([]).stockValue('s-1');
    expect(out).toEqual({
      valueAtWarehouseInr: '0.00',
      valueInTransitInr: '0.00',
      valueUnknownUnits: 0,
    });
  });
});
