import { GoodsReceiptStatus, VariantStatus } from '@skydrop/db';
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

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

function makeSut(opts: {
  receipt?: Record<string, unknown> | null;
  variantStatus?: VariantStatus;
  receiptCount?: number;
}) {
  const receipt = opts.receipt ?? null;
  const created: Array<Record<string, unknown>> = [];

  const client = {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(client),
    goodsReceipt: {
      count: jest.fn(async () => opts.receiptCount ?? 0),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return { id: 'gr1', ...args.data, lines: [] };
      }),
      findFirst: jest.fn(async () => (receipt ? clone(receipt) : null)),
      findUniqueOrThrow: jest.fn(async () => clone(receipt)),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'gr1',
        ...(receipt ?? {}),
        ...args.data,
        lines: [],
      })),
    },
    goodsReceiptLine: {
      deleteMany: jest.fn(async () => ({ count: 0 })),
      update: jest.fn(async () => ({})),
    },
    warehouseBin: {
      findFirst: jest.fn(async (a: { where: { id: string } }) => ({ id: a.where.id })),
    },
    auditLog: { create: jest.fn(async () => ({ id: 'a1' })) },
  };
  const prisma = { client } as unknown as PrismaService;
  const audit = new AuditLogService(prisma);
  const catalog = {
    getVariantsByIds: jest.fn(
      async () =>
        new Map([['v1', { sellerId: 's1', status: opts.variantStatus ?? VariantStatus.ACTIVE }]]),
    ),
  } as unknown as CatalogReadService;
  const warehouses = {
    resolveWarehouseId: jest.fn(async () => 'w1'),
  } as unknown as WarehouseResolverService;
  const noop = {} as unknown;

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
    noop as StockMutationService,
    noop as StockUnitService,
    noop as InventoryModeService,
    noop as StockAlertService,
    binPolicy,
    noop as StockCacheService,
    noop as EmailQueue,
    { sellerAppUrl: 'http://a', supportEmail: 'h@x.io' } as unknown as EnvService,
    // Only the per-line thumbnail uses this; a stub keeps the
    // receiving tests about receiving.
    { presignGetUrl: async () => 'https://example.test/img' } as unknown as SpacesService,
  );
  return { svc, created, client };
}

const CTX = { ipAddress: null, userAgent: null, requestId: null };

describe('GoodsReceiptService — declaration lifecycle', () => {
  it('declare creates a PENDING receipt with a GR-YYYY-MM-NNNN number', async () => {
    const sut = makeSut({ receiptCount: 4 });
    await sut.svc.declare('s1', { lines: [{ variantId: 'v1', expectedQty: 10 }] }, CTX);
    const data = sut.created[0]!;
    expect(data.status).toBe(GoodsReceiptStatus.PENDING);
    expect(String(data.receiptNumber)).toMatch(/^GR-\d{4}-\d{2}-0005$/); // count 4 -> 0005
  });

  it('declare rejects an ARCHIVED variant (CLAUDE catalog rule #8)', async () => {
    const sut = makeSut({ variantStatus: VariantStatus.ARCHIVED });
    await expect(
      sut.svc.declare('s1', { lines: [{ variantId: 'v1', expectedQty: 1 }] }, CTX),
    ).rejects.toMatchObject({ response: { code: 'VARIANT_ARCHIVED' } });
  });

  it('update is rejected unless the receipt is PENDING', async () => {
    const sut = makeSut({
      receipt: { id: 'gr1', sellerId: 's1', status: GoodsReceiptStatus.ARRIVING, lines: [] },
    });
    await expect(sut.svc.update('s1', 'gr1', { sellerReference: 'x' }, CTX)).rejects.toMatchObject({
      response: { code: 'INVALID_RECEIPT_STATUS' },
    });
  });

  it('cancel is rejected unless the receipt is PENDING', async () => {
    const sut = makeSut({
      receipt: { id: 'gr1', sellerId: 's1', status: GoodsReceiptStatus.COMPLETED, lines: [] },
    });
    await expect(sut.svc.cancel('s1', 'gr1', CTX)).rejects.toMatchObject({
      response: { code: 'INVALID_RECEIPT_STATUS' },
    });
  });
});

describe('GoodsReceiptService — admin recording lifecycle', () => {
  it('start-receiving requires PENDING', async () => {
    const sut = makeSut({
      receipt: {
        id: 'gr1',
        sellerId: 's1',
        warehouseId: 'w1',
        status: GoodsReceiptStatus.ARRIVING,
        lines: [],
      },
    });
    await expect(sut.svc.startReceiving('staff1', 'gr1', CTX)).rejects.toMatchObject({
      response: { code: 'INVALID_RECEIPT_STATUS' },
    });
  });

  it('recordLines requires ARRIVING and a putaway bin when receivedQty > 0', async () => {
    const sut = makeSut({
      receipt: {
        id: 'gr1',
        sellerId: 's1',
        warehouseId: 'w1',
        status: GoodsReceiptStatus.ARRIVING,
        lines: [{ id: 'ln1', variantId: 'v1', expectedQty: 5, receivedQty: 0, damagedQty: 0 }],
      },
    });
    await expect(
      sut.svc.recordLines('staff1', 'gr1', [{ lineId: 'ln1', receivedQty: 5 }], CTX),
    ).rejects.toMatchObject({ response: { code: 'BIN_REQUIRED' } });
  });

  it('recordLines rejects a line id not on the receipt', async () => {
    const sut = makeSut({
      receipt: {
        id: 'gr1',
        sellerId: 's1',
        warehouseId: 'w1',
        status: GoodsReceiptStatus.ARRIVING,
        lines: [{ id: 'ln1', variantId: 'v1', expectedQty: 5, receivedQty: 0, damagedQty: 0 }],
      },
    });
    await expect(
      sut.svc.recordLines(
        'staff1',
        'gr1',
        [{ lineId: 'ghost', receivedQty: 1, putawayBinId: 'b1' }],
        CTX,
      ),
    ).rejects.toMatchObject({ response: { code: 'RECEIPT_LINE_NOT_FOUND' } });
  });
});
