import { Injectable } from '@nestjs/common';
import { BankEntryType, Currency, Prisma, WalletEntryDirection } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

const ZERO = new Prisma.Decimal(0);

/**
 * Expense categories whose costs belong to a LEG, not to running the
 * business. Money filed here that is not attributed to a consignment is
 * reported as such rather than quietly inflating operating expenses
 * while its leg's margin reads better than it is.
 *
 * `courier_charges` is on the list for a different reason worth stating:
 * what a courier bills us is already captured per parcel
 * (`shipments.actual_courier_cost_inr`) and is funded out of the prepaid
 * wallet, which is an asset transfer rather than an expense. A payment
 * filed here is therefore either a double count or a cost the delivery
 * line cannot see.
 */
const LEG_EXPENSE_CATEGORIES = ['freight_forwarder', 'courier_charges'];

/** One way the business makes (or loses) money, and how well we can see it. */
export interface PnlLine {
  readonly key: string;
  readonly label: string;
  /** What we charged. */
  readonly revenueInr: string;
  /** What it cost us. */
  readonly costInr: string;
  readonly marginInr: string;
  readonly marginPercent: string | null;
  /**
   * How much of the cost side is MEASURED rather than missing.
   *
   * A margin computed over the third of parcels we happen to have
   * priced is not the business's margin, and presenting it as one is
   * how a bad lane stays invisible. Every line says what it stands on.
   */
  readonly coverage: {
    readonly priced: number;
    readonly total: number;
    readonly note: string | null;
  };
}

export interface PnlReport {
  readonly from: string;
  readonly to: string;
  readonly lines: ReadonlyArray<PnlLine>;
  readonly grossMarginInr: string;
  readonly operatingExpensesInr: string;
  readonly netInr: string;
  /** True when every line's cost side is fully measured. */
  readonly complete: boolean;
  /**
   * Leg costs sitting in operating expenses with no consignment behind
   * them. Null when there are none.
   */
  readonly unattributedLegCosts: {
    readonly amountInr: string;
    readonly count: number;
    readonly note: string;
  } | null;
}

/**
 * Where the money is actually made.
 *
 * Four sources, deliberately kept apart rather than netted into one
 * number: the BD→India leg, the Indian delivery leg, returns, and FX.
 * They have different cost bases and different fixes — a delivery lane
 * losing money is repriced, an FX spread going the wrong way is a
 * treasury decision — and a single "profit" figure would tell you the
 * business was down without telling you which of those to go and look
 * at.
 *
 * NOTHING here is stored. The report is derived on read from ledgers
 * that are already append-only, so a past month cannot silently change
 * shape, and there is no cached total to fall out of date with the
 * entries underneath it.
 */
@Injectable()
export class PnlService {
  constructor(private readonly prisma: PrismaService) {}

  async report(from: Date, to: Date): Promise<PnlReport> {
    const [inbound, delivery, rto, fx, expenses, unattributed] = await Promise.all([
      this.inboundFreight(from, to),
      this.delivery(from, to),
      this.rto(from, to),
      this.fx(from, to),
      this.expenses(from, to),
      this.unattributedLegCosts(from, to),
    ]);

    const lines = [inbound, delivery, rto, fx];
    const gross = lines.reduce((acc, l) => acc.add(new Prisma.Decimal(l.marginInr)), ZERO);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      lines,
      grossMarginInr: gross.toFixed(2),
      operatingExpensesInr: expenses.toFixed(2),
      netInr: gross.sub(expenses).toFixed(2),
      complete: lines.every((l) => l.coverage.priced === l.coverage.total),
      unattributedLegCosts:
        unattributed === null
          ? null
          : {
              amountInr: unattributed.countInr,
              count: unattributed.count,
              note:
                'Recorded as an operating expense with no consignment behind it, so the leg ' +
                'it belongs to reads better than it is. Pay the forwarder from the freight ' +
                'bill instead — that records the cash AND attributes it in one step.',
            },
    };
  }

  /** BD → India. What the seller pays us to bring stock in, less the forwarder. */
  private async inboundFreight(from: Date, to: Date): Promise<PnlLine> {
    const charges = await this.prisma.client.inboundFreightCharge.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { totalInr: true, ourCostInr: true },
    });
    let revenue = ZERO;
    let cost = ZERO;
    let priced = 0;
    for (const c of charges) {
      revenue = revenue.add(c.totalInr);
      if (c.ourCostInr !== null) {
        cost = cost.add(c.ourCostInr);
        priced += 1;
      }
    }
    return this.line({
      key: 'inbound_freight',
      label: 'BD → India freight',
      revenue,
      cost,
      priced,
      total: charges.length,
      note:
        priced < charges.length
          ? 'Some consignments have no forwarder cost recorded, so their margin reads as pure profit. Add it on the freight bill.'
          : null,
    });
  }

  /**
   * The Indian delivery leg. What we bill for carriage, less what the
   * courier charged.
   *
   * BOTH sides are anchored on the SHIPMENT, not one on the charge and
   * one on the parcel. Charges are written at order create and the
   * shipment is provisioned at confirmation — usually hours apart, but
   * across a month boundary that gap puts a parcel's revenue in one
   * report and its cost in the next, and every month then reads as
   * either unusually good or unusually bad for no real reason.
   */
  private async delivery(from: Date, to: Date): Promise<PnlLine> {
    // Revenue is the shipping charges we persisted on the order —
    // deliberately WITHOUT GST, which is the government's and not ours,
    // and without the RTO fee, which prices a second movement and is its
    // own line below.
    // Returned parcels are EXCLUDED, and that is the whole point of
    // splitting the two lines. Delhivery refunds the delivery deduction
    // when a parcel comes back and charges an RTO fee instead, so a
    // return's forward cost is not a cost we bore — counting it here as
    // well as on the returns line would charge the same carriage twice
    // and make both margins wrong in opposite directions.
    const shipmentWindow = {
      deletedAt: null,
      awbNumber: { not: null },
      createdAt: { gte: from, lte: to },
      rtoReceivedAt: null,
    } as const;

    const shipments = await this.prisma.client.shipment.findMany({
      where: shipmentWindow,
      select: { actualCourierCostInr: true },
    });

    // Revenue for exactly those parcels — reached through the orders
    // they belong to, so the two sides describe the same cohort rather
    // than the same calendar window.
    const revenueAgg = await this.prisma.client.orderCharge.aggregate({
      where: {
        deletedAt: null,
        order: { orderShipments: { some: { shipment: shipmentWindow } } },
        type: {
          in: [
            'BASE_SHIPPING',
            'COD_FEE',
            'FUEL_SURCHARGE',
            'REMOTE_AREA_FEE',
            'WEIGHT_DISPUTE_FEE',
          ],
        },
      },
      _sum: { amountInr: true },
    });
    let cost = ZERO;
    let priced = 0;
    for (const s of shipments) {
      if (s.actualCourierCostInr !== null) {
        cost = cost.add(s.actualCourierCostInr);
        priced += 1;
      }
    }

    return this.line({
      key: 'delivery',
      label: 'India delivery',
      revenue: revenueAgg._sum.amountInr ?? ZERO,
      cost,
      priced,
      total: shipments.length,
      note:
        priced < shipments.length
          ? `${shipments.length - priced} parcels have no real courier cost yet — run the margin report over this window to price them.`
          : null,
    });
  }

  /**
   * Returns.
   *
   * Revenue is the RTO fee the seller pays, which is its own wallet
   * direction precisely so this question is answerable.
   *
   * The cost is what the courier charged to bring the parcel BACK, and
   * that is a different number from what they charged to take it out:
   * Delhivery refunds the delivery deduction on a return and bills an
   * RTO fee instead. Keeping them in separate columns is what stops a
   * returned parcel being charged for twice — once on the delivery line
   * and again here.
   */
  private async rto(from: Date, to: Date): Promise<PnlLine> {
    const fees = await this.prisma.client.sellerWalletEntry.aggregate({
      where: {
        direction: WalletEntryDirection.RTO_FEE,
        currency: Currency.INR,
        createdAt: { gte: from, lte: to },
      },
      _sum: { amount: true },
    });
    const returned = await this.prisma.client.shipment.findMany({
      where: {
        deletedAt: null,
        rtoReceivedAt: { gte: from, lte: to },
      },
      select: { actualRtoCostInr: true },
    });
    let cost = ZERO;
    let priced = 0;
    for (const s of returned) {
      // The RTO cost specifically — not the forward one. What the
      // courier charged to bring it back IS what the return cost,
      // because the delivery deduction was refunded.
      if (s.actualRtoCostInr !== null) {
        cost = cost.add(s.actualRtoCostInr);
        priced += 1;
      }
    }
    return this.line({
      key: 'rto',
      label: 'Returns',
      revenue: fees._sum.amount ?? ZERO,
      cost,
      priced,
      total: returned.length,
      note:
        priced < returned.length
          ? `${returned.length - priced} returns have no courier cost recorded, so this margin is flattering.`
          : null,
    });
  }

  /**
   * FX.
   *
   * Fully measured by construction: the spread is POSTED as its own bank
   * entry at the moment a cross-currency transfer happens, so there is
   * no sampling and nothing to estimate. Negative when we honoured a
   * quote the market moved against.
   */
  private async fx(from: Date, to: Date): Promise<PnlLine> {
    const agg = await this.prisma.client.bankEntry.aggregate({
      where: {
        type: BankEntryType.FX_SPREAD,
        occurredAt: { gte: from, lte: to },
      },
      _sum: { signedAmount: true },
    });
    const spread = agg._sum.signedAmount ?? ZERO;
    return {
      key: 'fx',
      label: 'FX spread',
      revenueInr: spread.toFixed(2),
      costInr: '0.00',
      marginInr: spread.toFixed(2),
      marginPercent: null,
      coverage: { priced: 1, total: 1, note: null },
    };
  }

  /**
   * Everything we spend to exist — rent, salaries, software.
   *
   * ── AND NOT WHAT A LEG HAS ALREADY COUNTED ───────────────────────────
   * A payment attributed to a consignment's freight bill is ALREADY in
   * this report, as the cost side of the BD→India line. Counting the
   * same cash again here subtracts it twice — once from gross margin,
   * once from net — and the difference is invisible, because both
   * figures look plausible on their own.
   *
   * That was live: the forwarder payment was recorded on /expenses while
   * `ourCostInr` sat empty, so the freight line read as pure profit and
   * printed a note asking somebody to "add it on the freight bill" —
   * which would have created the double count the moment anyone obeyed.
   * Paying the forwarder from the bill now writes both sides at once
   * (`recordForwarderPayment`), and the link is what tells an ATTRIBUTED
   * cost from a general one.
   *
   * An UNLINKED forwarder payment still counts here, deliberately: it
   * belongs to no consignment, so operating expenses is exactly where it
   * belongs. `unattributedNote` is what stops that being silent.
   */
  private async expenses(from: Date, to: Date): Promise<Prisma.Decimal> {
    const agg = await this.prisma.client.bankEntry.aggregate({
      where: {
        type: BankEntryType.EXPENSE,
        occurredAt: { gte: from, lte: to },
        inboundFreightChargeId: null,
      },
      _sum: { signedAmount: true },
    });
    // Expenses are posted negative (money leaving); report the magnitude.
    return (agg._sum.signedAmount ?? ZERO).abs();
  }

  /**
   * Costs sitting in operating expenses that look like they belong to a
   * leg — a forwarder or courier charge nobody attributed.
   *
   * Reported rather than moved. We cannot know WHICH consignment an
   * unlinked forwarder payment was for, and guessing would put a real
   * number against the wrong parcel; but leaving it unmentioned means a
   * leg's margin reads better than it is while the money hides in a
   * total nobody breaks down.
   */
  private async unattributedLegCosts(
    from: Date,
    to: Date,
  ): Promise<{ countInr: string; count: number } | null> {
    const rows = await this.prisma.client.bankEntry.findMany({
      where: {
        type: BankEntryType.EXPENSE,
        occurredAt: { gte: from, lte: to },
        inboundFreightChargeId: null,
        expenseCategory: { code: { in: LEG_EXPENSE_CATEGORIES } },
      },
      select: { signedAmount: true },
    });
    if (rows.length === 0) return null;
    const total = rows.reduce((t, r) => t.add(r.signedAmount.abs()), ZERO);
    return { countInr: total.toFixed(2), count: rows.length };
  }

  private line(input: {
    key: string;
    label: string;
    revenue: Prisma.Decimal;
    cost: Prisma.Decimal;
    priced: number;
    total: number;
    note: string | null;
  }): PnlLine {
    const margin = input.revenue.sub(input.cost);
    return {
      key: input.key,
      label: input.label,
      revenueInr: input.revenue.toFixed(2),
      costInr: input.cost.toFixed(2),
      marginInr: margin.toFixed(2),
      marginPercent: input.revenue.isZero() ? null : margin.div(input.revenue).mul(100).toFixed(1),
      coverage: {
        priced: input.priced,
        total: input.total,
        note: input.priced === input.total ? null : input.note,
      },
    };
  }
}
