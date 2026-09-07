import { Prisma } from '@skydrop/db';
import { PnlService } from '../../src/modules/treasury/services/pnl.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import { ShipmentCostService } from '../../src/modules/treasury/services/shipment-cost.service';

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

function makeSut(opts: {
  freight?: Array<{ totalInr: Prisma.Decimal; ourCostInr: Prisma.Decimal | null }>;
  shippingRevenue?: Prisma.Decimal | null;
  shipments?: Array<{ actualCourierCostInr: Prisma.Decimal | null }>;
  rtoFees?: Prisma.Decimal | null;
  /** Tax deducted from CODs — OUR revenue since 2026-09-07, not a liability. */
  codTax?: Prisma.Decimal | null;
  returned?: Array<{ actualRtoCostInr: Prisma.Decimal | null }>;
  fxSpread?: Prisma.Decimal | null;
  expenses?: Prisma.Decimal | null;
  /**
   * EXPENSE entries filed under a leg category with no consignment
   * behind them — reported rather than moved, because we cannot know
   * which consignment they were for.
   */
  unattributed?: Array<{ signedAmount: Prisma.Decimal }>;
}) {
  const client = {
    inboundFreightCharge: { findMany: async () => opts.freight ?? [] },
    orderCharge: {
      aggregate: async () => ({ _sum: { amountInr: opts.shippingRevenue ?? null } }),
      // The same revenue, split by charge type for the line's basis —
      // "shipping revenue" is four different prices added together and
      // only one of them is the base rate.
      groupBy: async () =>
        opts.shippingRevenue == null
          ? []
          : [
              {
                type: 'BASE_SHIPPING',
                _sum: { amountInr: opts.shippingRevenue },
                _count: { _all: 1 },
              },
            ],
    },
    shipment: {
      findMany: async (args: { where: Record<string, unknown> }) =>
        // BOTH queries mention rtoReceivedAt now — the delivery line
        // filters it to null to exclude returns, the returns line uses a
        // date range. The VALUE is the discriminator, not the key.
        args.where['rtoReceivedAt'] === null ? (opts.shipments ?? []) : (opts.returned ?? []),
    },
    sellerWalletEntry: {
      // Keyed on DIRECTION, not answered the same way twice. Two lines
      // read this table now, and a fake that ignored the filter fed the
      // RTO fee into the COD-tax line as well — which is exactly the
      // shape of double count the report exists to avoid.
      aggregate: async (args: { where: { direction: string } }) => ({
        _sum: {
          amount:
            args.where.direction === 'GST_WITHHOLDING'
              ? (opts.codTax ?? null)
              : (opts.rtoFees ?? null),
        },
        _count: { _all: 1 },
      }),
    },
    bankEntry: {
      aggregate: async (args: { where: { type: string } }) => ({
        _sum: {
          signedAmount:
            args.where.type === 'FX_SPREAD' ? (opts.fxSpread ?? null) : (opts.expenses ?? null),
        },
        _count: { _all: 1 },
      }),
      findMany: async () => opts.unattributed ?? [],
    },
  };
  return new PnlService({ client } as unknown as PrismaService);
}

const FROM = new Date('2026-08-01T00:00:00.000Z');
const TO = new Date('2026-08-31T23:59:59.999Z');

describe('PnlService', () => {
  it('reports an unpriced cost as UNCOVERED, never as profit', async () => {
    // The failure this guards: two consignments billed, one forwarder
    // invoice recorded. Treating the missing one as zero would report a
    // 100% margin on it and quietly overstate the business.
    const svc = makeSut({
      freight: [
        { totalInr: D('10000'), ourCostInr: D('7000') },
        { totalInr: D('10000'), ourCostInr: null },
      ],
    });
    const r = await svc.report(FROM, TO);
    const line = r.lines.find((l) => l.key === 'inbound_freight');

    expect(line?.revenueInr).toBe('20000.00');
    expect(line?.costInr).toBe('7000.00');
    expect(line?.coverage).toMatchObject({ priced: 1, total: 2 });
    expect(line?.coverage.note).not.toBeNull();
    expect(r.complete).toBe(false);
  });

  it('says it is complete only when every line is fully measured', async () => {
    const svc = makeSut({
      freight: [{ totalInr: D('100'), ourCostInr: D('60') }],
      shippingRevenue: D('500'),
      shipments: [{ actualCourierCostInr: D('300') }],
      rtoFees: D('30'),
      returned: [{ actualRtoCostInr: D('20') }],
    });
    const r = await svc.report(FROM, TO);
    expect(r.complete).toBe(true);
    expect(r.lines.every((l) => l.coverage.note === null)).toBe(true);
  });

  it('nets the four sources into gross margin and subtracts expenses', async () => {
    const svc = makeSut({
      freight: [{ totalInr: D('1000'), ourCostInr: D('600') }], // +400
      shippingRevenue: D('2000'),
      shipments: [{ actualCourierCostInr: D('1500') }], // +500
      rtoFees: D('200'),
      returned: [{ actualRtoCostInr: D('150') }], // +50
      fxSpread: D('75'), // +75
      expenses: D('-325'),
    });
    const r = await svc.report(FROM, TO);
    expect(r.grossMarginInr).toBe('1025.00');
    expect(r.operatingExpensesInr).toBe('325.00');
    expect(r.netInr).toBe('700.00');
  });

  it('carries a negative FX spread through as a loss, not an absolute', async () => {
    // We honour a quote the market moved against; that is a real cost
    // and flipping its sign would turn a loss into earnings.
    const svc = makeSut({ fxSpread: D('-120') });
    const r = await svc.report(FROM, TO);
    expect(r.lines.find((l) => l.key === 'fx')?.marginInr).toBe('-120.00');
    expect(r.grossMarginInr).toBe('-120.00');
  });

  it('reports no percentage where there is no revenue to take one of', async () => {
    const svc = makeSut({});
    const r = await svc.report(FROM, TO);
    for (const l of r.lines) expect(l.marginPercent).toBeNull();
  });

  it('never charges a returned parcel twice — the delivery line excludes it', async () => {
    // Delhivery refunds the delivery deduction on a return and bills an
    // RTO fee instead. Counting the forward cost here as well would
    // charge the same carriage twice and make both margins wrong in
    // opposite directions. The `rtoReceivedAt: null` filter is what
    // enforces it, so the fake distinguishes the two queries.
    const svc = makeSut({
      shippingRevenue: D('1000'),
      shipments: [{ actualCourierCostInr: D('700') }], // the ones that stayed delivered
      rtoFees: D('230'),
      returned: [{ actualRtoCostInr: D('180') }],
    });
    const r = await svc.report(FROM, TO);

    expect(r.lines.find((l) => l.key === 'delivery')?.costInr).toBe('700.00');
    expect(r.lines.find((l) => l.key === 'rto')?.costInr).toBe('180.00');
    // 300 on delivery + 50 on returns. If the return's forward cost had
    // leaked into the delivery line this would be lower.
    expect(r.grossMarginInr).toBe('350.00');
  });

  it('an empty window is zero everywhere, and complete', async () => {
    const svc = makeSut({});
    const r = await svc.report(FROM, TO);
    expect(r.grossMarginInr).toBe('0.00');
    expect(r.netInr).toBe('0.00');
    expect(r.complete).toBe(true);
  });
});

describe('ShipmentCostService', () => {
  function makeSut(existing: {
    actualCourierCostInr: Prisma.Decimal | null;
    actualRtoCostInr: Prisma.Decimal | null;
  }) {
    const update = jest.fn<Promise<unknown>, [{ where: unknown; data: Record<string, unknown> }]>(
      async (args) => ({
        actualCourierCostInr:
          (args.data['actualCourierCostInr'] as Prisma.Decimal | undefined) ??
          existing.actualCourierCostInr,
        actualRtoCostInr:
          (args.data['actualRtoCostInr'] as Prisma.Decimal | undefined) ??
          existing.actualRtoCostInr,
      }),
    );
    const prisma = {
      client: {
        shipment: { findFirst: async () => ({ id: 'sh1', ...existing }), update },
      },
    } as unknown as PrismaService;
    const audit = { log: jest.fn(async () => 'a1') } as unknown as AuditLogService;
    return { svc: new ShipmentCostService(prisma, audit), update };
  }

  const EMPTY = { actualCourierCostInr: null, actualRtoCostInr: null };

  it('keeps the forward and return figures in SEPARATE columns', async () => {
    // One column holding both would make the P&L charge the same
    // carriage twice — once on the delivery line, again on returns.
    const sut = makeSut(EMPTY);
    await sut.svc.record('staff-1', 'sh1', { forwardCostInr: '62', rtoCostInr: '48' });
    const data = sut.update.mock.calls[0]?.[0].data;
    expect(String(data?.['actualCourierCostInr'])).toBe('62');
    expect(String(data?.['actualRtoCostInr'])).toBe('48');
  });

  it('leaves the other figure untouched when only one is given', async () => {
    // The two arrive on different invoices weeks apart. Writing a null
    // over the one already recorded would silently un-price a parcel.
    const sut = makeSut({ actualCourierCostInr: new Prisma.Decimal('62'), actualRtoCostInr: null });
    await sut.svc.record('staff-1', 'sh1', { rtoCostInr: '48' });
    const data = sut.update.mock.calls[0]?.[0].data;
    expect(data).not.toHaveProperty('actualCourierCostInr');
    expect(String(data?.['actualRtoCostInr'])).toBe('48');
  });

  it('refuses a negative cost and an empty submission', async () => {
    const sut = makeSut(EMPTY);
    await expect(sut.svc.record('staff-1', 'sh1', { forwardCostInr: '-5' })).rejects.toMatchObject({
      response: { code: 'COST_INVALID' },
    });
    await expect(sut.svc.record('staff-1', 'sh1', {})).rejects.toMatchObject({
      response: { code: 'NO_COST_GIVEN' },
    });
  });
});

describe('a cost already counted by its leg is not counted again', () => {
  it('excludes freight payments LINKED to a bill from operating expenses', async () => {
    /*
      The double count this closes. `ourCostInr` is the cost side of the
      BD→India line; the cash going out used to be recorded separately
      as an expense, where it lands in operating expenses. Enter both —
      which the report's own coverage note told people to do — and the
      same rupees come off gross AND off net.

      The fake asserts the QUERY, because that is where the fix lives:
      the aggregate must be scoped to entries with no freight link.
    */
    let scoped: unknown;
    const client = {
      inboundFreightCharge: { findMany: async () => [] },
      orderCharge: {
        aggregate: async () => ({ _sum: { amountInr: null } }),
        groupBy: async () => [],
      },
      shipment: { findMany: async () => [] },
      sellerWalletEntry: {
        aggregate: async () => ({ _sum: { amount: null }, _count: { _all: 0 } }),
      },
      bankEntry: {
        aggregate: async (args: { where: Record<string, unknown> }) => {
          if (args.where['type'] === 'EXPENSE') scoped = args.where['inboundFreightChargeId'];
          return { _sum: { signedAmount: null }, _count: { _all: 0 } };
        },
        findMany: async () => [],
      },
    };
    const svc = new PnlService({ client } as unknown as PrismaService);
    await svc.report(FROM, TO);
    expect(scoped).toBeNull();
  });

  it('REPORTS a leg cost nobody attributed rather than hiding it', async () => {
    // Moving it would mean guessing which consignment it was for, and a
    // real number against the wrong parcel is worse than an unassigned
    // one. Leaving it unmentioned means the leg's margin reads better
    // than it is while the money sits in a total nobody breaks down.
    const svc = makeSut({
      unattributed: [{ signedAmount: D('-2000') }, { signedAmount: D('-500') }],
    });
    const r = await svc.report(FROM, TO);
    expect(r.unattributedLegCosts).not.toBeNull();
    expect(r.unattributedLegCosts?.amountInr).toBe('2500.00');
    expect(r.unattributedLegCosts?.count).toBe(2);
  });

  it('says nothing when there is nothing to say', async () => {
    const svc = makeSut({});
    const r = await svc.report(FROM, TO);
    expect(r.unattributedLegCosts).toBeNull();
  });
});

describe('the tax deducted from a COD is OURS', () => {
  it('reports it as revenue with no cost side', async () => {
    /*
      Reversed on 2026-09-07. It was reported as money held for the
      government, on the reading that we file a return against it. We
      do not: the courier bills GST on the shipping alongside their own
      charge and remits it, so there is no separate filing of ours
      behind this deduction.

      Reporting it as a liability made the business look poorer than it
      is AND implied an obligation that does not exist — the more
      dangerous half, because a liability nobody can discharge sits on
      the books forever.
    */
    const svc = makeSut({ codTax: D('608.64') });
    const r = await svc.report(FROM, TO);
    const line = r.lines.find((l) => l.key === 'cod_tax');
    expect(line?.revenueInr).toBe('608.64');
    expect(line?.costInr).toBe('0.00');
    expect(line?.marginInr).toBe('608.64');
    // Nothing is spent to collect it, and an empty cost basis says so
    // more honestly than a zero would.
    expect(line?.basis.cost).toHaveLength(0);
  });

  it('does NOT take the RTO fee as its figure', async () => {
    // Two lines read seller_wallet_entries now. Answering both from the
    // same aggregate would count one sum twice — the exact shape of
    // double count this report exists to avoid.
    const svc = makeSut({ rtoFees: D('200.00'), codTax: D('608.64') });
    const r = await svc.report(FROM, TO);
    expect(r.lines.find((l) => l.key === 'rto')?.revenueInr).toBe('200.00');
    expect(r.lines.find((l) => l.key === 'cod_tax')?.revenueInr).toBe('608.64');
  });
});
