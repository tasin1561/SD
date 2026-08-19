import { GoodsReceiptStatus, VariantStatus } from '@skydrop/db';
import type { InventoryMode } from '@skydrop/db';
import { BadRequestException } from '@nestjs/common';
import type { BinPolicyService } from '../../src/modules/inventory-shared/bin-policy.service';
import { GoodsReceiptService } from '../../src/modules/inventory-receipt/services/goods-receipt.service';
import { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { CatalogReadService } from '../../src/modules/catalog-read/services/catalog-read.service';
import type { WarehouseResolverService } from '../../src/modules/inventory-shared/warehouse-resolver.service';
import type { StockMutationService } from '../../src/modules/inventory-shared/stock-mutation.service';
import type { StockUnitService } from '../../src/modules/inventory-shared/stock-unit.service';
import type { InventoryModeService } from '../../src/modules/inventory-shared/inventory-mode.service';
import type { StockAlertService } from '../../src/modules/inventory-shared/stock-alert.service';
import type { StockCacheService } from '../../src/modules/inventory-shared/stock-cache.service';
import type { EmailQueue } from '../../src/modules/email/queue/email.queue';
import type { EnvService } from '../../src/config/env.service';
import type { SpacesService } from '../../src/infrastructure/spaces/spaces.service';

interface Line {
  id: string;
  variantId: string;
  expectedQty: number;
  receivedQty: number;
  damagedQty: number;
  putawayBinId: string | null;
  manufacturedAt: Date | null;
  expiresAt: Date | null;
  unitCostInr: null;
  batchId: string | null;
}

function makeReceipt(status: GoodsReceiptStatus, lines: Partial<Line>[]) {
  return {
    id: 'gr1',
    sellerId: 's1',
    warehouseId: 'w1',
    receiptNumber: 'GR-2026-05-0001',
    status,
    discrepancyNotes: null as string | null,
    lines: lines.map((l, i) => ({
      id: l.id ?? `ln${i + 1}`,
      variantId: l.variantId ?? 'v1',
      expectedQty: l.expectedQty ?? 10,
      receivedQty: l.receivedQty ?? 10,
      damagedQty: l.damagedQty ?? 0,
      putawayBinId: l.putawayBinId ?? 'bin1',
      manufacturedAt: null,
      expiresAt: null,
      unitCostInr: null,
      batchId: null as string | null,
      // The real include always carries this. The fixture omitted it,
      // which is how the note printed a uuid to sellers unnoticed.
      variant: {
        skuCode: l.variantId === 'v2' ? 'SKU-TWO' : 'SKU-ONE',
        variantLabel: null,
        product: { name: 'Test Product' },
      },
    })),
  };
}

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

function makeSut(receipt: ReturnType<typeof makeReceipt>) {
  const applyCalls: Array<Record<string, unknown>> = [];
  const batchCreates: Array<Record<string, unknown>> = [];
  const emails: Array<{ templateCode: string; variables: Record<string, unknown> }> = [];

  const client = {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(client),
    goodsReceipt: {
      findFirst: jest.fn(async () => clone(receipt)),
      findUniqueOrThrow: jest.fn(async () => clone(receipt)),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => {
        Object.assign(receipt, args.data);
        return clone(receipt);
      }),
    },
    goodsReceiptLine: {
      update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const l = receipt.lines.find((x) => x.id === args.where.id)!;
        Object.assign(l, args.data);
        return {};
      }),
    },
    stockBatch: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        batchCreates.push(args.data);
        return { id: `batch-${batchCreates.length}` };
      }),
    },
    warehouseBin: {
      findFirst: jest.fn(async (args: { where: { id: string } }) => ({ id: args.where.id })),
    },
    seller: {
      findUnique: jest.fn(async () => ({ id: 's1', email: 's@x.io', companyName: 'Acme' })),
    },
    warehouse: { findUnique: jest.fn(async () => ({ name: 'CCU-01' })) },
    auditLog: { create: jest.fn(async () => ({ id: 'a1' })) },
  };
  const prisma = { client } as unknown as PrismaService;
  const audit = new AuditLogService(prisma);
  const catalog = {
    getVariantsByIds: jest.fn(async () => new Map()),
  } as unknown as CatalogReadService;
  const warehouses = {
    resolveWarehouseId: jest.fn(async () => 'w1'),
  } as unknown as WarehouseResolverService;
  const mutation = {
    runWithRetry: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
    apply: jest.fn(async (_tx: unknown, input: Record<string, unknown>) => {
      applyCalls.push(input);
      return {
        stockLevelId: 'L1',
        movementId: 'm1',
        qtyBefore: 0,
        qtyAfter: input.qtyChange,
        version: 0,
      };
    }),
  } as unknown as StockMutationService;
  const alerts = { evaluate: jest.fn(async () => ({})) } as unknown as StockAlertService;
  const cache = { invalidate: jest.fn(async () => undefined) } as unknown as StockCacheService;
  const email = {
    enqueue: jest.fn(async (i: { templateCode: string; variables: Record<string, unknown> }) => {
      emails.push(i);
      return 'job';
    }),
  } as unknown as EmailQueue;
  const env = { sellerAppUrl: 'http://app', supportEmail: 'help@x.io' } as unknown as EnvService;

  // R4: these fixtures cover NORMAL-mode SKUs, so no unit is ever
  // registered — registerUnits being untouched IS part of the assertion
  // that strict mode is opt-in.
  const units = {
    registerUnits: jest.fn(async () => []),
  } as unknown as StockUnitService;
  const modes = {
    resolveForVariants: jest.fn(async () => new Map<string, InventoryMode>()),
    serialPrefixFor: jest.fn(async () => 'SDU'),
  } as unknown as InventoryModeService;

  const binPolicy = {
    // Faithful to the real service: with tracking ON the agent's choice
    // is required and honoured. The OFF path has its own suite
    // (bin-policy.service.spec.ts) — it needs a real warehouse row.
    resolvePutawayBin: async (_warehouseId: string, requested?: string | null) => {
      if (!requested) {
        throw new BadRequestException({
          code: 'BIN_REQUIRED',
          message: 'This warehouse tracks locations — choose the bin',
        });
      }
      return { binId: requested, trackingEnabled: true };
    },
  } as unknown as BinPolicyService;

  const svc = new GoodsReceiptService(
    prisma,
    audit,
    catalog,
    warehouses,
    mutation,
    units,
    modes,
    alerts,
    binPolicy,
    // Two-leg consignments: an arrival out of TRANSIT, and the R3
    // consignment-core primitives the completion writes through. None of
    // these suites exercise a consignment leg, so a bare stub is honest —
    // transit-arrival.service.spec.ts owns that path.
    {} as never,
    { append: async () => ({ id: 'ce1' }) } as never,
    { recompute: async () => 'PENDING' } as never,
    cache,
    email,
    env,
    // Only the per-line thumbnail uses this; a stub keeps the
    // receiving tests about receiving.
    { presignGetUrl: async () => 'https://example.test/img' } as unknown as SpacesService,
  );
  return { svc, receipt, applyCalls, batchCreates, emails, mutation, alerts, cache };
}

const CTX = { ipAddress: null, userAgent: null, requestId: null };

describe('GoodsReceiptService.complete', () => {
  it('full match -> COMPLETED: batch + RECEIVING movement per line, post-commit alert+cache, email', async () => {
    const sut = makeSut(
      makeReceipt(GoodsReceiptStatus.ARRIVING, [
        { id: 'ln1', variantId: 'v1', expectedQty: 10, receivedQty: 10 },
        { id: 'ln2', variantId: 'v2', expectedQty: 5, receivedQty: 5 },
      ]),
    );
    const res = await sut.svc.complete('staff1', 'gr1', CTX);
    expect(res.status).toBe(GoodsReceiptStatus.COMPLETED);
    expect(sut.batchCreates).toHaveLength(2);
    expect(sut.applyCalls.map((c) => c.qtyChange)).toEqual([10, 5]);
    expect(sut.applyCalls[0]).toMatchObject({
      type: 'RECEIVING',
      binId: 'bin1',
      batchId: 'batch-1',
    });
    expect(sut.cache.invalidate).toHaveBeenCalledWith('s1', 'w1');
    expect(sut.alerts.evaluate).toHaveBeenCalledTimes(2);
    expect(sut.emails[0]?.templateCode).toBe('seller.goods_receipt_completed.email');
  });

  it('a SHORT count no longer blocks: stock is written for what arrived, variance recorded', async () => {
    // This test used to assert the opposite. The blocking DISCREPANCY
    // status earned its keep only where the held stock would become
    // sellable — and a two-unit variance stranding a whole consignment in
    // a warehouse, waiting on an email, cost more than it ever caught.
    // The variance is now a number on the line, and the goods carry on.
    const sut = makeSut(
      makeReceipt(GoodsReceiptStatus.ARRIVING, [
        { id: 'ln1', variantId: 'v1', expectedQty: 10, receivedQty: 7 },
      ]),
    );
    const res = await sut.svc.complete('staff1', 'gr1', CTX);
    expect(res.status).toBe(GoodsReceiptStatus.COMPLETED);
    expect(res.hasDiscrepancies).toBe(true);
    // The note NAMES the sku and says which direction. It printed the
    // raw variant uuid until 2026-08-19 — into this note, which the
    // seller reads, and into the variance email.
    expect(res.discrepancyNotes).toContain('SKU-ONE');
    expect(res.discrepancyNotes).toContain('3 short of the 10 declared');
    expect(res.discrepancyNotes).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    // Stock for what ACTUALLY arrived — not zero, and not the declared 10.
    expect(sut.applyCalls).toHaveLength(1);
    expect(sut.applyCalls[0]?.qtyChange).toBe(7);
    expect(sut.batchCreates).toHaveLength(1);
    expect(sut.cache.invalidate).toHaveBeenCalledWith('s1', 'w1');
    // Told, not asked: both mails go out — it completed AND it varied.
    expect(sut.emails.map((e) => e.templateCode)).toEqual([
      'seller.goods_receipt_completed.email',
      'seller.goods_receipt_discrepancy.email',
    ]);
  });

  it('an OVER count is equally non-blocking — counts move in both directions', async () => {
    const sut = makeSut(
      makeReceipt(GoodsReceiptStatus.ARRIVING, [
        { id: 'ln1', variantId: 'v1', expectedQty: 10, receivedQty: 12 },
      ]),
    );
    const res = await sut.svc.complete('staff1', 'gr1', CTX);
    expect(res.status).toBe(GoodsReceiptStatus.COMPLETED);
    expect(res.hasDiscrepancies).toBe(true);
    expect(sut.applyCalls[0]?.qtyChange).toBe(12);
  });

  it('damagedQty > 0 alone is still recorded as a variance', async () => {
    const sut = makeSut(
      makeReceipt(GoodsReceiptStatus.ARRIVING, [
        { id: 'ln1', variantId: 'v1', expectedQty: 10, receivedQty: 10, damagedQty: 2 },
      ]),
    );
    const res = await sut.svc.complete('staff1', 'gr1', CTX);
    expect(res.status).toBe(GoodsReceiptStatus.COMPLETED);
    expect(res.hasDiscrepancies).toBe(true);
  });

  it('rejects completing a non-ARRIVING receipt', async () => {
    const sut = makeSut(makeReceipt(GoodsReceiptStatus.PENDING, [{}]));
    await expect(sut.svc.complete('staff1', 'gr1', CTX)).rejects.toMatchObject({
      response: { code: 'INVALID_RECEIPT_STATUS' },
    });
  });
});

describe('GoodsReceiptService — variant guard', () => {
  it('declare rejects an ARCHIVED variant (CLAUDE catalog rule #8)', async () => {
    const sut = makeSut(makeReceipt(GoodsReceiptStatus.PENDING, [{}]));
    (sut.svc as unknown as { catalog: CatalogReadService }).catalog.getVariantsByIds = jest.fn(
      async () => new Map([['v1', { sellerId: 's1', status: VariantStatus.ARCHIVED }]]),
    ) as unknown as CatalogReadService['getVariantsByIds'];
    await expect(
      sut.svc.declare('s1', { lines: [{ variantId: 'v1', expectedQty: 5 }] }, CTX),
    ).rejects.toMatchObject({ response: { code: 'VARIANT_ARCHIVED' } });
  });
});
