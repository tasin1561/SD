import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  CategoryService,
  FULL_PATH_SEPARATOR,
} from '../../src/modules/catalog-category/services/category.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { ClientContext } from '../../src/modules/seller-auth/seller-auth.service';

interface Cat {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  fullPath: string;
  depth: number;
  sortOrder: number;
  defaultPackageType: unknown;
  requiresFragile: boolean;
  requiresColdChain: boolean;
  defaultHsCode: string | null;
  defaultGstRate: unknown;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const CTX: ClientContext = { ipAddress: null, userAgent: null, requestId: null };

function makeSut(seed: Array<Partial<Cat> & Pick<Cat, 'id'>> = []) {
  let seq = 0;
  const rows: Cat[] = seed.map((s) => ({
    parentId: null,
    slug: s.id,
    name: s.id,
    fullPath: s.id,
    depth: 0,
    sortOrder: 0,
    defaultPackageType: null,
    requiresFragile: false,
    requiresColdChain: false,
    defaultHsCode: null,
    defaultGstRate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...s,
  }));

  const category = {
    findUnique: jest.fn(
      async ({ where }: { where: { slug?: string; id?: string } }) => {
        if (where.slug !== undefined) {
          return rows.find((r) => r.slug === where.slug) ?? null;
        }
        return rows.find((r) => r.id === where.id) ?? null;
      },
    ),
    findFirst: jest.fn(
      async ({ where }: { where: { id: string; deletedAt?: null } }) =>
        rows.find((r) => r.id === where.id && r.deletedAt === null) ?? null,
    ),
    findMany: jest.fn(async () => rows.filter((r) => r.deletedAt === null)),
    findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
      const r = rows.find((x) => x.id === where.id);
      if (!r) throw new Error('not found');
      return r;
    }),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row: Cat = {
        id: `cat-${++seq}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...(data as object),
      } as Cat;
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
    count: jest.fn(async ({ where }: { where: { parentId: string } }) =>
      rows.filter((r) => r.parentId === where.parentId && r.deletedAt === null).length,
    ),
  };
  const client = { category, product: { count: jest.fn(async () => 0) } };
  const clientWithTx = Object.assign(client, {
    $transaction: jest.fn(async (cb: (tx: typeof client) => unknown) => cb(client)),
  });
  const prisma = { client: clientWithTx } as unknown as PrismaService;
  const audit = { log: jest.fn(async () => 'a-1') } as unknown as AuditLogService;
  const svc = new CategoryService(prisma, audit);
  return { svc, rows };
}

describe('CategoryService — create computes depth + fullPath', () => {
  it('root category: depth 0, fullPath = name', async () => {
    const { svc } = makeSut();
    const c = await svc.create(
      { name: 'Electronics', slug: 'electronics' } as never,
      'staff-1',
      CTX,
    );
    expect(c.depth).toBe(0);
    expect(c.fullPath).toBe('Electronics');
  });

  it('child category derives depth + fullPath from its parent', async () => {
    const { svc } = makeSut([
      { id: 'root', name: 'Electronics', fullPath: 'Electronics', depth: 0 },
    ]);
    const child = await svc.create(
      { name: 'Phones', slug: 'phones', parentId: 'root' } as never,
      'staff-1',
      CTX,
    );
    expect(child.depth).toBe(1);
    expect(child.fullPath).toBe(`Electronics${FULL_PATH_SEPARATOR}Phones`);
  });

  it('createInTx rejects a taken slug and a missing parent', async () => {
    const { svc } = makeSut();
    const txSlugTaken = {
      category: {
        findUnique: async () => ({ id: 'existing' }),
        findFirst: async () => null,
        create: async () => ({}),
      },
    } as never;
    await expect(
      svc.createInTx(txSlugTaken, { name: 'X', slug: 'taken' }),
    ).rejects.toThrow(ConflictException);

    const txNoParent = {
      category: {
        findUnique: async () => null,
        findFirst: async () => null,
        create: async () => ({}),
      },
    } as never;
    await expect(
      svc.createInTx(txNoParent, { name: 'X', slug: 'fresh', parentId: 'ghost' }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('CategoryService — move + cycle prevention', () => {
  it('rejects making a category its own parent', async () => {
    const { svc } = makeSut([{ id: 'a' }]);
    await expect(svc.move('a', 'a', 'staff-1', CTX)).rejects.toThrow(BadRequestException);
  });

  it('rejects moving a category under one of its own descendants', async () => {
    const { svc } = makeSut([
      { id: 'a', fullPath: 'a', depth: 0 },
      { id: 'b', parentId: 'a', fullPath: 'a > b', depth: 1 },
      { id: 'c', parentId: 'b', fullPath: 'a > b > c', depth: 2 },
    ]);
    await expect(svc.move('a', 'c', 'staff-1', CTX)).rejects.toThrow(BadRequestException);
  });

  it('valid move recomputes fullPath + depth for the node and its subtree', async () => {
    const { svc, rows } = makeSut([
      { id: 'a', name: 'A', fullPath: 'A', depth: 0 },
      { id: 'b', name: 'B', fullPath: 'B', depth: 0 },
      { id: 'b1', name: 'B1', parentId: 'b', fullPath: `B${FULL_PATH_SEPARATOR}B1`, depth: 1 },
    ]);
    await svc.move('b', 'a', 'staff-1', CTX);
    const b = rows.find((r) => r.id === 'b')!;
    const b1 = rows.find((r) => r.id === 'b1')!;
    expect(b.depth).toBe(1);
    expect(b.fullPath).toBe(`A${FULL_PATH_SEPARATOR}B`);
    expect(b1.depth).toBe(2);
    expect(b1.fullPath).toBe(`A${FULL_PATH_SEPARATOR}B${FULL_PATH_SEPARATOR}B1`);
  });
});

describe('CategoryService — ancestor / descendant traversal', () => {
  const tree = [
    { id: 'root', parentId: null },
    { id: 'mid', parentId: 'root' },
    { id: 'leaf', parentId: 'mid' },
    { id: 'leaf2', parentId: 'mid' },
  ];

  it('getAncestorChainIds is root-first and includes the category itself', async () => {
    const { svc } = makeSut(tree);
    expect(await svc.getAncestorChainIds('leaf')).toEqual(['root', 'mid', 'leaf']);
  });

  it('getAncestorChainIds throws for an unknown category', async () => {
    const { svc } = makeSut(tree);
    await expect(svc.getAncestorChainIds('ghost')).rejects.toThrow(NotFoundException);
  });

  it('getDescendantIds excludes the category itself and includes all nested', async () => {
    const { svc } = makeSut(tree);
    expect((await svc.getDescendantIds('root')).sort()).toEqual(
      ['leaf', 'leaf2', 'mid'].sort(),
    );
    expect(await svc.getDescendantIds('leaf')).toEqual([]);
  });
});
