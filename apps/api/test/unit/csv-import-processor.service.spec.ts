import Papa from 'papaparse';
import { BulkUploadStatus } from '@skydrop/db';
import { CsvImportProcessorService } from '../../src/modules/catalog-csv-import/services/csv-import-processor.service';
import { CsvParserService } from '../../src/modules/catalog-csv-import/services/csv-parser.service';
import { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { EnvService } from '../../src/config/env.service';
import { makeTestEnv } from '../helpers/env';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SpacesService } from '../../src/infrastructure/spaces/spaces.service';
import type { CsvTargetField } from '../../src/modules/catalog-csv-import/csv-fields';

function makeEnv(): EnvService {
  return makeTestEnv();
}

interface ProductRow {
  id: string;
  sellerId: string;
  name: string;
  externalRef: string | null;
  defaultHsCode: string | null;
  deletedAt: Date | null;
}
interface VariantRow {
  id: string;
  productId: string;
  sellerId: string;
  skuCode: string;
  attributes: unknown;
  weightGrams: number | null;
  hsCode: string | null;
  barcode: string | null;
  deletedAt: Date | null;
}

function makeSut(csvByKey: Record<string, string>) {
  const products: ProductRow[] = [];
  const variants: VariantRow[] = [];
  const bulk = new Map<string, Record<string, unknown>>();
  const putObjects: Record<string, Buffer> = {};
  let pSeq = 0;
  let vSeq = 0;

  const client = {
    bulkProductUpload: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const b = bulk.get(where.id);
        return b ? { ...b } : null;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const b = bulk.get(where.id) ?? {};
          Object.assign(b, data);
          bulk.set(where.id, b);
          return { ...b };
        },
      ),
    },
    product: {
      findFirst: jest.fn(
        async ({ where }: { where: { sellerId: string; externalRef?: string } }) =>
          products.find(
            (p) =>
              p.sellerId === where.sellerId &&
              p.deletedAt === null &&
              (where.externalRef === undefined || p.externalRef === where.externalRef),
          ) ?? null,
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const p = products.find((x) => x.id === where.id);
        if (!p) throw new Error('product not found');
        return p;
      }),
      create: jest.fn(async ({ data }: { data: Omit<ProductRow, 'id' | 'deletedAt'> }) => {
        const row: ProductRow = { id: `p-${++pSeq}`, deletedAt: null, ...data };
        products.push(row);
        return { id: row.id };
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const p = products.find((x) => x.id === where.id);
          if (p) Object.assign(p, data);
          return p;
        },
      ),
    },
    productVariant: {
      findFirst: jest.fn(
        async ({ where }: { where: { sellerId: string; skuCode: string } }) =>
          variants.find(
            (v) =>
              v.sellerId === where.sellerId && v.skuCode === where.skuCode && v.deletedAt === null,
          ) ?? null,
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const v = variants.find((x) => x.id === where.id);
        if (!v) throw new Error('variant not found');
        return v;
      }),
      create: jest.fn(async ({ data }: { data: Omit<VariantRow, 'id' | 'deletedAt'> }) => {
        const row: VariantRow = { id: `v-${++vSeq}`, deletedAt: null, ...data };
        variants.push(row);
        return { id: row.id };
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const v = variants.find((x) => x.id === where.id);
          if (v) Object.assign(v, data);
          return v;
        },
      ),
    },
    auditLog: { create: jest.fn(async () => ({ id: 'a-1' })) },
  };
  // Attach $transaction after the literal so it can reference `client`
  // without a self-referential type-inference cycle.
  const clientWithTx = Object.assign(client, {
    $transaction: jest.fn(async (cb: (tx: typeof client) => unknown) => cb(client)),
  });

  const prisma = { client: clientWithTx } as unknown as PrismaService;
  const spaces = {
    getObject: jest.fn(async (key: string) =>
      csvByKey[key] ? Buffer.from(csvByKey[key], 'utf8') : null,
    ),
    putObject: jest.fn(async (key: string, body: Buffer) => {
      putObjects[key] = body;
    }),
  } as unknown as SpacesService;
  const svc = new CsvImportProcessorService(
    prisma,
    spaces,
    makeEnv(),
    new AuditLogService(prisma),
    new CsvParserService(),
  );
  return { svc, products, variants, bulk, putObjects };
}

const MAPPING: Partial<Record<CsvTargetField, string>> = {
  productName: 'Product Name',
  productExternalRef: 'Product ID',
  variantSkuCode: 'SKU',
};

function seedUpload(sut: ReturnType<typeof makeSut>, id: string, key: string): void {
  sut.bulk.set(id, {
    id,
    sellerId: 'seller-1',
    spacesKey: key,
    status: BulkUploadStatus.PENDING,
  });
}

describe('CsvImportProcessorService — idempotent re-upload', () => {
  const CSV = 'Product Name,Product ID,SKU\nWidget,P1,S1\nGadget,P2,S2\n';
  const K1 = 'sellers/seller-1/csv-imports/aaa.csv';
  const K2 = 'sellers/seller-1/csv-imports/bbb.csv';

  it('first run creates; identical second run skips every row', async () => {
    const sut = makeSut({ [K1]: CSV, [K2]: CSV });

    seedUpload(sut, 'u1', K1);
    await sut.svc.process('u1', MAPPING);
    const r1 = sut.bulk.get('u1')!;
    expect(r1.status).toBe(BulkUploadStatus.COMPLETED);
    expect(r1.productsCreated).toBe(2);
    expect(r1.variantsCreated).toBe(2);
    expect(r1.rowsSkipped).toBe(0);
    expect(r1.rowsFailed).toBe(0);

    seedUpload(sut, 'u2', K2);
    await sut.svc.process('u2', MAPPING);
    const r2 = sut.bulk.get('u2')!;
    expect(r2.status).toBe(BulkUploadStatus.COMPLETED);
    expect(r2.productsCreated).toBe(0);
    expect(r2.variantsCreated).toBe(0);
    expect(r2.rowsSkipped).toBe(2);
    expect(sut.products).toHaveLength(2);
    expect(sut.variants).toHaveLength(2);
  });

  it('a re-delivered job for an already-terminal upload is a no-op', async () => {
    const sut = makeSut({ [K1]: CSV });
    sut.bulk.set('u1', {
      id: 'u1',
      sellerId: 'seller-1',
      spacesKey: K1,
      status: BulkUploadStatus.COMPLETED,
    });
    await sut.svc.process('u1', MAPPING);
    expect(sut.products).toHaveLength(0);
  });
});

describe('CsvImportProcessorService — partial success + error report', () => {
  it('imports valid rows, writes an error CSV for the bad one, COMPLETED_WITH_ERRORS', async () => {
    const CSV = 'Product Name,Product ID,SKU\nWidget,P1,S1\n,P2,S2\nGadget,P3,S3\n';
    const KEY = 'sellers/seller-1/csv-imports/ccc.csv';
    const ERR = 'sellers/seller-1/csv-imports/ccc.errors.csv';
    const sut = makeSut({ [KEY]: CSV });
    seedUpload(sut, 'u1', KEY);

    await sut.svc.process('u1', MAPPING);
    const r = sut.bulk.get('u1')!;
    expect(r.status).toBe(BulkUploadStatus.COMPLETED_WITH_ERRORS);
    expect(r.productsCreated).toBe(2);
    expect(r.variantsCreated).toBe(2);
    expect(r.rowsFailed).toBe(1);
    expect(r.errorReportKey).toBe(ERR);

    const csv = sut.putObjects[ERR]!.toString('utf8');
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
    expect(parsed.meta.fields).toEqual([
      'row_number',
      'error_field',
      'error_reason',
      'Product Name',
      'Product ID',
      'SKU',
    ]);
    expect(parsed.data).toHaveLength(1);
    const errRow = parsed.data[0]!;
    expect(errRow.row_number).toBe('3'); // header line 1 + 2nd data row
    expect(errRow.error_field).toBe('productName');
    expect(errRow.error_reason).toMatch(/productName is required/);
    expect(errRow['SKU']).toBe('S2');
  });

  it('all rows failing → status FAILED', async () => {
    const CSV = 'Product Name,Product ID,SKU\n,P1,\n,P2,\n';
    const KEY = 'sellers/seller-1/csv-imports/ddd.csv';
    const sut = makeSut({ [KEY]: CSV });
    seedUpload(sut, 'u1', KEY);
    await sut.svc.process('u1', MAPPING);
    expect(sut.bulk.get('u1')!.status).toBe(BulkUploadStatus.FAILED);
  });
});
