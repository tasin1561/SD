import { Injectable } from '@nestjs/common';
import {
  BankEntryType,
  BankOwnerKind,
  CourierWalletTxnCategory,
  CourierWalletTxnKind,
  Currency,
  InboundFreightStatus,
  OrderStatus,
  Prisma,
  WalletEntryDirection,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

const ZERO = new Prisma.Decimal(0);

/**
 * The first day every parcel on the courier accounts is a Skydrop parcel
 * (1 Oct 2026). Before it the same accounts carried the business's parcels
 * shipped OUTSIDE Skydrop — 12,941 of 12,970 waybills in the first 90 days
 * — whose cost and revenue are not in this report, so their account
 * adjustments (lost-shipment credits, insurance refunds) are not either.
 */
export const SETTING_PNL_COURIER_ADJUSTMENTS_FROM = 'pnl.courier_adjustments_from';

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

/**
 * What a seller pays us for carriage, by charge line. GST is included:
 * we file no GST return against it (the founder, 2026-09-11) — like the
 * tax deducted from a COD, what we charge is ours. Seeded at 0% today.
 */
const DELIVERY_REVENUE_TYPES = [
  'BASE_SHIPPING',
  'COD_FEE',
  'FUEL_SURCHARGE',
  'REMOTE_AREA_FEE',
  'WEIGHT_DISPUTE_FEE',
  'GST',
] as const;

/** A returned parcel earns its delivery fee AND its return fee (RTO or customer return). */
const RETURN_REVENUE_TYPES = [...DELIVERY_REVENUE_TYPES, 'RTO_FEE'] as const;

/**
 * INR per unit of an entry's currency, from the transfer that produced
 * it — the rate that actually applied — when the transfer can say.
 */
function transferRate(
  currency: Currency,
  t: {
    amountOut: Prisma.Decimal;
    currencyOut: Currency;
    amountIn: Prisma.Decimal;
    currencyIn: Currency;
  } | null,
): Prisma.Decimal | null {
  if (currency === Currency.INR) return new Prisma.Decimal(1);
  if (t === null) return null;
  if (t.currencyIn === currency && t.currencyOut === Currency.INR && t.amountIn.gt(0)) {
    return t.amountOut.div(t.amountIn);
  }
  if (t.currencyOut === currency && t.currencyIn === Currency.INR && t.amountOut.gt(0)) {
    return t.amountIn.div(t.amountOut);
  }
  return null;
}

/**
 * One report's exchange rates, and how many amounts had to be put in
 * rupees at TODAY's rate because nothing was recorded for their date.
 * Per report, never shared: the service is a singleton and two reports
 * running at once must not count each other's fallbacks.
 */
class RateBook {
  readonly rates = new Map<string, { rate: Prisma.Decimal | null; fallback: boolean }>();
  fellBack = 0;
}

/**
 * Where a parcel's order has to have got to for its fate to be KNOWN:
 * delivered, or lost on the way. Revenue and carriage are recognised
 * then, not at booking.
 */
const FATE_STATUSES = [OrderStatus.DELIVERED, OrderStatus.LOST_IN_TRANSIT];

/** With the courier and not yet delivered or back — on no line yet. */
const MOVING_STATUSES = [
  OrderStatus.DISPATCHED,
  OrderStatus.IN_TRANSIT,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERY_FAILED,
  OrderStatus.RTO_INITIATED,
  OrderStatus.RTO_IN_TRANSIT,
];

/**
 * One way the business makes (or loses) money, and how well we can see it.
 *
 * One term of a line's arithmetic, named well enough to be re-run by
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
  /** Anything the report had to leave out, in words. Empty when nothing was. */
  readonly warnings: readonly string[];
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
    // One rate cache per report: the same currency on the same day is
    // looked up once, whichever line asks.
    const rates = new RateBook();
    const [
      inbound,
      delivery,
      rto,
      codTax,
      codService,
      fx,
      courierAdj,
      unmatched,
      codFees,
      codShort,
      damage,
      reconciliation,
      investment,
      expenses,
      unattributed,
    ] = await Promise.all([
      this.inboundFreight(from, to),
      this.delivery(from, to),
      this.rto(from, to),
      this.codTaxDeduction(from, to),
      this.codServiceFees(from, to),
      this.fx(from, to, rates),
      this.courierAdjustments(from, to),
      this.unmatchedCourierCharges(from, to),
      this.courierCodFees(from, to),
      this.codShortfall(from, to),
      this.damageRefunds(from, to),
      this.bankReconciliation(from, to, rates),
      this.investmentIncome(from, to, rates),
      this.expenses(from, to, rates),
      this.unattributedLegCosts(from, to, rates),
    ]);

    const lines = [
      inbound,
      delivery,
      rto,
      codTax,
      codService,
      fx,
      courierAdj,
      unmatched,
      codFees,
      codShort,
      damage,
      reconciliation,
      investment,
    ];
    const gross = lines.reduce((acc, l) => acc.add(new Prisma.Decimal(l.marginInr)), ZERO);

    // Money we could not put in rupees is LEFT OUT and said to be — a
    // taka amount added as rupees is wrong by the exchange rate with
    // nothing to show it.
    const warnings: string[] = [];
    if (expenses.unconverted > 0) {
      warnings.push(
        `${expenses.unconverted} operating expense(s) in another currency had no exchange rate ` +
          'to rupees on their date and are not counted. Set the rate on /fx-rates.',
      );
    }
    // Converted, but at TODAY's rate: nothing was recorded for their date,
    // so the rupee figure is an approximation and is said to be one.
    if (rates.fellBack > 0) {
      warnings.push(
        `${rates.fellBack} amount(s) in another currency had no exchange rate recorded for ` +
          "their date and were put in rupees at today's rate. Record the rate for those days " +
          'on /fx-rates for an exact figure.',
      );
    }

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      lines,
      grossMarginInr: gross.toFixed(2),
      operatingExpensesInr: expenses.total.toFixed(2),
      netInr: gross.sub(expenses.total).toFixed(2),
      complete:
        expenses.unconverted === 0 && lines.every((l) => l.coverage.priced === l.coverage.total),
      warnings,
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
      select: { totalInr: true, ourCostInr: true, status: true, amountSettledInr: true },
    });
    let revenue = ZERO;
    let cost = ZERO;
    let priced = 0;
    for (const c of charges) {
      // A WAIVED bill earns only what was charged before it was forgiven;
      // counting its full total would book income nobody will ever pay.
      revenue = revenue.add(
        c.status === InboundFreightStatus.WAIVED ? c.amountSettledInr : c.totalInr,
      );
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
            source:
              'inbound_freight_charges.total_inr (bill raised in window); amount_settled_inr when WAIVED',
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
   * The orders whose parcel's FATE was settled in the window: delivered,
   * or lost on the way. Revenue and carriage are recognised THEN, not at
   * booking — until a parcel is delivered or comes back we do not know
   * which line it belongs to. Booked at dispatch, revenue was taken for
   * orders never billed (two cancelled ones read ₹400 of income) and for
   * parcels still moving, and a parcel that then came back moved from one
   * month's delivery line to a later month's returns line, restating a
   * month already reported.
   *
   * Dated by the ORDER's own event (its first transition to DELIVERED or
   * LOST_IN_TRANSIT): order_events is written for every transition however
   * it happened — a courier scan, a manual scan, god mode — and a shipment
   * carries no delivered-at of its own (nothing writes `deliveredAt`).
   *
   * An order that was delivered and then came back anyway (a courier
   * reversing a delivery) belongs to the RETURNS line alone, never here as
   * well — so it is dropped from this cohort, and a delivered month does
   * restate in that one rare case rather than count the parcel twice.
   */
  private async fateCohort(
    from: Date,
    to: Date,
  ): Promise<{ orderIds: string[]; at: Map<string, Date> }> {
    const events = await this.prisma.client.orderEvent.groupBy({
      by: ['orderId'],
      where: { toStatus: { in: FATE_STATUSES }, createdAt: { lte: to } },
      _min: { createdAt: true },
      having: { createdAt: { _min: { gte: from } } },
    });
    const at = new Map<string, Date>();
    for (const e of events) {
      if (e._min.createdAt !== null) at.set(e.orderId, e._min.createdAt);
    }
    if (at.size === 0) return { orderIds: [], at };
    const cameBack = await this.prisma.client.orderShipment.findMany({
      where: { orderId: { in: [...at.keys()] }, shipment: { rtoReceivedAt: { not: null } } },
      select: { orderId: true },
    });
    for (const c of cameBack) at.delete(c.orderId);
    return { orderIds: [...at.keys()], at };
  }

  /**
   * The parcels that carried a fate-settled order: live, never replaced
   * by another shipment (a superseded one's charges are on the no-parcel
   * line), with a waybill, and not received back.
   */
  private deliveryShipments(orderIds: readonly string[]): Prisma.ShipmentWhereInput {
    return {
      deletedAt: null,
      supersededAt: null,
      awbNumber: { not: null },
      rtoReceivedAt: null,
      orderShipments: { some: { orderId: { in: [...orderIds] } } },
    };
  }

  /**
   * The Indian delivery leg. What we bill for carriage, less what the
   * courier charged, for every parcel DELIVERED (or lost) in the window.
   *
   * BOTH sides are anchored on the same ORDERS (see `fateCohort`), so a
   * parcel's revenue and its cost can never land in different reports.
   */
  private async delivery(from: Date, to: Date): Promise<PnlLine> {
    // Revenue is every charge we billed for carriage — base, surcharges
    // AND the GST on them (we file no return against it; it is ours,
    // DELIVERY_REVENUE_TYPES), without the RTO fee, which prices a second
    // movement and is on the returns line.
    //
    // The cost is BOTH columns added. The importer nets refunds (COST-1),
    // so the sum is what the parcel cost whichever leg it was billed on.
    const { orderIds } = await this.fateCohort(from, to);
    // With the courier right now and not yet delivered or back: on no line
    // until their fate is known. Counted so the report says so.
    const moving = await this.prisma.client.shipment.count({
      where: {
        deletedAt: null,
        supersededAt: null,
        awbNumber: { not: null },
        rtoReceivedAt: null,
        orderShipments: { some: { order: { status: { in: MOVING_STATUSES } } } },
      },
    });

    const shipments =
      orderIds.length === 0
        ? []
        : await this.prisma.client.shipment.findMany({
            where: this.deliveryShipments(orderIds),
            select: { actualCourierCostInr: true, actualRtoCostInr: true },
          });

    const chargeWhere = {
      deletedAt: null,
      orderId: { in: orderIds },
      type: { in: [...DELIVERY_REVENUE_TYPES] },
    };
    const revenueByType =
      orderIds.length === 0
        ? []
        : await this.prisma.client.orderCharge.groupBy({
            by: ['type'],
            where: chargeWhere,
            _sum: { amountInr: true },
            _count: { _all: true },
          });
    const revenueAgg =
      orderIds.length === 0
        ? { _sum: { amountInr: null } }
        : await this.prisma.client.orderCharge.aggregate({
            where: chargeWhere,
            _sum: { amountInr: true },
          });
    // A delivery fee handed back on one of these orders (a waived or
    // mistaken charge) comes off here, or it is income twice.
    const refunds =
      orderIds.length === 0
        ? { _sum: { amount: null }, _count: { _all: 0 } }
        : await this.prisma.client.sellerWalletEntry.aggregate({
            where: {
              direction: WalletEntryDirection.ORDER_CHARGES_REFUND,
              currency: Currency.INR,
              linkedOrderId: { in: orderIds },
            },
            _sum: { amount: true },
            _count: { _all: true },
          });
    const refunded = refunds._sum.amount ?? ZERO;

    let cost = ZERO;
    let priced = 0;
    for (const s of shipments) {
      if (s.actualCourierCostInr !== null || s.actualRtoCostInr !== null) {
        cost = cost.add(s.actualCourierCostInr ?? ZERO).add(s.actualRtoCostInr ?? ZERO);
        priced += 1;
      }
    }

    const notes = [
      ...(priced < shipments.length
        ? [
            `${shipments.length - priced} delivered parcels have no courier cost yet. The ` +
              'nightly wallet sync fills these in once the courier has billed them. A parcel on ' +
              'a manual courier has no ledger at all and needs its cost recorded by hand on the ' +
              'order.',
          ]
        : []),
      ...(moving > 0
        ? [
            `${moving} parcels are with the courier right now and are on no line until they ` +
              'are delivered or come back.',
          ]
        : []),
    ];

    const built = this.line({
      key: 'delivery',
      label: 'India delivery',
      revenue: (revenueAgg._sum.amountInr ?? ZERO).sub(refunded),
      cost,
      priced,
      total: shipments.length,
      note: notes.length === 0 ? null : notes.join(' '),
      basis: {
        // Broken out by CHARGE TYPE, because "shipping revenue" is four
        // different prices added together and only one of them is the
        // base rate. A total that cannot be split cannot be checked
        // against a rate card.
        revenue: [
          ...revenueByType.map((r) => ({
            label: this.chargeTypeLabel(r.type),
            source: `order_charges.amount_inr WHERE type=${r.type}`,
            count: r._count._all,
            amountInr: (r._sum.amountInr ?? ZERO).toFixed(2),
          })),
          ...(refunds._count._all === 0
            ? []
            : [
                {
                  label: 'Refunded to the seller on these orders',
                  source: 'seller_wallet_entries.amount WHERE direction=ORDER_CHARGES_REFUND',
                  count: refunds._count._all,
                  amountInr: refunded.negated().toFixed(2),
                },
              ]),
        ],
        cost: [
          {
            label: 'Courier cost on parcels not received back',
            source:
              'shipments.actual_courier_cost_inr + actual_rto_cost_inr (excludes parcels received back)',
            count: priced,
            amountInr: cost.toFixed(2),
          },
        ],
      },
    });
    // Set on the built line: `line()` drops a note when every parcel in it
    // is priced, and "N parcels are still moving" is true — and worth
    // saying — even then.
    return notes.length === 0
      ? built
      : { ...built, coverage: { ...built.coverage, note: notes.join(' ') } };
  }

  /**
   * Returns — every parcel RECEIVED back in the window.
   *
   * Revenue is what the seller is billed for a parcel that came back: its
   * delivery fee AND its return fee (RETURN_REVENUE_TYPES), read from the
   * order's charges. A shipment that was replaced by another is not the
   * parcel that came back, so only live, non-superseded ones count.
   *
   * The cost is everything the courier charged for the parcel, both
   * columns added. Delhivery refunds the delivery charge on a return and
   * bills one combined return charge; the importer nets that (COST-1),
   * so the forward column of such a parcel is ₹0 and the sum is the true
   * figure. A manual courier bills both legs and refunds neither, and
   * the sum is right there too — reading the return column alone lost
   * its forward cost from every line.
   */
  private async rto(from: Date, to: Date): Promise<PnlLine> {
    const returnedWindow = {
      deletedAt: null,
      supersededAt: null,
      rtoReceivedAt: { gte: from, lte: to },
    } as const;
    // Revenue for exactly the parcels whose cost is on this line: their
    // DELIVERY fee (a returned parcel never reaches the delivery line, and
    // the fee is swept when it is received) plus the return fee — RTO or
    // customer-requested, both written as an RTO_FEE charge line. Read
    // from the wallet's RTO_FEE entries alone, this line showed ₹30
    // against a parcel's whole round trip.
    const revenueByType = await this.prisma.client.orderCharge.groupBy({
      by: ['type'],
      where: {
        deletedAt: null,
        order: { orderShipments: { some: { shipment: returnedWindow } } },
        type: { in: [...RETURN_REVENUE_TYPES] },
      },
      _sum: { amountInr: true },
      _count: { _all: true },
    });
    const revenue = revenueByType.reduce((t, r) => t.add(r._sum.amountInr ?? ZERO), ZERO);
    const returned = await this.prisma.client.shipment.findMany({
      where: returnedWindow,
      select: { actualCourierCostInr: true, actualRtoCostInr: true },
    });
    let cost = ZERO;
    let priced = 0;
    for (const s of returned) {
      cost = cost.add(s.actualCourierCostInr ?? ZERO).add(s.actualRtoCostInr ?? ZERO);
      // MEASURED only once the return itself has been billed: until then
      // the forward figure is all we know, and it is not the whole cost.
      if (s.actualRtoCostInr !== null) priced += 1;
    }
    return this.line({
      key: 'rto',
      label: 'Returns',
      revenue,
      cost,
      priced,
      total: returned.length,
      note:
        priced < returned.length
          ? `${returned.length - priced} returns have no courier cost recorded, so this margin is flattering.`
          : null,
      basis: {
        revenue: revenueByType.map((r) => ({
          label: this.chargeTypeLabel(r.type),
          source: `order_charges.amount_inr WHERE type=${r.type} (parcels received back)`,
          count: r._count._all,
          amountInr: (r._sum.amountInr ?? ZERO).toFixed(2),
        })),
        cost: [
          {
            label: 'Courier cost to bring parcels back',
            source: 'shipments.actual_courier_cost_inr + actual_rto_cost_inr',
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
  private async fx(from: Date, to: Date, rates: RateBook): Promise<PnlLine> {
    // The spread is posted in the RECEIVING account's currency — usually
    // taka. Summed as it stood it was taka read as rupees. Each is put in
    // rupees at its OWN transfer's rate (the one that produced it), and
    // only failing that at the rate in force that day.
    const rows = await this.prisma.client.bankEntry.findMany({
      where: { type: BankEntryType.FX_SPREAD, occurredAt: { gte: from, lte: to } },
      select: {
        signedAmount: true,
        currency: true,
        occurredAt: true,
        transfer: {
          select: { amountOut: true, currencyOut: true, amountIn: true, currencyIn: true },
        },
      },
    });
    let spread = ZERO;
    let unconverted = 0;
    for (const r of rows) {
      const rate =
        transferRate(r.currency, r.transfer) ??
        (await this.inrPerUnit(r.currency, r.occurredAt, rates));
      if (rate === null) {
        unconverted += 1;
        continue;
      }
      spread = spread.add(r.signedAmount.mul(rate).toDecimalPlaces(2));
    }
    return {
      key: 'fx',
      label: 'FX spread',
      revenueInr: spread.toFixed(2),
      costInr: '0.00',
      marginInr: spread.toFixed(2),
      marginPercent: null,
      coverage: {
        priced: rows.length - unconverted,
        total: rows.length,
        note:
          unconverted === 0
            ? null
            : `${unconverted} spread entr(ies) had no rate to rupees and are not counted.`,
      },
      basis: {
        revenue: [
          {
            label: 'Gap between the rate quoted and the rate achieved, in rupees',
            source: 'bank_entries.signed_amount WHERE type=FX_SPREAD × the transfer’s own rate',
            count: rows.length - unconverted,
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
   * What the courier charged the ACCOUNT, rather than a parcel.
   *
   * Their ledger is not only carriage. It carries monthly
   * reconciliations, lost-shipment settlements and fraud credit notes —
   * 37 of 23,276 rows over ninety days, and 36 of those 37 name a
   * waybill even though they are nothing to do with what moving that
   * box cost. Folding a fraud credit note into a parcel would quietly
   * make that parcel look profitable, so they are kept out of the
   * delivery and returns lines and reported here instead.
   *
   * A DEBIT is a cost; a CREDIT gives money back and so reduces it. The
   * line has no revenue: nobody was billed for any of this.
   *
   * ── WHY THIS IS NOT AN EXPENSE (bank) ROW ────────────────────────
   * No money leaves a bank account when the courier debits their own
   * wallet — the cash left when we recharged it, and that recharge
   * already has its bank entry. Writing one here as well would count
   * the same rupee twice. The wallet is prepaid float, and consuming it
   * is a cost recognised against the float, exactly as a parcel's
   * carriage already is.
   *
   * ── ONLY FROM THE CUTOVER (`pnl.courier_adjustments_from`) ───────────
   * Until every parcel on the accounts went through Skydrop, most of
   * their adjustments were about parcels this report never sees — no
   * order, no revenue, no parcel cost. Counting those credits would book
   * income from somebody else's parcels. So adjustments dated before the
   * cutover are left out and SAID to be left out; with the setting
   * cleared, every adjustment counts.
   */
  private async courierAdjustments(from: Date, to: Date): Promise<PnlLine> {
    const cutover = await this.adjustmentsCutover();
    const countFrom = cutover !== null && cutover.getTime() > from.getTime() ? cutover : from;
    const base = {
      category: CourierWalletTxnCategory.ADJUSTMENT,
      // `success` only. A failed line is a row about something that
      // did not happen.
      status: 'success',
      // A transaction their ledger has since DROPPED is kept as evidence
      // but moves no money: the later export still balances to the live
      // wallet without it. Parcel costs already exclude it; so must this.
      missingFromExportAt: null,
    } as const;
    const rows =
      countFrom.getTime() > to.getTime()
        ? []
        : await this.prisma.client.courierWalletTransaction.groupBy({
            by: ['kind'],
            where: { ...base, occurredAt: { gte: countFrom, lte: to } },
            _sum: { amountInr: true },
            _count: { _all: true },
          });
    // What the cutover left out of THIS window, so the line says so.
    const excluded =
      countFrom.getTime() > from.getTime()
        ? await this.prisma.client.courierWalletTransaction.groupBy({
            by: ['kind'],
            where: {
              ...base,
              occurredAt: { gte: from, lt: countFrom.getTime() > to.getTime() ? to : countFrom },
            },
            _sum: { amountInr: true },
            _count: { _all: true },
          })
        : [];
    let excludedCount = 0;
    let excludedNet = ZERO;
    for (const r of excluded) {
      excludedCount += r._count._all;
      const amt = r._sum.amountInr ?? ZERO;
      excludedNet =
        r.kind === CourierWalletTxnKind.DEBIT ? excludedNet.add(amt) : excludedNet.sub(amt);
    }

    let cost = ZERO;
    let debited = ZERO;
    let credited = ZERO;
    let debitCount = 0;
    let creditCount = 0;
    for (const r of rows) {
      const amt = r._sum.amountInr ?? ZERO;
      if (r.kind === CourierWalletTxnKind.DEBIT) {
        debited = debited.add(amt);
        debitCount += r._count._all;
        cost = cost.add(amt);
      } else {
        credited = credited.add(amt);
        creditCount += r._count._all;
        cost = cost.sub(amt);
      }
    }
    const count = debitCount + creditCount;
    // Said even though the line is fully measured — `line()` keeps a note
    // only for missing coverage, and money deliberately left out of a
    // total is exactly what a reader of that total needs told.
    const cutoverNote =
      excludedCount > 0 && cutover !== null
        ? `${excludedCount} adjustment(s) dated before ${istDate(cutover)} (net ` +
          `${excludedNet.isNegative() ? 'credit' : 'debit'} ₹${excludedNet.abs().toFixed(2)}) ` +
          'are not counted: they belong to parcels shipped outside Skydrop, whose cost and ' +
          'revenue are not in this report either.'
        : null;

    const line = this.line({
      key: 'courier_adjustments',
      label: 'Courier account adjustments',
      revenue: ZERO,
      cost,
      // Every one of them is known: they are read from the courier's own
      // ledger, not estimated. Nothing here is uncovered.
      priced: count,
      total: count,
      note:
        count === 0
          ? null
          : 'Reconciliations, settlements and credit notes the courier applied to the account ' +
            'rather than to a parcel. A credit reduces the cost.',
      basis: {
        revenue: [],
        cost: [
          {
            label: 'Debited by the courier',
            source: "courier_wallet_transactions WHERE category='adjustment' AND kind='debit'",
            count: debitCount,
            amountInr: debited.toFixed(2),
          },
          {
            label: 'Credited back',
            source: "courier_wallet_transactions WHERE category='adjustment' AND kind='credit'",
            count: creditCount,
            amountInr: credited.negated().toFixed(2),
          },
        ],
      },
    });
    return cutoverNote === null
      ? line
      : { ...line, coverage: { ...line.coverage, note: cutoverNote } };
  }

  /**
   * What a courier KEPT from a COD payout as its fee (early COD).
   *
   * It never passes through the courier's wallet, so the wallet sync
   * cannot see it: Shiprocket takes it out of the remittance and invoices
   * it separately ("COD Remittance Fee"). Recording the payout books it as
   * an EXPENSE bank entry linked to the settlement — that is what puts it
   * on /expenses — and this line counts exactly those entries. Operating
   * expenses leave them out, or the same fee would come off gross AND off
   * net.
   *
   * Fully measured: each is the figure the courier's own file states.
   */
  private async courierCodFees(from: Date, to: Date): Promise<PnlLine> {
    const agg = await this.prisma.client.bankEntry.aggregate({
      where: {
        type: BankEntryType.EXPENSE,
        settlementId: { not: null },
        occurredAt: { gte: from, lte: to },
      },
      _sum: { signedAmount: true },
      _count: { _all: true },
    });
    // Posted negative (money leaving); a cost is its magnitude.
    const cost = (agg._sum.signedAmount ?? ZERO).abs();
    const count = agg._count._all;
    return this.line({
      key: 'courier_cod_fees',
      label: 'Courier COD fees',
      revenue: ZERO,
      cost,
      priced: count,
      total: count,
      note: null,
      basis: {
        revenue: [],
        cost: [
          {
            label: 'Early-COD fees kept back from COD payouts',
            source: 'bank_entries.signed_amount WHERE type=EXPENSE AND settlement_id IS NOT NULL',
            count,
            amountInr: cost.toFixed(2),
          },
        ],
      },
    });
  }

  /** The cutover date, or null when the setting is cleared (count every adjustment). */
  private async adjustmentsCutover(): Promise<Date | null> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: SETTING_PNL_COURIER_ADJUSTMENTS_FROM },
      select: { valueDate: true },
    });
    return row?.valueDate ?? null;
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
    // Tax withheld on a COD the courier later reversed is given back to
    // the seller — it was never earned, so it comes off this line.
    const returned = await this.deductionsReturned(from, to, [
      WalletEntryDirection.GST_WITHHOLDING,
    ]);
    const withheld = agg._sum.amount ?? ZERO;
    const amount = withheld.sub(returned.amount);
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
            amountInr: withheld.toFixed(2),
          },
          ...(returned.count > 0
            ? [
                {
                  label: 'Returned on CODs the courier reversed',
                  source:
                    'seller_wallet_entries.amount WHERE direction=COD_DEDUCTION_REFUND AND linked to GST_WITHHOLDING',
                  count: returned.count,
                  amountInr: returned.amount.negated().toFixed(2),
                },
              ]
            : []),
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
  private async expenses(
    from: Date,
    to: Date,
    rates: RateBook,
  ): Promise<{ total: Prisma.Decimal; unconverted: number }> {
    const where = {
      type: BankEntryType.EXPENSE,
      occurredAt: { gte: from, lte: to },
      inboundFreightChargeId: null,
      // A courier's COD fee is its own line (courierCodFees); counted
      // here too it would come off gross and off net.
      settlementId: null,
    } as const;
    const inr = await this.prisma.client.bankEntry.aggregate({
      where: { ...where, currency: Currency.INR },
      _sum: { signedAmount: true },
    });
    // Expenses are posted negative (money leaving); a cost is its negation.
    let total = (inr._sum.signedAmount ?? ZERO).negated();
    // Rent or salaries paid from a taka account: put in rupees at the
    // rate in force THAT day. Added as they stood, they were taka read
    // as rupees — wrong by the exchange rate, silently.
    const other = await this.prisma.client.bankEntry.findMany({
      where: { ...where, currency: { not: Currency.INR } },
      select: { signedAmount: true, currency: true, occurredAt: true },
    });
    let unconverted = 0;
    for (const o of other) {
      const rate = await this.inrPerUnit(o.currency, o.occurredAt, rates);
      if (rate === null) {
        unconverted += 1;
        continue;
      }
      total = total.add(o.signedAmount.negated().mul(rate).toDecimalPlaces(2));
    }
    return { total, unconverted };
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
    rates: RateBook,
  ): Promise<{ countInr: string; count: number } | null> {
    const rows = await this.prisma.client.bankEntry.findMany({
      where: {
        type: BankEntryType.EXPENSE,
        occurredAt: { gte: from, lte: to },
        inboundFreightChargeId: null,
        settlementId: null,
        expenseCategory: { code: { in: LEG_EXPENSE_CATEGORIES } },
      },
      select: { signedAmount: true, currency: true, occurredAt: true },
    });
    if (rows.length === 0) return null;
    let total = ZERO;
    for (const r of rows) {
      const rate = await this.inrPerUnit(r.currency, r.occurredAt, rates);
      if (rate !== null) total = total.add(r.signedAmount.abs().mul(rate).toDecimalPlaces(2));
    }
    return { countInr: total.toFixed(2), count: rows.length };
  }

  /**
   * What the seller pays us for COD handling: the Instant Pay fee (paid
   * at delivery instead of at settlement) and the settlement-mode COD
   * collection fee. Revenue with no cost of its own — both are taken off
   * the seller's COD credit — and neither was counted anywhere before.
   */
  private async codServiceFees(from: Date, to: Date): Promise<PnlLine> {
    const rows = await this.prisma.client.sellerWalletEntry.groupBy({
      by: ['direction'],
      where: {
        direction: {
          in: [WalletEntryDirection.INSTANT_PAY_FEE, WalletEntryDirection.COD_COLLECTION_FEE],
        },
        currency: Currency.INR,
        createdAt: { gte: from, lte: to },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const returned = await this.deductionsReturned(from, to, [
      WalletEntryDirection.INSTANT_PAY_FEE,
      WalletEntryDirection.COD_COLLECTION_FEE,
    ]);
    const revenue = rows.reduce((t, r) => t.add(r._sum.amount ?? ZERO), ZERO).sub(returned.amount);
    return this.line({
      key: 'cod_service_fees',
      label: 'COD handling fees',
      revenue,
      cost: ZERO,
      priced: 1,
      total: 1,
      note: null,
      basis: {
        revenue: [
          ...rows.map((r) => ({
            label:
              r.direction === WalletEntryDirection.INSTANT_PAY_FEE
                ? 'Instant Pay fees'
                : 'COD collection fees',
            source: `seller_wallet_entries.amount WHERE direction=${r.direction}`,
            count: r._count._all,
            amountInr: (r._sum.amount ?? ZERO).toFixed(2),
          })),
          ...(returned.count > 0
            ? [
                {
                  label: 'Returned on CODs the courier reversed',
                  source:
                    'seller_wallet_entries.amount WHERE direction=COD_DEDUCTION_REFUND AND linked to a fee',
                  count: returned.count,
                  amountInr: returned.amount.negated().toFixed(2),
                },
              ]
            : []),
        ],
        cost: [],
      },
    });
  }

  /**
   * Deductions given back to sellers because the courier reversed the COD
   * they were taken from — only those returning one of `directions`, read
   * off the deduction each refund names (`linkedEntryId`).
   */
  private async deductionsReturned(
    from: Date,
    to: Date,
    directions: WalletEntryDirection[],
  ): Promise<{ amount: Prisma.Decimal; count: number }> {
    const agg = await this.prisma.client.sellerWalletEntry.aggregate({
      where: {
        direction: WalletEntryDirection.COD_DEDUCTION_REFUND,
        currency: Currency.INR,
        createdAt: { gte: from, lte: to },
        linkedEntry: { direction: { in: directions } },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return { amount: agg._sum.amount ?? ZERO, count: agg._count._all };
  }

  /**
   * COD the courier never paid us on parcels whose sellers we credited in
   * full (WAL-6) — ours to absorb, so a cost. Recognised per payout line
   * as the CHANGE in the order's shortfall, so a later payout that makes
   * it up comes back off as a recovery and a two-part payment nets to
   * nothing. Dated by when the payout landed.
   */
  private async codShortfall(from: Date, to: Date): Promise<PnlLine> {
    const [short, recovered] = await Promise.all([
      this.prisma.client.courierSettlementLine.aggregate({
        where: { shortfallInr: { gt: 0 }, settlement: { receivedAt: { gte: from, lte: to } } },
        _sum: { shortfallInr: true },
        _count: { _all: true },
      }),
      this.prisma.client.courierSettlementLine.aggregate({
        where: { shortfallInr: { lt: 0 }, settlement: { receivedAt: { gte: from, lte: to } } },
        _sum: { shortfallInr: true },
        _count: { _all: true },
      }),
    ]);
    const shortSum = short._sum.shortfallInr ?? ZERO;
    const recoveredSum = recovered._sum.shortfallInr ?? ZERO;
    const cost = shortSum.add(recoveredSum);
    const count = short._count._all + recovered._count._all;
    return this.line({
      key: 'cod_shortfall',
      label: 'COD short-payments absorbed',
      revenue: ZERO,
      cost,
      priced: count,
      total: count,
      note: null,
      basis: {
        revenue: [],
        cost: [
          {
            label: 'Paid short of the COD we credited the seller',
            source: 'courier_settlement_lines.shortfall_inr WHERE > 0',
            count: short._count._all,
            amountInr: shortSum.toFixed(2),
          },
          ...(recovered._count._all > 0
            ? [
                {
                  label: 'Made up on a later payout',
                  source: 'courier_settlement_lines.shortfall_inr WHERE < 0',
                  count: recovered._count._all,
                  amountInr: recoveredSum.toFixed(2),
                },
              ]
            : []),
        ],
      },
    });
  }

  /**
   * What we paid sellers for goods damaged or lost in our care (a ticket
   * resolved in their favour). A real cost — and the courier's
   * lost-shipment credit for the same parcel is already on the account
   * adjustments line, so leaving this out made a loss read as a gain.
   */
  private async damageRefunds(from: Date, to: Date): Promise<PnlLine> {
    const agg = await this.prisma.client.sellerWalletEntry.aggregate({
      where: {
        direction: WalletEntryDirection.SCRAP_REFUND,
        currency: Currency.INR,
        createdAt: { gte: from, lte: to },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const cost = agg._sum.amount ?? ZERO;
    const count = agg._count._all;
    return this.line({
      key: 'damage_refunds',
      label: 'Damage & loss refunds to sellers',
      revenue: ZERO,
      cost,
      priced: count,
      total: count,
      note: null,
      basis: {
        revenue: [],
        cost: [
          {
            label: 'Credited to sellers for damaged or lost goods',
            source: 'seller_wallet_entries.amount WHERE direction=SCRAP_REFUND',
            count,
            amountInr: cost.toFixed(2),
          },
        ],
      },
    });
  }

  /**
   * What a courier charged on a waybill that is no LIVE Skydrop parcel —
   * one cancelled after its waybill was issued (its shipment voided), or
   * one booked outside Skydrop. The wallet import stamps costs only on
   * the parcels it can match, so these fell out of every line. Counted
   * from the same cutover as account adjustments: before it the accounts
   * carried the business's parcels shipped outside Skydrop.
   */
  private async unmatchedCourierCharges(from: Date, to: Date): Promise<PnlLine> {
    // Two kinds of waybill, counted from two different dates:
    //
    //  - one that WAS a Skydrop parcel and is no longer a live one (voided
    //    when its order was cancelled, or replaced by another shipment):
    //    OURS whatever the date, because it was booked through us — the
    //    cutover exists for the business's parcels shipped OUTSIDE
    //    Skydrop, and this is not one. Before this, a voided parcel's
    //    charges before 1 Oct fell off every line.
    //  - one that matches no Skydrop parcel at all: counted only from the
    //    cutover, before which the accounts carried parcels whose revenue
    //    is not in this report.
    //
    // A waybill is unique only within a courier, so "ours" means a
    // shipment of the SAME courier as the account the charge was taken
    // from — a live parcel of another courier that merely shares the
    // number does not absorb the charge (the importer, which is scoped the
    // same way, would never have stamped it there either).
    const cutover = await this.adjustmentsCutover();
    const cutoverFrom = cutover !== null && cutover.getTime() > from.getTime() ? cutover : from;
    const parcelWhere = {
      category: CourierWalletTxnCategory.PARCEL,
      status: 'success',
      missingFromExportAt: null,
      awbNumber: { not: null },
    } as const;
    const netOf = (
      rows: ReadonlyArray<{
        courierAccountId: string;
        awbNumber: string | null;
        kind: CourierWalletTxnKind;
        _sum: { amountInr: Prisma.Decimal | null };
      }>,
    ): Map<string, Prisma.Decimal> => {
      const net = new Map<string, Prisma.Decimal>();
      for (const r of rows) {
        if (r.awbNumber === null) continue;
        const amt = r._sum.amountInr ?? ZERO;
        const key = `${r.courierAccountId}|${r.awbNumber}`;
        net.set(
          key,
          (net.get(key) ?? ZERO).add(r.kind === CourierWalletTxnKind.DEBIT ? amt : amt.negated()),
        );
      }
      return net;
    };
    const windowRows = await this.prisma.client.courierWalletTransaction.groupBy({
      by: ['courierAccountId', 'awbNumber', 'kind'],
      where: { ...parcelWhere, occurredAt: { gte: from, lte: to } },
      _sum: { amountInr: true },
    });
    const windowNet = netOf(windowRows);
    let sinceCutoverNet = windowNet;
    if (cutoverFrom.getTime() > to.getTime()) {
      sinceCutoverNet = new Map<string, Prisma.Decimal>();
    } else if (cutoverFrom.getTime() !== from.getTime()) {
      const cutoverRows = await this.prisma.client.courierWalletTransaction.groupBy({
        by: ['courierAccountId', 'awbNumber', 'kind'],
        where: { ...parcelWhere, occurredAt: { gte: cutoverFrom, lte: to } },
        _sum: { amountInr: true },
      });
      sinceCutoverNet = netOf(cutoverRows);
    }

    const keys = [...windowNet.keys()];
    const accountIds = [...new Set(keys.map((k) => k.slice(0, k.indexOf('|'))))];
    const awbs = [...new Set(keys.map((k) => k.slice(k.indexOf('|') + 1)))];
    const [accounts, shipments] =
      keys.length === 0
        ? [[], []]
        : await Promise.all([
            this.prisma.client.courierAccount.findMany({
              where: { id: { in: accountIds } },
              select: { id: true, courier: { select: { code: true } } },
            }),
            // Every shipment that ever carried one of these waybills —
            // voided and replaced ones included, which is the point.
            this.prisma.client.shipment.findMany({
              where: { awbNumber: { in: awbs } },
              select: { awbNumber: true, courierCode: true, deletedAt: true, supersededAt: true },
            }),
          ]);
    const courierOf = new Map(accounts.map((a) => [a.id, a.courier.code]));

    let deadCost = ZERO;
    let deadCount = 0;
    let strayCost = ZERO;
    let strayCount = 0;
    for (const key of keys) {
      const bar = key.indexOf('|');
      const code = courierOf.get(key.slice(0, bar));
      const awb = key.slice(bar + 1);
      const mine = shipments.filter((s) => s.awbNumber === awb && s.courierCode === code);
      if (mine.some((s) => s.deletedAt === null && s.supersededAt === null)) continue;
      if (mine.length > 0) {
        deadCost = deadCost.add(windowNet.get(key) ?? ZERO);
        deadCount += 1;
        continue;
      }
      const since = sinceCutoverNet.get(key);
      if (since === undefined) continue;
      strayCost = strayCost.add(since);
      strayCount += 1;
    }
    const cost = deadCost.add(strayCost);
    const count = deadCount + strayCount;
    return this.line({
      key: 'courier_unmatched',
      label: 'Courier charges on no live Skydrop parcel',
      revenue: ZERO,
      cost,
      priced: count,
      total: count,
      note: null,
      basis: {
        revenue: [],
        cost: [
          {
            label: 'On Skydrop parcels voided or replaced by another shipment',
            source:
              "courier_wallet_transactions WHERE category='parcel' AND awb is a deleted or superseded shipment of the same courier",
            count: deadCount,
            amountInr: deadCost.toFixed(2),
          },
          {
            label: 'On waybills that match no Skydrop parcel (from the cutover)',
            source:
              "courier_wallet_transactions WHERE category='parcel' AND awb matches no shipment of that courier AND occurred_at >= pnl.courier_adjustments_from",
            count: strayCount,
            amountInr: strayCost.toFixed(2),
          },
        ],
      },
    });
  }

  /**
   * Corrections posted against a bank statement on OUR money — bank
   * charges, interest, a difference nobody could explain. Signed: a
   * positive one is money we did not know we had.
   */
  private async bankReconciliation(from: Date, to: Date, rates: RateBook): Promise<PnlLine> {
    const rows = await this.prisma.client.bankEntry.findMany({
      where: {
        type: BankEntryType.RECONCILIATION_ADJUSTMENT,
        // A correction to money held for a seller is theirs, not ours.
        ownerKind: BankOwnerKind.CAPITAL,
        occurredAt: { gte: from, lte: to },
      },
      select: { id: true, accountId: true, signedAmount: true, currency: true, occurredAt: true },
    });
    let total = ZERO;
    let counted = 0;
    let unconverted = 0;
    let opening = ZERO;
    let openingCount = 0;
    for (const r of rows) {
      // The account's FIRST capital entry is its OPENING balance: money
      // the business already had when the book started — capital put in,
      // not earned. Judged on CAPITAL entries only, so a seller top-up
      // landing before the owner got round to entering the balance does
      // not turn the balance into income. Money put in LATER has its own
      // entry type (OWNER_CONTRIBUTION) and never reaches this line.
      const earlier = await this.prisma.client.bankEntry.findFirst({
        where: { accountId: r.accountId, ownerKind: BankOwnerKind.CAPITAL, id: { lt: r.id } },
        select: { id: true },
      });
      const rate = await this.inrPerUnit(r.currency, r.occurredAt, rates);
      if (earlier === null) {
        openingCount += 1;
        if (rate !== null) opening = opening.add(r.signedAmount.mul(rate).toDecimalPlaces(2));
        continue;
      }
      if (rate === null) {
        unconverted += 1;
        continue;
      }
      total = total.add(r.signedAmount.mul(rate).toDecimalPlaces(2));
      counted += 1;
    }
    const notes = [
      ...(openingCount > 0
        ? [
            `${openingCount} opening balance(s) (₹${opening.toFixed(2)}) are capital put in, ` +
              'not earned, and are not counted.',
          ]
        : []),
      ...(unconverted > 0
        ? [`${unconverted} correction(s) had no rate to rupees and are not counted.`]
        : []),
    ];
    return {
      key: 'bank_reconciliation',
      label: 'Bank reconciliation differences',
      revenueInr: total.toFixed(2),
      costInr: '0.00',
      marginInr: total.toFixed(2),
      marginPercent: null,
      coverage: {
        // An opening balance is outside the line, not unmeasured in it.
        priced: counted,
        total: counted + unconverted,
        note: notes.length === 0 ? null : notes.join(' '),
      },
      basis: {
        revenue: [
          {
            label: 'Corrections against a bank statement (charges, interest, unexplained)',
            source:
              "bank_entries.signed_amount WHERE type=RECONCILIATION_ADJUSTMENT AND owner='capital' AND not the account's first capital entry",
            count: counted,
            amountInr: total.toFixed(2),
          },
        ],
        cost: [],
      },
    };
  }

  /**
   * What an investment earned: returned less placed, recognised when it
   * closes. The principal moving out and back is not income; the
   * difference is.
   */
  private async investmentIncome(from: Date, to: Date, rates: RateBook): Promise<PnlLine> {
    // `placed_inr` / `returned_inr` hold the ACCOUNT's currency despite
    // their names (InvestmentService says so): a taka deposit stores taka.
    // Subtracted as they stood, ৳1,500 of interest read as ₹1,500. The
    // difference is put in rupees at the rate on the day it closed.
    const rows = await this.prisma.client.investment.findMany({
      where: { closedAt: { gte: from, lte: to } },
      select: { placedInr: true, returnedInr: true, currency: true, closedAt: true },
    });
    let income = ZERO;
    let unconverted = 0;
    for (const r of rows) {
      const rate = await this.inrPerUnit(r.currency, r.closedAt ?? to, rates);
      if (rate === null) {
        unconverted += 1;
        continue;
      }
      income = income.add(r.returnedInr.sub(r.placedInr).mul(rate).toDecimalPlaces(2));
    }
    return {
      key: 'investment_income',
      label: 'Investment income',
      revenueInr: income.toFixed(2),
      costInr: '0.00',
      marginInr: income.toFixed(2),
      marginPercent: null,
      coverage: {
        priced: rows.length - unconverted,
        total: rows.length,
        note:
          unconverted === 0
            ? null
            : `${unconverted} investment(s) had no rate to rupees on the day they closed and are not counted.`,
      },
      basis: {
        revenue: [
          {
            label: 'Returned less placed, on investments closed in the window (in rupees)',
            source:
              "(investments.returned_inr − placed_inr) × the account currency's rate on closed_at",
            count: rows.length - unconverted,
            amountInr: income.toFixed(2),
          },
        ],
        cost: [],
      },
    };
  }

  /**
   * INR per unit of `currency` on `at`: the rate in force then (the
   * history), else today's. Null when there is no rate at all — the
   * caller leaves the amount out and says so rather than guessing.
   */
  private async inrPerUnit(
    currency: Currency,
    at: Date,
    book: RateBook,
  ): Promise<Prisma.Decimal | null> {
    if (currency === Currency.INR) return new Prisma.Decimal(1);
    const key = `${currency}|${at.toISOString().slice(0, 10)}`;
    let entry = book.rates.get(key);
    if (entry === undefined) {
      const pair = [
        { fromCurrency: currency, toCurrency: Currency.INR },
        { fromCurrency: Currency.INR, toCurrency: currency },
      ];
      const hist = await this.prisma.client.fxRateHistory.findFirst({
        where: { recordedAt: { lte: at }, OR: pair },
        orderBy: { recordedAt: 'desc' },
        select: { fromCurrency: true, rate: true },
      });
      const row =
        hist ??
        (await this.prisma.client.fxRate.findFirst({
          where: { OR: pair },
          select: { fromCurrency: true, rate: true },
        }));
      // A rate is "1 fromCurrency = rate toCurrency"; INR→BDT 1.32 means a
      // taka is 1/1.32 of a rupee.
      const rate =
        row === null || row.rate.isZero()
          ? null
          : row.fromCurrency === currency
            ? row.rate
            : new Prisma.Decimal(1).div(row.rate);
      // TODAY's rate standing in for a day nothing was recorded for. Used,
      // because leaving the amount out would be further from the truth —
      // but counted, so the report says how many figures are approximate.
      entry = { rate, fallback: hist === null && rate !== null };
      book.rates.set(key, entry);
    }
    if (entry.fallback) book.fellBack += 1;
    return entry.rate;
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
        // EXACTLY the totals' cohorts: the same orders (delivery) or the
        // same received-back window (returns), the same shipment filter,
        // and revenue net of the same refunds — or the rows stop adding up
        // to the figure above them.
        const isRto = key === 'rto';
        const fate = isRto ? null : await this.fateCohort(from, to);
        const where: Prisma.ShipmentWhereInput = isRto
          ? { deletedAt: null, supersededAt: null, rtoReceivedAt: { gte: from, lte: to } }
          : this.deliveryShipments(fate?.orderIds ?? []);
        const rows =
          fate !== null && fate.orderIds.length === 0
            ? []
            : await this.prisma.client.shipment.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: take + 1,
                select: {
                  shipmentNumber: true,
                  awbNumber: true,
                  createdAt: true,
                  rtoReceivedAt: true,
                  actualCourierCostInr: true,
                  actualRtoCostInr: true,
                  orderShipments: {
                    take: 1,
                    select: {
                      order: {
                        select: {
                          id: true,
                          orderNumber: true,
                          charges: {
                            where: {
                              deletedAt: null,
                              type: {
                                in: isRto ? [...RETURN_REVENUE_TYPES] : [...DELIVERY_REVENUE_TYPES],
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
        const refundedBy = new Map<string, Prisma.Decimal>();
        if (!isRto && rows.length > 0) {
          const ids = rows
            .map((s) => s.orderShipments[0]?.order.id)
            .filter((id): id is string => id !== undefined);
          const refunds = await this.prisma.client.sellerWalletEntry.groupBy({
            by: ['linkedOrderId'],
            where: {
              direction: WalletEntryDirection.ORDER_CHARGES_REFUND,
              currency: Currency.INR,
              linkedOrderId: { in: ids },
            },
            _sum: { amount: true },
          });
          for (const r of refunds) {
            if (r.linkedOrderId !== null) refundedBy.set(r.linkedOrderId, r._sum.amount ?? ZERO);
          }
        }
        return {
          key,
          items: rows.slice(0, take).map((s) => {
            const order = s.orderShipments[0]?.order ?? null;
            const billed = (order?.charges ?? [])
              .reduce((t, c) => t.add(c.amountInr), ZERO)
              .sub(order === null ? ZERO : (refundedBy.get(order.id) ?? ZERO));
            // Both columns, as on the summary lines: a returned parcel's
            // forward is ₹0 once the refund is netted, so the sum is the
            // parcel's cost. Null only when neither has been recorded.
            const cost =
              s.actualCourierCostInr === null && s.actualRtoCostInr === null
                ? null
                : (s.actualCourierCostInr ?? ZERO).add(s.actualRtoCostInr ?? ZERO);
            // Dated when its fate was settled — delivered / lost, or
            // received back — which is what put it in this window.
            const at = isRto
              ? (s.rtoReceivedAt ?? s.createdAt)
              : ((order === null ? undefined : fate?.at.get(order.id)) ?? s.createdAt);
            return {
              ref: s.shipmentNumber,
              subRef: order?.orderNumber ?? s.awbNumber,
              at: at.toISOString(),
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

      case 'cod_service_fees':
      case 'damage_refunds': {
        const isDamage = key === 'damage_refunds';
        const rows = await this.prisma.client.sellerWalletEntry.findMany({
          where: {
            direction: isDamage
              ? WalletEntryDirection.SCRAP_REFUND
              : {
                  in: [
                    WalletEntryDirection.INSTANT_PAY_FEE,
                    WalletEntryDirection.COD_COLLECTION_FEE,
                  ],
                },
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
            revenueInr: isDamage ? null : e.amount.toFixed(2),
            costInr: isDamage ? e.amount.toFixed(2) : null,
          })),
          truncated: rows.length > take,
        };
      }

      case 'cod_shortfall': {
        const rows = await this.prisma.client.courierSettlementLine.findMany({
          where: {
            shortfallInr: { not: 0 },
            settlement: { receivedAt: { gte: from, lte: to } },
          },
          orderBy: { id: 'desc' },
          take: take + 1,
          select: {
            shortfallInr: true,
            order: { select: { orderNumber: true } },
            settlement: { select: { reference: true, receivedAt: true } },
          },
        });
        return {
          key,
          items: rows.slice(0, take).map((l) => ({
            ref: l.order.orderNumber,
            subRef: l.settlement.reference,
            at: l.settlement.receivedAt.toISOString(),
            revenueInr: null,
            // Signed: a recovery shows as a negative cost.
            costInr: l.shortfallInr.toFixed(2),
          })),
          truncated: rows.length > take,
        };
      }

      case 'courier_cod_fees': {
        const rows = await this.prisma.client.bankEntry.findMany({
          where: {
            type: BankEntryType.EXPENSE,
            settlementId: { not: null },
            occurredAt: { gte: from, lte: to },
          },
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
            ref: e.reference ?? '—',
            subRef: e.account.label,
            at: e.occurredAt.toISOString(),
            revenueInr: null,
            costInr: e.signedAmount.abs().toFixed(2),
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
      case 'GST':
        return 'GST on our fees';
      case 'RTO_FEE':
        return 'Return fee';
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

/** "1 Oct 2026" — a date as a person in India reads it. */
function istDate(d: Date): string {
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}
