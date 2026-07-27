import {
  InboundFreightMode,
  InboundFreightStatus,
  Prisma,
  WalletEntryDirection,
} from '@skydrop/db';
import { InboundFreightAmortisationService } from '../../src/modules/inbound-freight/services/inbound-freight-amortisation.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { CatalogReadService } from '../../src/modules/catalog-read/services/catalog-read.service';
import type { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';

type AnyArgs = Record<string, unknown>;

const SELLER = 'seller-1';
const ORDER = 'order-1';
const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

interface LineSeed {
  id: string;
  variantId: string;
  receivedQty: number;
}

function makeSut(
  opts: {
    lines?: LineSeed[];
    weights?: Record<string, number | null>;
    items?: Array<{ id: string; quantity: number; pickedBatchId: string | null }>;
    /** batchId → { lineId, parentBatchId } */
    batches?: Record<string, { lineId: string | null; parentBatchId: string | null }>;
    /** lineId → allocation */
    allocations?: Record<
      string,
      { perUnitInr: string; mode?: InboundFreightMode; status?: InboundFreightStatus }
    >;
    existingEntry?: boolean;
    chargeAfterUpdate?: { unitsSettled: number; totalUnits: number; status: InboundFreightStatus };
  } = {},
) {
  const lineFindMany = jest.fn<Promise<LineSeed[]>, [AnyArgs]>(async () => opts.lines ?? []);
  const lineFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async (args) => {
    const batchId = ((args['where'] ?? {}) as AnyArgs)['batchId'] as string;
    const lineId = Object.entries(opts.batches ?? {}).find(
      ([, v]) => v.lineId !== null && batchId === lineIdToBatch(batchId),
    );
    void lineId;
    // Resolve which line this batch belongs to via the batches map.
    const entry = Object.entries(opts.batches ?? {}).find(([b]) => b === batchId);
    const targetLine = entry?.[1].lineId ?? null;
    if (targetLine === null) return null;
    const alloc = opts.allocations?.[targetLine];
    if (!alloc) return { freightAllocation: null };
    return {
      freightAllocation: {
        id: `alloc-${targetLine}`,
        freightChargeId: 'fc-1',
        perUnitInr: D(alloc.perUnitInr),
        freightCharge: {
          mode: alloc.mode ?? InboundFreightMode.PAY_LATER,
          status: alloc.status ?? InboundFreightStatus.PENDING,
        },
      },
    };
  });
  const lineIdToBatch = (b: string): string => b;

  const batchFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async (args) => {
    const id = ((args['where'] ?? {}) as AnyArgs)['id'] as string;
    const b = opts.batches?.[id];
    if (!b) return null;
    return { id, parentBatchId: b.parentBatchId };
  });

  const allocUpdate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({}));
  const chargeUpdate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({
    unitsSettled: opts.chargeAfterUpdate?.unitsSettled ?? 1,
    totalUnits: opts.chargeAfterUpdate?.totalUnits ?? 100,
    status: opts.chargeAfterUpdate?.status ?? InboundFreightStatus.PENDING,
  }));
  const walletFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.existingEntry ? { id: 'entry-old' } : null,
  );
  const itemFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(async () => opts.items ?? []);

  const client = {
    goodsReceiptLine: { findMany: lineFindMany, findFirst: lineFindFirst },
    stockBatch: { findUnique: batchFindUnique },
    inboundFreightAllocation: { update: allocUpdate },
    inboundFreightCharge: { update: chargeUpdate },
    sellerWalletEntry: { findFirst: walletFindFirst },
    shipmentItem: { findMany: itemFindMany },
  };
  const prisma = { client } as unknown as PrismaService;

  const getVariantsByIds = jest.fn(async () => {
    const map = new Map<string, { weightGrams: number | null }>();
    for (const [id, w] of Object.entries(opts.weights ?? {})) {
      map.set(id, { weightGrams: w });
    }
    return map;
  });
  const catalog = { getVariantsByIds } as unknown as CatalogReadService;

  const applyEntry = jest.fn<Promise<AnyArgs>, [unknown, AnyArgs]>(async () => ({
    id: 'we-1',
    runningBalanceAfter: D('0'),
  }));
  const wallet = { applyEntry } as unknown as WalletService;

  return {
    svc: new InboundFreightAmortisationService(prisma, catalog, wallet),
    tx: client as unknown as Prisma.TransactionClient,
    applyEntry,
    allocUpdate,
    chargeUpdate,
  };
}

describe('InboundFreightAmortisationService.planAllocation — the weight split', () => {
  it('splits by WEIGHT, so a heavy SKU carries more of the bill than a light one', async () => {
    // 10 kettles @ 2000g = 20 000g; 100 cases @ 50g = 5000g. Total 25 000g.
    // Kettle pool = 4500 × 20/25 = 3600 ⇒ 360/unit.
    // Case pool   = 4500 ×  5/25 =  900 ⇒   9/unit.
    const sut = makeSut({
      lines: [
        { id: 'l-kettle', variantId: 'v-kettle', receivedQty: 10 },
        { id: 'l-case', variantId: 'v-case', receivedQty: 100 },
      ],
      weights: { 'v-kettle': 2000, 'v-case': 50 },
    });
    const plan = await sut.svc.planAllocation('gr-1', D('4500'));

    expect(plan.totalUnits).toBe(110);
    const kettle = plan.lines.find((l) => l.goodsReceiptLineId === 'l-kettle');
    const kase = plan.lines.find((l) => l.goodsReceiptLineId === 'l-case');
    expect(kettle?.perUnitInr.toString()).toBe('360');
    expect(kase?.perUnitInr.toString()).toBe('9');
    // Sanity: the split adds back up to the bill.
    const total = plan.lines.reduce((sum, l) => sum.add(l.perUnitInr.mul(l.units)), D('0'));
    expect(total.toString()).toBe('4500');
  });

  it('falls back to a COUNT split when no SKU has a weight — never treats freight as free', async () => {
    const sut = makeSut({
      lines: [
        { id: 'l-1', variantId: 'v-1', receivedQty: 60 },
        { id: 'l-2', variantId: 'v-2', receivedQty: 40 },
      ],
      weights: { 'v-1': null, 'v-2': null },
    });
    const plan = await sut.svc.planAllocation('gr-1', D('1000'));
    // 1000 / 100 units = 10/unit for both lines.
    for (const line of plan.lines) {
      expect(line.perUnitInr.toString()).toBe('10');
      expect(line.unitWeightGrams).toBeNull();
    }
  });

  it('a zero weight is treated as MISSING, not as weightless', async () => {
    const sut = makeSut({
      lines: [{ id: 'l-1', variantId: 'v-1', receivedQty: 10 }],
      weights: { 'v-1': 0 },
    });
    const plan = await sut.svc.planAllocation('gr-1', D('500'));
    expect(plan.lines[0]?.unitWeightGrams).toBeNull();
    expect(plan.lines[0]?.perUnitInr.toString()).toBe('50');
  });

  it('mixed: a weighed line and an unweighed line each get a share', async () => {
    const sut = makeSut({
      lines: [
        { id: 'l-w', variantId: 'v-w', receivedQty: 50 },
        { id: 'l-u', variantId: 'v-u', receivedQty: 50 },
      ],
      weights: { 'v-w': 100, 'v-u': null },
    });
    const plan = await sut.svc.planAllocation('gr-1', D('1000'));
    const weighed = plan.lines.find((l) => l.goodsReceiptLineId === 'l-w');
    const unweighed = plan.lines.find((l) => l.goodsReceiptLineId === 'l-u');
    // Units split the bill 50/50 between pools, then weight applies inside.
    expect(weighed?.perUnitInr.toString()).toBe('10');
    expect(unweighed?.perUnitInr.toString()).toBe('10');
  });

  it('ignores lines that received nothing', async () => {
    const sut = makeSut({
      lines: [
        { id: 'l-1', variantId: 'v-1', receivedQty: 10 },
        { id: 'l-empty', variantId: 'v-2', receivedQty: 0 },
      ],
      weights: { 'v-1': 100, 'v-2': 100 },
    });
    const plan = await sut.svc.planAllocation('gr-1', D('100'));
    expect(plan.lines).toHaveLength(1);
    expect(plan.totalUnits).toBe(10);
  });

  it('an empty receipt allocates nothing rather than dividing by zero', async () => {
    const sut = makeSut({ lines: [] });
    const plan = await sut.svc.planAllocation('gr-1', D('100'));
    expect(plan).toEqual({ lines: [], totalUnits: 0 });
  });
});

describe('InboundFreightAmortisationService.debitForDeliveredOrder', () => {
  const base = {
    items: [{ id: 'si-1', quantity: 1, pickedBatchId: 'batch-1' }],
    batches: { 'batch-1': { lineId: 'l-1', parentBatchId: null } },
    allocations: { 'l-1': { perUnitInr: '45.0000' } },
  };

  it("charges ONLY the delivered unit's share — the rest of the consignment still owes", async () => {
    const sut = makeSut(base);
    const r = await sut.svc.debitForDeliveredOrder(sut.tx, ORDER, SELLER);

    expect(r).toMatchObject({ amountInr: '45', unitsCharged: 1 });
    expect(sut.applyEntry.mock.calls[0]![1]).toMatchObject({
      direction: WalletEntryDirection.INBOUND_FREIGHT,
      linkedOrderId: ORDER,
    });
    // The line and the bill both record what has been consumed.
    expect(sut.allocUpdate.mock.calls[0]![0]).toMatchObject({
      data: {
        unitsSettled: { increment: 1 },
        amountSettledInr: { increment: expect.anything() },
      },
    });
  });

  it('charges quantity × rate for a multi-unit line', async () => {
    const sut = makeSut({
      ...base,
      items: [{ id: 'si-1', quantity: 3, pickedBatchId: 'batch-1' }],
    });
    const r = await sut.svc.debitForDeliveredOrder(sut.tx, ORDER, SELLER);
    expect(r.amountInr).toBe('135');
    expect(r.unitsCharged).toBe(3);
  });

  it('is idempotent: a second run finds the existing entry and charges nothing', async () => {
    const sut = makeSut({ ...base, existingEntry: true });
    const r = await sut.svc.debitForDeliveredOrder(sut.tx, ORDER, SELLER);
    expect(r).toEqual({ amountInr: '0', unitsCharged: 0, alreadyCharged: true });
    expect(sut.applyEntry).not.toHaveBeenCalled();
  });

  it('does NOT charge a PAY_NOW consignment — it was paid in full at receipt', async () => {
    const sut = makeSut({
      ...base,
      allocations: { 'l-1': { perUnitInr: '45.0000', mode: InboundFreightMode.PAY_NOW } },
    });
    const r = await sut.svc.debitForDeliveredOrder(sut.tx, ORDER, SELLER);
    expect(r.amountInr).toBe('0');
    expect(sut.applyEntry).not.toHaveBeenCalled();
  });

  it('does NOT charge a WAIVED bill', async () => {
    const sut = makeSut({
      ...base,
      allocations: {
        'l-1': { perUnitInr: '45.0000', status: InboundFreightStatus.WAIVED },
      },
    });
    const r = await sut.svc.debitForDeliveredOrder(sut.tx, ORDER, SELLER);
    expect(r.amountInr).toBe('0');
  });

  it('charges nothing when the goods came from no billed consignment', async () => {
    const sut = makeSut({
      items: [{ id: 'si-1', quantity: 1, pickedBatchId: 'batch-1' }],
      batches: { 'batch-1': { lineId: 'l-1', parentBatchId: null } },
      allocations: {},
    });
    const r = await sut.svc.debitForDeliveredOrder(sut.tx, ORDER, SELLER);
    expect(r.amountInr).toBe('0');
    expect(sut.applyEntry).not.toHaveBeenCalled();
  });

  it('follows an R6b child batch to its PARENT consignment line', async () => {
    // A unit that came back, was restocked at another warehouse into a
    // child batch, and later sold. Its freight still belongs to the
    // consignment that carried it into India.
    const sut = makeSut({
      items: [{ id: 'si-1', quantity: 1, pickedBatchId: 'batch-child' }],
      batches: {
        'batch-child': { lineId: null, parentBatchId: 'batch-parent' },
        'batch-parent': { lineId: 'l-1', parentBatchId: null },
      },
      allocations: { 'l-1': { perUnitInr: '45.0000' } },
    });
    const r = await sut.svc.debitForDeliveredOrder(sut.tx, ORDER, SELLER);
    expect(r.amountInr).toBe('45');
  });

  it('marks the bill SETTLED once its last unit is charged', async () => {
    const sut = makeSut({
      ...base,
      chargeAfterUpdate: {
        unitsSettled: 100,
        totalUnits: 100,
        status: InboundFreightStatus.PARTIALLY_SETTLED,
      },
    });
    await sut.svc.debitForDeliveredOrder(sut.tx, ORDER, SELLER);
    const statusUpdate = sut.chargeUpdate.mock.calls[1]![0]['data'] as AnyArgs;
    expect(statusUpdate['status']).toBe(InboundFreightStatus.SETTLED);
  });

  it('marks the bill PARTIALLY_SETTLED while units remain', async () => {
    const sut = makeSut({
      ...base,
      chargeAfterUpdate: {
        unitsSettled: 1,
        totalUnits: 100,
        status: InboundFreightStatus.PENDING,
      },
    });
    await sut.svc.debitForDeliveredOrder(sut.tx, ORDER, SELLER);
    const statusUpdate = sut.chargeUpdate.mock.calls[1]![0]['data'] as AnyArgs;
    expect(statusUpdate['status']).toBe(InboundFreightStatus.PARTIALLY_SETTLED);
  });

  it('never downgrades a bill an operator already settled by hand', async () => {
    const sut = makeSut({
      ...base,
      chargeAfterUpdate: {
        unitsSettled: 5,
        totalUnits: 100,
        status: InboundFreightStatus.SETTLED,
      },
    });
    await sut.svc.debitForDeliveredOrder(sut.tx, ORDER, SELLER);
    // Only the increment update ran; no status write followed.
    expect(sut.chargeUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('InboundFreightAmortisationService.debitForWrittenOffItems', () => {
  it("charges a written-off unit's freight share — the freight was really spent", async () => {
    const sut = makeSut({
      items: [{ id: 'si-1', quantity: 2, pickedBatchId: 'batch-1' }],
      batches: { 'batch-1': { lineId: 'l-1', parentBatchId: null } },
      allocations: { 'l-1': { perUnitInr: '45.0000' } },
    });
    const r = await sut.svc.debitForWrittenOffItems(sut.tx, {
      orderId: ORDER,
      sellerId: SELLER,
      shipmentItemIds: ['si-1'],
    });
    expect(r.amountInr).toBe('90');
    expect(sut.applyEntry.mock.calls[0]![1]).toMatchObject({
      direction: WalletEntryDirection.INBOUND_FREIGHT,
    });
  });

  it('no items ⇒ no wallet entry at all', async () => {
    const sut = makeSut();
    const r = await sut.svc.debitForWrittenOffItems(sut.tx, {
      orderId: ORDER,
      sellerId: SELLER,
      shipmentItemIds: [],
    });
    expect(r).toEqual({ amountInr: '0', unitsCharged: 0, alreadyCharged: false });
    expect(sut.applyEntry).not.toHaveBeenCalled();
  });

  it('shares the one-entry-per-order gate with the delivery path', async () => {
    const sut = makeSut({ existingEntry: true });
    const r = await sut.svc.debitForWrittenOffItems(sut.tx, {
      orderId: ORDER,
      sellerId: SELLER,
      shipmentItemIds: ['si-1'],
    });
    expect(r.alreadyCharged).toBe(true);
    expect(sut.applyEntry).not.toHaveBeenCalled();
  });
});
