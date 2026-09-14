import { ResellerStockMode, ResellerStoreStatus } from '@skydrop/db';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { CatalogReadService } from '../../src/modules/catalog-read/services/catalog-read.service';
import type { StockReadService } from '../../src/modules/inventory-stock/services/stock-read.service';
import type { ResellerSetAsideNotifier } from '../../src/modules/reseller-catalogue/services/reseller-set-aside-notifier.service';
import { ResellerSetAsideSweepService } from '../../src/modules/reseller-catalogue/services/reseller-set-aside-sweep.service';

/**
 * RS-3 — the hourly set-aside shrink, against an in-memory store that
 * APPLIES the where-clauses the sweep sends (a mock that answered every
 * query alike could not show a closed store's set-aside being ignored,
 * or a guarded update refusing a figure that moved).
 */

interface Row {
  id: string;
  storeId: string;
  sellerId: string;
  variantId: string;
  stockMode: ResellerStockMode;
  setAsideQty: number | null;
  setAsideAt: Date | null;
  store: { name: string; status: ResellerStoreStatus; deletedAt: Date | null };
}

type Where = Record<string, unknown>;

function matches(row: Row, where: Where): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'store') {
      const s = cond as { status?: { in: ResellerStoreStatus[] }; deletedAt?: null };
      if (s.status !== undefined && !s.status.in.includes(row.store.status)) return false;
      if (s.deletedAt === null && row.store.deletedAt !== null) return false;
      continue;
    }
    const value = (row as unknown as Record<string, unknown>)[key];
    if (cond !== null && typeof cond === 'object' && 'gt' in (cond as object)) {
      if (!(typeof value === 'number' && value > (cond as { gt: number }).gt)) return false;
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

function makeDb(rows: Row[]) {
  const shrinks: Array<Record<string, unknown>> = [];
  const lockKeys: unknown[] = [];
  const resellerStoreVariant = {
    groupBy: jest.fn(async (args: { where: Where }) => {
      const sums = new Map<string, { sellerId: string; variantId: string; total: number }>();
      for (const r of rows.filter((x) => matches(x, args.where))) {
        const k = `${r.sellerId}|${r.variantId}`;
        const cur = sums.get(k) ?? { sellerId: r.sellerId, variantId: r.variantId, total: 0 };
        cur.total += r.setAsideQty ?? 0;
        sums.set(k, cur);
      }
      return [...sums.values()].map((s) => ({
        sellerId: s.sellerId,
        variantId: s.variantId,
        _sum: { setAsideQty: s.total },
      }));
    }),
    findMany: jest.fn(async (args: { where: Where }) =>
      rows.filter((r) => matches(r, args.where)).map((r) => ({ ...r })),
    ),
    updateMany: jest.fn(async (args: { where: Where; data: { setAsideQty: number } }) => {
      const hit = rows.filter((r) => matches(r, args.where));
      for (const r of hit) r.setAsideQty = args.data.setAsideQty;
      return { count: hit.length };
    }),
  };
  const resellerSetAsideShrink = {
    create: jest.fn(async (args: { data: Record<string, unknown> }) => {
      const id = `shrink-${shrinks.length + 1}`;
      shrinks.push({ id, ...args.data });
      return { id };
    }),
  };
  const tx = {
    resellerStoreVariant,
    resellerSetAsideShrink,
    $executeRaw: jest.fn(async (_s: TemplateStringsArray, ...values: unknown[]) => {
      lockKeys.push(values);
      return 1;
    }),
  };
  const client = {
    resellerStoreVariant,
    resellerSetAsideShrink,
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { prisma: { client } as unknown as PrismaService, shrinks, lockKeys, tx };
}

function row(over: Partial<Row> & Pick<Row, 'id' | 'storeId'>): Row {
  return {
    sellerId: 'seller-1',
    variantId: 'v-1',
    stockMode: ResellerStockMode.SET_ASIDE,
    setAsideQty: 1,
    setAsideAt: new Date('2026-09-01T00:00:00Z'),
    store: { name: over.storeId, status: ResellerStoreStatus.ACTIVE, deletedAt: null },
    ...over,
  };
}

function makeSut(
  rows: Row[],
  onHand: Record<string, number> | ((sellerId: string) => Record<string, number>),
) {
  const db = makeDb(rows);
  const stock = {
    getSellableStockLive: jest.fn(async (sellerId: string, ids: readonly string[]) => {
      const table = typeof onHand === 'function' ? onHand(sellerId) : onHand;
      return new Map(ids.map((id) => [id, { onHand: table[id] ?? 0, available: table[id] ?? 0 }]));
    }),
  } as unknown as StockReadService;
  const catalog = {
    getVariantById: jest.fn(async (id: string) => ({ skuCode: `SKU-${id}` })),
  } as unknown as CatalogReadService;
  const notifier = { setAsideShrunk: jest.fn(async () => undefined) };
  const audit = { log: jest.fn(async () => 'audit-1') };
  const svc = new ResellerSetAsideSweepService(
    db.prisma,
    stock,
    catalog,
    notifier as unknown as ResellerSetAsideNotifier,
    audit as unknown as AuditLogService,
  );
  return { svc, db, stock, notifier, audit };
}

describe('ResellerSetAsideSweepService (RS-3)', () => {
  it('does nothing while every set-aside fits inside on-hand', async () => {
    const rows = [row({ id: 'r1', storeId: 'A', setAsideQty: 5 })];
    const { svc, db, notifier } = makeSut(rows, { 'v-1': 5 });
    const result = await svc.sweep();
    expect(result).toEqual({ pairsChecked: 1, pairsOverCommitted: 0, shrunk: 0, failures: 0 });
    expect(db.shrinks).toEqual([]);
    expect(notifier.setAsideShrunk).not.toHaveBeenCalled();
  });

  it('shrinks newest-first until the set-asides fit, and records every cut', async () => {
    const rows = [
      row({ id: 'old', storeId: 'A', setAsideQty: 5, setAsideAt: new Date('2026-09-01') }),
      row({ id: 'mid', storeId: 'B', setAsideQty: 4, setAsideAt: new Date('2026-09-05') }),
      row({ id: 'new', storeId: 'C', setAsideQty: 3, setAsideAt: new Date('2026-09-10') }),
    ];
    const { svc, db, notifier, audit } = makeSut(rows, { 'v-1': 6 });
    const result = await svc.sweep();

    expect(result.shrunk).toBe(2);
    expect(rows.map((r) => [r.id, r.setAsideQty])).toEqual([
      ['old', 5],
      ['mid', 1],
      ['new', 0],
    ]);
    expect(
      db.shrinks.map((s) => [s.storeVariantId, s.fromQty, s.toQty, s.onHand, s.totalBefore]),
    ).toEqual([
      ['new', 3, 0, 6, 12],
      ['mid', 4, 1, 6, 12],
    ]);
    // Under the SAME lock key a seller's save takes.
    expect(db.lockKeys).toHaveLength(1);
    // One notice for the (seller, variant), naming the SKU and both stores.
    expect(notifier.setAsideShrunk).toHaveBeenCalledTimes(1);
    expect(notifier.setAsideShrunk).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerId: 'seller-1',
        skuCode: 'SKU-v-1',
        onHand: 6,
        steps: [
          expect.objectContaining({ storeName: 'C', fromQty: 3, toQty: 0 }),
          expect.objectContaining({ storeName: 'B', fromQty: 4, toQty: 1 }),
        ],
      }),
    );
    // The audit row is about no single row: entity id null (rule 6).
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reseller.set_aside.shrunk', entityId: null }),
    );
  });

  it('is idempotent — a second run over the same stock changes nothing', async () => {
    const rows = [
      row({ id: 'a', storeId: 'A', setAsideQty: 5 }),
      row({ id: 'b', storeId: 'B', setAsideQty: 5, setAsideAt: new Date('2026-09-09') }),
    ];
    const { svc, db, notifier } = makeSut(rows, { 'v-1': 7 });
    await svc.sweep();
    await svc.sweep();
    expect(db.shrinks).toHaveLength(1);
    expect(rows.map((r) => r.setAsideQty)).toEqual([5, 2]);
    expect(notifier.setAsideShrunk).toHaveBeenCalledTimes(1);
  });

  it('ignores a closed store’s set-aside, SHARED rows and other variants', async () => {
    const rows = [
      row({ id: 'live', storeId: 'A', setAsideQty: 4 }),
      row({
        id: 'closed',
        storeId: 'X',
        setAsideQty: 100,
        setAsideAt: new Date('2026-09-12'),
        store: { name: 'X', status: ResellerStoreStatus.CLOSED, deletedAt: null },
      }),
      row({ id: 'shared', storeId: 'B', stockMode: ResellerStockMode.SHARED, setAsideQty: null }),
      row({ id: 'other', storeId: 'A', variantId: 'v-2', setAsideQty: 2 }),
    ];
    const { svc, db } = makeSut(rows, { 'v-1': 4, 'v-2': 2 });
    const result = await svc.sweep();
    expect(result.pairsOverCommitted).toBe(0);
    expect(db.shrinks).toEqual([]);
    expect(rows.find((r) => r.id === 'closed')?.setAsideQty).toBe(100);
  });

  it('a pending store’s set-aside counts (its commitment already holds stock)', async () => {
    const rows = [
      row({ id: 'a', storeId: 'A', setAsideQty: 3 }),
      row({
        id: 'p',
        storeId: 'P',
        setAsideQty: 3,
        setAsideAt: new Date('2026-09-11'),
        store: { name: 'P', status: ResellerStoreStatus.PENDING_SELLER_APPROVAL, deletedAt: null },
      }),
    ];
    const { svc } = makeSut(rows, { 'v-1': 4 });
    await svc.sweep();
    expect(rows.map((r) => r.setAsideQty)).toEqual([3, 1]);
  });

  it('isolates one seller’s failure and carries on with the next', async () => {
    const rows = [
      row({ id: 'a', storeId: 'A', sellerId: 'broken', setAsideQty: 9 }),
      row({ id: 'b', storeId: 'B', sellerId: 'fine', setAsideQty: 9 }),
    ];
    const { svc, stock } = makeSut(rows, { 'v-1': 1 });
    (stock.getSellableStockLive as jest.Mock).mockImplementation(
      async (sellerId: string, ids: readonly string[]) => {
        if (sellerId === 'broken') throw new Error('stock read failed');
        return new Map(ids.map((id) => [id, { onHand: 1, available: 1 }]));
      },
    );
    const result = await svc.sweep();
    expect(result.failures).toBe(1);
    expect(rows.map((r) => r.setAsideQty)).toEqual([9, 1]);
  });

  it('a notifier or SKU lookup failure never undoes the shrink', async () => {
    const rows = [row({ id: 'a', storeId: 'A', setAsideQty: 5 })];
    const { svc, notifier } = makeSut(rows, { 'v-1': 2 });
    (notifier.setAsideShrunk as jest.Mock).mockResolvedValue(undefined);
    const out = await svc.shrinkOne('seller-1', 'v-1');
    expect(out).toEqual([expect.objectContaining({ fromQty: 5, toQty: 2 })]);
    expect(rows[0]?.setAsideQty).toBe(2);
  });
});
