import {
  EARLY_RESERVATION_KEY,
  OrderCsvStockCheckService,
} from '../../src/modules/order-csv-import/services/order-csv-stock-check.service';
import type { CoercedOrderGroup } from '../../src/modules/order-csv-import/services/order-csv-parser.service';

const SELLER = 's1';

/** Only `lines` is read; the rest of a group is the customer block. */
function group(...lines: Array<[string, number]>): CoercedOrderGroup {
  return {
    lines: lines.map(([productSku, quantity]) => ({ productSku, quantity })),
  } as CoercedOrderGroup;
}

function makeService(opts: {
  /** SKU → variant id. A SKU absent from here resolves to nothing. */
  skus: Record<string, string>;
  /** variant id → availability. An id absent from here has NO stock row. */
  available: Record<string, number>;
  holdsAtPlacement: boolean;
  warehouse?: 'ok' | 'unconfigured';
}) {
  const getVariantBySku = jest.fn(async (_sellerId: string, skuCode: string) => {
    const variantId = opts.skus[skuCode];
    return variantId === undefined ? null : { variantId, skuCode };
  });
  const computeBulk = jest.fn(
    async ({ variantIds }: { variantIds: string[] }) =>
      new Map(
        variantIds
          .filter((id) => opts.available[id] !== undefined)
          .map((id) => [id, opts.available[id] as number]),
      ),
  );
  const getDefaultWarehouseId = jest.fn(async () => {
    if (opts.warehouse === 'unconfigured') throw new Error('DEFAULT_WAREHOUSE_NOT_CONFIGURED');
    return 'wh-1';
  });
  const resolve = jest.fn(async (_sellerId: string, key: string) => ({
    key,
    value: opts.holdsAtPlacement,
  }));

  const svc = new OrderCsvStockCheckService(
    { getVariantBySku } as never,
    { computeBulk } as never,
    { getDefaultWarehouseId } as never,
    { resolve } as never,
  );
  const run = (groups: CoercedOrderGroup[]) => svc.check(SELLER, groups);
  return { run, getVariantBySku, computeBulk, resolve };
}

describe('OrderCsvStockCheckService', () => {
  it('sums demand across the WHOLE FILE per variant, and reads availability once', async () => {
    // Five rows of 100 against 300 on hand is an oversell even though no
    // single row is — and two of them are lines of the same order.
    const { run, computeBulk } = makeService({
      skus: { 'SKU-A': 'v-a' },
      available: { 'v-a': 300 },
      holdsAtPlacement: false,
    });
    const check = await run([
      group(['SKU-A', 100], ['SKU-A', 100]),
      group(['SKU-A', 100]),
      group(['SKU-A', 100]),
      group(['SKU-A', 100]),
    ]);

    expect(check?.oversold).toEqual([
      { skuCode: 'SKU-A', requested: 500, available: 300, shortfall: 200 },
    ]);
    // ONCE for the whole file, not once per row (INV-3 via computeBulk).
    expect(computeBulk).toHaveBeenCalledTimes(1);
    expect(computeBulk).toHaveBeenCalledWith(
      expect.objectContaining({ sellerId: SELLER, variantIds: ['v-a'], warehouseId: 'wh-1' }),
    );
  });

  it('a file that does not oversell is reported as nothing at all', async () => {
    const { run, resolve } = makeService({
      skus: { 'SKU-A': 'v-a' },
      available: { 'v-a': 500 },
      holdsAtPlacement: true,
    });
    expect(await run([group(['SKU-A', 500])])).toBeNull();
    // Not even the setting is read when there is nothing to say.
    expect(resolve).not.toHaveBeenCalled();
  });

  it('WARNING when stock is claimed at confirmation (the setting off)', async () => {
    const { run, resolve } = makeService({
      skus: { 'SKU-A': 'v-a' },
      available: { 'v-a': 3 },
      holdsAtPlacement: false,
    });
    const check = await run([group(['SKU-A', 500])]);

    expect(resolve).toHaveBeenCalledWith(SELLER, EARLY_RESERVATION_KEY);
    expect(check?.holdsAtPlacement).toBe(false);
    expect(check?.blocksImport).toBe(false);
    expect(check?.headline).toContain('SKU-A: 500 ordered, 3 available');
    // A warning offers no switch and claims nothing lasting.
    expect(check?.waysForward).toBeNull();
    expect(check?.lasting).toBeNull();
    expect(check?.message).toBe(check?.headline);
  });

  it('REFUSAL when the client holds stock at placement (the setting on)', async () => {
    const { run } = makeService({
      skus: { 'SKU-A': 'v-a' },
      available: { 'v-a': 3 },
      holdsAtPlacement: true,
    });
    const check = await run([group(['SKU-A', 500])]);

    expect(check?.blocksImport).toBe(true);
    expect(check?.headline).toContain('Book Stock At Order Placement');
    expect(check?.headline).toContain('SKU-A: 500 ordered, 3 available');
    // Both ways forward, named.
    expect(check?.waysForward).toContain('reduce the quantities');
    expect(check?.waysForward).toContain('import anyway');
    // And the part that must not be glossed: account-wide and lasting.
    expect(check?.lasting).toContain('EVERY FUTURE ORDER');
    expect(check?.lasting).toContain('stays off until');
    // Existing holds are not released, and the copy says so.
    expect(check?.lasting).toContain('Stock already held for earlier orders stays held');
    // `message` is exactly the three sentences the console shows.
    expect(check?.message).toBe(`${check?.headline} ${check?.waysForward} ${check?.lasting}`);
  });

  it('a variant with no stock record at all counts as zero available', async () => {
    const { run } = makeService({
      skus: { 'SKU-NEW': 'v-new' },
      available: {}, // never received, never counted — no stock_levels row
      holdsAtPlacement: true,
    });
    const check = await run([group(['SKU-NEW', 2])]);
    expect(check?.oversold).toEqual([
      { skuCode: 'SKU-NEW', requested: 2, available: 0, shortfall: 2 },
    ]);
  });

  it('a SKU that resolves to nothing is left to the row processor', async () => {
    const { run } = makeService({
      skus: { 'SKU-A': 'v-a' },
      available: { 'v-a': 10 },
      holdsAtPlacement: true,
    });
    // SKU-GHOST is refused BY NAME per row; saying it twice in different
    // words is what this skip prevents.
    expect(await run([group(['SKU-GHOST', 999], ['SKU-A', 1])])).toBeNull();
  });

  it('names the biggest gap first and counts the rest', async () => {
    const skus: Record<string, string> = {};
    const available: Record<string, number> = {};
    const lines: Array<[string, number]> = [];
    for (let i = 0; i < 12; i++) {
      skus[`SKU-${i}`] = `v-${i}`;
      available[`v-${i}`] = 0;
      lines.push([`SKU-${i}`, i + 1]);
    }
    const { run } = makeService({ skus, available, holdsAtPlacement: false });
    const check = await run([group(...lines)]);

    expect(check?.oversold).toHaveLength(12);
    expect(check?.oversold[0]?.skuCode).toBe('SKU-11');
    expect(check?.headline).toContain('and 2 more SKUs');
  });

  it('fails OPEN: an unconfigured warehouse is no at-placement hold to break', async () => {
    const { run } = makeService({
      skus: { 'SKU-A': 'v-a' },
      available: { 'v-a': 0 },
      holdsAtPlacement: true,
      warehouse: 'unconfigured',
    });
    expect(await run([group(['SKU-A', 5])])).toBeNull();
  });

  it('says nothing about an empty file', async () => {
    const { run, computeBulk } = makeService({
      skus: {},
      available: {},
      holdsAtPlacement: true,
    });
    expect(await run([])).toBeNull();
    expect(computeBulk).not.toHaveBeenCalled();
  });
});
