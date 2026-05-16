import { BatchStatus, BinType } from '@skydrop/db';
import { StockPickAllocationService } from '../../src/modules/inventory-stock/services/stock-pick-allocation.service';
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
  const svc = new StockPickAllocationService(prisma);
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
