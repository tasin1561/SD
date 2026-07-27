import {
  AdjustmentStatus,
  AdjustmentType,
  CycleCountStatus,
  CycleCountType,
  Prisma,
  StockMovementReasonCode,
} from '@skydrop/db';
import { CycleCountService } from '../../src/modules/inventory-cycle-count/services/cycle-count.service';
import { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { WarehouseResolverService } from '../../src/modules/inventory-shared/warehouse-resolver.service';

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

interface Item {
  id: string;
  variantId: string;
  binId: string;
  batchId: string | null;
  systemQty: number;
  countedQty: number;
  adjustmentId: string | null;
}

function makeSut(opts: { status: CycleCountStatus; items: Item[]; batchUnitCost?: string | null }) {
  const cc = {
    id: 'cc1',
    warehouseId: 'w1',
    zoneId: null,
    status: opts.status,
    items: opts.items.map((i) => ({ ...i })),
  };
  const adjustmentsCreated: Array<Record<string, unknown>> = [];
  const itemAdjLinks: Array<{ itemId: string; adjustmentId: string }> = [];

  const client = {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(client),
    cycleCount: {
      findFirst: jest.fn(async () => clone(cc)),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        Object.assign(cc, args.data, { items: [] });
        return clone(cc);
      }),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => {
        Object.assign(cc, args.data);
        return clone(cc);
      }),
    },
    cycleCountItem: {
      update: jest.fn(async (args: { where: { id: string }; data: { adjustmentId: string } }) => {
        itemAdjLinks.push({ itemId: args.where.id, adjustmentId: args.data.adjustmentId });
        return {};
      }),
    },
    stockBatch: {
      findFirst: jest.fn(async () => ({
        sellerId: 's1',
        unitCostInr: opts.batchUnitCost == null ? null : new Prisma.Decimal(opts.batchUnitCost),
      })),
    },
    stockAdjustment: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        adjustmentsCreated.push(args.data);
        return { id: `adj${adjustmentsCreated.length}` };
      }),
    },
    systemSetting: {
      findUnique: jest.fn(async () => ({ valueDecimal: null, valueInt: 50_000 })),
    },
    auditLog: { create: jest.fn(async () => ({ id: 'a1' })) },
  };
  const prisma = { client } as unknown as PrismaService;
  const audit = new AuditLogService(prisma);
  const warehouses = {
    resolveWarehouseId: jest.fn(async () => 'w1'),
  } as unknown as WarehouseResolverService;

  const svc = new CycleCountService(prisma, audit, warehouses);
  return { svc, cc, adjustmentsCreated, itemAdjLinks };
}

const CTX = { ipAddress: null, userAgent: null, requestId: null };
const item = (over: Partial<Item>): Item => ({
  id: 'it1',
  variantId: 'v1',
  binId: 'b1',
  batchId: 'bat1',
  systemQty: 10,
  countedQty: 10,
  adjustmentId: null,
  ...over,
});

describe('CycleCountService.complete', () => {
  it('generates one PENDING single-line CYCLE_COUNT adjustment per discrepancy', async () => {
    const sut = makeSut({
      status: CycleCountStatus.IN_PROGRESS,
      batchUnitCost: '5',
      items: [
        item({ id: 'it1', variantId: 'v1', binId: 'b1', systemQty: 10, countedQty: 7 }), // -3
        item({ id: 'it2', variantId: 'v2', binId: 'b2', systemQty: 4, countedQty: 9 }), // +5
        item({ id: 'it3', variantId: 'v3', binId: 'b3', systemQty: 8, countedQty: 8 }), // match
      ],
    });
    const res = await sut.svc.complete('staff1', 'cc1', CTX);
    expect(res.status).toBe(CycleCountStatus.COMPLETED);
    expect(sut.adjustmentsCreated).toHaveLength(2); // only the 2 discrepancies
    for (const a of sut.adjustmentsCreated) {
      expect(a.type).toBe(AdjustmentType.CYCLE_COUNT);
      expect(a.status).toBe(AdjustmentStatus.PENDING);
      expect(a.reasonCode).toBe(StockMovementReasonCode.COUNTING_ERROR);
      expect(a.approverThresholdInr).toBeDefined(); // threshold snapshot
      expect((a.lines as { create: unknown[] }).create).toHaveLength(1); // single-line
    }
    const firstLine = (sut.adjustmentsCreated[0]!.lines as { create: { qtyChange: number }[] })
      .create[0];
    expect(firstLine?.qtyChange).toBe(-3);
    expect(res.discrepancyCount).toBe(2);
    expect(res.totalSkusCounted).toBe(3);
    expect(res.totalBinsCounted).toBe(3);
    // each discrepant item linked to its adjustment
    expect(sut.itemAdjLinks).toEqual([
      { itemId: 'it1', adjustmentId: 'adj1' },
      { itemId: 'it2', adjustmentId: 'adj2' },
    ]);
  });

  it('no discrepancies -> no adjustments, still COMPLETED', async () => {
    const sut = makeSut({
      status: CycleCountStatus.IN_PROGRESS,
      items: [item({ systemQty: 5, countedQty: 5 })],
    });
    const res = await sut.svc.complete('staff1', 'cc1', CTX);
    expect(res.status).toBe(CycleCountStatus.COMPLETED);
    expect(sut.adjustmentsCreated).toHaveLength(0);
    expect(res.discrepancyCount).toBe(0);
  });

  it('rejects completing a non-IN_PROGRESS cycle count', async () => {
    const sut = makeSut({ status: CycleCountStatus.SCHEDULED, items: [] });
    await expect(sut.svc.complete('staff1', 'cc1', CTX)).rejects.toMatchObject({
      response: { code: 'INVALID_CYCLE_COUNT_STATUS' },
    });
  });

  it('rejects start on a non-SCHEDULED cycle count', async () => {
    const sut = makeSut({ status: CycleCountStatus.COMPLETED, items: [] });
    await expect(sut.svc.start('staff1', 'cc1', CTX)).rejects.toMatchObject({
      response: { code: 'INVALID_CYCLE_COUNT_STATUS' },
    });
  });
});

describe('CycleCountService.schedule', () => {
  it('creates a SCHEDULED count via the warehouse resolver', async () => {
    const sut = makeSut({ status: CycleCountStatus.SCHEDULED, items: [] });
    sut.cc.status = CycleCountStatus.SCHEDULED;
    const res = await sut.svc.schedule(
      'staff1',
      { countType: CycleCountType.FULL, countDate: '2026-05-20' },
      CTX,
    );
    expect(res.status).toBe(CycleCountStatus.SCHEDULED);
  });
});
