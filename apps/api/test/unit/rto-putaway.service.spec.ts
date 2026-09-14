import { BinType, RtoDisposition, RtoItemCondition, StockMovementType } from '@skydrop/db';
import { RtoPutawayService } from '../../src/modules/warehouse-rto/services/rto-putaway.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { StockTransferService } from '../../src/modules/inventory-transfer/services/stock-transfer.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';

type AnyArgs = Record<string, unknown>;

/**
 * Putaway after WMS-8e: only a unit a PRE-WMS-8e finalize restocked INTO
 * the returns hold is waiting to be shelved. A return finalized since is
 * already on a sellable bin, a unit kept aside damaged sits in the DAMAGED
 * bin on purpose, and a unit booked at receive and not yet decided sharing
 * the same hold row is never offered.
 */
function line(
  id: string,
  quantity: number,
  rows: Array<{ quantity: number; condition: RtoItemCondition; disposition: RtoDisposition }>,
): AnyArgs {
  return {
    id,
    orderItemId: `oi-${id}`,
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

const GOOD_RESTOCK = {
  quantity: 1,
  condition: RtoItemCondition.GOOD,
  disposition: RtoDisposition.RESTOCK,
};
const DAMAGED_HOLD = {
  quantity: 1,
  condition: RtoItemCondition.DAMAGED,
  disposition: RtoDisposition.HOLD_DAMAGED,
};

function makeSut(opts: {
  items: AnyArgs[];
  /** RETURN_RESTOCK movements for the shipment. */
  restocks?: AnyArgs[];
  /** Bins that are RTO_HOLD. */
  holdBins?: string[];
  /** qtyOnHand of every hold row. */
  levelQty?: number;
  /** Receive bookings / finalize moves at the hold row (the undecided sum). */
  undecidedMovements?: Array<{ qtyChange: number }>;
}) {
  const stockMovementFindMany = jest.fn(async (args: { where: AnyArgs }) =>
    args.where['type'] === StockMovementType.RETURN_RESTOCK
      ? (opts.restocks ?? [])
      : (opts.undecidedMovements ?? []),
  );
  const warehouseBinFindMany = jest.fn(async (args: { where: AnyArgs }) => {
    const ids = ((args.where['id'] as { in: string[] }).in ?? []) as string[];
    expect(args.where['type']).toBe(BinType.RTO_HOLD);
    return ids
      .filter((id) => (opts.holdBins ?? ['bin-hold']).includes(id))
      .map((id) => ({ id, code: 'R-01-01' }));
  });
  // The hold row (asked by bin + batch). The suggestion's "busiest shelf"
  // lookup (no batch) finds nothing here.
  const stockLevelFindFirst = jest.fn(async (args: { where: AnyArgs }) =>
    args.where['batchId'] !== undefined ? { qtyOnHand: opts.levelQty ?? 5 } : null,
  );
  const client = {
    shipment: {
      findFirst: jest.fn(async () => ({
        id: 'ship-1',
        originWarehouseId: 'wh-1',
        rtoReceivedWarehouseId: null,
        items: opts.items,
      })),
    },
    stockMovement: { findMany: stockMovementFindMany },
    stockLevel: { findFirst: stockLevelFindFirst },
    warehouseBin: { findFirst: jest.fn(async () => null), findMany: warehouseBinFindMany },
  };
  const svc = new RtoPutawayService(
    { client } as unknown as PrismaService,
    {} as unknown as StockTransferService,
    { log: jest.fn() } as unknown as AuditLogService,
  );
  return { svc, stockMovementFindMany };
}

function restockInto(bin: string, qty: number, orderItemId = 'oi-si-1'): AnyArgs {
  return { orderItemId, binId: bin, batchId: 'bat-1', qtyChange: qty };
}

describe('RtoPutawayService.listPending (WMS-8e)', () => {
  it('offers a unit an older finalize restocked into the hold — the restocked row of a split line only', async () => {
    const { svc } = makeSut({
      items: [line('si-1', 2, [GOOD_RESTOCK, DAMAGED_HOLD]), line('si-2', 1, [DAMAGED_HOLD])],
      restocks: [restockInto('bin-hold', 1), restockInto('bin-damaged', 1, 'oi-si-2')],
    });
    const pending = await svc.listPending('ship-1');
    expect(pending).toEqual([
      expect.objectContaining({
        shipmentItemId: 'si-1',
        quantity: 1,
        holdBinId: 'bin-hold',
        holdBinCode: 'R-01-01',
      }),
    ]);
  });

  it('a return finalized since WMS-8e offers nothing: it wrote no restock into a hold', async () => {
    const { svc } = makeSut({ items: [line('si-1', 1, [GOOD_RESTOCK])], restocks: [] });
    expect(await svc.listPending('ship-1')).toEqual([]);
  });

  it('a restock that landed in a non-hold bin is not offered', async () => {
    const { svc } = makeSut({
      items: [line('si-1', 1, [GOOD_RESTOCK])],
      restocks: [restockInto('bin-floor', 1)],
      holdBins: [],
    });
    expect(await svc.listPending('ship-1')).toEqual([]);
  });

  it('never offers undecided units sharing the hold row: they are subtracted first', async () => {
    // Hold row holds 3: 1 from an older restocked return, 2 booked at
    // receive for a parcel nobody has decided about yet.
    const { svc } = makeSut({
      items: [line('si-1', 1, [GOOD_RESTOCK])],
      restocks: [restockInto('bin-hold', 1)],
      levelQty: 3,
      undecidedMovements: [{ qtyChange: 2 }],
    });
    expect(await svc.listPending('ship-1')).toEqual([
      expect.objectContaining({ shipmentItemId: 'si-1', quantity: 1 }),
    ]);
  });

  it('once the old unit is shelved, the undecided units left in the row are not offered in its place', async () => {
    const { svc } = makeSut({
      items: [line('si-1', 1, [GOOD_RESTOCK])],
      restocks: [restockInto('bin-hold', 1)],
      levelQty: 2,
      // Booked +3 at receive, 1 already moved out by its finalize.
      undecidedMovements: [{ qtyChange: 3 }, { qtyChange: -1 }],
    });
    expect(await svc.listPending('ship-1')).toEqual([]);
  });
});
