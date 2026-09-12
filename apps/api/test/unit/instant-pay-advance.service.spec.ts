import { Prisma } from '@skydrop/db';
import { InstantPayAdvanceService } from '../../src/modules/treasury/services/instant-pay-advance.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * "We paid this seller in advance and will get it from the courier" —
 * which orders, and how much of our cash is behind each.
 *
 * The fake APPLIES the where-clauses the service sends (status, COD, no
 * payout line, direction, reference) rather than answering every query
 * alike, so an order the predicate should exclude really is excluded.
 */

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
const NOW = new Date('2026-09-12T12:00:00Z');
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000);

interface FakeOrder {
  id: string;
  orderNumber: string;
  sellerId: string;
  status: string;
  codAmountInr: Prisma.Decimal | null;
  settlementLines: number;
  deliveredAt?: Date;
  courierAccountId?: string;
}
interface FakeEntry {
  linkedOrderId: string;
  sellerId: string;
  direction: string;
  amount: Prisma.Decimal;
  createdAt: Date;
}
interface FakeBank {
  reference: string;
  sellerId: string | null;
  type: string;
  ownerKind: string;
  signedAmount: Prisma.Decimal;
  accountId: string;
}

function makeSut(data: { orders: FakeOrder[]; entries: FakeEntry[]; bank: FakeBank[] }) {
  const byId = new Map(data.orders.map((o) => [o.id, o]));
  const floatMatch = (o: FakeOrder | undefined, f: Record<string, unknown>): boolean => {
    if (o === undefined) return false;
    if (f['status'] !== undefined && o.status !== String(f['status'])) return false;
    if (f['codAmountInr'] !== undefined && !(o.codAmountInr ?? D('0')).greaterThan(0)) return false;
    if (f['courierSettlementLines'] !== undefined && o.settlementLines > 0) return false;
    return true;
  };

  const client = {
    sellerWalletEntry: {
      groupBy: async (args: {
        where: {
          direction: { in: string[] };
          sellerId?: string;
          linkedOrder: Record<string, unknown>;
        };
      }) => {
        const counts = new Map<string, number>();
        for (const e of data.entries) {
          if (!args.where.direction.in.includes(e.direction)) continue;
          if (args.where.sellerId !== undefined && e.sellerId !== args.where.sellerId) continue;
          if (!floatMatch(byId.get(e.linkedOrderId), args.where.linkedOrder)) continue;
          const k = `${e.linkedOrderId}|${e.direction}`;
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        return [...counts].map(([k, n]) => {
          const [linkedOrderId, direction] = k.split('|');
          return { linkedOrderId, direction, _count: { _all: n } };
        });
      },
      findMany: async (args: {
        where: { linkedOrderId: { in: string[] }; direction: { in: string[] } };
      }) =>
        data.entries.filter(
          (e) =>
            args.where.linkedOrderId.in.includes(e.linkedOrderId) &&
            args.where.direction.in.includes(e.direction),
        ),
    },
    order: {
      aggregate: async (args: { where: { id: { in: string[] } } }) => {
        const hit = data.orders.filter((o) => args.where.id.in.includes(o.id));
        return {
          _sum: { codAmountInr: hit.reduce((a, o) => a.add(o.codAmountInr ?? D('0')), D('0')) },
          _count: { _all: hit.length },
        };
      },
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        data.orders
          .filter((o) => args.where.id.in.includes(o.id))
          .map((o) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            sellerId: o.sellerId,
            codAmountInr: o.codAmountInr,
            seller: { companyName: `Seller ${o.sellerId}` },
            orderShipments: [
              {
                shipment: {
                  courierCode: 'delhivery',
                  courierAccountId: o.courierAccountId ?? 'ca-1',
                  awbNumber: `AWB-${o.id}`,
                  supersededAt: null,
                  deletedAt: null,
                  createdAt: daysAgo(10),
                  courierAccount: { label: `Account ${o.courierAccountId ?? 'ca-1'}` },
                },
              },
            ],
          })),
    },
    bankEntry: {
      findMany: async (args: {
        where: { reference: { in: string[] }; type: string; ownerKind: string };
      }) =>
        data.bank
          .filter(
            (b) =>
              args.where.reference.in.includes(b.reference) &&
              b.type === args.where.type &&
              b.ownerKind === args.where.ownerKind &&
              b.signedAmount.greaterThan(0),
          )
          .map((b) => ({ ...b, account: { label: `Bank ${b.accountId}` } })),
    },
    orderEvent: {
      findMany: async (args: { where: { orderId: { in: string[] } } }) =>
        data.orders
          .filter((o) => args.where.orderId.in.includes(o.id) && o.deliveredAt !== undefined)
          .map((o) => ({ orderId: o.id, createdAt: o.deliveredAt })),
    },
  };
  return new InstantPayAdvanceService({ client } as unknown as PrismaService);
}

/** An Instant Pay credit as `CodCreditService` + the accrual write it. */
function instantPayCredit(
  orderId: string,
  sellerId: string,
  cod: string,
  opts: { gst: string; fee: string; front: string | null; at: Date },
): { entries: FakeEntry[]; bank: FakeBank[] } {
  const e = (direction: string, amount: string): FakeEntry => ({
    linkedOrderId: orderId,
    sellerId,
    direction,
    amount: D(amount),
    createdAt: opts.at,
  });
  return {
    entries: [
      e('COD_COLLECTION', cod),
      e('GST_WITHHOLDING', opts.gst),
      e('INSTANT_PAY_FEE', opts.fee),
    ],
    bank:
      opts.front === null
        ? []
        : [
            // The pair: seller +front, capital −front, both referenced by order id.
            {
              reference: orderId,
              sellerId,
              type: 'RECLASSIFICATION',
              ownerKind: 'SELLER',
              signedAmount: D(opts.front),
              accountId: 'hdfc',
            },
            {
              reference: orderId,
              sellerId: null,
              type: 'RECLASSIFICATION',
              ownerKind: 'CAPITAL',
              signedAmount: D(opts.front).neg(),
              accountId: 'hdfc',
            },
          ],
  };
}

const delivered = (id: string, sellerId: string, cod: string, extra: Partial<FakeOrder> = {}) => ({
  id,
  orderNumber: `SD-${id}`,
  sellerId,
  status: 'DELIVERED',
  codAmountInr: D(cod),
  settlementLines: 0,
  deliveredAt: daysAgo(4),
  ...extra,
});

describe('InstantPayAdvanceService', () => {
  it('lists an unpaid Instant Pay order with what reached the seller and the cash we fronted', async () => {
    const c = instantPayCredit('o1', 's1', '1180', {
      gst: '180',
      fee: '25',
      front: '1180',
      at: daysAgo(4),
    });
    const r = await makeSut({
      orders: [delivered('o1', 's1', '1180')],
      ...c,
    }).report({}, NOW);

    expect(r.count).toBe(1);
    const row = r.rows[0];
    expect(row?.orderNumber).toBe('SD-o1');
    expect(row?.codInr).toBe('1180.00');
    expect(row?.netCreditedInr).toBe('975.00');
    expect(row?.frontedInr).toBe('1180.00');
    expect(row?.frontAccountLabel).toBe('Bank hdfc');
    expect(row?.courierAccountId).toBe('ca-1');
    expect(row?.ageDays).toBe(4);
    expect(r.totalCodInr).toBe('1180.00');
    expect(r.totalFrontedInr).toBe('1180.00');
  });

  it('fronts LESS than the credit when part of the COD repaid a debt (SD-2026-26-000007)', async () => {
    // COD ₹1,180 on a seller already ₹630 in the red: ₹630 cleared the
    // receivable and needed no cash; only ₹550 left capital.
    const c = instantPayCredit('o7', 's1', '1180', {
      gst: '180',
      fee: '25',
      front: '550',
      at: daysAgo(2),
    });
    const r = await makeSut({ orders: [delivered('o7', 's1', '1180')], ...c }).report({}, NOW);
    expect(r.rows[0]?.codInr).toBe('1180.00');
    expect(r.rows[0]?.frontedInr).toBe('550.00');
    expect(r.totalFrontedInr).toBe('550.00');
  });

  it('still lists an order whose whole COD repaid a debt — nothing fronted, but the courier owes it', async () => {
    const c = instantPayCredit('o8', 's1', '500', {
      gst: '76.27',
      fee: '0',
      front: null,
      at: daysAgo(1),
    });
    const r = await makeSut({ orders: [delivered('o8', 's1', '500')], ...c }).report({}, NOW);
    expect(r.count).toBe(1);
    expect(r.rows[0]?.frontedInr).toBe('0.00');
  });

  it('drops the order once a courier payout line settles it', async () => {
    const c = instantPayCredit('o1', 's1', '1180', {
      gst: '180',
      fee: '25',
      front: '1180',
      at: daysAgo(4),
    });
    const svc = makeSut({
      orders: [delivered('o1', 's1', '1180', { settlementLines: 1 })],
      ...c,
    });
    expect((await svc.report({}, NOW)).count).toBe(0);
    expect((await svc.summary()).count).toBe(0);
  });

  it('drops a reversed credit (as many COD_REVERSAL as COD_COLLECTION)', async () => {
    const c = instantPayCredit('o2', 's1', '1000', {
      gst: '152.54',
      fee: '0',
      front: '1000',
      at: daysAgo(6),
    });
    c.entries.push({
      linkedOrderId: 'o2',
      sellerId: 's1',
      direction: 'COD_REVERSAL',
      amount: D('1000'),
      createdAt: daysAgo(1),
    });
    const r = await makeSut({ orders: [delivered('o2', 's1', '1000')], ...c }).report({}, NOW);
    expect(r.count).toBe(0);
  });

  it('never lists a settlement-mode order — delivered, unpaid, but not credited', async () => {
    const svc = makeSut({ orders: [delivered('o3', 's2', '900')], entries: [], bank: [] });
    expect((await svc.report({}, NOW)).count).toBe(0);
    expect((await svc.summary()).amount.toFixed(2)).toBe('0.00');
  });

  it('filters by seller and by courier account, and groups the totals', async () => {
    const a = instantPayCredit('oa', 's1', '1000', {
      gst: '0',
      fee: '0',
      front: '1000',
      at: daysAgo(9),
    });
    const b = instantPayCredit('ob', 's2', '400', {
      gst: '0',
      fee: '0',
      front: '300',
      at: daysAgo(3),
    });
    const svc = makeSut({
      orders: [
        delivered('oa', 's1', '1000', { deliveredAt: daysAgo(9) }),
        delivered('ob', 's2', '400', { courierAccountId: 'ca-2' }),
      ],
      entries: [...a.entries, ...b.entries],
      bank: [...a.bank, ...b.bank],
    });

    const all = await svc.report({}, NOW);
    // Oldest first — the one the courier has sat on longest.
    expect(all.rows.map((r) => r.orderId)).toEqual(['oa', 'ob']);
    expect(all.totalCodInr).toBe('1400.00');
    expect(all.totalFrontedInr).toBe('1300.00');
    expect(all.bySeller.map((g) => [g.key, g.codInr])).toEqual([
      ['s1', '1000.00'],
      ['s2', '400.00'],
    ]);
    expect(all.byCourierAccount.map((g) => [g.key, g.frontedInr])).toEqual([
      ['ca-1', '1000.00'],
      ['ca-2', '300.00'],
    ]);

    expect((await svc.report({ sellerId: 's2' }, NOW)).rows.map((r) => r.orderId)).toEqual(['ob']);
    expect((await svc.report({ courierAccountId: 'ca-1' }, NOW)).totalCodInr).toBe('1000.00');
    // The summary the liabilities page reads is the same set.
    const s = await svc.summary();
    expect([s.amount.toFixed(2), s.count]).toEqual(['1400.00', 2]);
  });
});
