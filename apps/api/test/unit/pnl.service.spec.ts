import { Prisma } from '@skydrop/db';
import { PnlService } from '../../src/modules/treasury/services/pnl.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import { ShipmentCostService } from '../../src/modules/treasury/services/shipment-cost.service';

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

/** The filter the COUNTED courier-adjustments query was called with, last time. */
let adjustmentWhere: Record<string, unknown> | undefined;
/** The filter of the query that measures what the cutover left out, if it ran. */
let excludedWhere: Record<string, unknown> | undefined;
/** The filter the OPERATING-expenses aggregate was called with, last time. */
let expensesWhere: Record<string, unknown> | undefined;
/** The filter of the delivery-fee refunds query, last time. */
let refundWhere: Record<string, unknown> | undefined;
/** The filter of the bank-reconciliation query, last time. */
let reconciliationWhere: Record<string, unknown> | undefined;

type Grouped = { kind: string; _sum: { amountInr: Prisma.Decimal }; _count: { _all: number } };

function makeSut(opts: {
  freight?: Array<{
    totalInr: Prisma.Decimal;
    ourCostInr: Prisma.Decimal | null;
    status?: string;
    amountSettledInr?: Prisma.Decimal;
  }>;
  /** Grouped adjustment rows, as the ledger would return them. */
  courierAdjustments?: Grouped[];
  /** Adjustments dated before the cutover, as the second query returns them. */
  preCutoverAdjustments?: Grouped[];
  /** `pnl.courier_adjustments_from`; absent = the setting is cleared. */
  cutover?: Date | null;
  /** Delivery-cohort order charges (parcels NOT received back). */
  shippingRevenue?: Prisma.Decimal | null;
  shipments?: Array<{
    actualCourierCostInr: Prisma.Decimal | null;
    actualRtoCostInr?: Prisma.Decimal | null;
  }>;
  /** Returns-cohort order charges: the delivery fee AND the return fee of parcels received back. */
  rtoFees?: Prisma.Decimal | null;
  /** Tax deducted from CODs — OUR revenue since 2026-09-07, not a liability. */
  codTax?: Prisma.Decimal | null;
  /** Delivery fees refunded on cancelled orders still in the delivery cohort. */
  refunds?: Prisma.Decimal | null;
  /** Damage / loss refunds paid to sellers. */
  damage?: Prisma.Decimal | null;
  /** Instant Pay / COD collection fees, grouped by direction. */
  codServiceFees?: Array<{ direction: string; amount: Prisma.Decimal }>;
  returned?: Array<{
    actualRtoCostInr: Prisma.Decimal | null;
    actualCourierCostInr?: Prisma.Decimal | null;
  }>;
  /** FX spread, in rupees (one entry). */
  fxSpread?: Prisma.Decimal | null;
  /** FX spread entries in full — currency and the transfer behind each. */
  fxEntries?: Array<{
    signedAmount: Prisma.Decimal;
    currency: string;
    occurredAt: Date;
    transfer: {
      amountOut: Prisma.Decimal;
      currencyOut: string;
      amountIn: Prisma.Decimal;
      currencyIn: string;
    } | null;
  }>;
  /** INR operating expenses, summed (posted negative). */
  expenses?: Prisma.Decimal | null;
  /** Operating expenses in another currency, one row each. */
  foreignExpenses?: Array<{ signedAmount: Prisma.Decimal; currency: string; occurredAt: Date }>;
  /** A rate row, as fx_rate_history / fx_rates would return it. */
  rate?: { fromCurrency: string; rate: Prisma.Decimal } | null;
  /** Early-COD fees booked against payouts (EXPENSE entries WITH a settlement). */
  codFees?: Prisma.Decimal | null;
  /** Courier PARCEL transactions in the window, grouped by waybill. */
  parcelTxns?: Array<{ awbNumber: string; kind: string; amount: Prisma.Decimal; ref?: string }>;
  /** Live shipments found by their courier ORDER id, holding a different waybill. */
  liveOrderRefs?: Array<{ ref: string; awb: string }>;
  /** Waybills that belong to a live Skydrop shipment. */
  liveAwbs?: string[];
  reconciliation?: Array<{
    id?: string;
    signedAmount: Prisma.Decimal;
    currency: string;
    occurredAt: Date;
  }>;
  /** Reconciliation entries that are their account's FIRST entry (opening balances). */
  openingIds?: string[];
  /** Closed investments; `currency` defaults to INR, as the account's currency. */
  investments?: Array<{
    placedInr: Prisma.Decimal;
    returnedInr: Prisma.Decimal;
    currency?: string;
  }>;
  /**
   * EXPENSE entries filed under a leg category with no consignment
   * behind them — reported rather than moved, because we cannot know
   * which consignment they were for.
   */
  unattributed?: Array<{ signedAmount: Prisma.Decimal }>;
  /** Orders first delivered or lost in the window; default one order. */
  fates?: Array<{ orderId: string; _min: { createdAt: Date } }>;
  /** Of those, orders whose parcel came back anyway. */
  cameBack?: Array<{ orderId: string }>;
  /** Parcels with the courier right now. */
  moving?: number;
  /** Waybills of VOIDED Skydrop shipments (same courier). */
  deadAwbs?: string[];
  /** Waybills of live shipments of ANOTHER courier. */
  otherCourierAwbs?: string[];
  /** Today's rate, used when a day has none recorded. */
  todayRate?: { fromCurrency: string; rate: Prisma.Decimal } | null;
  /** Shortfalls recognised on payout lines (negative = a recovery). */
  shortfalls?: Prisma.Decimal[];
  /** Deductions returned on reversed CODs: the tax, and the fees. */
  taxReturned?: Prisma.Decimal | null;
  feesReturned?: Prisma.Decimal | null;
}) {
  adjustmentWhere = undefined;
  excludedWhere = undefined;
  expensesWhere = undefined;
  refundWhere = undefined;
  reconciliationWhere = undefined;
  // Delivery reads its orders by id (the fate cohort); returns reaches
  // them through a shipment received back in the window.
  const cohort = (where: Record<string, unknown>): 'delivery' | 'returns' =>
    where['orderId'] !== undefined ? 'delivery' : 'returns';
  const chargeSum = (where: Record<string, unknown>): Prisma.Decimal | null =>
    cohort(where) === 'delivery' ? (opts.shippingRevenue ?? null) : (opts.rtoFees ?? null);
  const client = {
    systemSetting: {
      findUnique: async () => (opts.cutover == null ? null : { valueDate: opts.cutover }),
    },
    inboundFreightCharge: {
      findMany: async () =>
        (opts.freight ?? []).map((f) => ({
          status: 'PENDING',
          amountSettledInr: D('0'),
          ...f,
        })),
    },
    // Courier ledger reads: account adjustments (counted window with lte,
    // and what a cutover left out with lt), and PARCEL charges grouped by
    // waybill for the no-Skydrop-parcel line.
    courierWalletTransaction: {
      groupBy: async (args: { where: Record<string, unknown> }) => {
        if (args.where['category'] === 'PARCEL') {
          return (opts.parcelTxns ?? []).map((t) => ({
            courierAccountId: 'acct-1',
            awbNumber: t.awbNumber,
            courierOrderRef: t.ref ?? null,
            kind: t.kind,
            _sum: { amountInr: t.amount },
          }));
        }
        const window = args.where['occurredAt'] as Record<string, unknown>;
        if ('lt' in window) {
          excludedWhere = args.where;
          return opts.preCutoverAdjustments ?? [];
        }
        adjustmentWhere = args.where;
        return opts.courierAdjustments ?? [];
      },
    },

    orderCharge: {
      aggregate: async (args: { where: Record<string, unknown> }) => ({
        _sum: { amountInr: chargeSum(args.where) },
      }),
      // The same revenue, split by charge type for the line's basis.
      groupBy: async (args: { where: Record<string, unknown> }) => {
        const sum = chargeSum(args.where);
        return sum == null
          ? []
          : [
              {
                type: cohort(args.where) === 'delivery' ? 'BASE_SHIPPING' : 'RTO_FEE',
                _sum: { amountInr: sum },
                _count: { _all: 1 },
              },
            ];
      },
    },
    shipment: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        // The no-Skydrop-parcel line asks which waybills are live parcels.
        const ors =
          (args.where['OR'] as Array<Record<string, { in?: string[] }>> | undefined) ?? [];
        const inList =
          (args.where['awbNumber'] as { in?: string[] } | undefined)?.in ??
          ors.find((o) => o['awbNumber'] !== undefined)?.['awbNumber']?.in;
        if (inList !== undefined) {
          // Every shipment that ever carried the waybill — live ones of the
          // account's courier, voided ones, live ones of ANOTHER courier
          // that merely share the number — or that is the order a charge
          // names under a waybill since replaced.
          const refList =
            ors.find((o) => o['courierOrderId'] !== undefined)?.['courierOrderId']?.in ?? [];
          const row = (
            a: string,
            courierCode: string,
            deletedAt: Date | null,
            courierOrderId: string | null = null,
          ) => ({ awbNumber: a, courierOrderId, courierCode, deletedAt, supersededAt: null });
          return [
            ...(opts.liveAwbs ?? []).map((a) => row(a, 'delhivery', null)),
            ...(opts.deadAwbs ?? []).map((a) => row(a, 'delhivery', FROM)),
            ...(opts.otherCourierAwbs ?? []).map((a) => row(a, 'shiprocket', null)),
            ...(opts.liveOrderRefs ?? []).map((o) => row(o.awb, 'delhivery', null, o.ref)),
          ].filter(
            (s) =>
              inList.includes(s.awbNumber) ||
              (s.courierOrderId !== null && refList.includes(s.courierOrderId)),
          );
        }
        // BOTH cohort queries mention rtoReceivedAt — the delivery line
        // filters it to null, the returns line uses a date range.
        return args.where['rtoReceivedAt'] === null
          ? (opts.shipments ?? [])
          : (opts.returned ?? []);
      },
      // Parcels still with the courier — on no line yet.
      count: async () => opts.moving ?? 0,
    },
    // The fate cohort: orders first delivered (or lost) in the window.
    orderEvent: {
      groupBy: async () => opts.fates ?? [{ orderId: 'o-del', _min: { createdAt: FROM } }],
    },
    // Orders of that cohort whose parcel came back anyway.
    orderShipment: { findMany: async () => opts.cameBack ?? [] },
    courierAccount: {
      findMany: async () => [{ id: 'acct-1', courier: { code: 'delhivery' } }],
    },
    sellerWalletEntry: {
      // Keyed on DIRECTION, never answered the same way twice: several
      // lines read this table, and a fake that ignored the filter would
      // feed one line's money into another — the double count the report
      // exists to avoid.
      aggregate: async (args: { where: Record<string, unknown> }) => {
        const dir = args.where['direction'];
        if (dir === 'ORDER_CHARGES_REFUND') refundWhere = args.where;
        if (dir === 'COD_DEDUCTION_REFUND') {
          const linked = (
            (args.where['linkedEntry'] as Record<string, unknown>)['direction'] as { in: string[] }
          ).in;
          const amt = linked.includes('GST_WITHHOLDING')
            ? (opts.taxReturned ?? null)
            : (opts.feesReturned ?? null);
          return { _sum: { amount: amt }, _count: { _all: amt === null ? 0 : 1 } };
        }
        const amount =
          dir === 'GST_WITHHOLDING'
            ? (opts.codTax ?? null)
            : dir === 'ORDER_CHARGES_REFUND'
              ? (opts.refunds ?? null)
              : dir === 'SCRAP_REFUND'
                ? (opts.damage ?? null)
                : null;
        return { _sum: { amount }, _count: { _all: amount === null ? 0 : 1 } };
      },
      groupBy: async () =>
        (opts.codServiceFees ?? []).map((f) => ({
          direction: f.direction,
          _sum: { amount: f.amount },
          _count: { _all: 1 },
        })),
    },
    bankEntry: {
      // Operating expenses in rupees (EXPENSE linked to nothing), and the
      // COD-fee line (EXPENSE linked to a settlement).
      aggregate: async (args: { where: Record<string, unknown> }) => {
        if (args.where['settlementId'] !== null && args.where['settlementId'] !== undefined) {
          return {
            _sum: { signedAmount: opts.codFees ?? null },
            _count: { _all: opts.codFees == null ? 0 : 1 },
          };
        }
        expensesWhere = args.where;
        return { _sum: { signedAmount: opts.expenses ?? null }, _count: { _all: 1 } };
      },
      findMany: async (args: { where: Record<string, unknown> }) => {
        const type = args.where['type'];
        if (type === 'FX_SPREAD') {
          if (opts.fxEntries !== undefined) return opts.fxEntries;
          return opts.fxSpread == null
            ? []
            : [
                {
                  signedAmount: opts.fxSpread,
                  currency: 'INR',
                  occurredAt: FROM,
                  transfer: null,
                },
              ];
        }
        if (type === 'RECONCILIATION_ADJUSTMENT') {
          reconciliationWhere = args.where;
          return (opts.reconciliation ?? []).map((r, i) => ({
            id: `rec-${i}`,
            accountId: 'acct-1',
            ...r,
          }));
        }
        if (args.where['expenseCategory'] !== undefined) {
          return (opts.unattributed ?? []).map((u) => ({
            currency: 'INR',
            occurredAt: FROM,
            ...u,
          }));
        }
        // Operating expenses in another currency.
        return opts.foreignExpenses ?? [];
      },
      // Is there an earlier entry on this account? None ⇒ an opening balance.
      findFirst: async (args: { where: { id: { lt: string } } }) =>
        (opts.openingIds ?? []).includes(args.where.id.lt) ? null : { id: 'earlier' },
    },
    // Payout lines' recognised shortfalls, split by sign as the line asks.
    courierSettlementLine: {
      aggregate: async (args: { where: Record<string, unknown> }) => {
        const positive = 'gt' in (args.where['shortfallInr'] as Record<string, unknown>);
        const rows = (opts.shortfalls ?? []).filter((s) => (positive ? s.gt(0) : s.lt(0)));
        return {
          _sum: { shortfallInr: rows.length === 0 ? null : rows.reduce((t, s) => t.add(s)) },
          _count: { _all: rows.length },
        };
      },
    },
    investment: {
      findMany: async () =>
        (opts.investments ?? []).map((i) => ({ currency: 'INR', closedAt: FROM, ...i })),
    },
    fxRateHistory: { findFirst: async () => opts.rate ?? null },
    // Today's rate — the fallback when nothing was recorded for a day.
    fxRate: { findFirst: async () => opts.todayRate ?? null },
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
    // A parcel received back belongs to the returns line alone. The
    // `rtoReceivedAt: null` filter is what keeps the two lines disjoint,
    // so the fake distinguishes the two queries.
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

  it('a parcel on its way BACK still costs something on the delivery line', async () => {
    // Delhivery has turned it round and netted the refund (COST-1): ₹0
    // forward, the whole ₹151.91 on the return column — and we have not
    // received it. Reading the forward column alone showed it as free,
    // and a parcel LOST on the way back never showed up anywhere.
    const svc = makeSut({
      shipments: [{ actualCourierCostInr: D('0'), actualRtoCostInr: D('151.91') }],
    });
    const r = await svc.report(FROM, TO);

    expect(r.lines.find((l) => l.key === 'delivery')?.costInr).toBe('151.91');
  });

  it('a returned parcel billed on BOTH legs counts both on the returns line', async () => {
    // A manual courier bills the delivery and the return and refunds
    // neither. The return column alone dropped the ₹62 from every line.
    const svc = makeSut({
      returned: [{ actualCourierCostInr: D('62'), actualRtoCostInr: D('48') }],
    });
    const r = await svc.report(FROM, TO);

    expect(r.lines.find((l) => l.key === 'rto')?.costInr).toBe('110.00');
  });

  it('an empty window is zero everywhere, and complete', async () => {
    const svc = makeSut({});
    const r = await svc.report(FROM, TO);
    expect(r.grossMarginInr).toBe('0.00');
    expect(r.netInr).toBe('0.00');
    expect(r.complete).toBe(true);
  });
});

describe('COD the courier short-paid or reversed', () => {
  it('a short-payment we absorbed is a cost, and a later recovery comes back off it', async () => {
    const svc = makeSut({ shortfalls: [D('50'), D('30'), D('-20')] });
    const r = await svc.report(FROM, TO);
    const line = r.lines.find((l) => l.key === 'cod_shortfall');
    expect(line).toMatchObject({ revenueInr: '0.00', costInr: '60.00' });
    expect(r.grossMarginInr).toBe('-60.00');
  });

  it('tax withheld on a COD the courier reversed is not revenue', async () => {
    const svc = makeSut({ codTax: D('152.54'), taxReturned: D('152.54') });
    const r = await svc.report(FROM, TO);
    expect(r.lines.find((l) => l.key === 'cod_tax')?.revenueInr).toBe('0.00');
  });

  it('a fee taken on a reversed COD comes off the COD handling fees', async () => {
    const svc = makeSut({
      codServiceFees: [{ direction: 'INSTANT_PAY_FEE', amount: D('50.00') }],
      feesReturned: D('21.19'),
    });
    const r = await svc.report(FROM, TO);
    expect(r.lines.find((l) => l.key === 'cod_service_fees')?.revenueInr).toBe('28.81');
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
      systemSetting: { findUnique: async () => null },
      inboundFreightCharge: { findMany: async () => [] },
      courierWalletTransaction: { groupBy: async () => [] },
      orderCharge: {
        aggregate: async () => ({ _sum: { amountInr: null } }),
        groupBy: async () => [],
      },
      shipment: { findMany: async () => [], count: async () => 0 },
      orderEvent: { groupBy: async () => [] },
      sellerWalletEntry: {
        aggregate: async () => ({ _sum: { amount: null }, _count: { _all: 0 } }),
        groupBy: async () => [],
      },
      courierSettlementLine: {
        aggregate: async () => ({ _sum: { shortfallInr: null }, _count: { _all: 0 } }),
      },
      investment: { findMany: async () => [] },
      bankEntry: {
        aggregate: async (args: { where: Record<string, unknown> }) => {
          // The operating-expenses query: EXPENSE linked to no settlement
          // (a settlement-linked one is the COD-fee line's).
          if (args.where['type'] === 'EXPENSE' && args.where['settlementId'] === null) {
            scoped = args.where['inboundFreightChargeId'];
          }
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

/**
 * What the courier charged the ACCOUNT rather than a parcel.
 *
 * Their ledger carries monthly reconciliations, lost-shipment
 * settlements and fraud credit notes — 37 of 23,276 rows over ninety
 * days, and 36 of those name a waybill despite having nothing to do
 * with what moving that box cost. They get their own line so a fraud
 * settlement cannot quietly make a parcel look profitable.
 */
describe('PnlService — courier account adjustments', () => {
  const adj = (kind: string, amount: string, count = 1) => ({
    kind,
    _sum: { amountInr: new Prisma.Decimal(amount) },
    _count: { _all: count },
  });

  it('a debit is a cost and a credit gives it back', async () => {
    const svc = makeSut({
      courierAdjustments: [adj('DEBIT', '2100.00', 36), adj('CREDIT', '1290.00', 1)],
    });
    const out = await svc.report(new Date('2026-06-01'), new Date('2026-09-01'));
    const line = out.lines.find((l) => l.key === 'courier_adjustments');
    expect(line?.costInr).toBe('810.00');
  });

  it('has NO revenue — nobody was billed for any of it', async () => {
    const svc = makeSut({ courierAdjustments: [adj('DEBIT', '500.00')] });
    const out = await svc.report(new Date('2026-06-01'), new Date('2026-09-01'));
    const line = out.lines.find((l) => l.key === 'courier_adjustments');
    expect(line?.revenueInr).toBe('0.00');
    expect(line?.marginInr).toBe('-500.00');
  });

  it('counts as fully MEASURED, because it is read from their ledger', async () => {
    // Not an estimate and not uncovered: every row is a fact the
    // courier stated. Reporting it as unpriced would make the P&L
    // understate its own completeness.
    const svc = makeSut({ courierAdjustments: [adj('DEBIT', '500.00', 3)] });
    const out = await svc.report(new Date('2026-06-01'), new Date('2026-09-01'));
    const line = out.lines.find((l) => l.key === 'courier_adjustments');
    expect(line?.coverage).toMatchObject({ priced: 3, total: 3 });
  });

  it('is silent when the courier made none', async () => {
    const svc = makeSut({});
    const out = await svc.report(new Date('2026-06-01'), new Date('2026-09-01'));
    const line = out.lines.find((l) => l.key === 'courier_adjustments');
    expect(line?.costInr).toBe('0.00');
    expect(line?.coverage.note).toBeNull();
  });
});

/**
 * Courier expenses are counted on the day they happened, once, and only
 * while they still move money.
 */
describe('courier account adjustments — what the P&L counts', () => {
  it('counts by the TRANSACTION date, successful only, and never a dropped one', async () => {
    const svc = makeSut({});
    await svc.report(FROM, TO);

    expect(adjustmentWhere).toMatchObject({
      occurredAt: { gte: FROM, lte: TO },
      status: 'success',
      // Kept as evidence when their ledger drops it — but it no longer
      // moves money, so it must not move the P&L either.
      missingFromExportAt: null,
    });
  });

  it('counts debits and credits separately, and nets them', async () => {
    const svc = makeSut({
      courierAdjustments: [
        { kind: 'DEBIT', _sum: { amountInr: D('58.83') }, _count: { _all: 1 } },
        { kind: 'CREDIT', _sum: { amountInr: D('1290') }, _count: { _all: 2 } },
      ],
    });
    const r = await svc.report(FROM, TO);
    const line = r.lines.find((l) => l.key === 'courier_adjustments');

    expect(line?.costInr).toBe('-1231.17');
    expect(line?.basis.cost.map((b) => b.count)).toEqual([1, 2]);
  });
});

/**
 * Before 1 Oct 2026 the courier accounts carried the business's parcels
 * shipped OUTSIDE Skydrop — 12,941 of 12,970 waybills in the first 90
 * days. Their costs and revenue are not in the report, so their account
 * adjustments must not be either.
 */
describe('courier account adjustments — only from the cutover', () => {
  const CUTOVER = new Date('2026-09-30T18:30:00.000Z'); // 1 Oct 2026, 00:00 IST
  const adj = (kind: string, amount: string, count = 1) => ({
    kind,
    _sum: { amountInr: D(amount) },
    _count: { _all: count },
  });

  it('counts from the cutover when it falls inside the window, and says what it left out', async () => {
    const from = new Date('2026-09-15T00:00:00.000Z');
    const to = new Date('2026-10-15T00:00:00.000Z');
    const svc = makeSut({
      cutover: CUTOVER,
      courierAdjustments: [adj('DEBIT', '100.00')],
      preCutoverAdjustments: [adj('DEBIT', '9206.66'), adj('CREDIT', '10560.00', 2)],
    });
    const r = await svc.report(from, to);
    const line = r.lines.find((l) => l.key === 'courier_adjustments');

    expect(adjustmentWhere).toMatchObject({ occurredAt: { gte: CUTOVER, lte: to } });
    expect(excludedWhere).toMatchObject({ occurredAt: { gte: from, lt: CUTOVER } });
    expect(line?.costInr).toBe('100.00');
    expect(line?.coverage.note).toMatch(/3 adjustment\(s\) dated before 1 Oct 2026/);
    expect(line?.coverage.note).toMatch(/net credit ₹1353\.34/);
  });

  it('a window wholly before the cutover counts nothing — and still says why', async () => {
    const svc = makeSut({
      cutover: CUTOVER,
      courierAdjustments: [adj('DEBIT', '999.00')], // would be wrong to count
      preCutoverAdjustments: [adj('CREDIT', '500.00')],
    });
    const r = await svc.report(FROM, TO); // August
    const line = r.lines.find((l) => l.key === 'courier_adjustments');

    expect(adjustmentWhere).toBeUndefined();
    expect(excludedWhere).toMatchObject({ occurredAt: { gte: FROM, lt: TO } });
    expect(line?.costInr).toBe('0.00');
    expect(line?.coverage.note).toMatch(/not counted/);
  });

  it('a window wholly after the cutover counts everything in it, with no second query', async () => {
    const from = new Date('2026-11-01T00:00:00.000Z');
    const to = new Date('2026-11-30T00:00:00.000Z');
    const svc = makeSut({ cutover: CUTOVER, courierAdjustments: [adj('DEBIT', '40.00')] });
    const r = await svc.report(from, to);

    expect(adjustmentWhere).toMatchObject({ occurredAt: { gte: from, lte: to } });
    expect(excludedWhere).toBeUndefined();
    expect(r.lines.find((l) => l.key === 'courier_adjustments')?.costInr).toBe('40.00');
  });

  it('with the setting cleared every adjustment counts', async () => {
    const svc = makeSut({ cutover: null, courierAdjustments: [adj('DEBIT', '40.00')] });
    await svc.report(FROM, TO);
    expect(adjustmentWhere).toMatchObject({ occurredAt: { gte: FROM, lte: TO } });
    expect(excludedWhere).toBeUndefined();
  });
});

/**
 * A courier's early-COD fee never passes through its wallet — it is
 * taken out of the COD payout and invoiced separately — so the wallet
 * sync cannot see it. Recording the payout books it as an EXPENSE entry
 * linked to the settlement; the P&L counts it on its own line, and only
 * there.
 */
describe('courier COD fees', () => {
  it('are their own cost line, and NOT also an operating expense', async () => {
    const svc = makeSut({ codFees: D('-90'), expenses: D('-325') });
    const r = await svc.report(FROM, TO);
    const line = r.lines.find((l) => l.key === 'courier_cod_fees');

    expect(line?.costInr).toBe('90.00');
    expect(line?.revenueInr).toBe('0.00');
    expect(line?.coverage).toMatchObject({ priced: 1, total: 1 });
    // The operating-expenses query leaves settlement-linked entries out.
    expect(expensesWhere).toMatchObject({ type: 'EXPENSE', settlementId: null });
    expect(r.operatingExpensesInr).toBe('325.00');
    expect(r.grossMarginInr).toBe('-90.00');
    expect(r.netInr).toBe('-415.00');
  });

  it('is zero and complete when no payout carried a fee', async () => {
    const svc = makeSut({});
    const r = await svc.report(FROM, TO);
    const line = r.lines.find((l) => l.key === 'courier_cod_fees');
    expect(line?.costInr).toBe('0.00');
    expect(r.complete).toBe(true);
  });
});

/**
 * Every rupee the business earns or spends, on some line — measured on
 * production 2026-09-11: the Returns line showed ₹30 of revenue against a
 * parcel's whole round trip, Instant Pay fees and damage refunds were on
 * no line at all, and taka amounts were added as rupees.
 */
describe('the P&L counts what it used to miss', () => {
  const line = (r: Awaited<ReturnType<PnlService['report']>>, key: string) =>
    r.lines.find((l) => l.key === key);

  it('a returned parcel earns its delivery fee AND its return fee', async () => {
    // ₹200 delivery + ₹30 return, both charge lines on the returned order.
    const svc = makeSut({ rtoFees: D('230'), returned: [{ actualRtoCostInr: D('151.91') }] });
    const r = await svc.report(FROM, TO);
    expect(line(r, 'rto')).toMatchObject({ revenueInr: '230.00', costInr: '151.91' });
  });

  it('takes a refunded delivery fee back off delivery revenue', async () => {
    const svc = makeSut({ shippingRevenue: D('600'), refunds: D('200') });
    const r = await svc.report(FROM, TO);
    expect(line(r, 'delivery')?.revenueInr).toBe('400.00');
    // Only refunds on orders IN the delivery cohort.
    expect(refundWhere).toMatchObject({
      direction: 'ORDER_CHARGES_REFUND',
      linkedOrderId: { in: ['o-del'] },
    });
  });

  it('a waived freight bill earns only what was charged before the waiver', async () => {
    const svc = makeSut({
      freight: [
        { totalInr: D('1000'), ourCostInr: D('600') },
        { totalInr: D('800'), ourCostInr: D('500'), status: 'WAIVED', amountSettledInr: D('300') },
      ],
    });
    const r = await svc.report(FROM, TO);
    expect(line(r, 'inbound_freight')).toMatchObject({ revenueInr: '1300.00', costInr: '1100.00' });
  });

  it('counts Instant Pay and COD collection fees as revenue', async () => {
    const svc = makeSut({
      codServiceFees: [
        { direction: 'INSTANT_PAY_FEE', amount: D('82.60') },
        { direction: 'COD_COLLECTION_FEE', amount: D('10.00') },
      ],
    });
    const r = await svc.report(FROM, TO);
    expect(line(r, 'cod_service_fees')).toMatchObject({ revenueInr: '92.60', costInr: '0.00' });
  });

  it('counts what we paid sellers for damaged or lost goods as a cost', async () => {
    const svc = makeSut({ damage: D('1250') });
    const r = await svc.report(FROM, TO);
    expect(line(r, 'damage_refunds')).toMatchObject({ costInr: '1250.00', marginInr: '-1250.00' });
  });

  it('a charge under a waybill Shiprocket replaced is that parcel’s, not “no Skydrop parcel”', async () => {
    // Filed under the old waybill, naming the order our live parcel is.
    // The importer nets it into that parcel's cost, so counting it here as
    // well would count it twice — and before this it was counted ONLY here.
    const svc = makeSut({
      parcelTxns: [{ awbNumber: 'OLD-AWB', kind: 'DEBIT', amount: D('60'), ref: 'SR-ORDER-1' }],
      liveOrderRefs: [{ ref: 'SR-ORDER-1', awb: 'NEW-AWB' }],
    });
    const r = await svc.report(FROM, TO);
    expect(r.lines.find((l) => l.key === 'courier_unmatched')?.costInr).toBe('0.00');
  });

  it('counts courier charges on a waybill that is no live Skydrop parcel — and only those', async () => {
    const svc = makeSut({
      parcelTxns: [
        { awbNumber: 'OURS', kind: 'DEBIT', amount: D('90.36') }, // already on its parcel
        { awbNumber: 'VOIDED', kind: 'DEBIT', amount: D('48.36') },
        { awbNumber: 'VOIDED', kind: 'CREDIT', amount: D('10.00') },
      ],
      liveAwbs: ['OURS'],
    });
    const r = await svc.report(FROM, TO);
    expect(line(r, 'courier_unmatched')).toMatchObject({ costInr: '38.36' });
    expect(line(r, 'courier_unmatched')?.coverage).toMatchObject({ priced: 1, total: 1 });
  });

  it('puts a taka FX spread in rupees at its own transfer’s rate', async () => {
    // ₹10,000 sent, ৳13,200 received: a taka is 10000/13200 of a rupee.
    const svc = makeSut({
      fxEntries: [
        {
          signedAmount: D('132'),
          currency: 'BDT',
          occurredAt: FROM,
          transfer: {
            amountOut: D('10000'),
            currencyOut: 'INR',
            amountIn: D('13200'),
            currencyIn: 'BDT',
          },
        },
      ],
    });
    const r = await svc.report(FROM, TO);
    expect(line(r, 'fx')?.revenueInr).toBe('100.00');
  });

  it('puts a taka expense in rupees at the rate that day — and leaves one out, loudly, when there is none', async () => {
    const withRate = makeSut({
      expenses: D('-500'),
      foreignExpenses: [{ signedAmount: D('-1320'), currency: 'BDT', occurredAt: FROM }],
      rate: { fromCurrency: 'INR', rate: D('1.32') }, // 1 INR = 1.32 BDT
    });
    const a = await withRate.report(FROM, TO);
    expect(a.operatingExpensesInr).toBe('1500.00');
    expect(a.warnings).toEqual([]);

    const noRate = makeSut({
      expenses: D('-500'),
      foreignExpenses: [{ signedAmount: D('-1320'), currency: 'BDT', occurredAt: FROM }],
      rate: null,
    });
    const b = await noRate.report(FROM, TO);
    expect(b.operatingExpensesInr).toBe('500.00');
    expect(b.complete).toBe(false);
    expect(b.warnings[0]).toMatch(/no exchange rate/);
  });

  it('counts OUR bank reconciliation differences and investment income', async () => {
    const svc = makeSut({
      reconciliation: [{ signedAmount: D('-35.40'), currency: 'INR', occurredAt: FROM }],
      investments: [{ placedInr: D('100000'), returnedInr: D('101500') }],
    });
    const r = await svc.report(FROM, TO);
    expect(line(r, 'bank_reconciliation')?.revenueInr).toBe('-35.40');
    expect(reconciliationWhere).toMatchObject({ ownerKind: 'CAPITAL' });
    expect(line(r, 'investment_income')?.revenueInr).toBe('1500.00');
  });

  it('an account’s OPENING balance is capital put in, not income — and it says so', async () => {
    // Production shipped with a ৳100,000 "Initial Balance" read as
    // ₹81,300.81 of profit.
    const svc = makeSut({
      reconciliation: [
        { id: 'open', signedAmount: D('100000'), currency: 'INR', occurredAt: FROM },
        { id: 'later', signedAmount: D('-12.00'), currency: 'INR', occurredAt: FROM },
      ],
      openingIds: ['open'],
    });
    const r = await svc.report(FROM, TO);
    const recon = line(r, 'bank_reconciliation');
    expect(recon?.revenueInr).toBe('-12.00');
    expect(recon?.coverage).toMatchObject({ priced: 1, total: 1 });
    expect(recon?.coverage.note).toContain('opening balance');
    expect(r.netInr).toBe('-12.00');
  });
});

/**
 * A parcel's revenue and cost are recognised when its FATE is known —
 * delivered (or lost), or received back — never at booking. On production
 * the delivery line counted ₹3,800 of ₹6,000 on orders never billed:
 * cancelled ones, and parcels still moving.
 */
describe('recognised when the parcel’s fate is known', () => {
  const line = (r: Awaited<ReturnType<PnlService['report']>>, key: string) =>
    r.lines.find((l) => l.key === key);

  it('an order not yet delivered earns nothing on the delivery line, however it was billed', async () => {
    const svc = makeSut({
      fates: [],
      shippingRevenue: D('600'),
      shipments: [{ actualCourierCostInr: D('90') }],
      moving: 3,
    });
    const r = await svc.report(FROM, TO);
    expect(line(r, 'delivery')).toMatchObject({ revenueInr: '0.00', costInr: '0.00' });
    expect(line(r, 'delivery')?.coverage.note).toMatch(/3 parcels are with the courier/);
  });

  it('a delivered order that came back anyway is on the RETURNS line only', async () => {
    const svc = makeSut({
      fates: [{ orderId: 'o-1', _min: { createdAt: FROM } }],
      cameBack: [{ orderId: 'o-1' }],
      shippingRevenue: D('200'),
      shipments: [{ actualCourierCostInr: D('90') }],
    });
    const r = await svc.report(FROM, TO);
    expect(line(r, 'delivery')?.revenueInr).toBe('0.00');
  });

  it('charges on a VOIDED Skydrop parcel count whatever the cutover; a stranger’s only after it', async () => {
    // August, before the 1 Oct cutover.
    const svc = makeSut({
      cutover: new Date('2026-09-30T18:30:00.000Z'),
      parcelTxns: [
        { awbNumber: 'DEAD', kind: 'DEBIT', amount: D('40.00') },
        { awbNumber: 'STRANGER', kind: 'DEBIT', amount: D('25.00') },
      ],
      deadAwbs: ['DEAD'],
    });
    const r = await svc.report(FROM, TO);
    expect(line(r, 'courier_unmatched')?.costInr).toBe('40.00');
  });

  it('a live parcel of ANOTHER courier sharing the waybill does not absorb the charge', async () => {
    const svc = makeSut({
      cutover: null,
      parcelTxns: [{ awbNumber: 'SHARED', kind: 'DEBIT', amount: D('33.00') }],
      otherCourierAwbs: ['SHARED'],
    });
    const r = await svc.report(FROM, TO);
    expect(line(r, 'courier_unmatched')?.costInr).toBe('33.00');
  });

  it('investment income on a taka account is put in rupees at the rate the day it closed', async () => {
    // ৳1,500 earned; 1 INR = 1.32 BDT → ₹1,136.36, not ₹1,500.
    const svc = makeSut({
      investments: [{ placedInr: D('100000'), returnedInr: D('101500'), currency: 'BDT' }],
      rate: { fromCurrency: 'INR', rate: D('1.32') },
    });
    const r = await svc.report(FROM, TO);
    expect(line(r, 'investment_income')?.revenueInr).toBe('1136.36');
  });

  it('an amount converted at TODAY’s rate is converted — and the report says so', async () => {
    const svc = makeSut({
      expenses: D('-500'),
      foreignExpenses: [{ signedAmount: D('-1320'), currency: 'BDT', occurredAt: FROM }],
      rate: null,
      todayRate: { fromCurrency: 'INR', rate: D('1.32') },
    });
    const r = await svc.report(FROM, TO);
    expect(r.operatingExpensesInr).toBe('1500.00');
    expect(r.warnings.some((w) => /today's rate/.test(w))).toBe(true);
  });
});
