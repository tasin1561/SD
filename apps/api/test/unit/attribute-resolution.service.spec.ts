import { AttributeValueType } from '@skydrop/db';
import { AttributeResolutionService } from '../../src/modules/catalog-attribute/services/attribute-resolution.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { RedisService } from '../../src/infrastructure/redis/redis.service';
import type { CategoryService } from '../../src/modules/catalog-category/services/category.service';

interface DefRow {
  categoryId: string;
  attributeKey: string;
  displayLabel: string;
  valueType: AttributeValueType;
  allowedValues: string[];
  isRequired: boolean;
  displayOrder: number;
}

function makeSut(opts: {
  // ancestor chain root-first per categoryId
  chains: Record<string, string[]>;
  defs: DefRow[];
}) {
  const store = new Map<string, string>();
  const redisClient = {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    }),
    del: jest.fn(async (...keys: string[]) => {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    }),
  };
  const redis = { client: redisClient } as unknown as RedisService;

  const prismaClient = {
    categoryAttributeDefinition: {
      findMany: jest.fn(async (args: { where: { categoryId: { in: string[] } } }) => {
        const ids = new Set(args.where.categoryId.in);
        return opts.defs.filter((d) => ids.has(d.categoryId));
      }),
    },
  };
  const prisma = { client: prismaClient } as unknown as PrismaService;

  const categories = {
    getAncestorChainIds: jest.fn(async (categoryId: string) => {
      const chain = opts.chains[categoryId];
      if (!chain) {
        const e = new Error('CATEGORY_NOT_FOUND');
        throw e;
      }
      return chain;
    }),
    getDescendantIds: jest.fn(async (categoryId: string) => {
      // derive descendants from chains: any category whose chain contains categoryId (excluding itself)
      const out: string[] = [];
      for (const [cat, chain] of Object.entries(opts.chains)) {
        if (cat !== categoryId && chain.includes(categoryId)) out.push(cat);
      }
      return out;
    }),
  } as unknown as CategoryService;

  const svc = new AttributeResolutionService(prisma, redis, categories);
  return { svc, redisClient, prismaClient, store };
}

const def = (over: Partial<DefRow> & Pick<DefRow, 'categoryId' | 'attributeKey'>): DefRow => ({
  displayLabel: over.attributeKey,
  valueType: AttributeValueType.STRING,
  allowedValues: [],
  isRequired: false,
  displayOrder: 100,
  ...over,
});

describe('AttributeResolutionService — inheritance', () => {
  it('an attribute defined on the parent appears on the child', async () => {
    const sut = makeSut({
      chains: { parent: ['parent'], child: ['parent', 'child'] },
      defs: [def({ categoryId: 'parent', attributeKey: 'color' })],
    });
    const effective = await sut.svc.resolveEffectiveAttributes('child');
    expect(effective.map((a) => a.attributeKey)).toEqual(['color']);
    expect(effective[0]!.sourceCategoryId).toBe('parent');
  });

  it('a child override wins over the parent for the same attributeKey', async () => {
    const sut = makeSut({
      chains: { child: ['parent', 'child'] },
      defs: [
        def({
          categoryId: 'parent',
          attributeKey: 'size',
          valueType: AttributeValueType.STRING,
          isRequired: false,
        }),
        def({
          categoryId: 'child',
          attributeKey: 'size',
          valueType: AttributeValueType.ENUM,
          allowedValues: ['S', 'M', 'L'],
          isRequired: true,
        }),
      ],
    });
    const effective = await sut.svc.resolveEffectiveAttributes('child');
    expect(effective).toHaveLength(1);
    const size = effective[0]!;
    expect(size.sourceCategoryId).toBe('child');
    expect(size.valueType).toBe(AttributeValueType.ENUM);
    expect(size.allowedValues).toEqual(['S', 'M', 'L']);
    expect(size.isRequired).toBe(true);
  });

  it('union across 3 levels; deepest wins; result is displayOrder-sorted', async () => {
    const sut = makeSut({
      chains: { leaf: ['root', 'mid', 'leaf'] },
      defs: [
        def({ categoryId: 'root', attributeKey: 'material', displayOrder: 10 }),
        def({ categoryId: 'mid', attributeKey: 'color', displayOrder: 30 }),
        def({ categoryId: 'leaf', attributeKey: 'size', displayOrder: 20 }),
        def({ categoryId: 'root', attributeKey: 'color', displayOrder: 99 }), // overridden by mid
      ],
    });
    const effective = await sut.svc.resolveEffectiveAttributes('leaf');
    expect(effective.map((a) => a.attributeKey)).toEqual(['material', 'size', 'color']);
    expect(effective.find((a) => a.attributeKey === 'color')!.sourceCategoryId).toBe('mid');
  });

  it('second resolve is served from cache (no second DB read)', async () => {
    const sut = makeSut({
      chains: { c: ['c'] },
      defs: [def({ categoryId: 'c', attributeKey: 'x' })],
    });
    await sut.svc.resolveEffectiveAttributes('c');
    await sut.svc.resolveEffectiveAttributes('c');
    expect(sut.prismaClient.categoryAttributeDefinition.findMany).toHaveBeenCalledTimes(1);
  });

  it('invalidate clears the category AND its descendants', async () => {
    const sut = makeSut({
      chains: { parent: ['parent'], child: ['parent', 'child'] },
      defs: [def({ categoryId: 'parent', attributeKey: 'color' })],
    });
    await sut.svc.resolveEffectiveAttributes('parent');
    await sut.svc.resolveEffectiveAttributes('child');
    expect(sut.store.size).toBe(2);

    await sut.svc.invalidate('parent');
    expect(sut.store.has('catalog:attrs:effective:parent')).toBe(false);
    expect(sut.store.has('catalog:attrs:effective:child')).toBe(false);
  });
});
