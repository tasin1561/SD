import { CatalogProductService } from '../../src/modules/catalog-product/services/catalog-product.service';

/** Owner, 2026-11-19: the product list shows every SKU a product has. */
function svc(products: Array<{ id: string; name: string }>, variants: unknown[]) {
  const productFind = jest.fn(async () => products);
  const variantFind = jest.fn(async () => variants);
  const s = Object.create(CatalogProductService.prototype) as CatalogProductService;
  (s as unknown as { prisma: unknown }).prisma = {
    client: {
      product: { findMany: productFind, count: jest.fn(async () => products.length) },
      productImage: { findMany: jest.fn(async () => []) },
      productVariant: { findMany: variantFind },
    },
  };
  return { s, productFind, variantFind };
}

describe('product list SKUs', () => {
  it('attaches every live SKU to its product in one query', async () => {
    const { s, variantFind } = svc(
      [
        { id: 'p1', name: 'Elite Collagen' },
        { id: 'p2', name: 'Aviator' },
      ],
      [
        { productId: 'p1', skuCode: 'Coffee', variantLabel: null, status: 'ACTIVE' },
        { productId: 'p2', skuCode: 'AV-BLK', variantLabel: 'Black', status: 'ACTIVE' },
        { productId: 'p2', skuCode: 'AV-GLD', variantLabel: 'Golden', status: 'DRAFT' },
      ],
    );
    const r = await s.list('seller-1', {} as never);
    expect(r.items.map((p) => p.skus?.map((x) => x.skuCode))).toEqual([
      ['Coffee'],
      ['AV-BLK', 'AV-GLD'],
    ]);
    expect(variantFind).toHaveBeenCalledTimes(1);
    expect(variantFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null, productId: { in: ['p1', 'p2'] } } }),
    );
  });

  it('a product with no variants gets an empty list', async () => {
    const { s } = svc([{ id: 'p1', name: 'X' }], []);
    expect((await s.list('seller-1', {} as never)).items[0]?.skus).toEqual([]);
  });

  it('search also matches a SKU, inside the seller scope', async () => {
    const { s, productFind } = svc([], []);
    await s.list('seller-1', { search: 'Coffee' } as never);
    const where = (productFind.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0]
      .where;
    expect(where.sellerId).toBe('seller-1');
    expect(JSON.stringify(where.OR)).toContain('"skuCode":{"contains":"Coffee"');
  });
});
