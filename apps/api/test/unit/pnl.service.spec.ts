import { Prisma } from '@skydrop/db';
import { PnlService } from '../../src/modules/treasury/services/pnl.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

function makeSut(opts: {
  freight?: Array<{ totalInr: Prisma.Decimal; ourCostInr: Prisma.Decimal | null }>;
  shippingRevenue?: Prisma.Decimal | null;
  shipments?: Array<{ actualCourierCostInr: Prisma.Decimal | null }>;
  rtoFees?: Prisma.Decimal | null;
  returned?: Array<{ actualCourierCostInr: Prisma.Decimal | null }>;
  fxSpread?: Prisma.Decimal | null;
  expenses?: Prisma.Decimal | null;
}) {
  const client = {
    inboundFreightCharge: { findMany: async () => opts.freight ?? [] },
    orderCharge: {
      aggregate: async () => ({ _sum: { amountInr: opts.shippingRevenue ?? null } }),
    },
    shipment: {
      findMany: async (args: { where: Record<string, unknown> }) =>
        // The RTO line selects on rtoReceivedAt; delivery selects on awbNumber.
        'rtoReceivedAt' in args.where ? (opts.returned ?? []) : (opts.shipments ?? []),
    },
    sellerWalletEntry: {
      aggregate: async () => ({ _sum: { amount: opts.rtoFees ?? null } }),
    },
    bankEntry: {
      aggregate: async (args: { where: { type: string } }) => ({
        _sum: {
          signedAmount:
            args.where.type === 'FX_SPREAD' ? (opts.fxSpread ?? null) : (opts.expenses ?? null),
        },
      }),
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
      returned: [{ actualCourierCostInr: D('20') }],
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
      returned: [{ actualCourierCostInr: D('150') }], // +50
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

  it('an empty window is zero everywhere, and complete', async () => {
    const svc = makeSut({});
    const r = await svc.report(FROM, TO);
    expect(r.grossMarginInr).toBe('0.00');
    expect(r.netInr).toBe('0.00');
    expect(r.complete).toBe(true);
  });
});
