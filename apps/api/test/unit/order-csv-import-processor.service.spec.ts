import { BulkUploadStatus, OrderStatus } from '@skydrop/db';
import type { StagedOrderRowService } from '../../src/modules/order-csv-import/services/staged-order-row.service';
import { OrderCsvImportProcessorService } from '../../src/modules/order-csv-import/services/order-csv-import-processor.service';
import { OrderCsvParserService } from '../../src/modules/order-csv-import/services/order-csv-parser.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { EnvService } from '../../src/config/env.service';

type AnyArgs = Record<string, unknown>;

const HEADER =
  'Product SKU,Quantity,Customer Name,Customer Phone,Address Line1,Address Line2,City,State,Pin Code,COD Amount,External Ref';
const ROW =
  'SKU-1,2,Asha,+919876543210,12 MG Road,Near City Hospital,Bengaluru,Karnataka,560001,999,EXT-1';

const parser = new OrderCsvParserService();
const MAPPING = parser.detectMapping(HEADER.split(',')).mapping;

function makeService(opts: {
  uploadStatus?: BulkUploadStatus;
  csv?: string;
  existing?: { id: string; status: OrderStatus } | null;
  variant?: AnyArgs | null;
  /** RS-5 — a RESELLER STORE's upload rather than the seller's own. */
  store?: boolean;
  /** What `OrderService.edit` does with the patched row. */
  editThrows?: unknown;
}) {
  const csv = opts.csv ?? `${HEADER}\n${ROW}\n`;
  const findUnique = jest.fn(async () => ({
    id: 'u1',
    sellerId: 's1',
    spacesKey: 'sellers/s1/order-imports/t.csv',
    status: opts.uploadStatus ?? BulkUploadStatus.PENDING,
    resellerStoreId: opts.store === true ? 'store-1' : null,
    uploadedByStoreUserId: opts.store === true ? 'su-1' : null,
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
  const edit = jest.fn<Promise<{ id: string }>, unknown[]>(async () => {
    if (opts.editThrows !== undefined) throw opts.editThrows;
    return { id: 'o9' };
  });
  const orders = {
    getBySellerOrderRef: jest.fn(async () => (opts.existing === undefined ? null : opts.existing)),
    create: jest.fn<Promise<{ id: string }>, unknown[]>(async () => ({ id: 'o1' })),
    applyBulkPatch: jest.fn(async () => 'PATCHED' as const),
    edit,
  };

  const storeCreate = jest.fn<Promise<{ id: string }>, unknown[]>(async () => ({
    id: 'o-store',
  }));

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
    // RS-5: a store upload's rows are PLACED here; a repeat reference is
    // patched through `orders.edit` with the store's scope (2026-09-19).
    { create: storeCreate } as never,
  );
  return { svc, findUnique, update, spaces, audit, catalog, orders, storeCreate, edit };
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

/*
  ORD-9 FOR A RESELLER STORE'S UPLOAD (owner, 2026-09-19).

  A store's re-upload used to be an error row on every repeat reference,
  because the seller's patch path re-snapshots the line from the LIVE
  catalogue with no reseller terms on it. It now goes through
  `OrderService.edit` with the store's own scope — the same call the
  store's portal makes — so the line is re-termed under the ORDER's
  snapshot and the money is re-planned. These pin the ROUTING; what the
  re-term itself decides is that service's own concern.
*/
describe('OrderCsvImportProcessorService.process — a RESELLER STORE upload (RS-5)', () => {
  const STORE_HEADER = `${HEADER},Retail Price`;
  const storeMapping = (): Record<string, string> =>
    parser.detectMapping(STORE_HEADER.split(',')).mapping as Record<string, string>;

  it('a fresh reference PLACES the order as the store', async () => {
    const { svc, storeCreate, orders, update } = makeService({
      store: true,
      existing: null,
      csv: `${STORE_HEADER}\n${ROW},499\n`,
    });
    await svc.process('u1', storeMapping());
    expect(storeCreate).toHaveBeenCalledTimes(1);
    expect(orders.edit).not.toHaveBeenCalled();
    // The lookup is SCOPED to the store — a seller's own order under the
    // same reference must not be found, let alone patched.
    expect(orders.getBySellerOrderRef.mock.calls[0]![2]).toBe('store-1');
    expect(lastUpdateData(update).ordersCreated).toBe(1);
  });

  it('a row with NO Retail Price omits it, so the service applies the fallback', async () => {
    const { svc, storeCreate } = makeService({
      store: true,
      existing: null,
      csv: `${HEADER}\n${ROW}\n`,
    });
    await svc.process('u1', MAPPING);
    const dto = storeCreate.mock.calls[0]![1] as AnyArgs;
    const line = (dto['items'] as AnyArgs[])[0]!;
    // Absent, not zero: a 0 would price the goods at nothing and pass
    // every range check that has no minimum.
    expect(line).not.toHaveProperty('retailUnitPriceInr');
  });

  it('a repeat reference on an EDITABLE order is PATCHED through the store-scoped edit', async () => {
    const { svc, orders, storeCreate, update } = makeService({
      store: true,
      existing: { id: 'o9', status: OrderStatus.PENDING_CONFIRMATION },
      csv: `${STORE_HEADER}\n${ROW},520\n`,
    });
    await svc.process('u1', storeMapping());
    expect(storeCreate).not.toHaveBeenCalled();
    expect(orders.edit).toHaveBeenCalledTimes(1);
    const call = orders.edit.mock.calls[0]!;
    expect(call[0]).toBe('s1');
    expect(call[1]).toBe('o9');
    // As the STORE, in the store's scope — never as the seller, or the
    // order's own timeline would name the wrong party.
    expect(call[3]).toEqual({ type: 'STORE', id: 'su-1' });
    expect(call[5]).toEqual({ storeId: 'store-1' });
    // The selling price travels as the line's unit price — what a
    // reseller order's retail IS.
    const dto = call[2] as AnyArgs;
    expect((dto['items'] as AnyArgs[])[0]!['unitPriceInr']).toBe(520);
    // NEVER the seller's live-catalogue patch, which would strip the terms.
    expect(orders.applyBulkPatch).not.toHaveBeenCalled();
    expect(lastUpdateData(update).rowsSkipped).toBe(1);
  });

  it('a row with no Retail Price leaves the line’s own retail alone on a patch', async () => {
    const { svc, orders } = makeService({
      store: true,
      existing: { id: 'o9', status: OrderStatus.PENDING_CONFIRMATION },
      csv: `${HEADER}\n${ROW}\n`,
    });
    await svc.process('u1', MAPPING);
    const dto = orders.edit.mock.calls[0]![2] as AnyArgs;
    // Omitted, so the reterm keeps the retail the line was PLACED at.
    expect((dto['items'] as AnyArgs[])[0]!).not.toHaveProperty('unitPriceInr');
  });

  it('a row that changes nothing is NOT a failure — the same file twice is normal', async () => {
    const { svc, update } = makeService({
      store: true,
      existing: { id: 'o9', status: OrderStatus.PENDING_CONFIRMATION },
      csv: `${STORE_HEADER}\n${ROW},499\n`,
      editThrows: { response: { code: 'NOTHING_TO_UPDATE' } },
    });
    await svc.process('u1', storeMapping());
    const data = lastUpdateData(update);
    expect(data.rowsFailed).toBe(0);
    expect(data.rowsSkipped).toBe(1);
    expect(data.status).toBe(BulkUploadStatus.COMPLETED);
  });

  it('any OTHER refusal from the edit is an error row', async () => {
    const { svc, update, spaces } = makeService({
      store: true,
      existing: { id: 'o9', status: OrderStatus.PENDING_CONFIRMATION },
      csv: `${STORE_HEADER}\n${ROW},9999\n`,
      editThrows: Object.assign(new Error('out of range'), {
        response: { code: 'RETAIL_OUT_OF_RANGE' },
      }),
    });
    await svc.process('u1', storeMapping());
    expect(lastUpdateData(update).rowsFailed).toBe(1);
    expect(spaces.putObject).toHaveBeenCalledTimes(1);
  });

  it('a reference already CONFIRMED is an error row, never a patch', async () => {
    const { svc, orders, update } = makeService({
      store: true,
      existing: { id: 'o9', status: OrderStatus.CONFIRMED },
      csv: `${STORE_HEADER}\n${ROW},499\n`,
    });
    await svc.process('u1', storeMapping());
    expect(orders.edit).not.toHaveBeenCalled();
    expect(lastUpdateData(update).rowsFailed).toBe(1);
  });
});
