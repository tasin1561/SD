import { BatchStatus, BinType } from '@skydrop/db';
import { RtoRestockTargetService } from '../../src/modules/warehouse-rto/services/rto-restock-target.service';

type AnyArgs = Record<string, unknown>;

const SELLER = 'seller-1';
const VARIANT = 'v-1';
const ORIGIN = 'wh-origin';
const RECEIVED = 'wh-received';
const PICKED_BIN = 'bin-origin';
const PICKED_BATCH = 'batch-1';

function makeSut(
  opts: {
    bins?: Array<{ id: string; type: BinType }>;
    parent?: AnyArgs | null;
    existingChild?: AnyArgs | null;
    warehouseCode?: string;
  } = {},
) {
  const binFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async (args) => {
    const wanted = ((args['where'] ?? {}) as AnyArgs)['type'] as BinType;
    const bins = opts.bins ?? [{ id: 'bin-rto', type: BinType.RTO_HOLD }];
    return bins.find((b) => b.type === wanted) ?? null;
  });
  const batchFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async (args) => {
    const where = args['where'] as AnyArgs;
    if (where['sellerId_batchCode'] !== undefined) {
      return opts.existingChild ?? null;
    }
    return opts.parent === undefined
      ? {
          id: PICKED_BATCH,
          batchCode: 'GR-2026-07-0001-L1',
          manufacturedAt: new Date('2026-01-01T00:00:00.000Z'),
          expiresAt: new Date('2026-12-31T00:00:00.000Z'),
          unitCostInr: '120.00',
          unitCostBdt: '160.00',
          receivingNoteId: 'gr-1',
        }
      : opts.parent;
  });
  const batchCreate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({ id: 'batch-child' }));
  const batchUpdate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({}));
  const warehouseFindUniqueOrThrow = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({
    code: opts.warehouseCode ?? 'DEL-01',
  }));

  const tx = {
    warehouseBin: { findFirst: binFindFirst },
    stockBatch: {
      findUnique: batchFindUnique,
      create: batchCreate,
      update: batchUpdate,
    },
    warehouse: { findUniqueOrThrow: warehouseFindUniqueOrThrow },
  };

  return {
    svc: new RtoRestockTargetService(),
    tx: tx as unknown as Parameters<RtoRestockTargetService['resolve']>[0],
    binFindFirst,
    batchCreate,
    batchUpdate,
  };
}

const INPUT = {
  sellerId: SELLER,
  variantId: VARIANT,
  originWarehouseId: ORIGIN,
  receivedWarehouseId: RECEIVED,
  pickedBinId: PICKED_BIN,
  pickedBatchId: PICKED_BATCH,
  quantity: 2,
  staffId: 'staff-1',
};

describe('RtoRestockTargetService.resolve — same warehouse', () => {
  it('lands in RTO_HOLD, not the picked bin, keeping the picked batch', async () => {
    // At finalize the carton is on the returns bench, not back on the
    // shelf it was picked from — nobody carried it there. Booking it
    // into the picked bin would claim a putaway that never happened
    // AND, because that bin is pickable, offer the unit to the next
    // customer before anyone had physically shelved it.
    //
    // The BATCH is untouched: same goods, same expiry, same freight
    // lineage. Only the location is in question.
    const sut = makeSut();
    const t = await sut.svc.resolve(sut.tx, {
      ...INPUT,
      receivedWarehouseId: ORIGIN,
    });
    expect(t).toEqual({
      warehouseId: ORIGIN,
      binId: 'bin-rto',
      batchId: PICKED_BATCH,
      crossWarehouse: false,
    });
    // Still no child batch — that is the cross-warehouse concern.
    expect(sut.batchCreate).not.toHaveBeenCalled();
  });

  it('falls back to the picked bin when the warehouse has no hold bin', async () => {
    // A warehouse that never set up a returns area behaves exactly as
    // it did before: the goods go back where they came from. Refusing
    // instead would strand a return over a setup step.
    const sut = makeSut({ bins: [] });
    const t = await sut.svc.resolve(sut.tx, {
      ...INPUT,
      receivedWarehouseId: ORIGIN,
    });
    expect(t).toEqual({
      warehouseId: ORIGIN,
      binId: PICKED_BIN,
      batchId: PICKED_BATCH,
      crossWarehouse: false,
    });
  });
});

describe('RtoRestockTargetService.resolve — cross warehouse', () => {
  it('creates a child batch that INHERITS the lineage that matters', async () => {
    const sut = makeSut();
    const t = await sut.svc.resolve(sut.tx, INPUT);

    expect(t).toEqual({
      warehouseId: RECEIVED,
      binId: 'bin-rto',
      batchId: 'batch-child',
      crossWarehouse: true,
    });
    const data = sut.batchCreate.mock.calls[0]![0]['data'] as AnyArgs;
    expect(data).toMatchObject({
      sellerId: SELLER,
      variantId: VARIANT,
      warehouseId: RECEIVED,
      // Deterministic code = the find-or-create key.
      batchCode: 'GR-2026-07-0001-L1-RTO-DEL-01',
      parentBatchId: PICKED_BATCH,
      status: BatchStatus.ACTIVE,
      initialQty: 2,
    });
    // FEFO: an expiry date that vanished would make old stock look fresh.
    expect(data['expiresAt']).toEqual(new Date('2026-12-31T00:00:00.000Z'));
    expect(data['manufacturedAt']).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    // Margin reporting.
    expect(data['unitCostInr']).toBe('120.00');
    // The freight chain: batch → goods receipt → inbound freight bill.
    // Clearing this would orphan the returned unit's landed cost.
    expect(data['receivingNoteId']).toBe('gr-1');
  });

  it('prefers an RTO_HOLD bin', async () => {
    const sut = makeSut({
      bins: [
        { id: 'bin-storage', type: BinType.STORAGE },
        { id: 'bin-rto', type: BinType.RTO_HOLD },
      ],
    });
    const t = await sut.svc.resolve(sut.tx, INPUT);
    expect(t.binId).toBe('bin-rto');
  });

  it('falls back to STORAGE when the warehouse has no RTO bin', async () => {
    const sut = makeSut({ bins: [{ id: 'bin-storage', type: BinType.STORAGE }] });
    const t = await sut.svc.resolve(sut.tx, INPUT);
    expect(t.binId).toBe('bin-storage');
  });

  it('refuses — with an actionable code — when no bin can hold returns', async () => {
    const sut = makeSut({ bins: [] });
    await expect(sut.svc.resolve(sut.tx, INPUT)).rejects.toMatchObject({
      response: { code: 'RTO_RESTOCK_NO_TARGET_BIN' },
    });
    expect(sut.batchCreate).not.toHaveBeenCalled();
  });

  it('a second return joins the EXISTING child batch instead of colliding', async () => {
    const sut = makeSut({ existingChild: { id: 'batch-child-existing' } });
    const t = await sut.svc.resolve(sut.tx, INPUT);
    expect(t.batchId).toBe('batch-child-existing');
    expect(sut.batchCreate).not.toHaveBeenCalled();
    // initialQty accumulates so the return batch stays a meaningful record.
    expect(sut.batchUpdate.mock.calls[0]![0]).toMatchObject({
      where: { id: 'batch-child-existing' },
      data: { initialQty: { increment: 2 } },
    });
  });

  it('refuses when the original batch has vanished rather than inventing lineage', async () => {
    const sut = makeSut({ parent: null });
    await expect(sut.svc.resolve(sut.tx, INPUT)).rejects.toMatchObject({
      response: { code: 'RTO_RESTOCK_PARENT_BATCH_MISSING' },
    });
  });
});
