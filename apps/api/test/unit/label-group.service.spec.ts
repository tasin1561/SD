import { ConflictException } from '@nestjs/common';
import { PDFDocument, PDFPage } from 'pdf-lib';
import {
  LabelGroupService,
  buildGroups,
  type LabelGroupPrintResult,
} from '../../src/modules/warehouse-printing/services/label-group.service';
import { LabelPrintService } from '../../src/modules/warehouse-printing/services/label-print.service';
import { LabelSheetService } from '../../src/modules/warehouse-printing/services/label-sheet.service';
import { ManualLabelPdfService } from '../../src/modules/warehouse-printing/services/manual-label-pdf.service';
import { WarehousePrintingController } from '../../src/modules/warehouse-printing/controllers/warehouse-printing.controller';
import { REQUIRE_PERMISSIONS_KEY } from '../../src/common/auth/require-permissions.decorator';
import type { PrintQueueRow } from '../../src/modules/warehouse-printing/services/print-queue.service';

type Any = Record<string, unknown>;

function row(over: Partial<PrintQueueRow> & { shipmentId: string }): PrintQueueRow {
  return {
    shipmentNumber: `SH-${over.shipmentId}`,
    orderId: `o-${over.shipmentId}`,
    orderNumber: `ORD-${over.shipmentId}`,
    sellerCompanyName: null,
    warehouseId: 'wh-1',
    warehouseName: 'Main',
    courierCode: 'DELHIVERY',
    courierName: 'DELHIVERY',
    awbNumber: `AWB-${over.shipmentId}`,
    isManualCourier: false,
    destCity: 'Pune',
    destPostalCode: '411001',
    codAmountInr: null,
    itemCount: 1,
    confirmedAtIso: null,
    placedAtIso: '2026-11-10T00:00:00.000Z',
    labelPrintedAtIso: null,
    labelPrintCount: 0,
    packCompletedAtIso: null,
    ...over,
  };
}

describe('buildGroups', () => {
  it('sorts by courier, then oldest first, and chunks by size with a smaller last group', () => {
    const rows = [
      row({ shipmentId: 'd3', placedAtIso: '2026-11-03T00:00:00.000Z' }),
      row({
        shipmentId: 'b1',
        courierCode: 'BLUEDART',
        courierName: 'BLUEDART',
        placedAtIso: '2026-11-09T00:00:00.000Z',
      }),
      row({ shipmentId: 'd1', placedAtIso: '2026-11-01T00:00:00.000Z' }),
      row({ shipmentId: 'd2', placedAtIso: '2026-11-02T00:00:00.000Z' }),
    ];
    const groups = buildGroups(rows, 2);
    expect(groups.map((g) => g.label)).toEqual([
      'Bluedart · Group 1',
      'Delhivery · Group 1',
      'Delhivery · Group 2',
    ]);
    expect(groups.map((g) => g.shipmentIds)).toEqual([['b1'], ['d1', 'd2'], ['d3']]);
    expect(groups.map((g) => g.size)).toEqual([1, 2, 1]);
    expect(groups[1]?.oldestPlacedAt).toBe('2026-11-01T00:00:00.000Z');
    // The key follows the contents, not the position.
    expect(groups[1]?.key).toBe(buildGroups(rows, 2)[1]?.key);
  });
});

function makeHarness(opts: { pool: PrintQueueRow[]; setting?: number | null }) {
  const store = new Map<string, string>();
  const redis = {
    client: {
      set: jest.fn(async (k: string, v: string, ...rest: unknown[]) => {
        if (rest.includes('NX') && store.has(k)) return null;
        store.set(k, v);
        return 'OK';
      }),
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      del: jest.fn(async (k: string) => {
        store.delete(k);
        return 1;
      }),
    },
  };
  const shipmentRows = new Map<string, Any>();
  for (const r of opts.pool) {
    shipmentRows.set(r.shipmentId, {
      id: r.shipmentId,
      shipmentNumber: r.shipmentNumber,
      awbNumber: r.awbNumber,
      isManualCourier: true,
      manualCourierName: 'Local',
      destRecipientName: 'Cust',
      destRecipientPhoneE164: '+919000000000',
      destAddressLine1: '1 Road',
      destAddressLine2: null,
      destCity: 'Pune',
      destStateProvince: 'MH',
      destPostalCode: '411001',
      totalWeightGrams: 100,
      awbLabels: [],
      items: [{ skuCode: 'S', productName: 'Thing', quantity: 1 }],
      orderShipments: [
        {
          order: { orderNumber: r.orderNumber, codAmountInr: null, seller: { companyName: 'Co' } },
        },
      ],
    });
  }
  const shipmentUpdateMany = jest.fn(async () => ({ count: 0 }));
  const prisma = {
    client: {
      systemSetting: {
        findUnique: jest.fn(async () =>
          opts.setting === undefined ? null : { valueInt: opts.setting },
        ),
      },
      shipment: {
        findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => shipmentRows.get(id)).filter((x) => x !== undefined),
        ),
        updateMany: shipmentUpdateMany,
      },
    },
  };
  const audit = { log: jest.fn(async () => undefined) };
  const labels = new LabelPrintService(
    prisma as never,
    audit as never,
    { getObject: jest.fn() } as never,
    new LabelSheetService(),
    new ManualLabelPdfService(),
  );
  const batches = {
    create: jest.fn(async () => ({ id: 'batch-1', batchNumber: 'PB-2026-11-000042' })),
    cancel: jest.fn(async () => undefined),
  };
  const queues = { labelPool: jest.fn(async () => opts.pool) };
  const svc = new LabelGroupService(
    prisma as never,
    redis as never,
    queues as never,
    labels,
    batches as never,
  );
  return { svc, batches, queues, shipmentUpdateMany, store };
}

describe('LabelGroupService', () => {
  const pool = [
    row({ shipmentId: 'a', placedAtIso: '2026-11-03T00:00:00.000Z' }),
    row({ shipmentId: 'b', placedAtIso: '2026-11-01T00:00:00.000Z' }),
    row({ shipmentId: 'c', placedAtIso: '2026-11-02T00:00:00.000Z' }),
  ];

  it('reads the group size from the setting (clamped), default 30', async () => {
    expect((await makeHarness({ pool }).svc.list()).groupSize).toBe(30);
    expect((await makeHarness({ pool, setting: 2 }).svc.list()).groups.map((g) => g.size)).toEqual([
      2, 1,
    ]);
    expect(await makeHarness({ pool, setting: 9999 }).svc.groupSize()).toBe(200);
    expect(await makeHarness({ pool, setting: 0 }).svc.groupSize()).toBe(1);
  });

  it('prints ONE batch and ONE pdf in oldest order, tagging every label', async () => {
    const drawn: string[] = [];
    const orig = PDFPage.prototype.drawText;
    const spy = jest.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function (
      this: PDFPage,
      text: string,
      options?: Parameters<PDFPage['drawText']>[1],
    ) {
      drawn.push(text);
      return orig.call(this, text, options);
    });
    const h = makeHarness({ pool });
    const res = await h.svc.print(
      { shipmentIds: ['a', 'b', 'c'], idempotencyKey: 'click-0001' },
      'staff-1',
    );

    expect(h.batches.create).toHaveBeenCalledTimes(1);
    expect(h.batches.create).toHaveBeenCalledWith(['b', 'c', 'a'], 'staff-1', undefined, {
      skipLabelGate: true,
    });
    expect(res.batchNumber).toBe('PB-2026-11-000042');
    expect(res.replayed).toBe(false);
    expect(res.pageCount).toBe(3);

    const bytes = Buffer.from(res.pdfBase64 as string, 'base64');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    // Content streams are deflated, so assert on what was DRAWN, in page order.
    const tags = drawn.filter((t) => t.startsWith('PB-'));
    expect(tags).toEqual([
      'PB-2026-11-000042 · 1/3',
      'PB-2026-11-000042 · 2/3',
      'PB-2026-11-000042 · 3/3',
    ]);
    // The count and audit behave like an ordinary build.
    expect(h.shipmentUpdateMany).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('is idempotent per click: a replay makes no second batch and no second file', async () => {
    const h = makeHarness({ pool });
    const input = { shipmentIds: ['a', 'b'], idempotencyKey: 'click-0002' };
    const first = await h.svc.print(input, 'staff-1');
    const again: LabelGroupPrintResult = await h.svc.print(input, 'staff-1');
    expect(h.batches.create).toHaveBeenCalledTimes(1);
    expect(again.replayed).toBe(true);
    expect(again.pdfBase64).toBeNull();
    expect(again.batchNumber).toBe(first.batchNumber);
  });

  it('refuses parcels no longer in the label pool and makes no batch', async () => {
    const h = makeHarness({ pool });
    await expect(
      h.svc.print({ shipmentIds: ['a', 'gone'], idempotencyKey: 'click-0003' }, 'staff-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.batches.create).not.toHaveBeenCalled();
    // The key is freed so the operator can click again.
    expect(h.store.size).toBe(0);
  });
});

describe('label group endpoints: permission and the tag strip', () => {
  it('both endpoints sit behind warehouse.pick, like the label queue', () => {
    const proto = WarehousePrintingController.prototype;
    const classPerm = Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, WarehousePrintingController);
    expect(classPerm).toEqual(['warehouse.pick']);
    expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, proto.labelGroupList)).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, proto.printLabelGroups)).toBeUndefined();
  });

  it('a tagged page keeps the label above the tag strip; untagged pages are unchanged', async () => {
    const src = await PDFDocument.create();
    src.addPage([288, 432]).drawRectangle({ x: 0, y: 0, width: 288, height: 432 });
    const bytes = Buffer.from(await src.save());
    const sheet = new LabelSheetService();
    const plain = await sheet.merge([{ shipmentId: 'x', bytes }]);
    const tagged = await sheet.merge([{ shipmentId: 'x', bytes }], {
      tags: new Map([['x', 'PB-1 · 1/1']]),
    });
    const size = async (b: Buffer): Promise<string> => {
      const p = (await PDFDocument.load(b)).getPage(0);
      return `${p.getWidth()}x${p.getHeight()}`;
    };
    expect(await size(plain.pdf)).toBe('288x432');
    expect(await size(tagged.pdf)).toBe('288x432');
    expect(tagged.pdf.equals(plain.pdf)).toBe(false);
  });
});
