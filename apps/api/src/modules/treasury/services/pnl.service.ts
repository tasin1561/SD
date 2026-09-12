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
 * Where a parcel's order has to have got to for its fate to be KNOWN
 * on the DELIVERY side: delivered, or lost on the way. A LOST parcel is
 * on the delivery line for its courier cost only — nothing ever bills a
 * lost parcel (the founder, 2026-09-12), so it earns nothing.
 */
const DELIVERED_FATES: OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.LOST_IN_TRANSIT];

/**
 * …and on the RETURNS side: received back. `RTO_RESTOCKED` is listed
 * because an order can reach it without an `RTO_RECEIVED` event of its
 * own (the receipt was skipped or recorded outside the transition);
 * normally RECEIVED comes first, so the earliest of the two is the day
 * the parcel was back.
 */
const RETURNED_FATES: OrderStatus[] = [OrderStatus.RTO_RECEIVED, OrderStatus.RTO_RESTOCKED];

/** A courier-account adjustment that still moves money. */
const ADJUSTMENT_BASE = {
  category: CourierWalletTxnCategory.ADJUSTMENT,
  // `success` only. A failed line is a row about something that did not
  // happen.
  status: 'success',
  // A transaction their ledger has since DROPPED is kept as evidence but
  // moves no money: the later export still balances to the live wallet
  // without it. Parcel costs already exclude it; so must this.
  missingFromExportAt: null,
} as const;

/** The fees a seller pays us for COD handling. */
const COD_SERVICE_FEE_DIRECTIONS: WalletEntryDirection[] = [
  WalletEntryDirection.INSTANT_PAY_FEE,
  WalletEntryDirection.COD_COLLECTION_FEE,
];

/** With the courier and not yet delivered or back — on no line yet. */
const MOVING_STATUSES = [
  OrderStatus.DISPATCHED,
  OrderStatus.IN_TRANSIT,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERY_FAILED,
  OrderStatus.RTO_INITIATED,
  OrderStatus.RTO_IN_TRANSIT,
];

/** Every line the report carries, in order. A drill-down exists for each. */
export const PNL_LINE_KEYS = [
  'inbound_freight',
  'delivery',
  'rto',
  'cod_tax',
  'cod_service_fees',
  'fx',
  'courier_adjustments',
  'courier_unmatched',
  'courier_cod_fees',
  'cod_shortfall',
  'damage_refunds',
  'bank_reconciliation',
  'investment_income',
] as const;
export type PnlLineKey = (typeof PNL_LINE_KEYS)[number];

function isLineKey(key: string): key is PnlLineKey {
  return (PNL_LINE_KEYS as readonly string[]).includes(key);
}

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
 * One report's exchange rates, and WHICH amounts had to be put in rupees
 * at TODAY's rate because nothing was recorded at or before their instant.
 * Per report, never shared: the service is a singleton and two reports
 * running at once must not count each other's fallbacks.
 *
 * The rates are keyed by the EXACT instant asked about, not by the day: a
 * rate recorded at 15:00 applies to an amount at 16:00 the same day and
 * not to one at 09:00, and a day-keyed cache served whichever of the two
 * was asked first to both. The fallbacks are a SET of amounts, because
 * two lines can convert the same entry (operating expenses and the
 * unattributed leg costs both read an expense) and it is still one
 * approximate figure, not two.
 */
class RateBook {
  readonly rates = new Map<string, { rate: Prisma.Decimal | null; fallback: boolean }>();
  readonly fellBack = new Set<string>();
}

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
  /** Anything the report had to leave out, in words. Empty when nothing was. */
  readonly warnings: readonly string[];
  /**
   * Leg costs sitting in operating expenses with no consignment behind
   * them. Null when there are none.
   */
  readonly unattributedLegCosts: {
    readonly amountInr: string;
    readonly count: number;
    /** Of `count`, how many had no rate to rupees and are NOT in `amountInr`. */
    readonly unconverted: number;
    readonly note: string;
  } | null;
}

/** One record behind a line. Null means NOT RECORDED / not counted — never zero. */
export interface PnlLineItem {
  readonly ref: string;
  readonly subRef: string | null;
  readonly at: string;
  readonly revenueInr: string | null;
  readonly costInr: string | null;
}

/**
 * One ORDER whose parcel's fate was settled in the window.
 *
 * Per ORDER, not per shipment: an order's charges are billed once however
 * many parcels carried it, so a per-shipment row repeated them (or, with
 * `take: 1`, dropped the second parcel's cost), and an order whose only
 * shipment never got a waybill had no row at all while its revenue was in
 * the total. Summed over its live shipments, the cost is null only when
 * NOTHING is recorded — which is what the drill-down shows as "not
 * recorded" and the coverage counts as uncovered.
 */
interface FateOrder {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly at: Date;
  /** Lost in transit and never delivered: counted for its cost, never billed. */
  readonly lost: boolean;
  /** Charges less refunds; null for a lost parcel (never billed). */
  readonly billed: Prisma.Decimal | null;
  /** Sum of what is recorded on its live shipments; null when nothing is. */
  readonly cost: Prisma.Decimal | null;
  readonly priced: boolean;
  readonly parcels: readonly string[];
}

interface FateCohort {
  readonly orders: readonly FateOrder[];
  readonly chargesByType: ReadonlyMap<string, { amount: Prisma.Decimal; count: number }>;
  readonly refunds: { amount: Prisma.Decimal; count: number };
}

/** A courier charge on a waybill that is no live Skydrop parcel. */
interface UnmatchedCharge {
  readonly awb: string;
  readonly net: Prisma.Decimal;
  readonly at: Date;
  /** `dead`: a voided or replaced Skydrop parcel. `stray`: nobody's we know. */
  readonly kind: 'dead' | 'stray';
}

/** The half-open window `[from, to)`. Every query in this report uses it. */
function win(from: Date, to: Date): { gte: Date; lt: Date } {
  return { gte: from, lt: to };
}

const sum = (xs: ReadonlyArray<Prisma.Decimal | null>): Prisma.Decimal =>
  xs.reduce<Prisma.Decimal>((t, x) => (x === null ? t : t.add(x)), ZERO);

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
 *
 * ── WINDOWS ARE HALF-OPEN: `[from, to)` ─────────────────────────────
 * Every query is `gte: from, lt: to`. The admin sends `to` as the NEXT
 * IST midnight. A closed window ending at 23:59:59.999 left the last
 * half-millisecond of every day in no window at all — Postgres stores
 * microseconds, so a charge stamped 23:59:59.9995 was in neither that
 * day's report nor the next — and two adjacent closed windows could not
 * be added without a gap. Half-open windows tile: two adjacent reports
 * sum to the report over both, line by line.
 */
@Injectable()
export class PnlService {
  constructor(private readonly prisma: PrismaService) {}

  async report(from: Date, to: Date): Promise<PnlReport> {
    // One rate cache per report: the same currency at the same instant is
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
    // Converted, but at TODAY's rate: nothing was recorded at or before
    // their instant, so the rupee figure is an approximation and is said
    // to be one. Counted per AMOUNT, however many lines converted it.
    if (rates.fellBack.size > 0) {
      warnings.push(
        `${rates.fellBack.size} amount(s) in another currency had no exchange rate recorded for ` +
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
              amountInr: unattributed.amountInr,
              count: unattributed.count,
              unconverted: unattributed.unconverted,
              note:
                (unattributed.unconverted > 0
                  ? `${unattributed.unconverted} of them had no exchange rate to rupees on ` +
                    'their date and are not in the ₹ figure. '
                  : '') +
                'Recorded as an operating expense with no consignment behind it, so the leg ' +
                'it belongs to reads better than it is. Pay the forwarder from the freight ' +
                'bill instead — that records the cash AND attributes it in one step.',
            },
    };
  }

  /** BD → India. What the seller pays us to bring stock in, less the forwarder. */
  private async inboundFreight(from: Date, to: Date): Promise<PnlLine> {
    const charges = await this.prisma.client.inboundFreightCharge.findMany({
      where: { createdAt: win(from, to) },
      select: { totalInr: true, ourCostInr: true, status: true, amountSettledInr: true },
    });
    let revenue = ZERO;
    let cost = ZERO;
    let priced = 0;
    for (const c of charges) {
      revenue = revenue.add(this.freightBilled(c));
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
   * What a freight bill EARNS: a WAIVED bill only what was charged before
   * it was forgiven — counting its full total would book income nobody
   * will ever pay. One place, so the total and its rows cannot disagree.
   */
  private freightBilled(c: {
    status: InboundFreightStatus;
    totalInr: Prisma.Decimal;
    amountSettledInr: Prisma.Decimal;
  }): Prisma.Decimal {
    return c.status === InboundFreightStatus.WAIVED ? c.amountSettledInr : c.totalInr;
  }

  /**
   * The orders whose parcel's FATE was settled in the window, one entry
   * per ORDER, with its revenue and cost already worked out — the ONE
   * computation both the line total and its drill-down read, so the rows
   * always add up to the figure above them.
   *
   * DELIVERY: the order's FIRST transition to DELIVERED or LOST_IN_TRANSIT
   * falls in the window. An order that has EVER reached RTO_RECEIVED /
   * RTO_RESTOCKED belongs to returns alone — dropped here, so a delivered
   * month restates in that one rare case (a courier reversing a delivery)
   * rather than count the parcel twice. An order that was lost and never
   * delivered is here for its COST, with no revenue: nothing ever bills
   * a lost parcel.
   *
   * RETURNS: the order's FIRST transition to RTO_RECEIVED or RTO_RESTOCKED
   * falls in the window — the ORDER's fate, like delivery, not
   * `shipments.rto_received_at`, which a receipt recorded outside the
   * warehouse flow never stamps (SD-2026-QA-498051 has an rto_received
   * event on 29 Jul and no rto_received_at, and was on no line at all).
   *
   * Dated by `order_events`: it is written for every transition however it
   * happened — a courier scan, a manual scan, god mode.
   *
   * Classification (returned? lost?) reads ALL of an order's events, not
   * just those in the window, so it cannot change with the window: that is
   * what makes two adjacent reports add up to the report over both.
   *
   * Cost is summed over the order's LIVE shipments (not deleted, never
   * replaced — a superseded one's charges are on the no-parcel line),
   * both columns added. An order with no such shipment, or one whose
   * parcel never got a waybill, has nothing recorded and is UNCOVERED.
   */
  private async fateCohort(kind: 'delivery' | 'rto', from: Date, to: Date): Promise<FateCohort> {
    const statuses = kind === 'delivery' ? DELIVERED_FATES : RETURNED_FATES;
    const empty: FateCohort = {
      orders: [],
      chargesByType: new Map(),
      refunds: { amount: ZERO, count: 0 },
    };
    const first = await this.prisma.client.orderEvent.groupBy({
      by: ['orderId'],
      where: { toStatus: { in: statuses }, createdAt: { lt: to } },
      _min: { createdAt: true },
      having: { createdAt: { _min: { gte: from } } },
    });
    const at = new Map<string, Date>();
    for (const e of first) {
      if (e._min.createdAt !== null) at.set(e.orderId, e._min.createdAt);
    }
    if (at.size === 0) return empty;

    const lost = new Set<string>();
    if (kind === 'delivery') {
      const seen = await this.prisma.client.orderEvent.findMany({
        where: {
          orderId: { in: [...at.keys()] },
          toStatus: { in: [...DELIVERED_FATES, ...RETURNED_FATES] },
        },
        select: { orderId: true, toStatus: true },
        distinct: ['orderId', 'toStatus'],
      });
      const reached = new Map<string, Set<OrderStatus>>();
      for (const e of seen) {
        if (e.toStatus === null) continue;
        const s = reached.get(e.orderId) ?? new Set<OrderStatus>();
        s.add(e.toStatus);
        reached.set(e.orderId, s);
      }
      for (const id of [...at.keys()]) {
        const s = reached.get(id) ?? new Set<OrderStatus>();
        if (RETURNED_FATES.some((r) => s.has(r))) {
          at.delete(id);
        } else if (!s.has(OrderStatus.DELIVERED)) {
          lost.add(id);
        }
      }
      if (at.size === 0) return empty;
    }

    const ids = [...at.keys()];
    const billable = ids.filter((id) => !lost.has(id));
    const types = kind === 'delivery' ? DELIVERY_REVENUE_TYPES : RETURN_REVENUE_TYPES;
    const [orders, links, charges, refunds] = await Promise.all([
      this.prisma.client.order.findMany({
        where: { id: { in: ids } },
        select: { id: true, orderNumber: true },
      }),
      this.prisma.client.orderShipment.findMany({
        where: { orderId: { in: ids } },
        select: { orderId: true, shipmentId: true },
      }),
      billable.length === 0
        ? []
        : this.prisma.client.orderCharge.findMany({
            where: { deletedAt: null, orderId: { in: billable }, type: { in: [...types] } },
            select: { orderId: true, type: true, amountInr: true },
          }),
      // A fee handed back on one of these orders (a waived or mistaken
      // charge) comes off here, or it is income twice.
      billable.length === 0
        ? []
        : this.prisma.client.sellerWalletEntry.findMany({
            where: {
              direction: WalletEntryDirection.ORDER_CHARGES_REFUND,
              currency: Currency.INR,
              linkedOrderId: { in: billable },
            },
            select: { linkedOrderId: true, amount: true },
          }),
    ]);
    const shipmentIds = [...new Set(links.map((l) => l.shipmentId))];
    const shipments =
      shipmentIds.length === 0
        ? []
        : await this.prisma.client.shipment.findMany({
            where: { id: { in: shipmentIds }, deletedAt: null, supersededAt: null },
            select: {
              id: true,
              shipmentNumber: true,
              awbNumber: true,
              actualCourierCostInr: true,
              actualRtoCostInr: true,
            },
          });
    const shipmentById = new Map(shipments.map((s) => [s.id, s]));

    const chargesByType = new Map<string, { amount: Prisma.Decimal; count: number }>();
    const billedBy = new Map<string, Prisma.Decimal>();
    for (const c of charges) {
      const t = chargesByType.get(c.type) ?? { amount: ZERO, count: 0 };
      chargesByType.set(c.type, { amount: t.amount.add(c.amountInr), count: t.count + 1 });
      billedBy.set(c.orderId, (billedBy.get(c.orderId) ?? ZERO).add(c.amountInr));
    }
    let refundAmount = ZERO;
    for (const r of refunds) {
      if (r.linkedOrderId === null) continue;
      refundAmount = refundAmount.add(r.amount);
      billedBy.set(r.linkedOrderId, (billedBy.get(r.linkedOrderId) ?? ZERO).sub(r.amount));
    }

    const numberOf = new Map(orders.map((o) => [o.id, o.orderNumber]));
    const out: FateOrder[] = ids.map((id) => {
      const mine = links
        .filter((l) => l.orderId === id)
        .map((l) => shipmentById.get(l.shipmentId))
        .filter((s): s is NonNullable<typeof s> => s !== undefined);
      const recorded = mine.filter(
        (s) => s.actualCourierCostInr !== null || s.actualRtoCostInr !== null,
      );
      const cost =
        recorded.length === 0
          ? null
          : sum(recorded.flatMap((s) => [s.actualCourierCostInr, s.actualRtoCostInr]));
      // MEASURED: delivery once every live parcel carries a figure; a
      // return only once the RETURN itself has been billed — until then
      // the forward figure is all we know, and it is not the whole cost.
      const priced =
        mine.length > 0 &&
        mine.every((s) =>
          kind === 'delivery'
            ? s.actualCourierCostInr !== null || s.actualRtoCostInr !== null
            : s.actualRtoCostInr !== null,
        );
      return {
        orderId: id,
        orderNumber: numberOf.get(id) ?? id,
        at: at.get(id) ?? from,
        lost: lost.has(id),
        billed: lost.has(id) ? null : (billedBy.get(id) ?? ZERO),
        cost,
        priced,
        parcels: mine.map((s) => s.awbNumber ?? s.shipmentNumber),
      };
    });
    out.sort((a, b) => b.at.getTime() - a.at.getTime());
    return {
      orders: out,
      chargesByType,
      refunds: {
        amount: refundAmount,
        count: refunds.filter((r) => r.linkedOrderId !== null).length,
      },
    };
  }

  /**
   * The Indian delivery leg. What we bill for carriage, less what the
   * courier charged, for every order DELIVERED (or lost) in the window.
   *
   * BOTH sides are anchored on the same ORDERS (see `fateCohort`), so a
   * parcel's revenue and its cost can never land in different reports.
   *
   * Revenue is every charge we billed for carriage — base, surcharges AND
   * the GST on them (we file no return against it; it is ours,
   * DELIVERY_REVENUE_TYPES), without the RTO fee, which prices a second
   * movement and is on the returns line. The cost is BOTH columns added:
   * the importer nets refunds (COST-1), so the sum is what the parcel
   * cost whichever leg it was billed on.
   */
  private async delivery(from: Date, to: Date): Promise<PnlLine> {
    const [cohort, moving] = await Promise.all([
      this.fateCohort('delivery', from, to),
      // With the courier right now and not yet delivered or back: on no
      // line until their fate is known. Counted so the report says so.
      this.prisma.client.shipment.count({
        where: {
          deletedAt: null,
          supersededAt: null,
          awbNumber: { not: null },
          rtoReceivedAt: null,
          orderShipments: { some: { order: { status: { in: MOVING_STATUSES } } } },
        },
      }),
    ]);
    const orders = cohort.orders;
    const delivered = orders.filter((o) => !o.lost);
    const lost = orders.filter((o) => o.lost);
    const revenue = sum(orders.map((o) => o.billed));
    const deliveredCost = sum(delivered.map((o) => o.cost));
    const lostCost = sum(lost.map((o) => o.cost));
    const priced = orders.filter((o) => o.priced).length;

    const notes = [
      ...(priced < orders.length
        ? [
            `${orders.length - priced} delivered or lost order(s) have no courier cost yet. The ` +
              'nightly wallet sync fills these in once the courier has billed them; a parcel on ' +
              'a manual courier has no ledger at all and needs its cost recorded by hand on the ' +
              'order; and an order whose parcel never got a waybill has nothing to price.',
          ]
        : []),
      ...(lost.length > 0
        ? [
            `${lost.length} parcel(s) were lost in transit: their courier cost ` +
              `(₹${lostCost.toFixed(2)}) is counted here and nothing is billed for them.`,
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
      revenue,
      cost: deliveredCost.add(lostCost),
      priced,
      total: orders.length,
      note: notes.length === 0 ? null : notes.join(' '),
      basis: {
        // Broken out by CHARGE TYPE, because "shipping revenue" is four
        // different prices added together and only one of them is the
        // base rate. A total that cannot be split cannot be checked
        // against a rate card.
        revenue: [
          ...this.chargeParts(cohort, 'delivered or lost in window, first fate'),
          ...(lost.length === 0
            ? []
            : [
                {
                  label: 'Lost in transit — never billed',
                  source:
                    'orders first LOST_IN_TRANSIT and never DELIVERED: none of their order_charges count',
                  count: lost.length,
                  amountInr: '0.00',
                },
              ]),
        ],
        cost: [
          {
            label: 'Courier cost on delivered parcels',
            source:
              'shipments.actual_courier_cost_inr + actual_rto_cost_inr over the order’s live shipments',
            count: delivered.filter((o) => o.cost !== null).length,
            amountInr: deliveredCost.toFixed(2),
          },
          ...(lost.length === 0
            ? []
            : [
                {
                  label: 'Courier cost on parcels lost in transit (no revenue)',
                  source:
                    'shipments.actual_courier_cost_inr + actual_rto_cost_inr, orders LOST_IN_TRANSIT and never DELIVERED',
                  count: lost.filter((o) => o.cost !== null).length,
                  amountInr: lostCost.toFixed(2),
                },
              ]),
        ],
      },
    });
    // Set on the built line: `line()` drops a note when every parcel in it
    // is priced, and "N parcels are still moving" / "N were lost" are true
    // — and worth saying — even then.
    return notes.length === 0
      ? built
      : { ...built, coverage: { ...built.coverage, note: notes.join(' ') } };
  }

  /** A cohort's charges by type, and the refunds that came off them, as basis parts. */
  private chargeParts(cohort: FateCohort, filter: string): PnlBasisPart[] {
    return [
      ...[...cohort.chargesByType.entries()].map(([type, t]) => ({
        label: this.chargeTypeLabel(type),
        source: `order_charges.amount_inr WHERE type=${type} (${filter})`,
        count: t.count,
        amountInr: t.amount.toFixed(2),
      })),
      ...(cohort.refunds.count === 0
        ? []
        : [
            {
              label: 'Refunded to the seller on these orders',
              source: 'seller_wallet_entries.amount WHERE direction=ORDER_CHARGES_REFUND',
              count: cohort.refunds.count,
              amountInr: cohort.refunds.amount.negated().toFixed(2),
            },
          ]),
    ];
  }

  /**
   * Returns — every order whose parcel came BACK in the window (see
   * `fateCohort`).
   *
   * Revenue is what the seller is billed for a parcel that came back: its
   * delivery fee AND its return fee (RETURN_REVENUE_TYPES), less anything
   * refunded on the order — exactly as delivery nets its refunds, or a
   * refunded fee is income twice.
   *
   * The cost is everything the courier charged for the parcel, both
   * columns added. Delhivery refunds the delivery charge on a return and
   * bills one combined return charge; the importer nets that (COST-1),
   * so the forward column of such a parcel is ₹0 and the sum is the true
   * figure. A manual courier bills both legs and refunds neither, and
   * the sum is right there too.
   */
  private async rto(from: Date, to: Date): Promise<PnlLine> {
    const cohort = await this.fateCohort('rto', from, to);
    const orders = cohort.orders;
    const revenue = sum(orders.map((o) => o.billed));
    const cost = sum(orders.map((o) => o.cost));
    const priced = orders.filter((o) => o.priced).length;
    return this.line({
      key: 'rto',
      label: 'Returns',
      revenue,
      cost,
      priced,
      total: orders.length,
      note:
        priced < orders.length
          ? `${orders.length - priced} returns have no return cost recorded, so this margin is flattering.`
          : null,
      basis: {
        revenue: this.chargeParts(cohort, 'received back in window, first fate'),
        cost: [
          {
            label: 'Courier cost to bring parcels back',
            source:
              'shipments.actual_courier_cost_inr + actual_rto_cost_inr over the order’s live shipments',
            count: orders.filter((o) => o.cost !== null).length,
            amountInr: cost.toFixed(2),
          },
        ],
      },
    });
  }

  /**
   * FX spread entries in the window, each put in rupees at its OWN
   * transfer's rate (the one that produced it), and only failing that at
   * the rate in force at its instant. Null `inr` = no rate at all.
   *
   * The spread is posted in the RECEIVING account's currency — usually
   * taka. Summed as it stood it was taka read as rupees.
   */
  private async fxRows(
    from: Date,
    to: Date,
    rates: RateBook,
  ): Promise<
    Array<{
      ref: string;
      subRef: string;
      at: Date;
      inr: Prisma.Decimal | null;
    }>
  > {
    const rows = await this.prisma.client.bankEntry.findMany({
      where: { type: BankEntryType.FX_SPREAD, occurredAt: win(from, to) },
      orderBy: { occurredAt: 'desc' },
      select: {
        id: true,
        signedAmount: true,
        currency: true,
        occurredAt: true,
        reference: true,
        account: { select: { label: true } },
        transfer: {
          select: { amountOut: true, currencyOut: true, amountIn: true, currencyIn: true },
        },
      },
    });
    const out: Array<{ ref: string; subRef: string; at: Date; inr: Prisma.Decimal | null }> = [];
    for (const r of rows) {
      const rate =
        transferRate(r.currency, r.transfer) ??
        (await this.inrPerUnit(r.currency, r.occurredAt, rates, `bank_entries:${r.id}`));
      out.push({
        ref: r.reference ?? r.account.label,
        subRef:
          r.currency === Currency.INR
            ? r.account.label
            : `${r.account.label} · ${r.signedAmount.toFixed(2)} ${r.currency}` +
              (rate === null ? ' (no rate to rupees — not counted)' : ''),
        at: r.occurredAt,
        inr: rate === null ? null : r.signedAmount.mul(rate).toDecimalPlaces(2),
      });
    }
    return out;
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
    const rows = await this.fxRows(from, to, rates);
    const spread = sum(rows.map((r) => r.inr));
    const unconverted = rows.filter((r) => r.inr === null).length;
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
   * The courier-adjustment window for `[from, to)`: counted from the
   * cutover when it falls inside it (see `courierAdjustments`), and
   * nothing at all when the cutover is at or after `to`.
   */
  private async adjustmentWindow(
    from: Date,
    to: Date,
  ): Promise<{ cutover: Date | null; countFrom: Date; counts: boolean }> {
    const cutover = await this.adjustmentsCutover();
    const countFrom = cutover !== null && cutover.getTime() > from.getTime() ? cutover : from;
    return { cutover, countFrom, counts: countFrom.getTime() < to.getTime() };
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
    const { cutover, countFrom, counts } = await this.adjustmentWindow(from, to);
    const rows = counts
      ? await this.prisma.client.courierWalletTransaction.groupBy({
          by: ['kind'],
          where: { ...ADJUSTMENT_BASE, occurredAt: win(countFrom, to) },
          _sum: { amountInr: true },
          _count: { _all: true },
        })
      : [];
    // What the cutover left out of THIS window, so the line says so.
    const excluded =
      countFrom.getTime() > from.getTime()
        ? await this.prisma.client.courierWalletTransaction.groupBy({
            by: ['kind'],
            where: {
              ...ADJUSTMENT_BASE,
              occurredAt: win(from, counts ? countFrom : to),
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
        occurredAt: win(from, to),
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
        createdAt: win(from, to),
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    // Tax withheld on a COD the courier later reversed is given back to
    // the seller — it was never earned, so it comes off this line.
    const returned = await this.deductionsReturned(from, to, [
      WalletEntryDirection.GST_WITHHOLDING,
    ]);
    const returnedSum = sum(returned.map((r) => r.amount));
    const withheld = agg._sum.amount ?? ZERO;
    const amount = withheld.sub(returnedSum);
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
          ...(returned.length > 0
            ? [
                {
                  label: 'Returned on CODs the courier reversed',
                  source:
                    'seller_wallet_entries.amount WHERE direction=COD_DEDUCTION_REFUND AND linked to GST_WITHHOLDING',
                  count: returned.length,
                  amountInr: returnedSum.negated().toFixed(2),
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
      occurredAt: win(from, to),
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
    // rate in force at the time. Added as they stood, they were taka read
    // as rupees — wrong by the exchange rate, silently.
    const other = await this.prisma.client.bankEntry.findMany({
      where: { ...where, currency: { not: Currency.INR } },
      select: { id: true, signedAmount: true, currency: true, occurredAt: true },
    });
    let unconverted = 0;
    for (const o of other) {
      const rate = await this.inrPerUnit(o.currency, o.occurredAt, rates, `bank_entries:${o.id}`);
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
   *
   * An entry with no rate to rupees is counted in `count` and NOT in the
   * rupee figure — and `unconverted` says how many, so a figure that
   * leaves money out cannot pass for one that does not.
   */
  private async unattributedLegCosts(
    from: Date,
    to: Date,
    rates: RateBook,
  ): Promise<{ amountInr: string; count: number; unconverted: number } | null> {
    const rows = await this.prisma.client.bankEntry.findMany({
      where: {
        type: BankEntryType.EXPENSE,
        occurredAt: win(from, to),
        inboundFreightChargeId: null,
        settlementId: null,
        expenseCategory: { code: { in: LEG_EXPENSE_CATEGORIES } },
      },
      select: { id: true, signedAmount: true, currency: true, occurredAt: true },
    });
    if (rows.length === 0) return null;
    let total = ZERO;
    let unconverted = 0;
    for (const r of rows) {
      const rate = await this.inrPerUnit(r.currency, r.occurredAt, rates, `bank_entries:${r.id}`);
      if (rate === null) {
        unconverted += 1;
        continue;
      }
      total = total.add(r.signedAmount.abs().mul(rate).toDecimalPlaces(2));
    }
    return { amountInr: total.toFixed(2), count: rows.length, unconverted };
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
        direction: { in: COD_SERVICE_FEE_DIRECTIONS },
        currency: Currency.INR,
        createdAt: win(from, to),
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const returned = await this.deductionsReturned(from, to, COD_SERVICE_FEE_DIRECTIONS);
    const returnedSum = sum(returned.map((r) => r.amount));
    const revenue = rows.reduce((t, r) => t.add(r._sum.amount ?? ZERO), ZERO).sub(returnedSum);
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
          ...(returned.length > 0
            ? [
                {
                  label: 'Returned on CODs the courier reversed',
                  source:
                    'seller_wallet_entries.amount WHERE direction=COD_DEDUCTION_REFUND AND linked to a fee',
                  count: returned.length,
                  amountInr: returnedSum.negated().toFixed(2),
                },
              ]
            : []),
        ],
        cost: [],
      },
    });
  }

  /**
   * Deductions given back to sellers in the window because the courier
   * reversed the COD they were taken from — only those returning one of
   * `directions`, read off the deduction each refund names
   * (`linkedEntryId`). Rows, not a sum: the line total and its drill-down
   * both read this.
   */
  private async deductionsReturned(
    from: Date,
    to: Date,
    directions: WalletEntryDirection[],
  ): Promise<
    Array<{
      amount: Prisma.Decimal;
      createdAt: Date;
      orderNumber: string | null;
      companyName: string | null;
    }>
  > {
    const rows = await this.prisma.client.sellerWalletEntry.findMany({
      where: {
        direction: WalletEntryDirection.COD_DEDUCTION_REFUND,
        currency: Currency.INR,
        createdAt: win(from, to),
        linkedEntry: { direction: { in: directions } },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        amount: true,
        createdAt: true,
        linkedOrder: { select: { orderNumber: true } },
        seller: { select: { companyName: true } },
      },
    });
    return rows.map((r) => ({
      amount: r.amount,
      createdAt: r.createdAt,
      orderNumber: r.linkedOrder?.orderNumber ?? null,
      companyName: r.seller?.companyName ?? null,
    }));
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
        where: { shortfallInr: { gt: 0 }, settlement: { receivedAt: win(from, to) } },
        _sum: { shortfallInr: true },
        _count: { _all: true },
      }),
      this.prisma.client.courierSettlementLine.aggregate({
        where: { shortfallInr: { lt: 0 }, settlement: { receivedAt: win(from, to) } },
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
        createdAt: win(from, to),
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
   * Every courier charge in `[from, to)` on a waybill that is no LIVE
   * Skydrop parcel — the ONE computation the line total and its
   * drill-down both read.
   *
   * Two kinds of waybill, counted from two different dates:
   *
   *  - one that WAS a Skydrop parcel and is no longer a live one (voided
   *    when its order was cancelled, or replaced by another shipment):
   *    OURS whatever the date, because it was booked through us — the
   *    cutover exists for the business's parcels shipped OUTSIDE
   *    Skydrop, and this is not one.
   *  - one that matches no Skydrop parcel at all: counted only from the
   *    cutover, before which the accounts carried parcels whose revenue
   *    is not in this report.
   *
   * A LIVE parcel absorbs a charge on its own waybill, on its RETURN
   * waybill (`reverse_awb_number` — a customer-return pickup, which the
   * importer costs onto the parcel's return column), and, for Shiprocket,
   * on any waybill filed under its courier ORDER id. A waybill is unique
   * only within a courier, so "ours" means a shipment of the SAME courier
   * as the account the charge was taken from.
   */
  private async unmatchedCharges(from: Date, to: Date): Promise<UnmatchedCharge[]> {
    const cutover = await this.adjustmentsCutover();
    const cutoverFrom = cutover !== null && cutover.getTime() > from.getTime() ? cutover : from;
    const parcelWhere = {
      category: CourierWalletTxnCategory.PARCEL,
      status: 'success',
      missingFromExportAt: null,
      awbNumber: { not: null },
    } as const;
    type Grouped = {
      courierAccountId: string;
      awbNumber: string | null;
      kind: CourierWalletTxnKind;
      _sum: { amountInr: Prisma.Decimal | null };
      _max: { occurredAt: Date | null };
    };
    const netOf = (
      rows: ReadonlyArray<Grouped>,
    ): Map<string, { net: Prisma.Decimal; at: Date }> => {
      const net = new Map<string, { net: Prisma.Decimal; at: Date }>();
      for (const r of rows) {
        if (r.awbNumber === null) continue;
        const amt = r._sum.amountInr ?? ZERO;
        const key = `${r.courierAccountId}|${r.awbNumber}`;
        const prev = net.get(key) ?? { net: ZERO, at: from };
        const at = r._max.occurredAt ?? from;
        net.set(key, {
          net: prev.net.add(r.kind === CourierWalletTxnKind.DEBIT ? amt : amt.negated()),
          at: at.getTime() > prev.at.getTime() ? at : prev.at,
        });
      }
      return net;
    };
    const windowRows = await this.prisma.client.courierWalletTransaction.groupBy({
      by: ['courierAccountId', 'awbNumber', 'courierOrderRef', 'kind'],
      where: { ...parcelWhere, occurredAt: win(from, to) },
      _sum: { amountInr: true },
      _max: { occurredAt: true },
    });
    const windowNet = netOf(windowRows);
    let sinceCutoverNet = windowNet;
    if (cutoverFrom.getTime() >= to.getTime()) {
      sinceCutoverNet = new Map();
    } else if (cutoverFrom.getTime() !== from.getTime()) {
      const cutoverRows = await this.prisma.client.courierWalletTransaction.groupBy({
        by: ['courierAccountId', 'awbNumber', 'courierOrderRef', 'kind'],
        where: { ...parcelWhere, occurredAt: win(cutoverFrom, to) },
        _sum: { amountInr: true },
        _max: { occurredAt: true },
      });
      sinceCutoverNet = netOf(cutoverRows);
    }

    const keys = [...windowNet.keys()];
    if (keys.length === 0) return [];
    const accountIds = [...new Set(keys.map((k) => k.slice(0, k.indexOf('|'))))];
    const awbs = [...new Set(keys.map((k) => k.slice(k.indexOf('|') + 1)))];
    // A Shiprocket charge's ORDER id: a waybill Shiprocket has since
    // replaced still belongs to the parcel that order is, and that
    // parcel's cost already carries it (the importer nets by order id).
    const refOf = new Map<string, string>();
    for (const r of windowRows) {
      if (r.awbNumber !== null && typeof r.courierOrderRef === 'string') {
        refOf.set(`${r.courierAccountId}|${r.awbNumber}`, r.courierOrderRef);
      }
    }
    const refs = [...new Set(refOf.values())];
    const [accounts, shipments] = await Promise.all([
      this.prisma.client.courierAccount.findMany({
        where: { id: { in: accountIds } },
        select: { id: true, courier: { select: { code: true } } },
      }),
      // Every shipment that ever carried one of these waybills — voided
      // and replaced ones included, which is the point.
      this.prisma.client.shipment.findMany({
        where: {
          OR: [
            { awbNumber: { in: awbs } },
            { reverseAwbNumber: { in: awbs } },
            ...(refs.length > 0 ? [{ courierOrderId: { in: refs } }] : []),
          ],
        },
        select: {
          awbNumber: true,
          reverseAwbNumber: true,
          courierOrderId: true,
          courierCode: true,
          deletedAt: true,
          supersededAt: true,
        },
      }),
    ]);
    const courierOf = new Map(accounts.map((a) => [a.id, a.courier.code]));

    const out: UnmatchedCharge[] = [];
    for (const key of keys) {
      const bar = key.indexOf('|');
      const code = courierOf.get(key.slice(0, bar));
      const awb = key.slice(bar + 1);
      const ref = refOf.get(key);
      const mine = shipments.filter(
        (s) =>
          s.courierCode === code &&
          (s.awbNumber === awb ||
            s.reverseAwbNumber === awb ||
            (ref !== undefined && s.courierOrderId === ref)),
      );
      if (mine.some((s) => s.deletedAt === null && s.supersededAt === null)) continue;
      if (mine.length > 0) {
        const w = windowNet.get(key);
        if (w !== undefined) out.push({ awb, net: w.net, at: w.at, kind: 'dead' });
        continue;
      }
      const since = sinceCutoverNet.get(key);
      if (since === undefined) continue;
      out.push({ awb, net: since.net, at: since.at, kind: 'stray' });
    }
    out.sort((a, b) => b.at.getTime() - a.at.getTime());
    return out;
  }

  /** What a courier charged on a waybill that is no LIVE Skydrop parcel (see `unmatchedCharges`). */
  private async unmatchedCourierCharges(from: Date, to: Date): Promise<PnlLine> {
    const charges = await this.unmatchedCharges(from, to);
    const dead = charges.filter((c) => c.kind === 'dead');
    const stray = charges.filter((c) => c.kind === 'stray');
    const deadCost = sum(dead.map((c) => c.net));
    const strayCost = sum(stray.map((c) => c.net));
    const count = charges.length;
    return this.line({
      key: 'courier_unmatched',
      label: 'Courier charges on no live Skydrop parcel',
      revenue: ZERO,
      cost: deadCost.add(strayCost),
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
            count: dead.length,
            amountInr: deadCost.toFixed(2),
          },
          {
            label: 'On waybills that match no Skydrop parcel (from the cutover)',
            source:
              "courier_wallet_transactions WHERE category='parcel' AND awb matches no shipment (forward or return waybill) of that courier AND occurred_at >= pnl.courier_adjustments_from",
            count: stray.length,
            amountInr: strayCost.toFixed(2),
          },
        ],
      },
    });
  }

  /**
   * Capital RECONCILIATION_ADJUSTMENT entries in the window, each
   * classified — the ONE computation the line total and its drill-down
   * both read.
   *
   * The account's FIRST capital entry is its OPENING balance: money the
   * business already had when the book started — capital put in, not
   * earned. Judged on CAPITAL entries only, so a seller top-up landing
   * before the owner got round to entering the balance does not turn the
   * balance into income. Money put in LATER has its own entry type
   * (OWNER_CONTRIBUTION) and never reaches this line.
   */
  private async reconciliationRows(
    from: Date,
    to: Date,
    rates: RateBook,
  ): Promise<
    Array<{
      ref: string;
      subRef: string;
      at: Date;
      opening: boolean;
      inr: Prisma.Decimal | null;
    }>
  > {
    const rows = await this.prisma.client.bankEntry.findMany({
      where: {
        type: BankEntryType.RECONCILIATION_ADJUSTMENT,
        // A correction to money held for a seller is theirs, not ours.
        ownerKind: BankOwnerKind.CAPITAL,
        occurredAt: win(from, to),
      },
      orderBy: { occurredAt: 'desc' },
      select: {
        id: true,
        accountId: true,
        signedAmount: true,
        currency: true,
        occurredAt: true,
        reference: true,
        account: { select: { label: true } },
      },
    });
    const out: Array<{
      ref: string;
      subRef: string;
      at: Date;
      opening: boolean;
      inr: Prisma.Decimal | null;
    }> = [];
    for (const r of rows) {
      const earlier = await this.prisma.client.bankEntry.findFirst({
        where: { accountId: r.accountId, ownerKind: BankOwnerKind.CAPITAL, id: { lt: r.id } },
        select: { id: true },
      });
      const rate = await this.inrPerUnit(r.currency, r.occurredAt, rates, `bank_entries:${r.id}`);
      const opening = earlier === null;
      out.push({
        ref: r.reference ?? r.account.label,
        subRef:
          (r.currency === Currency.INR
            ? r.account.label
            : `${r.account.label} · ${r.signedAmount.toFixed(2)} ${r.currency}`) +
          (opening
            ? ' · opening balance — capital put in, not counted'
            : rate === null
              ? ' · no rate to rupees — not counted'
              : ''),
        at: r.occurredAt,
        opening,
        inr: rate === null ? null : r.signedAmount.mul(rate).toDecimalPlaces(2),
      });
    }
    return out;
  }

  /**
   * Corrections posted against a bank statement on OUR money — bank
   * charges, interest, a difference nobody could explain. Signed: a
   * positive one is money we did not know we had.
   */
  private async bankReconciliation(from: Date, to: Date, rates: RateBook): Promise<PnlLine> {
    const rows = await this.reconciliationRows(from, to, rates);
    const openings = rows.filter((r) => r.opening);
    const counted = rows.filter((r) => !r.opening && r.inr !== null);
    const unconverted = rows.filter((r) => !r.opening && r.inr === null).length;
    const total = sum(counted.map((r) => r.inr));
    const opening = sum(openings.map((r) => r.inr));
    const notes = [
      ...(openings.length > 0
        ? [
            `${openings.length} opening balance(s) (₹${opening.toFixed(2)}) are capital put in, ` +
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
        priced: counted.length,
        total: counted.length + unconverted,
        note: notes.length === 0 ? null : notes.join(' '),
      },
      basis: {
        revenue: [
          {
            label: 'Corrections against a bank statement (charges, interest, unexplained)',
            source:
              "bank_entries.signed_amount WHERE type=RECONCILIATION_ADJUSTMENT AND owner='capital' AND not the account's first capital entry",
            count: counted.length,
            amountInr: total.toFixed(2),
          },
        ],
        cost: [],
      },
    };
  }

  /**
   * Investments closed in the window, each with what it earned in rupees
   * — returned less placed, recognised when it closes. The principal
   * moving out and back is not income; the difference is.
   *
   * `placed_inr` / `returned_inr` hold the ACCOUNT's currency despite
   * their names (InvestmentService says so): a taka deposit stores taka.
   * Subtracted as they stood, ৳1,500 of interest read as ₹1,500. The
   * difference is put in rupees at the rate in force when it closed.
   */
  private async investmentRows(
    from: Date,
    to: Date,
    rates: RateBook,
  ): Promise<Array<{ ref: string; subRef: string; at: Date; inr: Prisma.Decimal | null }>> {
    const rows = await this.prisma.client.investment.findMany({
      where: { closedAt: win(from, to) },
      orderBy: { closedAt: 'desc' },
      select: {
        id: true,
        label: true,
        counterparty: true,
        placedInr: true,
        returnedInr: true,
        currency: true,
        closedAt: true,
      },
    });
    const out: Array<{ ref: string; subRef: string; at: Date; inr: Prisma.Decimal | null }> = [];
    for (const r of rows) {
      const at = r.closedAt ?? from;
      const rate = await this.inrPerUnit(r.currency, at, rates, `investments:${r.id}`);
      const earned = r.returnedInr.sub(r.placedInr);
      out.push({
        ref: r.label,
        subRef:
          (r.currency === Currency.INR
            ? r.counterparty
            : `${r.counterparty} · ${earned.toFixed(2)} ${r.currency}`) +
          (rate === null ? ' · no rate to rupees — not counted' : ''),
        at,
        inr: rate === null ? null : earned.mul(rate).toDecimalPlaces(2),
      });
    }
    return out;
  }

  /** What an investment earned, recognised when it closes (see `investmentRows`). */
  private async investmentIncome(from: Date, to: Date, rates: RateBook): Promise<PnlLine> {
    const rows = await this.investmentRows(from, to, rates);
    const income = sum(rows.map((r) => r.inr));
    const unconverted = rows.filter((r) => r.inr === null).length;
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
   * INR per unit of `currency` at the instant `at`: the LATEST rate
   * recorded at or before it (the history), else today's. Null when there
   * is no rate at all — the caller leaves the amount out and says so
   * rather than guessing.
   *
   * `amountKey` names the amount being converted (`<table>:<id>`), so the
   * report can say how many DISTINCT amounts fell back to today's rate.
   */
  private async inrPerUnit(
    currency: Currency,
    at: Date,
    book: RateBook,
    amountKey: string,
  ): Promise<Prisma.Decimal | null> {
    if (currency === Currency.INR) return new Prisma.Decimal(1);
    const key = `${currency}|${at.getTime()}`;
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
      // TODAY's rate standing in for an instant nothing was recorded
      // before. Used, because leaving the amount out would be further
      // from the truth — but counted, so the report says how many figures
      // are approximate.
      entry = { rate, fallback: hist === null && rate !== null };
      book.rates.set(key, entry);
    }
    if (entry.fallback) book.fellBack.add(amountKey);
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
   * Each line's rows use EXACTLY its total's filters — the same half-open
   * window, cutover, exclusions and conversions, most by reading the same
   * computation — so the signed rows add up to the figure above them. A
   * null figure is one the total does not count (not recorded, lost in
   * transit, no rate, an opening balance), never a zero.
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
  ): Promise<{ key: string; items: ReadonlyArray<PnlLineItem>; truncated: boolean }> {
    const take = Math.min(Math.max(limit, 1), 1000);
    const capped = (
      items: PnlLineItem[],
      moreInDb = false,
    ): { key: string; items: PnlLineItem[]; truncated: boolean } => {
      const sorted = [...items].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      return { key, items: sorted.slice(0, take), truncated: moreInDb || sorted.length > take };
    };
    if (!isLineKey(key)) return { key, items: [], truncated: false };
    const rates = new RateBook();

    switch (key) {
      case 'inbound_freight': {
        const rows = await this.prisma.client.inboundFreightCharge.findMany({
          where: { createdAt: win(from, to) },
          orderBy: { createdAt: 'desc' },
          take: take + 1,
          select: {
            totalInr: true,
            ourCostInr: true,
            status: true,
            amountSettledInr: true,
            createdAt: true,
            consignment: { select: { consignmentNumber: true } },
            seller: { select: { companyName: true } },
          },
        });
        return capped(
          rows.map((r) => ({
            ref: r.consignment?.consignmentNumber ?? '—',
            subRef: r.seller?.companyName ?? null,
            at: r.createdAt.toISOString(),
            revenueInr: this.freightBilled(r).toFixed(2),
            // Null, not zero. "No forwarder cost recorded" and "the
            // forwarder charged nothing" are different facts, and only
            // one of them means somebody still has to do something.
            costInr: r.ourCostInr?.toFixed(2) ?? null,
          })),
        );
      }

      case 'delivery':
      case 'rto': {
        // One row per ORDER — its charges once, its cost summed over its
        // live shipments — from the very cohort the total is built from.
        const cohort = await this.fateCohort(key, from, to);
        return capped(
          cohort.orders.map((o) => ({
            ref: o.orderNumber,
            subRef:
              (o.parcels.length === 0 ? 'no live parcel' : o.parcels.join(', ')) +
              (o.lost ? ' · lost in transit — never billed' : ''),
            at: o.at.toISOString(),
            revenueInr: o.billed?.toFixed(2) ?? null,
            costInr: o.cost?.toFixed(2) ?? null,
          })),
        );
      }

      case 'cod_tax':
      case 'cod_service_fees': {
        const isTax = key === 'cod_tax';
        const directions = isTax
          ? [WalletEntryDirection.GST_WITHHOLDING]
          : COD_SERVICE_FEE_DIRECTIONS;
        const [rows, returned] = await Promise.all([
          this.prisma.client.sellerWalletEntry.findMany({
            where: {
              direction: { in: directions },
              currency: Currency.INR,
              createdAt: win(from, to),
            },
            orderBy: { createdAt: 'desc' },
            take: take + 1,
            select: {
              amount: true,
              createdAt: true,
              linkedOrder: { select: { orderNumber: true } },
              seller: { select: { companyName: true } },
            },
          }),
          this.deductionsReturned(from, to, directions),
        ]);
        return capped(
          [
            ...rows.map((e) => ({
              ref: e.linkedOrder?.orderNumber ?? '—',
              subRef: e.seller?.companyName ?? null,
              at: e.createdAt.toISOString(),
              revenueInr: e.amount.toFixed(2),
              costInr: null,
            })),
            // Given back on a COD the courier reversed: comes OFF the line,
            // as it does in the total.
            ...returned.map((r) => ({
              ref: r.orderNumber ?? '—',
              subRef: `${r.companyName ?? '—'} · returned on a reversed COD`,
              at: r.createdAt.toISOString(),
              revenueInr: r.amount.negated().toFixed(2),
              costInr: null,
            })),
          ],
          rows.length > take,
        );
      }

      case 'fx': {
        const rows = await this.fxRows(from, to, rates);
        return capped(
          rows.map((r) => ({
            ref: r.ref,
            subRef: r.subRef,
            at: r.at.toISOString(),
            // In RUPEES at its own transfer's rate, as the total is —
            // signed, because a spread can go against us.
            revenueInr: r.inr?.toFixed(2) ?? null,
            costInr: null,
          })),
        );
      }

      case 'courier_adjustments': {
        const { countFrom, counts } = await this.adjustmentWindow(from, to);
        const rows = counts
          ? await this.prisma.client.courierWalletTransaction.findMany({
              where: { ...ADJUSTMENT_BASE, occurredAt: win(countFrom, to) },
              orderBy: { occurredAt: 'desc' },
              take: take + 1,
              select: {
                txnId: true,
                awbNumber: true,
                kind: true,
                amountInr: true,
                occurredAt: true,
                shipmentStatus: true,
              },
            })
          : [];
        return capped(
          rows.map((t) => ({
            ref: t.txnId,
            subRef: t.awbNumber ?? t.shipmentStatus,
            at: t.occurredAt.toISOString(),
            revenueInr: null,
            // Signed: a credit reduces the cost.
            costInr: (t.kind === CourierWalletTxnKind.DEBIT
              ? t.amountInr
              : t.amountInr.negated()
            ).toFixed(2),
          })),
          rows.length > take,
        );
      }

      case 'courier_unmatched': {
        const charges = await this.unmatchedCharges(from, to);
        return capped(
          charges.map((c) => ({
            ref: c.awb,
            subRef:
              c.kind === 'dead'
                ? 'Skydrop parcel voided or replaced'
                : 'matches no Skydrop parcel (from the cutover)',
            at: c.at.toISOString(),
            revenueInr: null,
            costInr: c.net.toFixed(2),
          })),
        );
      }

      case 'courier_cod_fees': {
        const rows = await this.prisma.client.bankEntry.findMany({
          where: {
            type: BankEntryType.EXPENSE,
            settlementId: { not: null },
            occurredAt: win(from, to),
          },
          orderBy: { occurredAt: 'desc' },
          take: take + 1,
          select: {
            signedAmount: true,
            occurredAt: true,
            reference: true,
            account: { select: { label: true } },
          },
        });
        return capped(
          rows.map((e) => ({
            ref: e.reference ?? '—',
            subRef: e.account.label,
            at: e.occurredAt.toISOString(),
            revenueInr: null,
            costInr: e.signedAmount.abs().toFixed(2),
          })),
          rows.length > take,
        );
      }

      case 'cod_shortfall': {
        const rows = await this.prisma.client.courierSettlementLine.findMany({
          where: {
            shortfallInr: { not: 0 },
            settlement: { receivedAt: win(from, to) },
          },
          orderBy: { id: 'desc' },
          take: take + 1,
          select: {
            shortfallInr: true,
            order: { select: { orderNumber: true } },
            settlement: { select: { reference: true, receivedAt: true } },
          },
        });
        return capped(
          rows.map((l) => ({
            ref: l.order.orderNumber,
            subRef: l.settlement.reference,
            at: l.settlement.receivedAt.toISOString(),
            revenueInr: null,
            // Signed: a recovery shows as a negative cost.
            costInr: l.shortfallInr.toFixed(2),
          })),
          rows.length > take,
        );
      }

      case 'damage_refunds': {
        const rows = await this.prisma.client.sellerWalletEntry.findMany({
          where: {
            direction: WalletEntryDirection.SCRAP_REFUND,
            currency: Currency.INR,
            createdAt: win(from, to),
          },
          orderBy: { createdAt: 'desc' },
          take: take + 1,
          select: {
            amount: true,
            createdAt: true,
            linkedOrder: { select: { orderNumber: true } },
            seller: { select: { companyName: true } },
          },
        });
        return capped(
          rows.map((e) => ({
            ref: e.linkedOrder?.orderNumber ?? '—',
            subRef: e.seller?.companyName ?? null,
            at: e.createdAt.toISOString(),
            revenueInr: null,
            costInr: e.amount.toFixed(2),
          })),
          rows.length > take,
        );
      }

      case 'bank_reconciliation': {
        const rows = await this.reconciliationRows(from, to, rates);
        return capped(
          rows.map((r) => ({
            ref: r.ref,
            subRef: r.subRef,
            at: r.at.toISOString(),
            // An opening balance is listed so it can be seen, and NOT
            // counted — exactly as the total leaves it out.
            revenueInr: r.opening ? null : (r.inr?.toFixed(2) ?? null),
            costInr: null,
          })),
        );
      }

      case 'investment_income': {
        const rows = await this.investmentRows(from, to, rates);
        return capped(
          rows.map((r) => ({
            ref: r.ref,
            subRef: r.subRef,
            at: r.at.toISOString(),
            revenueInr: r.inr?.toFixed(2) ?? null,
            costInr: null,
          })),
        );
      }

      default: {
        const unreachable: never = key;
        return { key: unreachable, items: [], truncated: false };
      }
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
    key: PnlLineKey;
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
