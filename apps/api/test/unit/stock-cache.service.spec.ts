import { VariantStatus } from '@skydrop/db';
import {
  StockCacheService,
  type CachedStockAggregate,
  type CachedStockDetail,
} from '../../src/modules/inventory-shared/stock-cache.service';
import type { RedisService } from '../../src/infrastructure/redis/redis.service';

function makeSut(opts: { failing?: boolean } = {}) {
  const store = new Map<string, string>();
  const del = jest.fn(async (...keys: string[]) => {
    if (opts.failing) throw new Error('redis down');
    let n = 0;
    for (const k of keys) if (store.delete(k)) n += 1;
    return n;
  });
  const get = jest.fn(async (k: string) => {
    if (opts.failing) throw new Error('redis down');
    return store.get(k) ?? null;
  });
  const set = jest.fn(async (k: string, v: string) => {
    if (opts.failing) throw new Error('redis down');
    store.set(k, v);
    return 'OK';
  });
  const redis = { client: { del, get, set } } as unknown as RedisService;
  const svc = new StockCacheService(redis);
  return { svc, store, del, get, set };
}

const detail = (sellerId: string, warehouseId: string): CachedStockDetail => ({
  sellerId,
  warehouseId,
  generatedAt: new Date().toISOString(),
  variants: [
    {
      variantId: 'v1',
      productId: 'p1',
      skuCode: 'SKU-1',
      variantLabel: null,
      status: VariantStatus.ACTIVE,
      qtyOnHand: 10,
      qtyReserved: 2,
      qtyAvailable: 8,
      lowStockThreshold: 5,
      isLowStock: false,
    },
  ],
});

const agg = (sellerId: string, warehouseId: string): CachedStockAggregate => ({
  sellerId,
  warehouseId,
  generatedAt: new Date().toISOString(),
  totalSkus: 1,
  totalQtyOnHand: 10,
  totalQtyReserved: 2,
  totalQtyAvailable: 8,
  lowStockSkus: 0,
});

describe('StockCacheService', () => {
  it('round-trips detail and aggregate per (seller, warehouse)', async () => {
    const { svc } = makeSut();
    await svc.setDetail(detail('s1', 'w1'));
    await svc.setAggregate(agg('s1', 'w1'));

    expect(await svc.getDetail('s1', 'w1')).toMatchObject({ sellerId: 's1', warehouseId: 'w1' });
    expect(await svc.getAggregate('s1', 'w1')).toMatchObject({ totalSkus: 1 });
    // Different warehouse is a separate key — miss.
    expect(await svc.getDetail('s1', 'w2')).toBeNull();
  });

  it('invalidate() clears BOTH detail and aggregate for the pair only', async () => {
    const { svc, del, store } = makeSut();
    await svc.setDetail(detail('s1', 'w1'));
    await svc.setAggregate(agg('s1', 'w1'));
    await svc.setDetail(detail('s2', 'w1')); // unrelated seller

    await svc.invalidate('s1', 'w1');

    expect(del).toHaveBeenCalledWith('inventory:stock:detail:s1:w1', 'inventory:stock:agg:s1:w1');
    expect(await svc.getDetail('s1', 'w1')).toBeNull();
    expect(await svc.getAggregate('s1', 'w1')).toBeNull();
    // The other seller's snapshot is untouched.
    expect(store.has('inventory:stock:detail:s2:w1')).toBe(true);
  });

  it('degrades silently when Redis is unavailable (never throws)', async () => {
    const { svc } = makeSut({ failing: true });
    await expect(svc.setDetail(detail('s1', 'w1'))).resolves.toBeUndefined();
    await expect(svc.getDetail('s1', 'w1')).resolves.toBeNull();
    await expect(svc.invalidate('s1', 'w1')).resolves.toBeUndefined();
  });

  it('returns null on a corrupt cache entry rather than throwing', async () => {
    const { svc, store } = makeSut();
    store.set('inventory:stock:detail:s1:w1', '{not-json');
    expect(await svc.getDetail('s1', 'w1')).toBeNull();
  });
});
