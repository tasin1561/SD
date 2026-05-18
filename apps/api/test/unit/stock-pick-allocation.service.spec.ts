import { BatchStatus, BinType } from '@skydrop/db';
import { StockPickAllocationService } from '../../src/modules/inventory-stock/services/stock-pick-allocation.service';
import { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

interface FakeLevel {
  binId: string;
  batchId: string;
  qtyOnHand: number;
  qtyReserved: number;
  binType?: BinType;
  binCode?: string;
  pickOrder?: number;
  expiresAt: string | null;
  receivedAt: string;
  batchStatus?: BatchStatus;
}

function makeSut(levels: FakeLevel[]) {
  const findMany = jest.fn(
    async (args: {
      where: { bin: { type: { notIn: BinType[] } }; batch: { status: BatchStatus } };
    }) =>
      levels
        .filter(
          (l) =>
            !args.where.bin.type.notIn.includes(l.binType ?? BinType.STORAGE) &&
            (l.batchStatus ?? BatchStatus.ACTIVE) === args.where.batch.status,
        )
        .map((l) => ({
          binId: l.binId,
          batchId: l.batchId,
          qtyOnHand: l.qtyOnHand,
          qtyReserved: l.qtyReserved,
          bin: { code: l.binCode ?? l.binId, zone: { pickOrder: l.pickOrder ?? 100 } },
          batch: {
            expiresAt: l.expiresAt ? new Date(l.expiresAt) : null,
            receivedAt: new Date(l.receivedAt),
          },
        })),
  );
  const prisma = { client: { stockLevel: { findMany } } } as unknown as PrismaService;
  const audit = new AuditLogService(prisma);
  const svc = new StockPickAllocationService(prisma, audit);
  return { svc };
}

const REQ = (qtyRequired: number) => ({
  sellerId: 's1',
  variantId: 'v1',
  warehouseId: 'w1',
  qtyRequired,
});

// B1 exp 2026-06-01, B2 exp 2026-07-01, B3 exp 2026-08-01 (one bin each)
const batch = (id: string, exp: string, qty: number): FakeLevel => ({
  binId: `bin-${id}`,
  batchId: id,
  qtyOnHand: qty,
  qtyReserved: 0,
  expiresAt: exp,
  receivedAt: '2026-01-01T00:00:00Z',
});

describe('StockPickAllocationService.allocateForOrderLine', () => {
  it('CASE 1: single-batch preference picks B2 (window {B1,B2}) not split-from-B1', async () => {
    const { svc } = makeSut([
      batch('B1', '2026-06-01', 5),
      batch('B2', '2026-07-01', 100),
      batch('B3', '2026-08-01', 50),
    ]);
    const plan = await svc.allocateForOrderLine(REQ(7));
    expect(plan.strategy).toBe('SINGLE_BATCH');
    expect(plan.picks).toEqual([{ binId: 'bin-B2', batchId: 'B2', qty: 7 }]);
    expect(plan.fullyAllocated).toBe(true);
  });

  it('CASE 2: no single batch in window {B1,B2} fits 7 -> split 5·B1 + 2·B2 (B3 ignored)', async () => {
    const { svc } = makeSut([
      batch('B1', '2026-06-01', 5),
      batch('B2', '2026-07-01', 3),
      batch('B3', '2026-08-01', 50),
    ]);
    const plan = await svc.allocateForOrderLine(REQ(7));
    expect(plan.strategy).toBe('SPLIT');
    expect(plan.picks).toEqual([
      { binId: 'bin-B1', batchId: 'B1', qty: 5 },
      { binId: 'bin-B2', batchId: 'B2', qty: 2 },
    ]);
    expect(plan.fullyAllocated).toBe(true);
  });

  it('CASE 3: order 4 -> window {B1}; B1 covers alone -> SINGLE_BATCH B1', async () => {
    const { svc } = makeSut([
      batch('B1', '2026-06-01', 5),
      batch('B2', '2026-07-01', 100),
      batch('B3', '2026-08-01', 50),
    ]);
    const plan = await svc.allocateForOrderLine(REQ(4));
    expect(plan.strategy).toBe('SINGLE_BATCH');
    expect(plan.picks).toEqual([{ binId: 'bin-B1', batchId: 'B1', qty: 4 }]);
  });

  it('excludes RTO_HOLD / DAMAGED / QUARANTINE bins', async () => {
    const { svc } = makeSut([
      { ...batch('B1', '2026-06-01', 50), binType: BinType.DAMAGED },
      { ...batch('B2', '2026-07-01', 50), binType: BinType.QUARANTINE },
      { ...batch('B3', '2026-08-01', 9), binType: BinType.STORAGE },
    ]);
    const plan = await svc.allocateForOrderLine(REQ(6));
    // Only B3 is pickable.
    expect(plan.picks).toEqual([{ binId: 'bin-B3', batchId: 'B3', qty: 6 }]);
  });

  it('skips non-ACTIVE batches', async () => {
    const { svc } = makeSut([
      { ...batch('B1', '2026-06-01', 50), batchStatus: BatchStatus.EXPIRED },
      { ...batch('B2', '2026-07-01', 8), batchStatus: BatchStatus.ACTIVE },
    ]);
    const plan = await svc.allocateForOrderLine(REQ(8));
    expect(plan.picks).toEqual([{ binId: 'bin-B2', batchId: 'B2', qty: 8 }]);
  });

  it('subtracts stock_levels.qtyReserved from per-batch availability', async () => {
    const { svc } = makeSut([
      { ...batch('B1', '2026-06-01', 10), qtyReserved: 8 }, // only 2 free
      { ...batch('B2', '2026-07-01', 10), qtyReserved: 0 },
    ]);
    const plan = await svc.allocateForOrderLine(REQ(5));
    // Window {B1(2), B2(10)} cum 12≥5; B1 can't cover 5 alone, B2 can ->
    // single-batch B2.
    expect(plan.strategy).toBe('SINGLE_BATCH');
    expect(plan.picks).toEqual([{ binId: 'bin-B2', batchId: 'B2', qty: 5 }]);
  });

  it('PARTIAL when total availability is short', async () => {
    const { svc } = makeSut([batch('B1', '2026-06-01', 3), batch('B2', '2026-07-01', 2)]);
    const plan = await svc.allocateForOrderLine(REQ(10));
    expect(plan.strategy).toBe('PARTIAL');
    expect(plan.allocatedQty).toBe(5);
    expect(plan.shortfall).toBe(5);
    expect(plan.fullyAllocated).toBe(false);
    expect(plan.picks).toEqual([
      { binId: 'bin-B1', batchId: 'B1', qty: 3 },
      { binId: 'bin-B2', batchId: 'B2', qty: 2 },
    ]);
  });

  it('NONE when nothing eligible', async () => {
    const { svc } = makeSut([]);
    const plan = await svc.allocateForOrderLine(REQ(5));
    expect(plan.strategy).toBe('NONE');
    expect(plan.picks).toEqual([]);
    expect(plan.shortfall).toBe(5);
  });

  it('non-expiring batch sorts AFTER expiring ones (NULLS LAST)', async () => {
    const { svc } = makeSut([
      { ...batch('B1', '2026-06-01', 4), expiresAt: null }, // no expiry
      batch('B2', '2026-07-01', 4),
    ]);
    // need 6 -> window order is [B2 (has expiry), B1 (null last)] ->
    // cum: B2=4 (<6), +B1=8 (>=6). No single covers 6 -> split 4·B2 + 2·B1.
    const plan = await svc.allocateForOrderLine(REQ(6));
    expect(plan.picks).toEqual([
      { binId: 'bin-B2', batchId: 'B2', qty: 4 },
      { binId: 'bin-B1', batchId: 'B1', qty: 2 },
    ]);
  });

  it('multi-bin batch draws by zone pickOrder then bin code', async () => {
    const { svc } = makeSut([
      { binId: 'binA', batchId: 'B1', qtyOnHand: 3, qtyReserved: 0, pickOrder: 50, binCode: 'A', expiresAt: '2026-06-01', receivedAt: '2026-01-01T00:00:00Z' },
      { binId: 'binB', batchId: 'B1', qtyOnHand: 10, qtyReserved: 0, pickOrder: 10, binCode: 'B', expiresAt: '2026-06-01', receivedAt: '2026-01-01T00:00:00Z' },
    ]);
    const plan = await svc.allocateForOrderLine(REQ(5));
    // Same batch B1 (avail 13 ≥ 5) -> single batch; bins ordered by
    // pickOrder asc: binB(10) first.
    expect(plan.strategy).toBe('SINGLE_BATCH');
    expect(plan.picks).toEqual([{ binId: 'binB', batchId: 'B1', qty: 5 }]);
  });
});

// ── releaseAllocation (WMS-5 — inverse of allocateAndPopulate) ──────────
import { ReservationStatus } from '@skydrop/db';

type RAnyArgs = Record<string, unknown>;

function makeReleaseSut(opts: { anchor?: RAnyArgs | null; group?: RAnyArgs[] } = {}) {
  const reservationFindUnique = jest.fn<Promise<RAnyArgs | null>, [RAnyArgs]>(async () =>
    opts.anchor === undefined
      ? { id: 'r1', status: ReservationStatus.ACTIVE, orderId: 'o1', orderItemId: 'oi1' }
      : opts.anchor,
  );
  const reservationFindMany = jest.fn<Promise<RAnyArgs[]>, [RAnyArgs]>(
    async () => opts.group ?? [],
  );
  const stockLevelUpdateMany = jest.fn<Promise<{ count: number }>, [RAnyArgs]>(
    async () => ({ count: 1 }),
  );
  const reservationUpdate = jest.fn<Promise<RAnyArgs>, [RAnyArgs]>(
    async () => ({}),
  );
  const reservationDeleteMany = jest.fn<Promise<{ count: number }>, [RAnyArgs]>(
    async () => ({ count: 0 }),
  );
  const txClient = {
    stockLevel: { updateMany: stockLevelUpdateMany },
    stockReservation: { update: reservationUpdate, deleteMany: reservationDeleteMany },
  };
  const client = {
    stockReservation: {
      findUnique: reservationFindUnique,
      findMany: reservationFindMany,
    },
  } as {
    stockReservation: {
      findUnique: typeof reservationFindUnique;
      findMany: typeof reservationFindMany;
    };
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  };
  client.$transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn(txClient);
  const auditLog = jest.fn<Promise<string | null>, [RAnyArgs, unknown?]>(
    async () => 'a1',
  );
  const audit = { log: auditLog } as unknown as AuditLogService;
  const svc = new StockPickAllocationService(
    { client } as unknown as PrismaService,
    audit,
  );
  return {
    svc,
    reservationFindUnique,
    stockLevelUpdateMany,
    reservationUpdate,
    reservationDeleteMany,
    auditLog,
  };
}

const P2 = (id: string, qty: number): RAnyArgs => ({
  id,
  sellerId: 's1',
  variantId: 'v1',
  warehouseId: 'w1',
  binId: `bin-${id}`,
  batchId: `batch-${id}`,
  qtyReserved: qty,
});
const P1 = (id: string, qty: number): RAnyArgs => ({
  id,
  sellerId: 's1',
  variantId: 'v1',
  warehouseId: 'w1',
  binId: null,
  batchId: null,
  qtyReserved: qty,
});

describe('StockPickAllocationService.releaseAllocation', () => {
  it('404 when the reservation does not exist', async () => {
    const { svc } = makeReleaseSut({ anchor: null });
    await expect(svc.releaseAllocation('rX')).rejects.toMatchObject({
      response: { code: 'RESERVATION_NOT_FOUND' },
    });
  });

  it('409 when the reservation is not ACTIVE', async () => {
    const { svc } = makeReleaseSut({
      anchor: { id: 'r1', status: ReservationStatus.FULFILLED, orderId: 'o1', orderItemId: 'oi1' },
    });
    await expect(svc.releaseAllocation('r1')).rejects.toMatchObject({
      response: { code: 'RESERVATION_NOT_ACTIVE' },
    });
  });

  it('idempotent no-op when the group is already a pure phase-1 float', async () => {
    const { svc, stockLevelUpdateMany, reservationUpdate } = makeReleaseSut({
      group: [P1('r1', 5)],
    });
    const r = await svc.releaseAllocation('r1');
    expect(r).toEqual({
      reservationId: 'r1',
      phase1ReservationId: 'r1',
      releasedQty: 0,
      alreadyPhase1: true,
    });
    expect(stockLevelUpdateMany).not.toHaveBeenCalled();
    expect(reservationUpdate).not.toHaveBeenCalled();
  });

  it('collapses phase-2 rows back to one conserved phase-1 row + gives holds back (clamped)', async () => {
    const { svc, stockLevelUpdateMany, reservationUpdate, reservationDeleteMany, auditLog } =
      makeReleaseSut({ group: [P2('r1', 3), P2('r2', 2)] });
    const r = await svc.releaseAllocation('r1');

    expect(r).toMatchObject({
      reservationId: 'r1',
      phase1ReservationId: 'r1',
      releasedQty: 5,
      alreadyPhase1: false,
    });
    // one clamped decrement per phase-2 row
    expect(stockLevelUpdateMany).toHaveBeenCalledTimes(2);
    const firstDec = stockLevelUpdateMany.mock.calls[0]![0] as RAnyArgs;
    expect((firstDec.where as RAnyArgs).qtyReserved).toEqual({ gte: 3 });
    expect((firstDec.data as RAnyArgs).qtyReserved).toEqual({ decrement: 3 });
    // survivor reverts to phase-1 holding the conserved total (3+2)
    expect((reservationUpdate.mock.calls[0]![0] as RAnyArgs).data).toEqual({
      binId: null,
      batchId: null,
      qtyReserved: 5,
    });
    // the extra row is deleted
    expect((reservationDeleteMany.mock.calls[0]![0] as RAnyArgs).where).toEqual({
      id: { in: ['r2'] },
    });
    expect(auditLog.mock.calls[0]![0]).toMatchObject({
      action: 'inventory.reservation.allocation_released',
    });
  });

  it('conserves total across mixed phase-2 + residual phase-1 rows', async () => {
    const { svc, reservationUpdate } = makeReleaseSut({
      group: [P2('r1', 3), P1('r-res', 2)], // allocated 3 + residual 2 = 5
    });
    const r = await svc.releaseAllocation('r1');
    expect(r.releasedQty).toBe(3); // only the phase-2 hold is given back
    expect((reservationUpdate.mock.calls[0]![0] as RAnyArgs).data).toEqual({
      binId: null,
      batchId: null,
      qtyReserved: 5, // conserved total
    });
  });
});
