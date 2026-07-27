import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { CsvImportType } from '@skydrop/db';
import { CsvMappingService } from '../../src/modules/catalog-csv-import/services/csv-mapping.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { ClientContext } from '../../src/modules/seller-auth/seller-auth.service';

interface MappingRow {
  id: string;
  sellerId: string;
  name: string;
  importType: CsvImportType;
  columnMap: unknown;
  isDefault: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const CTX: ClientContext = { ipAddress: null, userAgent: null, requestId: null };

function makeSut() {
  const rows: MappingRow[] = [];
  let seq = 0;
  const match = (r: MappingRow, w: Record<string, unknown>): boolean =>
    Object.entries(w).every(([k, v]) => {
      if (k === 'id' && v && typeof v === 'object' && 'not' in v) {
        return r.id !== (v as { not: string }).not;
      }
      return (r as unknown as Record<string, unknown>)[k] === v;
    });

  const client = {
    sellerCsvMapping: {
      findFirst: jest.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          rows.find((r) => match(r, where)) ?? null,
      ),
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        rows.filter((r) => match(r, where)),
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: MappingRow = {
          id: `m-${++seq}`,
          lastUsedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          isDefault: false,
          ...(data as object),
        } as MappingRow;
        rows.push(row);
        return { ...row };
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const r = rows.find((x) => x.id === where.id);
          if (r) Object.assign(r, data);
          return r ? { ...r } : null;
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const r of rows) {
            if (match(r, where)) {
              Object.assign(r, data);
              count += 1;
            }
          }
          return { count };
        },
      ),
    },
  };
  const clientWithTx = Object.assign(client, {
    $transaction: jest.fn(async (cb: (tx: typeof client) => unknown) => cb(client)),
  });
  const prisma = { client: clientWithTx } as unknown as PrismaService;
  const audit = { log: jest.fn(async () => 'a-1') } as unknown as AuditLogService;
  const svc = new CsvMappingService(prisma, audit);
  return { svc, rows };
}

describe('CsvMappingService — sanitize columnMap', () => {
  it('rejects unknown target-field keys', async () => {
    const { svc } = makeSut();
    await expect(
      svc.create('s1', { name: 'm', columnMap: { notAField: 'X' } }, CTX),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects non-string / empty header values and empty maps', async () => {
    const { svc } = makeSut();
    await expect(
      svc.create('s1', { name: 'm', columnMap: { productName: '' } }, CTX),
    ).rejects.toThrow(/non-empty header/);
    await expect(svc.create('s1', { name: 'm', columnMap: {} }, CTX)).rejects.toThrow(
      /at least one field/,
    );
  });
});

describe('CsvMappingService — single default per (seller, importType)', () => {
  it('creating a default unsets a prior default', async () => {
    const { svc, rows } = makeSut();
    const a = await svc.create(
      's1',
      { name: 'A', columnMap: { productName: 'Title' }, isDefault: true },
      CTX,
    );
    await svc.create(
      's1',
      { name: 'B', columnMap: { variantSkuCode: 'SKU' }, isDefault: true },
      CTX,
    );
    const after = rows.find((r) => r.id === a.id)!;
    expect(after.isDefault).toBe(false);
    expect(rows.filter((r) => r.isDefault && r.deletedAt === null)).toHaveLength(1);
  });

  it('a default for a different seller is untouched', async () => {
    const { svc, rows } = makeSut();
    await svc.create(
      's2',
      { name: 'other', columnMap: { productName: 'P' }, isDefault: true },
      CTX,
    );
    await svc.create('s1', { name: 'mine', columnMap: { productName: 'P' }, isDefault: true }, CTX);
    expect(
      rows
        .filter((r) => r.isDefault)
        .map((r) => r.sellerId)
        .sort(),
    ).toEqual(['s1', 's2']);
  });
});

describe('CsvMappingService — resolve / markUsed / delete', () => {
  it('resolveColumnMap returns the saved map; 404 for a foreign id', async () => {
    const { svc } = makeSut();
    const m = await svc.create(
      's1',
      { name: 'm', columnMap: { productName: 'Title', variantSkuCode: 'SKU' } },
      CTX,
    );
    await expect(svc.resolveColumnMap('s1', m.id)).resolves.toEqual({
      productName: 'Title',
      variantSkuCode: 'SKU',
    });
    await expect(svc.resolveColumnMap('s2', m.id)).rejects.toThrow(NotFoundException);
  });

  it('markUsed bumps lastUsedAt', async () => {
    const { svc, rows } = makeSut();
    const m = await svc.create('s1', { name: 'm', columnMap: { productName: 'P' } }, CTX);
    expect(rows.find((r) => r.id === m.id)!.lastUsedAt).toBeNull();
    await svc.markUsed('s1', m.id);
    expect(rows.find((r) => r.id === m.id)!.lastUsedAt).toBeInstanceOf(Date);
  });

  it('softDelete clears the default flag and sets deletedAt', async () => {
    const { svc, rows } = makeSut();
    const m = await svc.create(
      's1',
      { name: 'm', columnMap: { productName: 'P' }, isDefault: true },
      CTX,
    );
    await svc.softDelete('s1', m.id, CTX);
    const row = rows.find((r) => r.id === m.id)!;
    expect(row.deletedAt).toBeInstanceOf(Date);
    expect(row.isDefault).toBe(false);
    await expect(svc.getById('s1', m.id)).rejects.toThrow(NotFoundException);
  });
});
