import { ActorType, StockMovementType } from '@skydrop/db';
import { InventoryMovementService } from '../../src/modules/inventory-movement/services/inventory-movement.service';
import type { CatalogReadService } from '../../src/modules/catalog-read/services/catalog-read.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * The movement ledger read by BIN: filtered on `binId`, and each row
 * carrying the bin's and warehouse's code rather than a bare uuid.
 */

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    createdAt: new Date('2026-09-10T08:00:00.000Z'),
    sellerId: 's1',
    variantId: 'v1',
    warehouseId: 'w1',
    binId: 'b-rto',
    batchId: 'bt1',
    type: StockMovementType.RETURN_RESTOCK,
    qtyChange: 1,
    qtyBefore: 0,
    qtyAfter: 1,
    actorType: ActorType.STAFF,
    actorId: null,
    reason: null,
    reasonCode: null,
    orderId: null,
    orderItemId: null,
    shipmentId: null,
    adjustmentId: null,
    transferGroupId: null,
    fromBinId: null,
    toBinId: null,
    metadata: null,
    ...over,
  };
}

function makeSut(rows: ReturnType<typeof row>[]) {
  const prisma = {
    client: {
      stockMovement: {
        findMany: jest.fn(async () => rows),
        count: jest.fn(async () => rows.length),
      },
      warehouseBin: {
        findMany: jest.fn(async () => [{ id: 'b-rto', code: 'R-01-01' }]),
      },
      warehouse: {
        findMany: jest.fn(async () => [{ id: 'w1', code: 'CCU-01' }]),
      },
    },
  } as unknown as PrismaService;
  const catalog = {
    getVariantsByIds: jest.fn(async () => new Map()),
  } as unknown as CatalogReadService;
  return { svc: new InventoryMovementService(prisma, catalog), prisma };
}

describe('InventoryMovementService — by bin', () => {
  it('filters on binId when the admin asks for one bin', async () => {
    const { svc, prisma } = makeSut([row()]);
    await svc.listForAdmin({ binId: 'b-rto' });
    const call = (prisma.client.stockMovement.findMany as jest.Mock).mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(call.where.binId).toBe('b-rto');
    expect((prisma.client.stockMovement.count as jest.Mock).mock.calls[0]?.[0]).toEqual({
      where: expect.objectContaining({ binId: 'b-rto' }),
    });
  });

  it('names the bin and warehouse by code, one query each per page', async () => {
    const { svc, prisma } = makeSut([row(), row({ id: 'm2', binId: null })]);
    const out = await svc.listForAdmin({});
    expect(out.items[0]).toMatchObject({ binCode: 'R-01-01', warehouseCode: 'CCU-01' });
    expect(out.items[1]).toMatchObject({ binId: null, binCode: null, warehouseCode: 'CCU-01' });
    expect(prisma.client.warehouseBin.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.client.warehouse.findMany).toHaveBeenCalledTimes(1);
  });

  it('asks for no codes on an empty page', async () => {
    const { svc, prisma } = makeSut([]);
    await svc.listForAdmin({});
    expect(prisma.client.warehouseBin.findMany).not.toHaveBeenCalled();
    expect(prisma.client.warehouse.findMany).not.toHaveBeenCalled();
  });
});
