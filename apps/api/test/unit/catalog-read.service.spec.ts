import { Prisma, VariantStatus } from '@skydrop/db';
import { CatalogReadService } from '../../src/modules/catalog-read/services/catalog-read.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const dec = (n: string | number): Prisma.Decimal => new Prisma.Decimal(n);

interface ProductShape {
  name: string;
  deletedAt: Date | null;
  defaultWeightGrams: number | null;
  defaultLengthCm: Prisma.Decimal | null;
  defaultWidthCm: Prisma.Decimal | null;
  defaultHeightCm: Prisma.Decimal | null;
  defaultDeclaredValueInr: Prisma.Decimal | null;
  defaultHsCode: string | null;
}
interface VariantShape {
  id: string;
  productId: string;
  sellerId: string;
  skuCode: string;
  variantLabel: string | null;
  status: VariantStatus;
  attributes: unknown;
  weightGrams: number | null;
  lengthCm: Prisma.Decimal | null;
  widthCm: Prisma.Decimal | null;
  heightCm: Prisma.Decimal | null;
  declaredValueInr: Prisma.Decimal | null;
  hsCode: string | null;
  gstRate: Prisma.Decimal | null;
  deletedAt: Date | null;
  images: { url: string; isPrimary: boolean; displayOrder: number }[];
  product: ProductShape;
}

function product(over: Partial<ProductShape> = {}): ProductShape {
  return {
    name: 'Product',
    deletedAt: null,
    defaultWeightGrams: null,
    defaultLengthCm: null,
    defaultWidthCm: null,
    defaultHeightCm: null,
    defaultDeclaredValueInr: null,
    defaultHsCode: null,
    ...over,
  };
}
function variant(over: Partial<VariantShape> & Pick<VariantShape, 'id'>): VariantShape {
  return {
    productId: 'p1',
    sellerId: 's1',
    skuCode: 'SKU',
    variantLabel: null,
    status: VariantStatus.ACTIVE,
    attributes: null,
    weightGrams: null,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    declaredValueInr: null,
    hsCode: null,
    gstRate: null,
    deletedAt: null,
    images: [],
    product: product(),
    ...over,
  };
}

function makeSut(
  variants: VariantShape[],
  gst?: { valueDecimal?: Prisma.Decimal | null; valueInt?: number | null },
) {
  const findMany = jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
    variants.filter(
      (v) => where.id.in.includes(v.id) && v.deletedAt === null && v.product.deletedAt === null,
    ),
  );
  const findUnique = jest.fn(async () => gst ?? { valueDecimal: dec('18.00'), valueInt: null });
  const prisma = {
    client: {
      productVariant: { findMany },
      systemSetting: { findUnique },
    },
  } as unknown as PrismaService;
  const svc = new CatalogReadService(prisma);
  return { svc, findMany, findUnique };
}

describe('CatalogReadService — property inheritance precedence', () => {
  it('variant value wins over the product default', async () => {
    const { svc } = makeSut([
      variant({
        id: 'v1',
        weightGrams: 500,
        hsCode: 'V-HS',
        gstRate: dec('12'),
        product: product({
          defaultWeightGrams: 999,
          defaultHsCode: 'P-HS',
        }),
      }),
    ]);
    const r = (await svc.getVariantById('v1'))!;
    expect(r.weightGrams).toBe(500);
    expect(r.hsCode).toBe('V-HS');
    expect(r.gstRate.toString()).toBe('12');
  });

  it('falls to the product for hsCode; gst falls to the system default', async () => {
    const { svc } = makeSut([
      variant({
        id: 'v1',
        product: product({
          defaultWeightGrams: 777,
          defaultHsCode: 'P-HS',
        }),
      }),
    ]);
    const r = (await svc.getVariantById('v1'))!;
    expect(r.weightGrams).toBe(777); // product default
    expect(r.hsCode).toBe('P-HS'); // product default
    expect(r.gstRate.toString()).toBe('18'); // system_settings default
  });

  it('uses valueInt when the GST setting has no decimal', async () => {
    const { svc } = makeSut([variant({ id: 'v1' })], { valueDecimal: null, valueInt: 20 });
    const r = (await svc.getVariantById('v1'))!;
    expect(r.gstRate.toString()).toBe('20');
  });
});

describe('CatalogReadService — batch + safety', () => {
  it('resolves many ids with ONE variant query (no N+1)', async () => {
    const { svc, findMany, findUnique } = makeSut([
      variant({ id: 'v1' }),
      variant({ id: 'v2' }),
      variant({ id: 'v3' }),
    ]);
    const map = await svc.getVariantsByIds(['v1', 'v2', 'v3', 'v1']);
    expect(map.size).toBe(3);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('omits soft-deleted variants and variants of soft-deleted products', async () => {
    const { svc } = makeSut([
      variant({ id: 'v1' }),
      variant({ id: 'v2', deletedAt: new Date() }),
      variant({ id: 'v3', product: product({ deletedAt: new Date() }) }),
    ]);
    const map = await svc.getVariantsByIds(['v1', 'v2', 'v3']);
    expect([...map.keys()]).toEqual(['v1']);
  });

  it('returns frozen objects with a frozen attributes map', async () => {
    const { svc } = makeSut([variant({ id: 'v1', attributes: { color: 'Red' } })]);
    const r = (await svc.getVariantById('v1'))!;
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.attributes)).toBe(true);
    expect(r.attributes).toEqual({ color: 'Red' });
  });
});
