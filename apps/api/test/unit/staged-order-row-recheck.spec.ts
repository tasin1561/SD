import { StagedOrderRowService } from '../../src/modules/order-csv-import/services/staged-order-row.service';

/**
 * Owner, 2026-11-19: pending rows showed errors saved at upload ("another
 * row of order … has a problem", "… disagrees with an earlier row") after
 * the importer stopped refusing for them. The list re-checks now.
 */
const clean = {
  externalRef: 'Susmita (S. RO)',
  productSku: 'Elite Collagen',
  quantity: 1,
  customerName: 'Susmita (S. RO)',
  customerPhone: '+917076613237',
  addressLine1: 'Sovek Road',
  addressLine2: 'Landmark: M Bazar',
  city: 'Siliguri',
  state: 'West Bengal',
  pinCode: '734001',
  codAmount: 1050,
};

function svc(variants: Array<{ skuCode: string; name: string }>) {
  const row = {
    id: 'r1',
    uploadId: 'u1',
    sellerId: 's1',
    rowNumber: 2,
    data: clean,
    problems: [
      {
        field: 'externalRef',
        reason:
          'not imported: another row of order "Susmita (S. RO)" (rows 5, 8) has a problem to fix',
      },
      {
        field: 'customerPhone',
        reason: 'customerPhone disagrees with an earlier row of order "Susmita (S. RO)"',
      },
    ],
    status: 'NEEDS_INPUT',
    duplicateOf: null,
    resolvedOrderId: null,
    createdAt: new Date(),
  };
  const prisma = {
    client: {
      stagedOrderRow: { findMany: jest.fn(async () => [row]) },
      productVariant: {
        findMany: jest.fn(async (a: { where: { skuCode?: { in: string[] } } }) =>
          a.where.skuCode
            ? variants
                .filter((v) => a.where.skuCode!.in.includes(v.skuCode))
                .map((v) => ({ skuCode: v.skuCode }))
            : variants.map((v) => ({
                skuCode: v.skuCode,
                variantLabel: null,
                product: { name: v.name },
              })),
        ),
      },
    },
  };
  const catalog = {
    suggestSkus: async () => [
      { skuCode: 'Coffee', productName: 'Elite Collagen', variantLabel: null },
    ],
  };
  return new StagedOrderRowService(prisma as never, {} as never, catalog as never);
}

describe('pending rows show what is wrong NOW', () => {
  it('stale grouping errors are gone; the real SKU problem shows, with the right SKU suggested', async () => {
    const [v] = await svc([{ skuCode: 'Coffee', name: 'Elite Collagen' }]).list('s1');
    const reasons = v!.problems.map((p) => p.reason).join(' | ');
    expect(reasons).not.toMatch(/another row of order|disagrees with an earlier row/);
    expect(v!.problems).toEqual([
      {
        field: 'productSku',
        reason: 'No product with SKU "Elite Collagen" — did you mean "Coffee" (Elite Collagen)?',
      },
    ]);
  });

  it('a row whose SKU exists and fields are fine shows no problems', async () => {
    const [v] = await svc([{ skuCode: 'Elite Collagen', name: 'Elite Collagen' }]).list('s1');
    expect(v!.problems).toEqual([]);
  });
});
