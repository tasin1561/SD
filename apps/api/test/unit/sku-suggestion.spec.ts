import {
  CatalogReadService,
  withSkuHint,
} from '../../src/modules/catalog-read/services/catalog-read.service';

/** Owner, 2026-11-19: a product NAME typed in the SKU column gets the real SKU suggested. */
function svc(rows: Array<{ skuCode: string; variantLabel: string | null; name: string }>) {
  const findMany = jest.fn(async () =>
    rows.map((r) => ({
      skuCode: r.skuCode,
      variantLabel: r.variantLabel,
      product: { name: r.name },
    })),
  );
  const s = Object.create(CatalogReadService.prototype) as CatalogReadService;
  (s as unknown as { prisma: unknown }).prisma = { client: { productVariant: { findMany } } };
  return { s, findMany };
}

describe('suggestSkus', () => {
  it('the screenshot case: product name typed, real SKU suggested', async () => {
    const { s, findMany } = svc([
      { skuCode: 'Coffee', variantLabel: null, name: 'Elite Collagen' },
    ]);
    expect(await s.suggestSkus('seller-1', 'Elite Collagen')).toEqual([
      { skuCode: 'Coffee', productName: 'Elite Collagen', variantLabel: null },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sellerId: 'seller-1', deletedAt: null }),
      }),
    );
  });

  it('a SKU typed with different case/spaces ranks first', async () => {
    const { s } = svc([
      { skuCode: 'ELITE-COLLAGEN-1', variantLabel: null, name: 'Collagen Max' },
      { skuCode: 'Coffee', variantLabel: null, name: 'Elite Collagen' },
    ]);
    const r = await s.suggestSkus('x', 'elite collagen 1');
    expect(r[0]?.skuCode).toBe('ELITE-COLLAGEN-1');
  });

  it('product name + variant label', async () => {
    const { s } = svc([
      { skuCode: 'AV-BLK', variantLabel: 'Black', name: 'Aviator' },
      { skuCode: 'AV-GLD', variantLabel: 'Golden', name: 'Aviator' },
    ]);
    expect((await s.suggestSkus('x', 'Aviator Golden')).map((r) => r.skuCode)).toEqual(['AV-GLD']);
  });

  it('nothing close, or blank input: no suggestion', async () => {
    const { s } = svc([{ skuCode: 'Coffee', variantLabel: null, name: 'Elite Collagen' }]);
    expect(await s.suggestSkus('x', 'Shampoo')).toEqual([]);
    expect(await s.suggestSkus('x', '  ')).toEqual([]);
  });

  it('at most three', async () => {
    const { s } = svc(
      ['A', 'B', 'C', 'D'].map((k) => ({ skuCode: k, variantLabel: k, name: 'Tea Pack' })),
    );
    expect(await s.suggestSkus('x', 'Tea')).toHaveLength(0); // under 4 chars: no "contains" guess
    expect(await s.suggestSkus('x', 'Tea Pack')).toHaveLength(3);
  });
});

describe('withSkuHint', () => {
  const base = 'Variant SKU "Elite Collagen" not found for this client';
  it('keeps the base words and appends the hint', () => {
    expect(
      withSkuHint(base, [{ skuCode: 'Coffee', productName: 'Elite Collagen', variantLabel: null }]),
    ).toBe(`${base} — did you mean "Coffee" (Elite Collagen)?`);
  });
  it('no suggestion: the message is unchanged', () => {
    expect(withSkuHint(base, [])).toBe(base);
  });
});
