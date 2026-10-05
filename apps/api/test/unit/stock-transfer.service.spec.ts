import { BinType, StockMovementType } from '@skydrop/db';
import { StockTransferService } from '../../src/modules/inventory-transfer/services/stock-transfer.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { StockMutationService } from '../../src/modules/inventory-shared/stock-mutation.service';

type AnyArgs = Record<string, unknown>;

const SELLER = 'seller-1';
const VARIANT = 'variant-1';
const STAFF = 'staff-1';
const SRC_WH = 'wh-src';
const DST_WH = 'wh-dst';
const SRC_BIN = 'bin-src';
const DST_BIN = 'bin-dst';
const SRC_BATCH = 'bat-src';
const DST_BATCH = 'bat-dst';

function baseInput(over: Partial<AnyArgs> = {}) {
  return {
    sellerId: SELLER,
    variantId: VARIANT,
    qty: 3,
    sourceWarehouseId: SRC_WH,
    sourceBinId: SRC_BIN,
    sourceBatchId: SRC_BATCH,
    destWarehouseId: DST_WH,
    destBinId: DST_BIN,
    destBatchId: DST_BATCH,
    ...over,
  } as Parameters<StockTransferService['transfer']>[0];
}

function makeService(
  opts: {
    sourceBin?: AnyArgs | null;
    destBin?: AnyArgs | null;
    destBatch?: AnyArgs | null;
    applyThrows?: Error;
  } = {},
) {
  /**
   * Answers BY `where.id`, the way the database does.
   *
   * It used to return the same row for every `warehouseBin.findFirst`,
   * which was invisible while the service looked up one bin and became
   * wrong the moment it looked up two: with `destBin: null` the source
   * lookup answered null as well, so the DEST_BIN_NOT_FOUND case stopped
   * reaching the assertion it was written for. Same lesson as
   * `pnl-fake-db.ts` — a fake that answers every query alike cannot show
   * two queries disagreeing.
   */
  const bins = new Map<string, AnyArgs | null>([
    [
      SRC_BIN,
      opts.sourceBin === undefined
        ? { id: SRC_BIN, code: 'A-01-01', type: BinType.STORAGE }
        : opts.sourceBin,
    ],
    [
      DST_BIN,
      opts.destBin === undefined
        ? { id: DST_BIN, warehouseId: DST_WH, code: 'B-02-05', type: BinType.STORAGE }
        : opts.destBin,
    ],
  ]);
  const binFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async (args) => {
    const id = (args['where'] as AnyArgs | undefined)?.['id'];
    return bins.get(String(id)) ?? null;
  });
  const batchFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.destBatch === undefined
      ? { id: DST_BATCH, warehouseId: DST_WH, variantId: VARIANT, sellerId: SELLER }
      : opts.destBatch,
  );
  const client = {
    warehouseBin: { findFirst: binFindFirst },
    stockBatch: { findFirst: batchFindFirst },
  };
  const prisma = { client } as unknown as PrismaService;

  let counter = 0;
  const apply = jest.fn<Promise<AnyArgs>, [unknown, AnyArgs]>(async () => {
    if (opts.applyThrows) throw opts.applyThrows;
    counter += 1;
    return { movementId: `mv-${counter}` };
  });
  const runWithRetry = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));
  const mutation = { apply, runWithRetry };

  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a1');
  const audit = { log: auditLog };

  const svc = new StockTransferService(
    prisma,
    mutation as unknown as StockMutationService,
    audit as unknown as AuditLogService,
  );
  return { svc, apply, runWithRetry, auditLog, binFindFirst, batchFindFirst };
}

describe('StockTransferService.transfer', () => {
  it('emits paired TRANSFER_OUT (−qty at source) + TRANSFER_IN (+qty at dest) sharing one transferGroupId', async () => {
    const { svc, apply } = makeService();
    const r = await svc.transfer(baseInput(), STAFF);

    expect(apply).toHaveBeenCalledTimes(2);
    const out = apply.mock.calls[0]![1]!;
    const incoming = apply.mock.calls[1]![1]!;

    expect(out).toMatchObject({
      type: StockMovementType.TRANSFER_OUT,
      warehouseId: SRC_WH,
      binId: SRC_BIN,
      batchId: SRC_BATCH,
      qtyChange: -3,
    });
    expect(incoming).toMatchObject({
      type: StockMovementType.TRANSFER_IN,
      warehouseId: DST_WH,
      binId: DST_BIN,
      batchId: DST_BATCH,
      qtyChange: 3,
    });
    // Conservation: the two legs cancel exactly.
    expect((out.qtyChange as number) + (incoming.qtyChange as number)).toBe(0);
    // Both legs carry the SAME transferGroupId, and it's the returned one.
    expect(out.transferGroupId).toBe(incoming.transferGroupId);
    expect(r.transferGroupId).toBe(out.transferGroupId);
    expect(r).toMatchObject({ outMovementId: 'mv-1', inMovementId: 'mv-2', qty: 3 });
  });

  it('runs both legs inside ONE runWithRetry transaction', async () => {
    const { svc, runWithRetry } = makeService();
    await svc.transfer(baseInput(), STAFF);
    expect(runWithRetry).toHaveBeenCalledTimes(1);
  });

  it('audits MEDIUM with crossWarehouse=true for an inter-warehouse move', async () => {
    const { svc, auditLog } = makeService();
    await svc.transfer(baseInput(), STAFF);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'staff.stock.transferred',
        severity: 'MEDIUM',
        metadata: expect.objectContaining({ crossWarehouse: true, qty: 3 }),
      }),
    );
  });

  it('supports a bin-to-bin move inside ONE warehouse (crossWarehouse=false)', async () => {
    const { svc, auditLog, apply } = makeService({
      destBin: { id: DST_BIN, warehouseId: SRC_WH, code: 'B-02-05', type: BinType.STORAGE },
      destBatch: { id: DST_BATCH, warehouseId: SRC_WH, variantId: VARIANT, sellerId: SELLER },
    });
    await svc.transfer(baseInput({ destWarehouseId: SRC_WH }), STAFF);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ crossWarehouse: false }),
      }),
    );
  });

  it.each([0, -1, 2.5])('rejects INVALID_TRANSFER_QTY for qty=%s', async (qty) => {
    const { svc, apply } = makeService();
    await expect(svc.transfer(baseInput({ qty }), STAFF)).rejects.toMatchObject({
      response: { code: 'INVALID_TRANSFER_QTY' },
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('rejects TRANSFER_SOURCE_EQUALS_DEST when warehouse+bin+batch all match', async () => {
    const { svc, apply } = makeService();
    await expect(
      svc.transfer(
        baseInput({ destWarehouseId: SRC_WH, destBinId: SRC_BIN, destBatchId: SRC_BATCH }),
        STAFF,
      ),
    ).rejects.toMatchObject({ response: { code: 'TRANSFER_SOURCE_EQUALS_DEST' } });
    expect(apply).not.toHaveBeenCalled();
  });

  it('404 DEST_BIN_NOT_FOUND', async () => {
    const { svc, apply } = makeService({ destBin: null });
    await expect(svc.transfer(baseInput(), STAFF)).rejects.toMatchObject({
      response: { code: 'DEST_BIN_NOT_FOUND' },
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('404 SOURCE_BIN_NOT_FOUND', async () => {
    // The source bin is read so its TYPE can be judged (BIN-2); a
    // missing one has to say so rather than fall through to an
    // INSUFFICIENT_ON_HAND from the movement layer.
    const { svc, apply } = makeService({ sourceBin: null });
    await expect(svc.transfer(baseInput(), STAFF)).rejects.toMatchObject({
      response: { code: 'SOURCE_BIN_NOT_FOUND' },
    });
    expect(apply).not.toHaveBeenCalled();
  });

  describe('BIN-2 — a transfer may not make unsellable stock sellable', () => {
    const damaged = { id: SRC_BIN, code: 'D-01-01', type: BinType.DAMAGED };

    it('refuses a non-pickable source moving to a pickable destination', async () => {
      const { svc, apply } = makeService({ sourceBin: damaged });
      await expect(svc.transfer(baseInput(), STAFF)).rejects.toMatchObject({
        response: { code: 'TRANSFER_WOULD_MAKE_STOCK_SELLABLE' },
      });
      // Refused BEFORE the transaction — not rolled back out of it.
      expect(apply).not.toHaveBeenCalled();
    });

    it('allows it within the non-pickable set: nothing becomes sellable', async () => {
      const { svc, apply } = makeService({
        sourceBin: damaged,
        destBin: {
          id: DST_BIN,
          warehouseId: DST_WH,
          code: 'Q-01-01',
          type: BinType.QUARANTINE,
        },
      });
      await svc.transfer(baseInput(), STAFF);
      expect(apply).toHaveBeenCalledTimes(2);
    });

    it('allows the conservative direction: a shelf to a damaged bin', async () => {
      const { svc, apply } = makeService({
        destBin: { id: DST_BIN, warehouseId: DST_WH, code: 'D-01-01', type: BinType.DAMAGED },
      });
      await svc.transfer(baseInput(), STAFF);
      expect(apply).toHaveBeenCalledTimes(2);
    });

    it('honours the waiver for the one caller that carries the judgement', async () => {
      // `RtoPutawayService` moves a return out of RTO_HOLD and onto a
      // shelf, which is this exact direction and is the point of the
      // step. `stock-transfer-non-pickable.spec.ts` pins that it is the
      // only source file passing the flag, and that no request body can.
      const { svc, apply } = makeService({
        sourceBin: { id: SRC_BIN, code: 'R-01-01', type: BinType.RTO_HOLD },
      });
      await svc.transfer(baseInput({ allowFromNonPickableBin: true }), STAFF);
      expect(apply).toHaveBeenCalledTimes(2);
    });
  });

  it('rejects DEST_BIN_WAREHOUSE_MISMATCH when the bin belongs elsewhere', async () => {
    const { svc, apply } = makeService({
      destBin: {
        id: DST_BIN,
        warehouseId: 'wh-somewhere-else',
        code: 'B-02-05',
        type: BinType.STORAGE,
      },
    });
    await expect(svc.transfer(baseInput(), STAFF)).rejects.toMatchObject({
      response: { code: 'DEST_BIN_WAREHOUSE_MISMATCH' },
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('404 DEST_BATCH_NOT_FOUND', async () => {
    const { svc, apply } = makeService({ destBatch: null });
    await expect(svc.transfer(baseInput(), STAFF)).rejects.toMatchObject({
      response: { code: 'DEST_BATCH_NOT_FOUND' },
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('rejects DEST_BATCH_WAREHOUSE_MISMATCH (batches are warehouse-scoped)', async () => {
    const { svc, apply } = makeService({
      destBatch: {
        id: DST_BATCH,
        warehouseId: 'wh-somewhere-else',
        variantId: VARIANT,
        sellerId: SELLER,
      },
    });
    await expect(svc.transfer(baseInput(), STAFF)).rejects.toMatchObject({
      response: { code: 'DEST_BATCH_WAREHOUSE_MISMATCH' },
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('rejects DEST_BATCH_OWNER_MISMATCH when the batch is another seller/variant', async () => {
    const { svc, apply } = makeService({
      destBatch: {
        id: DST_BATCH,
        warehouseId: DST_WH,
        variantId: 'other-variant',
        sellerId: SELLER,
      },
    });
    await expect(svc.transfer(baseInput(), STAFF)).rejects.toMatchObject({
      response: { code: 'DEST_BATCH_OWNER_MISMATCH' },
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('an INSUFFICIENT_ON_HAND from the OUT leg aborts the whole transfer (no audit)', async () => {
    const boom = Object.assign(new Error('insufficient'), {
      response: { code: 'INSUFFICIENT_ON_HAND' },
    });
    const { svc, auditLog } = makeService({ applyThrows: boom });
    await expect(svc.transfer(baseInput(), STAFF)).rejects.toMatchObject({
      response: { code: 'INSUFFICIENT_ON_HAND' },
    });
    expect(auditLog).not.toHaveBeenCalled();
  });
});
