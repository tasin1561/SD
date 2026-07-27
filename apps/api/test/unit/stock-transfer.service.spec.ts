import { StockMovementType } from '@skydrop/db';
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
    destBin?: AnyArgs | null;
    destBatch?: AnyArgs | null;
    applyThrows?: Error;
  } = {},
) {
  const binFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.destBin === undefined ? { id: DST_BIN, warehouseId: DST_WH } : opts.destBin,
  );
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
      destBin: { id: DST_BIN, warehouseId: SRC_WH },
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

  it('rejects DEST_BIN_WAREHOUSE_MISMATCH when the bin belongs elsewhere', async () => {
    const { svc, apply } = makeService({
      destBin: { id: DST_BIN, warehouseId: 'wh-somewhere-else' },
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
