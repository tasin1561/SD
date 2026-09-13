import { BinType, RtoDisposition, RtoItemCondition } from '@skydrop/db';
import { RtoPutawayService } from '../../src/modules/warehouse-rto/services/rto-putaway.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { StockTransferService } from '../../src/modules/inventory-transfer/services/stock-transfer.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';

type AnyArgs = Record<string, unknown>;

/**
 * WMS-8d — putaway shelves RESTOCKED units only. A unit kept aside damaged
 * sits in the DAMAGED bin on purpose; offering it to a shelf would make a
 * damaged unit sellable with one tap. A split line offers exactly its
 * restocked quantity.
 */
function line(
  id: string,
  quantity: number,
  rows: Array<{ quantity: number; condition: RtoItemCondition; disposition: RtoDisposition }>,
): AnyArgs {
  return {
    id,
    quantity,
    rtoCondition: rows[0]?.condition ?? null,
    rtoDisposition: rows[0]?.disposition ?? null,
    rtoInspections: rows.map((r) => ({ ...r, notes: null })),
    pickedBinId: null,
    pickedBatchId: null,
    orderItem: {
      variantId: `v-${id}`,
      skuCode: `SKU-${id}`,
      productName: `Product ${id}`,
      order: { sellerId: 'seller-1' },
    },
  };
}

function makeSut(items: AnyArgs[]) {
  const stockLevelFindFirst = jest.fn(async (args: { where: AnyArgs }) => {
    const bin = args.where['bin'] as { type: unknown } | undefined;
    // The hold lookup: a row in the returns hold for every variant.
    if (bin?.type === BinType.RTO_HOLD) {
      return { binId: 'bin-hold', batchId: 'bat-1', bin: { code: 'R-01-01' } };
    }
    return null;
  });
  const client = {
    shipment: {
      findFirst: jest.fn(async () => ({
        id: 'ship-1',
        originWarehouseId: 'wh-1',
        rtoReceivedWarehouseId: null,
        items,
      })),
    },
    stockLevel: { findFirst: stockLevelFindFirst },
    warehouseBin: { findFirst: jest.fn(async () => null) },
  };
  const svc = new RtoPutawayService(
    { client } as unknown as PrismaService,
    {} as unknown as StockTransferService,
    { log: jest.fn() } as unknown as AuditLogService,
  );
  return { svc, stockLevelFindFirst };
}

describe('RtoPutawayService.listPending', () => {
  it('offers the restocked unit of a split line, and never a unit kept aside damaged', async () => {
    const { svc, stockLevelFindFirst } = makeSut([
      line('si-1', 2, [
        { quantity: 1, condition: RtoItemCondition.GOOD, disposition: RtoDisposition.RESTOCK },
        {
          quantity: 1,
          condition: RtoItemCondition.DAMAGED,
          disposition: RtoDisposition.HOLD_DAMAGED,
        },
      ]),
      line('si-2', 1, [
        {
          quantity: 1,
          condition: RtoItemCondition.DAMAGED,
          disposition: RtoDisposition.HOLD_DAMAGED,
        },
      ]),
    ]);
    const pending = await svc.listPending('ship-1');
    expect(pending).toEqual([
      expect.objectContaining({ shipmentItemId: 'si-1', quantity: 1, holdBinId: 'bin-hold' }),
    ]);
    // The hold lookup asks for RTO_HOLD only — not the non-pickable list,
    // which includes the DAMAGED bin the kept-aside unit sits in.
    const holdLookups = stockLevelFindFirst.mock.calls
      .map((c) => (c[0].where['bin'] as { type: unknown } | undefined)?.type)
      .filter((t) => t !== undefined && typeof t === 'string');
    expect(holdLookups).toEqual([BinType.RTO_HOLD]);
  });
});
