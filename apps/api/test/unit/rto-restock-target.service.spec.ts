import { BatchStatus, BinType } from '@skydrop/db';
import { RtoRestockTargetService } from '../../src/modules/warehouse-rto/services/rto-restock-target.service';
import type { BinPolicyService } from '../../src/modules/inventory-shared/bin-policy.service';

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
    /** BIN-1: bin tracking on the warehouse the goods are in. */
    tracking?: boolean;
    /** Real shelves, looked up by id (the picked-from test). */
    shelves?: Array<{ id: string; warehouseId: string; type: BinType }>;
  } = {},
) {
  const binFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async (args) => {
    const where = (args['where'] ?? {}) as AnyArgs;
    if (where['id'] !== undefined) {
      const notIn = ((where['type'] as { notIn?: BinType[] } | undefined)?.notIn ??
        []) as BinType[];
      const shelf = (opts.shelves ?? []).find(
        (b) =>
          b.id === where['id'] && b.warehouseId === where['warehouseId'] && !notIn.includes(b.type),
      );
      return shelf === undefined ? null : { id: shelf.id, code: `CODE-${shelf.id}` };
    }
    const wanted = where['type'] as BinType;
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
    warehouse: {
      findUniqueOrThrow: warehouseFindUniqueOrThrow,
      findUnique: jest.fn(async () => ({ code: opts.warehouseCode ?? 'DEL-01' })),
    },
  };

  const binPolicy = {
    isTrackingEnabled: jest.fn(async () => opts.tracking ?? false),
    floorBinId: jest.fn(async (warehouseId: string) => `floor-${warehouseId}`),
  };
  return {
    svc: new RtoRestockTargetService(binPolicy as unknown as BinPolicyService),
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

describe('RtoRestockTargetService.resolveDamagedHold — Keep aside (damaged), WMS-8d', () => {
  const SAME = { ...INPUT, receivedWarehouseId: ORIGIN };

  it('same warehouse: the DAMAGED bin, keeping the batch the unit left from', async () => {
    const { svc, tx, batchCreate } = makeSut({
      bins: [
        { id: 'bin-rto', type: BinType.RTO_HOLD },
        { id: 'bin-dmg', type: BinType.DAMAGED },
      ],
    });
    await expect(svc.resolveDamagedHold(tx, SAME)).resolves.toEqual({
      warehouseId: ORIGIN,
      binId: 'bin-dmg',
      batchId: PICKED_BATCH,
      crossWarehouse: false,
    });
    expect(batchCreate).not.toHaveBeenCalled();
  });

  it('no DAMAGED bin ⇒ refused by name, never the hold or storage bin', async () => {
    const { svc, tx } = makeSut({
      warehouseCode: 'CCU-01',
      bins: [
        { id: 'bin-rto', type: BinType.RTO_HOLD },
        { id: 'bin-store', type: BinType.STORAGE },
      ],
    });
    const err = await svc.resolveDamagedHold(tx, SAME).catch((e: unknown) => e);
    expect(err).toMatchObject({ response: { code: 'RTO_NO_DAMAGED_BIN' } });
    expect((err as { response: { message: string } }).response.message).toContain('CCU-01');
  });

  it('cross-warehouse: the receiving warehouse’s DAMAGED bin, in a lineage child batch', async () => {
    const { svc, tx, batchCreate } = makeSut({
      bins: [{ id: 'bin-dmg-recv', type: BinType.DAMAGED }],
    });
    const target = await svc.resolveDamagedHold(tx, INPUT);
    expect(target).toEqual({
      warehouseId: RECEIVED,
      binId: 'bin-dmg-recv',
      batchId: 'batch-child',
      crossWarehouse: true,
    });
    expect(batchCreate.mock.calls[0]![0]['data']).toMatchObject({
      parentBatchId: PICKED_BATCH,
      receivingNoteId: 'gr-1',
      status: BatchStatus.ACTIVE,
    });
  });
});

describe('RtoRestockTargetService.holdBinId — where receive books a return (WMS-8e)', () => {
  it('the warehouse’s RTO_HOLD bin', async () => {
    const sut = makeSut({
      bins: [
        { id: 'bin-storage', type: BinType.STORAGE },
        { id: 'bin-rto', type: BinType.RTO_HOLD },
      ],
    });
    await expect(sut.svc.holdBinId(sut.tx, ORIGIN)).resolves.toBe('bin-rto');
  });

  it('null when there is none — never a storage bin standing in for it', async () => {
    const sut = makeSut({ bins: [{ id: 'bin-storage', type: BinType.STORAGE }] });
    await expect(sut.svc.holdBinId(sut.tx, ORIGIN)).resolves.toBeNull();
  });
});

describe('RtoRestockTargetService.sellableDestination — where “Put back in stock” lands (WMS-8e)', () => {
  const shelves = [{ id: 'shelf-A', warehouseId: ORIGIN, type: BinType.STORAGE }];

  it('bin tracking OFF: the FLOOR bin, even when the picked shelf still exists', async () => {
    const sut = makeSut({ tracking: false, shelves });
    await expect(
      sut.svc.sellableDestination(sut.tx, { warehouseId: ORIGIN, candidateBinIds: ['shelf-A'] }),
    ).resolves.toEqual({ binId: `floor-${ORIGIN}`, reason: 'FLOOR' });
  });

  it('bin tracking ON: the shelf the unit was picked from', async () => {
    const sut = makeSut({ tracking: true, shelves });
    await expect(
      sut.svc.sellableDestination(sut.tx, { warehouseId: ORIGIN, candidateBinIds: ['shelf-A'] }),
    ).resolves.toEqual({ binId: 'shelf-A', reason: 'PICKED_FROM' });
  });

  it('bin tracking ON: the first usable candidate wins; a missing one is skipped', async () => {
    const sut = makeSut({ tracking: true, shelves });
    const d = await sut.svc.sellableDestination(sut.tx, {
      warehouseId: ORIGIN,
      candidateBinIds: [null, 'gone', 'shelf-A'],
    });
    expect(d.binId).toBe('shelf-A');
  });

  it('bin tracking ON: a shelf in another warehouse, or a non-pickable bin, falls back to FLOOR', async () => {
    const sut = makeSut({
      tracking: true,
      shelves: [
        { id: 'shelf-elsewhere', warehouseId: RECEIVED, type: BinType.STORAGE },
        { id: 'bin-hold', warehouseId: ORIGIN, type: BinType.RTO_HOLD },
      ],
    });
    await expect(
      sut.svc.sellableDestination(sut.tx, {
        warehouseId: ORIGIN,
        candidateBinIds: ['shelf-elsewhere', 'bin-hold'],
      }),
    ).resolves.toEqual({ binId: `floor-${ORIGIN}`, reason: 'FLOOR' });
  });
});

describe('RtoRestockTargetService.resolve — a line NOT booked at receive (WMS-8e)', () => {
  it('same warehouse: straight to a sellable bin (FLOOR), keeping the picked batch — never the hold', async () => {
    // It used to land in RTO_HOLD and wait for a putaway. Since WMS-8e the
    // hold holds returns nobody has decided about; this one has been
    // decided, so it goes where it can be sold.
    const sut = makeSut();
    const t = await sut.svc.resolve(sut.tx, { ...INPUT, receivedWarehouseId: ORIGIN });
    expect(t).toEqual({
      warehouseId: ORIGIN,
      binId: `floor-${ORIGIN}`,
      batchId: PICKED_BATCH,
      crossWarehouse: false,
    });
    expect(sut.batchCreate).not.toHaveBeenCalled();
  });

  it('same warehouse, tracking ON: back to the shelf it was picked from', async () => {
    const sut = makeSut({
      tracking: true,
      shelves: [{ id: PICKED_BIN, warehouseId: ORIGIN, type: BinType.STORAGE }],
    });
    const t = await sut.svc.resolve(sut.tx, { ...INPUT, receivedWarehouseId: ORIGIN });
    expect(t.binId).toBe(PICKED_BIN);
  });

  it('cross warehouse: FLOOR at the RECEIVING warehouse, in a child batch that inherits the lineage', async () => {
    const sut = makeSut();
    const t = await sut.svc.resolve(sut.tx, INPUT);

    expect(t).toEqual({
      warehouseId: RECEIVED,
      binId: `floor-${RECEIVED}`,
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
});

describe('RtoRestockTargetService.bookingBatch — the batch a return is booked in', () => {
  it('same warehouse: the batch the unit left from', async () => {
    const sut = makeSut();
    await expect(
      sut.svc.bookingBatch(sut.tx, { ...INPUT, receivedWarehouseId: ORIGIN }),
    ).resolves.toBe(PICKED_BATCH);
    expect(sut.batchCreate).not.toHaveBeenCalled();
  });

  it('a second return joins the EXISTING child batch instead of colliding', async () => {
    const sut = makeSut({ existingChild: { id: 'batch-child-existing' } });
    await expect(sut.svc.bookingBatch(sut.tx, INPUT)).resolves.toBe('batch-child-existing');
    expect(sut.batchCreate).not.toHaveBeenCalled();
    // initialQty accumulates so the return batch stays a meaningful record.
    expect(sut.batchUpdate.mock.calls[0]![0]).toMatchObject({
      where: { id: 'batch-child-existing' },
      data: { initialQty: { increment: 2 } },
    });
  });

  it('refuses when the original batch has vanished rather than inventing lineage', async () => {
    const sut = makeSut({ parent: null });
    await expect(sut.svc.bookingBatch(sut.tx, INPUT)).rejects.toMatchObject({
      response: { code: 'RTO_RESTOCK_PARENT_BATCH_MISSING' },
    });
  });
});
