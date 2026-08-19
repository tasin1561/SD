import { AdjustmentStatus, Prisma, StockMovementReasonCode } from '@skydrop/db';
import { StockAdjustmentService } from '../../src/modules/inventory-adjustment/services/stock-adjustment.service';
import { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { EnvService } from '../../src/config/env.service';
import type { CatalogReadService } from '../../src/modules/catalog-read/services/catalog-read.service';
import type { WarehouseResolverService } from '../../src/modules/inventory-shared/warehouse-resolver.service';
import type { StockMutationService } from '../../src/modules/inventory-shared/stock-mutation.service';
import type { StockAlertService } from '../../src/modules/inventory-shared/stock-alert.service';
import type { StockCacheService } from '../../src/modules/inventory-shared/stock-cache.service';
import type { EmailQueue } from '../../src/modules/email/queue/email.queue';
import type { AdjustmentQueue } from '../../src/modules/inventory-adjustment/queue/adjustment.queue';

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

function makeSut(opts: {
  thresholdInt?: number;
  batchUnitCost?: string | null;
  updateManyCount?: number;
}) {
  const adjustmentStore: { row: Record<string, unknown> | null } = { row: null };
  const applyCalls: Array<Record<string, unknown>> = [];
  const emails: Array<{ templateCode: string }> = [];

  const client = {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(client),
    stockAdjustment: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        adjustmentStore.row = {
          id: 'adj1',
          ...args.data,
          lines: (args.data.lines as { create: Record<string, unknown>[] }).create.map((l, i) => ({
            id: `al${i + 1}`,
            ...l,
          })),
        };
        return clone(adjustmentStore.row);
      }),
      findUniqueOrThrow: jest.fn(async () => clone(adjustmentStore.row)),
      findFirst: jest.fn(async () => (adjustmentStore.row ? clone(adjustmentStore.row) : null)),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => {
        Object.assign(adjustmentStore.row!, args.data);
        return clone(adjustmentStore.row);
      }),
      updateMany: jest.fn(async (args: { data: Record<string, unknown> }) => {
        const count = opts.updateManyCount ?? 1;
        if (count === 1 && adjustmentStore.row) Object.assign(adjustmentStore.row, args.data);
        return { count };
      }),
    },
    stockBatch: {
      findFirst: jest.fn(async () => ({
        unitCostInr: opts.batchUnitCost == null ? null : new Prisma.Decimal(opts.batchUnitCost),
      })),
    },
    systemSetting: {
      findUnique: jest.fn(async () => ({
        valueDecimal: null,
        valueInt: opts.thresholdInt ?? 50_000,
      })),
    },
    warehouse: { findUnique: jest.fn(async () => ({ name: 'CCU-01' })) },
    seller: {
      findUnique: jest.fn(async () => ({ id: 's1', email: 's@x.io', companyName: 'Acme' })),
    },
    auditLog: { create: jest.fn(async () => ({ id: 'a1' })) },
  };
  const prisma = { client } as unknown as PrismaService;
  const audit = new AuditLogService(prisma);
  const env = { supportEmail: 'h@x.io' } as unknown as EnvService;
  const catalog = {
    getVariantsByIds: jest.fn(async () => new Map([['v1', { sellerId: 's1' }]])),
  } as unknown as CatalogReadService;
  const warehouses = {
    resolveWarehouseId: jest.fn(async () => 'w1'),
  } as unknown as WarehouseResolverService;
  const mutation = {
    runWithRetry: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
    apply: jest.fn(async (_tx: unknown, input: Record<string, unknown>) => {
      applyCalls.push(input);
      return { stockLevelId: 'L1', movementId: 'm1', qtyBefore: 0, qtyAfter: 0, version: 0 };
    }),
  } as unknown as StockMutationService;
  const alerts = { evaluate: jest.fn(async () => ({})) } as unknown as StockAlertService;
  const cache = { invalidate: jest.fn(async () => undefined) } as unknown as StockCacheService;
  const email = {
    enqueue: jest.fn(async (i: { templateCode: string }) => {
      emails.push(i);
      return 'job';
    }),
  } as unknown as EmailQueue;

  const enqueued: string[] = [];
  const queue = {
    enqueueExecute: jest.fn(async (id: string) => {
      enqueued.push(id);
      return 'job1';
    }),
  } as unknown as AdjustmentQueue;

  const svc = new StockAdjustmentService(
    prisma,
    env,
    audit,
    catalog,
    warehouses,
    mutation,
    alerts,
    cache,
    email,
    queue,
  );
  return { svc, adjustmentStore, applyCalls, emails, cache, alerts, enqueued };
}

const CTX = { ipAddress: null, userAgent: null, requestId: null };
const baseInput = (over: Record<string, unknown> = {}) => ({
  sellerId: 's1',
  type: 'DECREASE' as const,
  reasonCode: StockMovementReasonCode.DAMAGED_IN_WAREHOUSE,
  lines: [{ variantId: 'v1', binId: 'b1', batchId: 'bat1', qtyChange: -2, unitCostInr: 10 }],
  ...over,
});

describe('StockAdjustmentService.initiate', () => {
  it('below threshold -> auto-executes (movement applied, EXECUTED) in one runWithRetry tx', async () => {
    // |impact| = |-2 * 10| = 20 < 50000 -> auto-execute
    const sut = makeSut({ thresholdInt: 50_000 });
    const res = await sut.svc.initiate('staff1', baseInput(), CTX);
    expect(res.status).toBe(AdjustmentStatus.EXECUTED);
    expect(sut.applyCalls).toHaveLength(1);
    expect(sut.applyCalls[0]).toMatchObject({
      type: 'ADJUSTMENT_DECREASE',
      qtyChange: -2,
      reasonCode: StockMovementReasonCode.DAMAGED_IN_WAREHOUSE, // INV-7
      adjustmentId: 'adj1',
    });
    expect(sut.cache.invalidate).toHaveBeenCalledWith('s1', 'w1');
    expect(sut.alerts.evaluate).toHaveBeenCalledWith('s1', 'v1', 'w1');
    expect(sut.emails[0]?.templateCode).toBe('seller.stock_adjustment_executed.email');
  });

  it('at/above threshold -> PENDING, NO movements (approverThresholdInr snapshot persisted)', async () => {
    // |impact| = 20 >= threshold 5 -> requires approval
    const sut = makeSut({ thresholdInt: 5 });
    const res = await sut.svc.initiate('staff1', baseInput(), CTX);
    expect(res.status).toBe(AdjustmentStatus.PENDING);
    expect(res.approverThresholdInr?.toString()).toBe('5');
    expect(sut.applyCalls).toHaveLength(0);
  });

  it('rejects a sign/type mismatch (DECREASE with positive qty)', async () => {
    const sut = makeSut({});
    await expect(
      sut.svc.initiate(
        'staff1',
        baseInput({ lines: [{ variantId: 'v1', binId: 'b1', batchId: 'bat1', qtyChange: 5 }] }),
        CTX,
      ),
    ).rejects.toMatchObject({ response: { code: 'ADJUSTMENT_SIGN_MISMATCH' } });
  });

  it('errors per-line when no unit cost can be resolved (line + batch both null)', async () => {
    const sut = makeSut({ batchUnitCost: null });
    await expect(
      sut.svc.initiate(
        'staff1',
        baseInput({ lines: [{ variantId: 'v1', binId: 'b1', batchId: 'bat1', qtyChange: -1 }] }),
        CTX,
      ),
    ).rejects.toMatchObject({ response: { code: 'ADJUSTMENT_LINE_COST_MISSING' } });
  });

  it('falls back to batch.unitCostInr when the line omits it', async () => {
    const sut = makeSut({ thresholdInt: 50_000, batchUnitCost: '7' });
    const res = await sut.svc.initiate(
      'staff1',
      baseInput({ lines: [{ variantId: 'v1', binId: 'b1', batchId: 'bat1', qtyChange: -3 }] }),
      CTX,
    );
    expect(res.status).toBe(AdjustmentStatus.EXECUTED);
    expect(res.totalValueImpactInr?.toString()).toBe('-21'); // -3 * 7
  });

  it('rejects a zero qtyChange line', async () => {
    const sut = makeSut({});
    await expect(
      sut.svc.initiate(
        'staff1',
        baseInput({ lines: [{ variantId: 'v1', binId: 'b1', batchId: 'bat1', qtyChange: 0 }] }),
        CTX,
      ),
    ).rejects.toMatchObject({ response: { code: 'ADJUSTMENT_LINE_INVALID_QTY' } });
  });
});

describe('StockAdjustmentService.approve / reject', () => {
  it('approve: PENDING -> APPROVED and enqueues the executor', async () => {
    const sut = makeSut({ thresholdInt: 1 }); // above -> PENDING
    await sut.svc.initiate('staff1', baseInput(), CTX);
    const res = await sut.svc.approve('approver1', 'adj1', CTX);
    expect(res.status).toBe(AdjustmentStatus.APPROVED);
    expect(res.approvedById).toBe('approver1');
    expect(sut.enqueued).toEqual(['adj1']);
  });

  it('double-approve race -> 409 ADJUSTMENT_NOT_PENDING (no enqueue)', async () => {
    const sut = makeSut({ thresholdInt: 1, updateManyCount: 0 });
    await sut.svc.initiate('staff1', baseInput(), CTX);
    await expect(sut.svc.approve('approver1', 'adj1', CTX)).rejects.toMatchObject({
      response: { code: 'ADJUSTMENT_NOT_PENDING' },
    });
    expect(sut.enqueued).toHaveLength(0);
  });

  it('reject: requires a reason; PENDING -> REJECTED with rejectedReason', async () => {
    const sut = makeSut({ thresholdInt: 1 });
    await sut.svc.initiate('staff1', baseInput(), CTX);
    await expect(sut.svc.reject('approver1', 'adj1', '   ', CTX)).rejects.toMatchObject({
      response: { code: 'REJECT_REASON_REQUIRED' },
    });
    const res = await sut.svc.reject('approver1', 'adj1', 'not justified', CTX);
    expect(res.status).toBe(AdjustmentStatus.REJECTED);
    expect(res.rejectedReason).toBe('not justified');
  });
});

describe('StockAdjustmentService.executeAdjustment idempotency', () => {
  it('an already-EXECUTED adjustment is a no-op (no second movement set)', async () => {
    const sut = makeSut({ thresholdInt: 50_000 }); // below -> auto-EXECUTED
    await sut.svc.initiate('staff1', baseInput(), CTX);
    expect(sut.applyCalls).toHaveLength(1);
    // Re-deliver the executor job for the now-EXECUTED adjustment.
    const res = await sut.svc.executeAdjustment('adj1', { type: 'SYSTEM' as never });
    expect(res.status).toBe(AdjustmentStatus.EXECUTED);
    expect(sut.applyCalls).toHaveLength(1); // unchanged — no double-apply
  });
});
