import { ConflictException } from '@nestjs/common';
import { ActorType, Prisma, StockMovementType, StockMovementReasonCode } from '@skydrop/db';
import {
  RetryableStockConflictError,
  StockMutationService,
  type StockMutationInput,
} from '../../src/modules/inventory-shared/stock-mutation.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

interface LevelRow {
  id: string;
  qtyOnHand: number;
  version: number;
}

/**
 * In-memory Prisma fake. The store is the single shared stock_level; the
 * version-guarded updateMany is the concurrency primitive under test.
 * A failed attempt throws at updateMany BEFORE any movement is written
 * (mirrors the real code path), so no tx-rollback emulation is needed.
 */
function makeSut(opts: {
  initial?: LevelRow | null;
  // Forces the first N updateMany calls to lose the version race (a phantom
  // concurrent writer commits, advancing the row's version).
  injectConflicts?: number;
  createThrowsP2002Once?: boolean;
} = {}) {
  const store: { row: LevelRow | null } = { row: opts.initial ?? null };
  const movements: Array<Record<string, unknown>> = [];
  let conflictsLeft = opts.injectConflicts ?? 0;
  let createP2002 = opts.createThrowsP2002Once ?? false;
  let findCalls = 0;
  let updateCalls = 0;

  const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

  const client = {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(client),
    stockLevel: {
      findUnique: async (): Promise<LevelRow | null> => {
        findCalls += 1;
        await tick(); // force interleave between concurrent flows
        return store.row ? { ...store.row } : null;
      },
      updateMany: async (args: {
        where: { id: string; version: number };
        data: { qtyOnHand: number; version: { increment: number } };
      }): Promise<{ count: number }> => {
        updateCalls += 1;
        if (conflictsLeft > 0) {
          conflictsLeft -= 1;
          // Phantom concurrent writer committed first.
          if (store.row) store.row.version += 1;
          return { count: 0 };
        }
        if (
          store.row &&
          store.row.id === args.where.id &&
          store.row.version === args.where.version
        ) {
          store.row.qtyOnHand = args.data.qtyOnHand;
          store.row.version += 1;
          return { count: 1 };
        }
        return { count: 0 };
      },
      create: async (args: { data: { qtyOnHand: number } }): Promise<{ id: string }> => {
        if (createP2002) {
          createP2002 = false;
          throw new Prisma.PrismaClientKnownRequestError(
            'Unique constraint failed',
            { code: 'P2002', clientVersion: 'test' },
          );
        }
        store.row = { id: 'L1', qtyOnHand: args.data.qtyOnHand, version: 0 };
        return { id: 'L1' };
      },
    },
    stockMovement: {
      create: async (args: { data: Record<string, unknown> }): Promise<{ id: string }> => {
        movements.push(args.data);
        return { id: `m${movements.length}` };
      },
    },
  };

  const prisma = { client } as unknown as PrismaService;
  const svc = new StockMutationService(prisma);
  return {
    svc,
    store,
    movements,
    stats: () => ({ findCalls, updateCalls }),
  };
}

const input = (over: Partial<StockMutationInput> = {}): StockMutationInput => ({
  sellerId: 's1',
  variantId: 'v1',
  warehouseId: 'w1',
  binId: 'b1',
  batchId: 'bat1',
  qtyChange: 5,
  type: StockMovementType.RECEIVING,
  actorType: ActorType.SYSTEM,
  ...over,
});

describe('StockMutationService.apply', () => {
  it('creates a new stock_level + movement when none exists (qtyBefore=0)', async () => {
    const { svc, store, movements } = makeSut({ initial: null });
    const res = await svc.applyWithRetry(input({ qtyChange: 7 }));
    expect(res).toMatchObject({ qtyBefore: 0, qtyAfter: 7, version: 0 });
    expect(store.row).toMatchObject({ qtyOnHand: 7 });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ qtyBefore: 0, qtyAfter: 7, qtyChange: 7 });
  });

  it('version-guards an existing level and snapshots before/after', async () => {
    const { svc, store } = makeSut({ initial: { id: 'L1', qtyOnHand: 10, version: 4 } });
    const res = await svc.applyWithRetry(input({ qtyChange: -3 }));
    expect(res).toMatchObject({ qtyBefore: 10, qtyAfter: 7, version: 5 });
    expect(store.row).toEqual({ id: 'L1', qtyOnHand: 7, version: 5 });
  });

  it('two concurrent applies: one wins, the other retries and succeeds', async () => {
    const { svc, store, movements } = makeSut({
      initial: { id: 'L1', qtyOnHand: 100, version: 0 },
    });
    await Promise.all([
      svc.applyWithRetry(input({ qtyChange: -10 })),
      svc.applyWithRetry(input({ qtyChange: -5 })),
    ]);
    // Both mutations land exactly once; no lost update.
    expect(store.row?.qtyOnHand).toBe(85);
    expect(store.row?.version).toBe(2);
    expect(movements).toHaveLength(2);
  });

  it('throws STOCK_CONCURRENCY_CONFLICT after exhausting 3 attempts', async () => {
    const { svc, movements } = makeSut({
      initial: { id: 'L1', qtyOnHand: 50, version: 0 },
      injectConflicts: 3,
    });
    await expect(svc.applyWithRetry(input({ qtyChange: -1 }))).rejects.toMatchObject({
      response: { code: 'STOCK_CONCURRENCY_CONFLICT' },
    });
    expect(movements).toHaveLength(0); // never wrote a ledger row
  });

  it('retries a concurrent-create race then succeeds', async () => {
    const { svc, store } = makeSut({ initial: null, createThrowsP2002Once: true });
    const res = await svc.applyWithRetry(input({ qtyChange: 4 }));
    expect(res.qtyAfter).toBe(4);
    expect(store.row).toMatchObject({ qtyOnHand: 4 });
  });

  it('rejects a delta that would drive stock negative (not retryable)', async () => {
    const { svc, movements } = makeSut({ initial: { id: 'L1', qtyOnHand: 2, version: 0 } });
    await expect(svc.applyWithRetry(input({ qtyChange: -5 }))).rejects.toMatchObject({
      response: { code: 'INSUFFICIENT_ON_HAND' },
    });
    expect(movements).toHaveLength(0);
  });

  it('requires a reasonCode for adjustment movements (INV-7)', async () => {
    const { svc } = makeSut({ initial: { id: 'L1', qtyOnHand: 9, version: 0 } });
    await expect(
      svc.applyWithRetry(input({ qtyChange: -1, type: StockMovementType.ADJUSTMENT_DECREASE })),
    ).rejects.toMatchObject({ response: { code: 'REASON_CODE_REQUIRED' } });

    // With a reasonCode it goes through.
    const ok = await svc.applyWithRetry(
      input({
        qtyChange: -1,
        type: StockMovementType.ADJUSTMENT_DECREASE,
        reasonCode: StockMovementReasonCode.COUNTING_ERROR,
      }),
    );
    expect(ok.qtyAfter).toBe(8);
  });

  it('rejects a zero / non-integer delta', async () => {
    const { svc } = makeSut({ initial: { id: 'L1', qtyOnHand: 9, version: 0 } });
    await expect(svc.applyWithRetry(input({ qtyChange: 0 }))).rejects.toMatchObject({
      response: { code: 'INVALID_STOCK_DELTA' },
    });
  });

  it('RetryableStockConflictError is distinct from client errors', () => {
    expect(new RetryableStockConflictError('x')).toBeInstanceOf(Error);
    expect(new ConflictException({})).not.toBeInstanceOf(RetryableStockConflictError);
  });
});
