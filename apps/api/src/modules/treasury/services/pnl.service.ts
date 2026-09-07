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
/**
 * One term of a line's arithmetic, named well enough to be re-run by
 * hand.
 *
 * The figure alone is unauditable — "₹4,005 revenue" cannot be checked
 * against anything without knowing which rows and which COLUMN were
 * summed, and the two columns on a shipment (forward vs RTO cost) are
 * exactly the pair somebody would otherwise pick wrongly. So each part
 * carries the table and column it came from and how many rows went into
 * it, which is enough to write the same query and get the same number.
 */
export interface PnlBasisPart {
  readonly label: string;
  /** `table.column`, and any filter that changes the answer. */
  readonly source: string;
  readonly count: number;
  readonly amountInr: string;
}

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
  /** What the two figures are made of, term by term. */
  readonly basis: {
    readonly revenue: readonly PnlBasisPart[];
    readonly cost: readonly PnlBasisPart[];
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
    const [inbound, delivery, rto, codTax, fx, expenses, unattributed] = await Promise.all([
      this.inboundFreight(from, to),
      this.delivery(from, to),
      this.rto(from, to),
      this.codTaxDeduction(from, to),
      this.fx(from, to),
      this.expenses(from, to),
      this.unattributedLegCosts(from, to),
    ]);

    const lines = [inbound, delivery, rto, codTax, fx];
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
      basis: {
        revenue: [
          {
            label: 'Freight billed to sellers',
            source: 'inbound_freight_charges.total_inr (bill raised in window)',
            count: charges.length,
            amountInr: revenue.toFixed(2),
          },
        ],
        cost: [
          {
            label: 'Forwarder invoices recorded',
            source: 'inbound_freight_charges.our_cost_inr (NULL = not yet recorded)',
            count: priced,
            amountInr: cost.toFixed(2),
          },
        ],
      },
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
    const revenueByType = await this.prisma.client.orderCharge.groupBy({
      by: ['type'],
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
      _count: { _all: true },
    });

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
      basis: {
        // Broken out by CHARGE TYPE, because "shipping revenue" is four
        // different prices added together and only one of them is the
        // base rate. A total that cannot be split cannot be checked
        // against a rate card.
        revenue: revenueByType.map((r) => ({
          label: this.chargeTypeLabel(r.type),
          source: `order_charges.amount_inr WHERE type=${r.type}`,
          count: r._count._all,
          amountInr: (r._sum.amountInr ?? ZERO).toFixed(2),
        })),
        cost: [
          {
            label: 'Courier cost on delivered parcels',
            source: 'shipments.actual_courier_cost_inr (excludes returns)',
            count: priced,
            amountInr: cost.toFixed(2),
          },
        ],
      },
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
      _count: { _all: true },
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
      basis: {
        revenue: [
          {
            label: 'Return fees charged to sellers',
            source: 'seller_wallet_entries.amount WHERE direction=RTO_FEE',
            count: fees._count._all,
            amountInr: (fees._sum.amount ?? ZERO).toFixed(2),
          },
        ],
        cost: [
          {
            label: 'Courier cost to bring parcels back',
            source: 'shipments.actual_rto_cost_inr (NOT the forward cost)',
            count: priced,
            amountInr: cost.toFixed(2),
          },
        ],
      },
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
      _count: { _all: true },
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
      basis: {
        revenue: [
          {
            label: 'Gap between the rate quoted and the rate achieved',
            source: 'bank_entries.signed_amount WHERE type=FX_SPREAD',
            count: agg._count._all,
            amountInr: spread.toFixed(2),
          },
        ],
        // Nothing. The spread IS the margin — there is no cost side to
        // an arithmetic difference, and an empty list says that more
        // honestly than a zero would.
        cost: [],
      },
    };
  }

  /**
   * The tax deducted from a COD, which is OURS.
   *
   * ── WHY THIS IS REVENUE AND NOT A LIABILITY (2026-09-07) ─────────────
   * It was reported as money held for the government, on the reading
   * that we file a return against it. We do not: the courier bills GST
   * on the shipping alongside their own charge and remits it, so there
   * is no separate filing of ours behind this deduction. What we keep
   * back from a COD is income, and reporting it as a liability made the
   * business look poorer than it is while implying a filing obligation
   * that does not exist.
   *
   * It has NO cost side — nothing is spent to collect it — and an empty
   * cost basis says that more honestly than a zero would.
   */
  private async codTaxDeduction(from: Date, to: Date): Promise<PnlLine> {
    const agg = await this.prisma.client.sellerWalletEntry.aggregate({
      where: {
        direction: WalletEntryDirection.GST_WITHHOLDING,
        currency: Currency.INR,
        createdAt: { gte: from, lte: to },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const amount = agg._sum.amount ?? ZERO;
    return this.line({
      key: 'cod_tax',
      label: 'COD tax deduction',
      revenue: amount,
      cost: ZERO,
      // Fully measured by construction: the deduction IS the figure,
      // there is no second number that could be missing.
      priced: 1,
      total: 1,
      note: null,
      basis: {
        revenue: [
          {
            label: 'Deducted from COD before crediting the seller',
            source: 'seller_wallet_entries.amount WHERE direction=GST_WITHHOLDING',
            count: agg._count._all,
            amountInr: amount.toFixed(2),
          },
        ],
        cost: [],
      },
    });
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

  /**
   * EVERY ROW behind one line, so the total can be ticked off by hand.
   *
   * ── WHY THE TERMS WERE NOT ENOUGH ────────────────────────────────────
   * The basis says "₹2,400.00 across 12 rows of order_charges" — which
   * makes the figure re-runnable as a query, but not checkable against
   * anything a person is holding. Checking means finding the parcel that
   * looks wrong, and for that you need the twelve rows.
   *
   * Capped, and the cap is REPORTED rather than silently applied: a
   * truncated list that does not say it is truncated is worse than no
   * list, because the numbers stop adding up and nothing explains why.
   */
  async lineItems(
    key: string,
    from: Date,
    to: Date,
    limit = 500,
  ): Promise<{
    key: string;
    items: ReadonlyArray<{
      ref: string;
      subRef: string | null;
      at: string;
      revenueInr: string | null;
      costInr: string | null;
    }>;
    truncated: boolean;
  }> {
    const take = Math.min(Math.max(limit, 1), 1000);
    switch (key) {
      case 'inbound_freight': {
        const rows = await this.prisma.client.inboundFreightCharge.findMany({
          where: { createdAt: { gte: from, lte: to } },
          orderBy: { createdAt: 'desc' },
          take: take + 1,
          select: {
            totalInr: true,
            ourCostInr: true,
            createdAt: true,
            consignment: { select: { consignmentNumber: true } },
            seller: { select: { companyName: true } },
          },
        });
        return {
          key,
          items: rows.slice(0, take).map((r) => ({
            ref: r.consignment?.consignmentNumber ?? '—',
            subRef: r.seller?.companyName ?? null,
            at: r.createdAt.toISOString(),
            revenueInr: r.totalInr.toFixed(2),
            // Null, not zero. "No forwarder cost recorded" and "the
            // forwarder charged nothing" are different facts, and only
            // one of them means somebody still has to do something.
            costInr: r.ourCostInr?.toFixed(2) ?? null,
          })),
          truncated: rows.length > take,
        };
      }

      case 'delivery':
      case 'rto': {
        const isRto = key === 'rto';
        const rows = await this.prisma.client.shipment.findMany({
          where: {
            deletedAt: null,
            awbNumber: { not: null },
            ...(isRto
              ? { rtoReceivedAt: { gte: from, lte: to } }
              : { createdAt: { gte: from, lte: to }, rtoReceivedAt: null }),
          },
          orderBy: { createdAt: 'desc' },
          take: take + 1,
          select: {
            shipmentNumber: true,
            awbNumber: true,
            createdAt: true,
            actualCourierCostInr: true,
            actualRtoCostInr: true,
            orderShipments: {
              take: 1,
              select: {
                order: {
                  select: {
                    orderNumber: true,
                    charges: {
                      where: {
                        deletedAt: null,
                        type: {
                          in: isRto
                            ? ['RTO_FEE']
                            : [
                                'BASE_SHIPPING',
                                'COD_FEE',
                                'FUEL_SURCHARGE',
                                'REMOTE_AREA_FEE',
                                'WEIGHT_DISPUTE_FEE',
                              ],
                        },
                      },
                      select: { amountInr: true },
                    },
                  },
                },
              },
            },
          },
        });
        return {
          key,
          items: rows.slice(0, take).map((s) => {
            const order = s.orderShipments[0]?.order ?? null;
            const billed = (order?.charges ?? []).reduce((t, c) => t.add(c.amountInr), ZERO);
            const cost = isRto ? s.actualRtoCostInr : s.actualCourierCostInr;
            return {
              ref: s.shipmentNumber,
              subRef: order?.orderNumber ?? s.awbNumber,
              at: s.createdAt.toISOString(),
              revenueInr: billed.toFixed(2),
              costInr: cost?.toFixed(2) ?? null,
            };
          }),
          truncated: rows.length > take,
        };
      }

      case 'cod_tax': {
        const rows = await this.prisma.client.sellerWalletEntry.findMany({
          where: {
            direction: WalletEntryDirection.GST_WITHHOLDING,
            currency: Currency.INR,
            createdAt: { gte: from, lte: to },
          },
          orderBy: { id: 'desc' },
          take: take + 1,
          select: {
            amount: true,
            createdAt: true,
            linkedOrder: { select: { orderNumber: true } },
            seller: { select: { companyName: true } },
          },
        });
        return {
          key,
          items: rows.slice(0, take).map((e) => ({
            ref: e.linkedOrder?.orderNumber ?? '—',
            subRef: e.seller?.companyName ?? null,
            at: e.createdAt.toISOString(),
            revenueInr: e.amount.toFixed(2),
            costInr: null,
          })),
          truncated: rows.length > take,
        };
      }

      case 'fx': {
        const rows = await this.prisma.client.bankEntry.findMany({
          where: { type: BankEntryType.FX_SPREAD, occurredAt: { gte: from, lte: to } },
          orderBy: { id: 'desc' },
          take: take + 1,
          select: {
            signedAmount: true,
            occurredAt: true,
            reference: true,
            account: { select: { label: true } },
          },
        });
        return {
          key,
          items: rows.slice(0, take).map((e) => ({
            ref: e.reference ?? e.account.label,
            subRef: e.account.label,
            at: e.occurredAt.toISOString(),
            // Signed, not absolute: an FX spread can go against us, and
            // showing the magnitude would turn a loss into a gain.
            revenueInr: e.signedAmount.toFixed(2),
            costInr: null,
          })),
          truncated: rows.length > take,
        };
      }

      default:
        return { key, items: [], truncated: false };
    }
  }

  /**
   * A charge type in the words a person uses.
   *
   * Deliberately NOT exhaustive over ChargeType: this is a display
   * label for the five delivery-revenue types the query already filters
   * to, and anything else falls back to its own name rather than being
   * hidden. A part that vanished would make the terms stop adding up to
   * the total beside them, which is worse than an ugly label.
   */
  private chargeTypeLabel(type: string): string {
    switch (type) {
      case 'BASE_SHIPPING':
        return 'Base shipping';
      case 'COD_FEE':
        return 'COD collection fee';
      case 'FUEL_SURCHARGE':
        return 'Fuel surcharge';
      case 'REMOTE_AREA_FEE':
        return 'Remote-area fee';
      case 'WEIGHT_DISPUTE_FEE':
        return 'Weight dispute';
      default:
        return type.replaceAll('_', ' ').toLowerCase();
    }
  }

  private line(input: {
    key: string;
    label: string;
    revenue: Prisma.Decimal;
    cost: Prisma.Decimal;
    priced: number;
    total: number;
    note: string | null;
    basis: { revenue: readonly PnlBasisPart[]; cost: readonly PnlBasisPart[] };
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
      basis: input.basis,
    };
  }
}
