import {
  InboundFreightBasis,
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
      {
        perUnitInr: string;
        mode?: InboundFreightMode;
        status?: InboundFreightStatus;
        units?: number;
        unitsSettled?: number;
        lineTotalInr?: string;
        amountSettledInr?: string;
      }
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
        // The running-total charge reads the line total and what has
        // been settled so far, not the per-unit rate.
        units: alloc.units ?? 100,
        unitsSettled: alloc.unitsSettled ?? 0,
        lineTotalInr: D(alloc.lineTotalInr ?? '4500.00'),
        amountSettledInr: D(alloc.amountSettledInr ?? '0'),
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

describe('InboundFreightAmortisationService.planFromPricedLines', () => {
  const perKg = (id: string, rate: string, kg: string) => ({
    goodsReceiptLineId: id,
    basis: InboundFreightBasis.PER_KG,
    rateInr: D(rate),
    chargeableWeightKg: D(kg),
  });
  const perPiece = (id: string, rate: string) => ({
    goodsReceiptLineId: id,
    basis: InboundFreightBasis.PER_PIECE,
    rateInr: D(rate),
    chargeableWeightKg: null,
  });

  it('prices per kg and per piece on the SAME invoice, each at its own rate', async () => {
    // Air freight on the kettles at 300/kg for 20kg = 6000 over 10 units.
    // Handling on the cases at 9/piece for 100 = 900 over 100 units.
    const sut = makeSut({
      lines: [
        { id: 'l-kettle', variantId: 'v-kettle', receivedQty: 10 },
        { id: 'l-case', variantId: 'v-case', receivedQty: 100 },
      ],
      weights: { 'v-kettle': 2000, 'v-case': 50 },
    });
    const plan = await sut.svc.planFromPricedLines('gr-1', [
      perKg('l-kettle', '300', '20'),
      perPiece('l-case', '9'),
    ]);

    expect(plan.totalUnits).toBe(110);
    expect(plan.totalInr.toString()).toBe('6900');
    const kettle = plan.lines.find((l) => l.goodsReceiptLineId === 'l-kettle');
    const kase = plan.lines.find((l) => l.goodsReceiptLineId === 'l-case');
    expect(kettle?.lineTotalInr.toString()).toBe('6000');
    expect(kettle?.perUnitInr.toString()).toBe('600');
    expect(kase?.lineTotalInr.toString()).toBe('900');
    expect(kase?.perUnitInr.toString()).toBe('9');
  });

  it('the bill total is the SUM of its lines — never a figure typed separately', async () => {
    const sut = makeSut({
      lines: [
        { id: 'l-1', variantId: 'v-1', receivedQty: 5 },
        { id: 'l-2', variantId: 'v-2', receivedQty: 5 },
      ],
      weights: { 'v-1': 100, 'v-2': 100 },
    });
    const plan = await sut.svc.planFromPricedLines('gr-1', [
      perPiece('l-1', '12.50'),
      perKg('l-2', '200', '1.5'),
    ]);
    const summed = plan.lines.reduce((sum, l) => sum.add(l.lineTotalInr), D('0'));
    expect(plan.totalInr.toString()).toBe(summed.toString());
    expect(plan.totalInr.toString()).toBe('362.5');
  });

  it('REFUSES an unpriced product — the failure mode the per-line model exists to prevent', async () => {
    // A product left out gets no allocation row, and the charge path
    // skips a unit that has none. Those units would ship freight-free
    // forever, and nothing would ever report it.
    const sut = makeSut({
      lines: [
        { id: 'l-1', variantId: 'v-1', receivedQty: 10 },
        { id: 'l-2', variantId: 'v-2', receivedQty: 10 },
      ],
      weights: { 'v-1': 100, 'v-2': 100 },
    });
    await expect(
      sut.svc.planFromPricedLines('gr-1', [perPiece('l-1', '10')]),
    ).rejects.toMatchObject({ response: { code: 'FREIGHT_LINE_MISSING' } });
  });

  it('refuses a per-kg line with no weight', async () => {
    const sut = makeSut({
      lines: [{ id: 'l-1', variantId: 'v-1', receivedQty: 10 }],
      weights: { 'v-1': 100 },
    });
    await expect(
      sut.svc.planFromPricedLines('gr-1', [
        {
          goodsReceiptLineId: 'l-1',
          basis: InboundFreightBasis.PER_KG,
          rateInr: D('300'),
          chargeableWeightKg: null,
        },
      ]),
    ).rejects.toMatchObject({ response: { code: 'FREIGHT_WEIGHT_REQUIRED' } });
  });

  it('refuses a priced line that is not on this arrival', async () => {
    const sut = makeSut({
      lines: [{ id: 'l-1', variantId: 'v-1', receivedQty: 10 }],
      weights: { 'v-1': 100 },
    });
    await expect(
      sut.svc.planFromPricedLines('gr-1', [perPiece('l-1', '10'), perPiece('l-stray', '10')]),
    ).rejects.toMatchObject({ response: { code: 'FREIGHT_LINE_UNKNOWN' } });
  });

  it('a single free line is fine; a whole bill of nothing is not', async () => {
    // A consolidator waiving one carton is real. A zero-rupee freight
    // bill is not a bill, and recording one would say the shipment was
    // carried for free.
    const sut = makeSut({
      lines: [
        { id: 'l-1', variantId: 'v-1', receivedQty: 10 },
        { id: 'l-2', variantId: 'v-2', receivedQty: 10 },
      ],
      weights: { 'v-1': 100, 'v-2': 100 },
    });
    const ok = await sut.svc.planFromPricedLines('gr-1', [
      perPiece('l-1', '0'),
      perPiece('l-2', '10'),
    ]);
    expect(ok.totalInr.toString()).toBe('100');

    await expect(
      sut.svc.planFromPricedLines('gr-1', [perPiece('l-1', '0'), perPiece('l-2', '0')]),
    ).rejects.toMatchObject({ response: { code: 'FREIGHT_AMOUNT_INVALID' } });
  });

  it('ignores lines that received nothing, and does not demand a price for them', async () => {
    const sut = makeSut({
      lines: [
        { id: 'l-1', variantId: 'v-1', receivedQty: 10 },
        { id: 'l-empty', variantId: 'v-2', receivedQty: 0 },
      ],
      weights: { 'v-1': 100, 'v-2': 100 },
    });
    const plan = await sut.svc.planFromPricedLines('gr-1', [perPiece('l-1', '10')]);
    expect(plan.lines).toHaveLength(1);
    expect(plan.totalUnits).toBe(10);
  });

  it('an arrival with nothing counted is refused rather than dividing by zero', async () => {
    const sut = makeSut({ lines: [] });
    await expect(sut.svc.planFromPricedLines('gr-1', [])).rejects.toMatchObject({
      response: { code: 'FREIGHT_NOTHING_COUNTED' },
    });
  });
});

describe('the running-total charge loses nothing', () => {
  // perUnitInr is a 4dp division and its parts do not add back up. The
  // charge is worked out as "what SHOULD have been charged once these
  // units are gone, minus what has been charged so far", so every
  // payment is within a paisa of the true share and the LAST unit lands
  // the running total exactly on the line total.
  const line = (over: Record<string, unknown>) => ({
    items: [{ id: 'si-1', quantity: 1, pickedBatchId: 'batch-1' }],
    batches: { 'batch-1': { lineId: 'l-1', parentBatchId: null } },
    allocations: { 'l-1': { perUnitInr: '333.3333', ...over } },
  });

  it('the FINAL unit lands exactly on the line total, never a paisa short', async () => {
    // ₹1,000 over 3. Per-unit rate x quantity charges 333.33 three
    // times = 999.99, and the bill sits a paisa from SETTLED forever.
    const sut = makeSut(
      line({ units: 3, unitsSettled: 2, lineTotalInr: '1000.00', amountSettledInr: '666.67' }),
    );
    const r = await sut.svc.debitForDeliveredOrder(sut.tx, ORDER, SELLER);
    expect(r.amountInr).toBe('333.33');
    // 666.67 + 333.33 = 1000.00 exactly.
  });

  it('never charges PAST the line total either', async () => {
    // ₹1,000 over 7 is 142.8571 each; charging the rate seven times
    // takes 1,000.02 — two paise nobody owed. The drift goes both ways,
    // so it is not even consistently in anyone's favour.
    const sut = makeSut(
      line({ units: 7, unitsSettled: 6, lineTotalInr: '1000.00', amountSettledInr: '857.14' }),
    );
    const r = await sut.svc.debitForDeliveredOrder(sut.tx, ORDER, SELLER);
    expect(r.amountInr).toBe('142.86');
    // 857.14 + 142.86 = 1000.00 exactly.
  });

  it('charges nothing once the whole line has been paid for', async () => {
    const sut = makeSut(
      line({ units: 3, unitsSettled: 3, lineTotalInr: '1000.00', amountSettledInr: '1000.00' }),
    );
    const r = await sut.svc.debitForDeliveredOrder(sut.tx, ORDER, SELLER);
    expect(r).toMatchObject({ amountInr: '0', unitsCharged: 0 });
    expect(sut.applyEntry).not.toHaveBeenCalled();
  });
});

describe('InboundFreightAmortisationService.debitForDeliveredOrder', () => {
  const base = {
    items: [{ id: 'si-1', quantity: 1, pickedBatchId: 'batch-1' }],
    batches: { 'batch-1': { lineId: 'l-1', parentBatchId: null } },
    // ₹4,500 over 100 units — a clean ₹45 each, so the arithmetic in
    // the older assertions still reads the same.
    allocations: { 'l-1': { perUnitInr: '45.0000', units: 100, lineTotalInr: '4500.00' } },
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
        // Absolute — the running count, not a delta.
        unitsSettled: 1,
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
