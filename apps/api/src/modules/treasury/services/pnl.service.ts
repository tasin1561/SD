import { Injectable } from '@nestjs/common';
import { BankEntryType, Currency, Prisma, WalletEntryDirection } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

const ZERO = new Prisma.Decimal(0);

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
    const [inbound, delivery, rto, fx, expenses] = await Promise.all([
      this.inboundFreight(from, to),
      this.delivery(from, to),
      this.rto(from, to),
      this.fx(from, to),
      this.expenses(from, to),
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

  /** The Indian delivery leg. What we bill for carriage, less what the courier charged. */
  private async delivery(from: Date, to: Date): Promise<PnlLine> {
    // Revenue is the shipping charges we persisted on the order —
    // deliberately WITHOUT GST, which is the government's and not ours,
    // and without the RTO fee, which prices a second movement and is its
    // own line below.
    const revenueAgg = await this.prisma.client.orderCharge.aggregate({
      where: {
        deletedAt: null,
        createdAt: { gte: from, lte: to },
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

    const shipments = await this.prisma.client.shipment.findMany({
      where: {
        deletedAt: null,
        awbNumber: { not: null },
        createdAt: { gte: from, lte: to },
      },
      select: { actualCourierCostInr: true },
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
   * direction precisely so this question is answerable. The cost side is
   * whatever the courier charged to carry the parcel back, and it sits
   * on the same shipment column — so a return we have not priced shows
   * as uncovered here rather than as free.
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
      select: { actualCourierCostInr: true },
    });
    let cost = ZERO;
    let priced = 0;
    for (const s of returned) {
      if (s.actualCourierCostInr !== null) {
        cost = cost.add(s.actualCourierCostInr);
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
          ? 'Return carriage is unpriced for some parcels, so this margin is flattering.'
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

  /** Everything we spend to exist — rent, salaries, software. */
  private async expenses(from: Date, to: Date): Promise<Prisma.Decimal> {
    const agg = await this.prisma.client.bankEntry.aggregate({
      where: {
        type: BankEntryType.EXPENSE,
        occurredAt: { gte: from, lte: to },
      },
      _sum: { signedAmount: true },
    });
    // Expenses are posted negative (money leaving); report the magnitude.
    return (agg._sum.signedAmount ?? ZERO).abs();
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
