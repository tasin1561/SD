import { CsvImportService } from '../../src/modules/catalog-csv-import/services/csv-import.service';
import { CsvParserService } from '../../src/modules/catalog-csv-import/services/csv-parser.service';
import { OrderCsvImportService } from '../../src/modules/order-csv-import/services/order-csv-import.service';
import { OrderCsvParserService } from '../../src/modules/order-csv-import/services/order-csv-parser.service';
import type { EnvService } from '../../src/config/env.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * A CSV is refused on its SIZE before it is downloaded.
 *
 * `CSV_MAX_ROWS` is judged after parsing, so the whole object was
 * buffered and fully parsed before anything could say it was too big —
 * in the process that serves HTTP and runs all 17 BullMQ workers
 * (SCALE-1), which means an out-of-memory here is a full API outage.
 * `headObject` was already called and its `size` read as an existence
 * check only.
 *
 * The property that matters is not just the 400: it is that `getObject`
 * is NEVER reached, so the bytes never enter the process at all.
 */
const SELLER = 's1';
const MAX_BYTES = 8_388_608;

function env(): EnvService {
  return {
    csvPresignTtlSeconds: 900,
    csvMaxRows: 1000,
    csvMaxBytes: MAX_BYTES,
  } as unknown as EnvService;
}

function spacesWithSize(size: number, body: string) {
  return {
    presignPutUrl: jest.fn(async () => 'https://signed/put'),
    headObject: jest.fn(async () => ({ size })),
    getObject: jest.fn(async () => Buffer.from(body, 'utf8')),
  };
}

describe('catalog CSV import — CSV_MAX_BYTES', () => {
  const KEY = `sellers/${SELLER}/csv-imports/tok-1.csv`;
  const CSV = 'Product Name,Variant SKU\nWidget,SKU-1\n';

  function make(size: number) {
    const spaces = spacesWithSize(size, CSV);
    const svc = new CsvImportService(
      env(),
      { client: { bulkProductUpload: { create: jest.fn() } } } as unknown as PrismaService,
      spaces as never,
      new CsvParserService(),
      { log: jest.fn(async () => 'a1') } as never,
      { enqueueProcess: jest.fn(async () => 'job-1') } as never,
      { listForSeller: jest.fn(async () => []) } as never,
    );
    return { svc, spaces };
  }

  it('refuses an oversized object WITHOUT downloading it', async () => {
    const { svc, spaces } = make(MAX_BYTES + 1);

    await expect(svc.loadOwnedCsv(SELLER, KEY)).rejects.toMatchObject({
      response: {
        code: 'CSV_TOO_LARGE',
        message: `Uploaded CSV is ${MAX_BYTES + 1} bytes; the limit is ${MAX_BYTES}`,
      },
    });

    // The bytes never entered the process — that is the fix, not the 400.
    expect(spaces.headObject).toHaveBeenCalledTimes(1);
    expect(spaces.getObject).not.toHaveBeenCalled();
  });

  it('allows an object exactly at the limit', async () => {
    const { svc, spaces } = make(MAX_BYTES);
    await expect(svc.loadOwnedCsv(SELLER, KEY)).resolves.toBeInstanceOf(Buffer);
    expect(spaces.getObject).toHaveBeenCalledTimes(1);
  });
});

describe('order CSV import — CSV_MAX_BYTES', () => {
  const KEY = `sellers/${SELLER}/order-imports/tok-1.csv`;
  const CSV =
    'Product SKU,Quantity,Customer Name,Customer Phone,Address Line1,Address Line2,City,State,Pin Code,External Ref\n' +
    'SKU-1,2,Asha,+919876543210,12 MG Road,Near City Hospital,Bengaluru,Karnataka,560001,EXT-1\n';

  function make(size: number) {
    const spaces = spacesWithSize(size, CSV);
    const svc = new OrderCsvImportService(
      env(),
      { client: { bulkOrderUpload: { create: jest.fn() } } } as unknown as PrismaService,
      spaces as never,
      new OrderCsvParserService(),
      { log: jest.fn(async () => 'a1') } as never,
      { enqueueProcess: jest.fn(async () => 'job-1') } as never,
    );
    return { svc, spaces };
  }

  it('refuses an oversized object WITHOUT downloading it', async () => {
    const { svc, spaces } = make(MAX_BYTES + 1);

    await expect(svc.loadOwnedCsv(SELLER, KEY)).rejects.toMatchObject({
      response: { code: 'CSV_TOO_LARGE' },
    });

    expect(spaces.headObject).toHaveBeenCalledTimes(1);
    expect(spaces.getObject).not.toHaveBeenCalled();
  });

  it('allows an object exactly at the limit', async () => {
    const { svc, spaces } = make(MAX_BYTES);
    await expect(svc.loadOwnedCsv(SELLER, KEY)).resolves.toBeInstanceOf(Buffer);
    expect(spaces.getObject).toHaveBeenCalledTimes(1);
  });
});
