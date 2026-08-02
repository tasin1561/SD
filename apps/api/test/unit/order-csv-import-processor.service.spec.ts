import { BulkUploadStatus, OrderStatus } from '@skydrop/db';
import type { StagedOrderRowService } from '../../src/modules/order-csv-import/services/staged-order-row.service';
import { OrderCsvImportProcessorService } from '../../src/modules/order-csv-import/services/order-csv-import-processor.service';
import { OrderCsvParserService } from '../../src/modules/order-csv-import/services/order-csv-parser.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { EnvService } from '../../src/config/env.service';

type AnyArgs = Record<string, unknown>;

const HEADER =
  'Product SKU,Quantity,Customer Name,Customer Phone,Address Line1,City,State,Pin Code,COD Amount,External Ref';
const ROW = 'SKU-1,2,Asha,+919876543210,12 MG Road,Bengaluru,Karnataka,560001,999,EXT-1';

const parser = new OrderCsvParserService();
const MAPPING = parser.detectMapping(HEADER.split(',')).mapping;

function makeService(opts: {
  uploadStatus?: BulkUploadStatus;
  csv?: string;
  existing?: { id: string; status: OrderStatus } | null;
  variant?: AnyArgs | null;
}) {
  const csv = opts.csv ?? `${HEADER}\n${ROW}\n`;
  const findUnique = jest.fn(async () => ({
    id: 'u1',
    sellerId: 's1',
    spacesKey: 'sellers/s1/order-imports/t.csv',
    status: opts.uploadStatus ?? BulkUploadStatus.PENDING,
  }));
  const update = jest.fn(async () => ({ id: 'u1' }));
  const client = { bulkOrderUpload: { findUnique, update } };

  const spaces = {
    getObject: jest.fn(async () => Buffer.from(csv, 'utf8')),
    putObject: jest.fn(async () => undefined),
  };
  const env = { csvMaxRows: 1000 } as unknown as EnvService;
  const audit = { log: jest.fn(async () => 'a1') };
  const catalog = {
    getVariantBySku: jest.fn(async () =>
      opts.variant === undefined
        ? { variantId: 'v1', sellerId: 's1', skuCode: 'SKU-1' }
        : opts.variant,
    ),
  };
  const orders = {
    getBySellerOrderRef: jest.fn(async () => (opts.existing === undefined ? null : opts.existing)),
    create: jest.fn<Promise<{ id: string }>, unknown[]>(async () => ({ id: 'o1' })),
    applyBulkPatch: jest.fn(async () => 'PATCHED' as const),
  };

  const svc = new OrderCsvImportProcessorService(
    { client } as unknown as PrismaService,
    spaces as never,
    env,
    audit as never,
    parser,
    catalog as never,
    orders as never,
    // Staging is exercised in its own suite and end to end; here it
    // must not be able to fail the import loop.
    { stage: jest.fn(async () => undefined) } as unknown as StagedOrderRowService,
  );
  return { svc, findUnique, update, spaces, audit, catalog, orders };
}

function lastUpdateData(update: jest.Mock): AnyArgs {
  const calls = update.mock.calls as Array<[{ data: AnyArgs }]>;
  return calls[calls.length - 1]![0].data;
}

describe('OrderCsvImportProcessorService.process', () => {
  it('is idempotent against a re-delivered job for a terminal upload', async () => {
    const { svc, update } = makeService({ uploadStatus: BulkUploadStatus.COMPLETED });
    await svc.process('u1', MAPPING);
    expect(update).not.toHaveBeenCalled();
  });

  it('creates a new order in PENDING_CONFIRMATION for a fresh externalRef', async () => {
    const { svc, update, orders } = makeService({ existing: null });
    await svc.process('u1', MAPPING);
    expect(orders.create).toHaveBeenCalledTimes(1);
    const opts = orders.create.mock.calls[0]![4] as unknown as AnyArgs;
    expect(opts.initialStatus).toBe(OrderStatus.PENDING_CONFIRMATION);
    expect(opts.bulkUploadId).toBe('u1');
    const data = lastUpdateData(update);
    expect(data.status).toBe(BulkUploadStatus.COMPLETED);
    expect(data.ordersCreated).toBe(1);
  });

  it('PATCHes when externalRef matches a DRAFT/PENDING order', async () => {
    const { svc, update, orders } = makeService({
      existing: { id: 'o9', status: OrderStatus.PENDING_CONFIRMATION },
    });
    await svc.process('u1', MAPPING);
    expect(orders.applyBulkPatch).toHaveBeenCalledTimes(1);
    expect(orders.create).not.toHaveBeenCalled();
    expect(lastUpdateData(update).rowsSkipped).toBe(1);
  });

  it('errors (no silent update) when externalRef matches CONFIRMED+', async () => {
    const { svc, update, spaces } = makeService({
      existing: { id: 'o9', status: OrderStatus.CONFIRMED },
    });
    await svc.process('u1', MAPPING);
    const data = lastUpdateData(update);
    expect(data.rowsFailed).toBe(1);
    expect(data.status).toBe(BulkUploadStatus.FAILED); // only row failed
    expect(spaces.putObject).toHaveBeenCalledTimes(1); // error report written
  });

  it('writes an error row for an unresolvable SKU', async () => {
    const { svc, update } = makeService({ existing: null, variant: null });
    await svc.process('u1', MAPPING);
    expect(lastUpdateData(update).rowsFailed).toBe(1);
  });

  it('writes an error row for a row that fails coercion', async () => {
    const { svc, update } = makeService({
      csv: `${HEADER}\nSKU-1,notanumber,Asha,+91,Addr,City,State,560001,0,EXT-2\n`,
    });
    await svc.process('u1', MAPPING);
    expect(lastUpdateData(update).rowsFailed).toBe(1);
  });
});
