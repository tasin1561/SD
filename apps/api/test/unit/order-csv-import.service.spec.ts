import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ActorType, BulkUploadStatus } from '@skydrop/db';
import { OrderCsvImportService } from '../../src/modules/order-csv-import/services/order-csv-import.service';
import { OrderCsvParserService } from '../../src/modules/order-csv-import/services/order-csv-parser.service';
import type { OrderCsvStockCheck } from '../../src/modules/order-csv-import/services/order-csv-stock-check.service';
import type { EnvService } from '../../src/config/env.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type AnyArgs = Record<string, unknown>;

const SELLER = 's1';
const KEY = `sellers/${SELLER}/order-imports/tok-1.csv`;
const HEADER =
  'Product SKU,Quantity,Customer Name,Customer Phone,Address Line1,Address Line2,City,State,Pin Code,External Ref';
const GOOD_CSV = `${HEADER}\nSKU-1,2,Asha,+919876543210,12 MG Road,Near City Hospital,Bengaluru,Karnataka,560001,EXT-1\n`;

function makeService(
  opts: {
    object?: string | null;
    upload?: AnyArgs | null;
    /** What `OrderCsvStockCheckService.check` reports for this file. */
    stockCheck?: OrderCsvStockCheck | null;
  } = {},
) {
  const env = {
    csvPresignTtlSeconds: 900,
    csvMaxRows: 1000,
    csvMaxBytes: 8_388_608,
  } as unknown as EnvService;

  const bulkCreate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (a) => ({
    id: 'u1',
    fileName: (a.data as AnyArgs).fileName,
    status: BulkUploadStatus.PENDING,
    rowCount: (a.data as AnyArgs).rowCount,
    ordersCreated: 0,
    rowsFailed: 0,
    rowsSkipped: 0,
    errorReportKey: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
  }));
  const bulkUpdate = jest.fn(async () => ({ id: 'u1' }));
  const bulkFindFirst = jest.fn(async () => (opts.upload === undefined ? null : opts.upload));
  const bulkFindMany = jest.fn(async () => [{ id: 'u1' }]);
  const bulkCount = jest.fn(async () => 1);
  const client = {
    bulkOrderUpload: {
      create: bulkCreate,
      update: bulkUpdate,
      findFirst: bulkFindFirst,
      findMany: bulkFindMany,
      count: bulkCount,
    },
  };

  const spaces = {
    presignPutUrl: jest.fn(async () => 'https://signed/put'),
    headObject: jest.fn(async () => (opts.object === null ? null : { size: 123 })),
    getObject: jest.fn(async () =>
      opts.object === null ? null : Buffer.from(opts.object ?? GOOD_CSV, 'utf8'),
    ),
  };
  const audit = { log: jest.fn(async () => 'a1') };
  const queue = { enqueueProcess: jest.fn(async () => 'job-1') };

  const stock = { check: jest.fn(async () => opts.stockCheck ?? null) };
  const settings = { setOverride: jest.fn(async () => ({})) };

  const svc = new OrderCsvImportService(
    env,
    { client } as unknown as PrismaService,
    spaces as never,
    new OrderCsvParserService(),
    audit as never,
    queue as never,
    stock as never,
    settings as never,
  );
  return { svc, bulkCreate, bulkUpdate, spaces, audit, queue, stock, settings };
}

/** The shape `OrderCsvStockCheckService` returns when it has something to say. */
function oversellCheck(holdsAtPlacement: boolean): OrderCsvStockCheck {
  return {
    holdsAtPlacement,
    oversold: [{ skuCode: 'SKU-1', requested: 500, available: 3, shortfall: 497 }],
    blocksImport: holdsAtPlacement,
    headline: 'SKU-1: 500 ordered, 3 available.',
    waysForward: holdsAtPlacement ? 'Either reduce the quantities…' : null,
    lasting: holdsAtPlacement ? 'That switch applies to EVERY FUTURE ORDER…' : null,
    message: 'SKU-1: 500 ordered, 3 available.',
  };
}

describe('OrderCsvImportService', () => {
  it('buildTemplate emits headers + one example row', () => {
    const { svc } = makeService();
    const t = svc.buildTemplate();
    // Line 0 is the Excel `sep=,` hint; the header row follows it.
    const [, h, ex] = t
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\n');
    expect(h).toContain('Product SKU');
    expect(h).toContain('Order ID');
    expect(ex!.split(',').length).toBe(h!.split(',').length);
  });

  it('presign returns key + url + ttl', async () => {
    const { svc } = makeService();
    const r = await svc.presign(SELLER, { fileName: 'o.csv' });
    expect(r.spacesKey).toMatch(/^sellers\/s1\/order-imports\/.+\.csv$/);
    expect(r.uploadUrl).toBe('https://signed/put');
    expect(r.expiresInSeconds).toBe(900);
  });

  it('preview auto-detects mapping + flags none missing for a good header', async () => {
    const { svc } = makeService();
    const p = await svc.preview(SELLER, { spacesKey: KEY });
    expect(p.rowCount).toBe(1);
    expect(p.missingRequired).toEqual([]);
    expect(p.mapping.productSku).toBe('Product SKU');
    expect(p.sampleRows).toHaveLength(1);
  });

  it('createAndEnqueue creates the row, enqueues, audits, sets jobId', async () => {
    const { svc, bulkCreate, bulkUpdate, queue, audit } = makeService();
    const v = await svc.createAndEnqueue(
      SELLER,
      { spacesKey: KEY, fileName: 'o.csv' },
      { type: ActorType.SELLER, sellerId: SELLER },
    );
    expect(bulkCreate).toHaveBeenCalledTimes(1);
    expect(queue.enqueueProcess).toHaveBeenCalledWith({
      uploadId: 'u1',
      mapping: expect.any(Object),
    });
    expect(bulkUpdate).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { jobId: 'job-1' } });
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(v.status).toBe(BulkUploadStatus.PENDING);
  });

  it('createAndEnqueue rejects when a required field is unmapped', async () => {
    const { svc } = makeService({ object: 'Product SKU,Quantity\nX,1\n' });
    await expect(
      svc.createAndEnqueue(
        SELLER,
        { spacesKey: KEY, fileName: 'o.csv' },
        { type: ActorType.SELLER },
      ),
    ).rejects.toMatchObject({ response: { code: 'MISSING_REQUIRED_MAPPING' } });
  });

  it('loadOwnedCsv rejects a foreign seller key', async () => {
    const { svc } = makeService();
    await expect(
      svc.preview(SELLER, { spacesKey: 'sellers/other/order-imports/x.csv' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('loadOwnedCsv rejects a malformed key', async () => {
    const { svc } = makeService();
    await expect(svc.preview(SELLER, { spacesKey: 'not/a/csv/key' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('loadOwnedCsv 400s when the object is absent', async () => {
    const { svc } = makeService({ object: null });
    await expect(svc.preview(SELLER, { spacesKey: KEY })).rejects.toMatchObject({
      response: { code: 'OBJECT_NOT_FOUND' },
    });
  });

  // ── the pre-import stock check (owner, 2026-11-09) ──────────────────

  it('preview carries the stock check straight through', async () => {
    const check = oversellCheck(false);
    const { svc } = makeService({ stockCheck: check });
    const p = await svc.preview(SELLER, { spacesKey: KEY });
    expect(p.stockCheck).toEqual(check);
  });

  it('preview reports no stock check when nothing oversells', async () => {
    const { svc } = makeService();
    const p = await svc.preview(SELLER, { spacesKey: KEY });
    expect(p.stockCheck).toBeNull();
  });

  it('WARNING: with the setting off an oversell does not stop the import', async () => {
    const { svc, queue, settings } = makeService({ stockCheck: oversellCheck(false) });
    await svc.createAndEnqueue(
      SELLER,
      { spacesKey: KEY, fileName: 'o.csv' },
      { type: ActorType.SELLER, sellerId: SELLER },
    );
    expect(queue.enqueueProcess).toHaveBeenCalledTimes(1);
    expect(settings.setOverride).not.toHaveBeenCalled();
  });

  it('REFUSAL: with the setting on the import does not run, and says both ways forward', async () => {
    const { svc, queue, bulkCreate, settings } = makeService({ stockCheck: oversellCheck(true) });
    await expect(
      svc.createAndEnqueue(
        SELLER,
        { spacesKey: KEY, fileName: 'o.csv' },
        { type: ActorType.SELLER, sellerId: SELLER },
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'IMPORT_OVERSELLS_HELD_STOCK',
        message: oversellCheck(true).message,
      },
    });
    // Nothing was enqueued and no upload row exists: the refusal lands
    // before the job does.
    expect(bulkCreate).not.toHaveBeenCalled();
    expect(queue.enqueueProcess).not.toHaveBeenCalled();
    expect(settings.setOverride).not.toHaveBeenCalled();
  });

  it('PROCEED: writes the seller override to false BEFORE importing', async () => {
    const { svc, queue, settings } = makeService({ stockCheck: oversellCheck(true) });
    const order: string[] = [];
    settings.setOverride.mockImplementation(async () => {
      order.push('setting');
      return {};
    });
    queue.enqueueProcess.mockImplementation(async () => {
      order.push('import');
      return 'job-1';
    });

    await svc.createAndEnqueue(
      SELLER,
      { spacesKey: KEY, fileName: 'o.csv', switchToConfirmationHold: true },
      { type: ActorType.SELLER, sellerId: SELLER },
    );

    expect(order).toEqual(['setting', 'import']);
    expect(settings.setOverride).toHaveBeenCalledWith(
      SELLER,
      'inventory.early_reservation_enabled',
      expect.objectContaining({ valueType: 'BOOLEAN', value: false }),
      // The client's OWN override, written as the client — never a staff
      // id we invented, never the system-wide default row.
      { sellerActor: true },
    );
    /*
      ONE write, and the SYSTEM-WIDE default row is untouched. By
      construction as much as by assertion: the only settings writer this
      service can reach is the per-seller override (SET-1), and the prisma
      stub in this suite carries no `systemSetting` delegate at all — a
      global write would throw here rather than pass quietly.
    */
    expect(settings.setOverride).toHaveBeenCalledTimes(1);
  });

  it('PROCEED is ignored when the file does not oversell', async () => {
    const { svc, queue, settings } = makeService();
    await svc.createAndEnqueue(
      SELLER,
      { spacesKey: KEY, fileName: 'o.csv', switchToConfirmationHold: true },
      { type: ActorType.SELLER, sellerId: SELLER },
    );
    expect(settings.setOverride).not.toHaveBeenCalled();
    expect(queue.enqueueProcess).toHaveBeenCalledTimes(1);
  });

  it('CANCEL changes nothing: no setting write, no import', async () => {
    const { svc, queue, bulkCreate, settings } = makeService({ stockCheck: oversellCheck(true) });
    // Cancelling is not sending the request at all; the nearest thing the
    // service can be asked is the same file without the acknowledgement.
    await expect(
      svc.createAndEnqueue(
        SELLER,
        { spacesKey: KEY, fileName: 'o.csv', switchToConfirmationHold: false },
        { type: ActorType.SELLER, sellerId: SELLER },
      ),
    ).rejects.toMatchObject({ response: { code: 'IMPORT_OVERSELLS_HELD_STOCK' } });
    expect(settings.setOverride).not.toHaveBeenCalled();
    expect(bulkCreate).not.toHaveBeenCalled();
    expect(queue.enqueueProcess).not.toHaveBeenCalled();
  });

  it('getUpload 404s an unknown id', async () => {
    const { svc } = makeService({ upload: null });
    await expect(svc.getUpload(SELLER, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getErrorReport 404s when there is no report', async () => {
    const { svc } = makeService({
      upload: { id: 'u1', fileName: 'o.csv', errorReportKey: null },
    });
    await expect(svc.getErrorReport(SELLER, 'u1')).rejects.toMatchObject({
      response: { code: 'NO_ERROR_REPORT' },
    });
  });
});
