import {
  OrderStatus,
  Prisma,
  ResellerStoreEventKind,
  ResellerStoreStatus,
  SellerStoreKind,
} from '@skydrop/db';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import {
  ResellerAutoPauseService,
  autoPauseVerdict,
} from '../../src/modules/reseller-reports/services/reseller-auto-pause.service';
import { FakeDb, type Row, type Tables } from './pnl-fake-db';

const d = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);
const now = new Date('2026-09-15T10:00:00Z');
const daysAgo = (n: number): Date => new Date(now.getTime() - n * 86_400_000);

function orderRows(fates: Array<[string, OrderStatus, Date]>): { orders: Row[]; events: Row[] } {
  const orders: Row[] = [];
  const events: Row[] = [];
  for (const [id, status, at] of fates) {
    orders.push({
      id,
      orderNumber: `SD-${id}`,
      storeId: 's1',
      sellerId: 'x1',
      storeKind: SellerStoreKind.RESELLER,
      status,
      createdAt: daysAgo(20),
      confirmedAt: daysAgo(19),
    });
    events.push({ id: `ev-${id}`, orderId: id, toStatus: status, createdAt: at });
  }
  return { orders, events };
}

function setup(extra: Partial<Tables> = {}): {
  svc: ResellerAutoPauseService;
  autoPause: jest.Mock;
  notice: jest.Mock;
  tables: Tables;
} {
  const { orders, events } = orderRows([
    ['1', OrderStatus.DELIVERED, daysAgo(5)],
    ['2', OrderStatus.DELIVERED, daysAgo(4)],
    ['3', OrderStatus.RTO_RECEIVED, daysAgo(3)],
    ['4', OrderStatus.RTO_RESTOCKED, daysAgo(2)],
  ]);
  const tables: Tables = {
    resellerStoreAutoPause: [
      {
        storeId: 's1',
        enabled: true,
        returnRatePercent: d(30),
        minDecidedOrders: 3,
        windowDays: 30,
        lastPausedAt: null,
        lastEvaluatedAt: null,
      },
    ],
    sellerStore: [
      {
        id: 's1',
        sellerId: 'x1',
        kind: SellerStoreKind.RESELLER,
        status: ResellerStoreStatus.ACTIVE,
        deletedAt: null,
        name: 'Store',
        displayName: 'Store One',
      },
    ],
    order: orders,
    orderItem: [],
    orderEvent: events,
    resellerStoreEvent: [],
    ...extra,
  };
  const autoPause = jest.fn().mockResolvedValue({});
  const notice = jest.fn().mockResolvedValue(undefined);
  const svc = new ResellerAutoPauseService(
    { client: new FakeDb(tables).client() } as unknown as PrismaService,
    { autoPause } as never,
    { storeAutoPaused: notice } as never,
    { log: jest.fn() } as never,
  );
  return { svc, autoPause, notice, tables };
}

describe('reseller auto-pause (RS-9)', () => {
  it('the verdict: more than the limit, over at least the minimum — never on too few parcels', () => {
    expect(autoPauseVerdict({ delivered: 2, returned: 2, limitPct: d(30), minDecided: 3 })).toEqual(
      {
        decided: 4,
        ratePct: '50.0',
        over: true,
      },
    );
    expect(
      autoPauseVerdict({ delivered: 1, returned: 1, limitPct: d(30), minDecided: 3 }).over,
    ).toBe(false);
    // Exactly AT the limit is not over it.
    expect(
      autoPauseVerdict({ delivered: 7, returned: 3, limitPct: d(30), minDecided: 3 }).over,
    ).toBe(false);
    expect(
      autoPauseVerdict({ delivered: 0, returned: 0, limitPct: d(30), minDecided: 1 }).ratePct,
    ).toBeNull();
  });

  it('pauses through the ONE status writer, stamps the rule and tells the seller', async () => {
    const { svc, autoPause, notice, tables } = setup();
    const r = await svc.sweep(now);
    expect(r).toEqual({ evaluated: 1, paused: 1, failures: 0 });
    expect(autoPause).toHaveBeenCalledWith(
      'x1',
      's1',
      expect.stringContaining('2 of 4'),
      'ResellerAutoPauseService',
    );
    expect(notice).toHaveBeenCalledWith(expect.objectContaining({ sellerId: 'x1', returned: 2 }));
    expect(tables['resellerStoreAutoPause']?.[0]?.['lastPausedAt']).toEqual(now);
  });

  it('after the seller resumes, only parcels that reached their fate since count', async () => {
    const {
      svc: fresh,
      autoPause: pause2,
      tables,
    } = setup({
      resellerStoreEvent: [
        { id: 'r1', storeId: 's1', kind: ResellerStoreEventKind.RESUMED, createdAt: daysAgo(1) },
      ],
    });
    const rule = tables['resellerStoreAutoPause']?.[0];
    if (rule !== undefined) rule['lastPausedAt'] = daysAgo(2);
    const r = await fresh.sweep(now);
    expect(r.paused).toBe(0);
    expect(pause2).not.toHaveBeenCalled();
  });

  it('a store that is not ACTIVE is never evaluated', async () => {
    const { svc, autoPause, tables } = setup();
    const store = tables['sellerStore']?.[0];
    if (store !== undefined) store['status'] = ResellerStoreStatus.PAUSED;
    expect((await svc.sweep(now)).evaluated).toBe(0);
    expect(autoPause).not.toHaveBeenCalled();
  });
});
