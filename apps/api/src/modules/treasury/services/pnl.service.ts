import { Injectable } from '@nestjs/common';
import {
  BankEntryType,
  BankOwnerKind,
  ChargeType,
  CourierWalletTxnCategory,
  CourierWalletTxnKind,
  Currency,
  InboundFreightStatus,
  OrderStatus,
  Prisma,
  WalletEntryDirection,
} from '@skydrop/db';
import { inrRateAt } from '../../../common/fx/inr-rate-at';
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
 * Which leg of a parcel's journey a charge line prices — the ONE place a
 * charge type is placed, F2-exhaustive, so a new `ChargeType` fails to
 * compile until somebody decides whether it is revenue and on which line.
 *
 * The list it replaced was hand-written and had drifted: RESHIPMENT_FEE,
 * ADJUSTMENT and OTHER are debited to the seller's wallet with every
 * other order charge (`OrderChargesAccrualService` sums everything but
 * REFUND and RTO_FEE) and were on no line at all.
 *
 *  - `delivery`: what the ORDER_CHARGES debit is made of. GST is in it:
 *    we file no GST return against it (the founder, 2026-09-11) — like
 *    the tax deducted from a COD, what we charge is ours.
 *  - `return`: the return fee, taken on its own wallet direction at RTO
 *    receive. A returned parcel earns its delivery fee AND this.
 *  - `excluded`: REFUND — the accrual skips it (money handed back is an
 *    ORDER_CHARGES_REFUND wallet entry, which the cohorts subtract), so
 *    counting the line as well would take it off twice.
 */
export function chargeLeg(type: ChargeType): 'delivery' | 'return' | 'excluded' {
  switch (type) {
    case ChargeType.BASE_SHIPPING:
    case ChargeType.COD_FEE:
    case ChargeType.FUEL_SURCHARGE:
    case ChargeType.REMOTE_AREA_FEE:
    case ChargeType.WEIGHT_DISPUTE_FEE:
    case ChargeType.RESHIPMENT_FEE:
    case ChargeType.GST:
    case ChargeType.ADJUSTMENT:
    case ChargeType.OTHER:
      return 'delivery';
    case ChargeType.RTO_FEE:
      return 'return';
    case ChargeType.REFUND:
      return 'excluded';
    default: {
      const unplaced: never = type;
      return unplaced;
    }
  }
}

/** What a seller pays us for carriage (see `chargeLeg`). */
export const DELIVERY_REVENUE_TYPES: readonly ChargeType[] = Object.values(ChargeType).filter(
  (t) => chargeLeg(t) === 'delivery',
);

/** A returned parcel earns its delivery fee AND its return fee (RTO or customer return). */
export const RETURN_REVENUE_TYPES: readonly ChargeType[] = Object.values(ChargeType).filter(
  (t) => chargeLeg(t) !== 'excluded',
);

/**
 * What a seller is actually DEBITED for moving a parcel — the delivery
 * fee, the return fee, the customer-return fee. Revenue on the delivery
 * and returns lines is these debits on the order, less any
 * ORDER_CHARGES_REFUND: what was BILLED, never the charge lines, which
 * are a quote until the wallet is debited (a line added after the debit,
 * or a fee on AT_DELIVERY timing that never came due, was never paid).
 */
const BILLED_DIRECTIONS: readonly WalletEntryDirection[] = [
  WalletEntryDirection.ORDER_CHARGES,
  WalletEntryDirection.RTO_FEE,
  WalletEntryDirection.CUSTOMER_RETURN_FEE,
];

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

/**
 * PAYOUT_DATING — one date for everything a courier payout produces.
 *
 * A payout writes, in ONE transaction: its lines (with the shortfall each
 * recognises), the COD credits and their deductions (the tax we keep,
 * the COD collection fee), the reversals and the deductions they return,
 * and the early-COD fee's EXPENSE entry. They used to be dated two ways:
 * the wallet entries by `created_at` (when it was recorded) and the
 * shortfall and early-COD fee by the settlement's `received_at` — a date
 * an operator TYPES. So one payout could straddle two months, and
 * `allocateMore`, which adds lines later, put their shortfall back in the
 * month the original payout named while their credits landed today.
 *
 * Every figure derived from a payout is now dated by when it was
 * RECORDED: the line's, the wallet entry's and the bank entry's
 * `created_at`, which Postgres fixes per transaction — so a payout's
 * figures share one instant and can never split across windows. Chosen
 * over `received_at` because the wallet entries CANNOT be dated any other
 * way (an Instant Pay deduction has no payout behind it at all), because
 * a typed date can be back-dated into a month already closed and restate
 * it, and because a report must not move when somebody corrects a typo.
 * The cost: a payout recorded on the 2nd for money that landed on the
 * 30th is in the later month — the bank book (by `occurred_at`) still
 * shows the cash on the 30th.
 */

/** The fees a seller pays us for COD handling. */
const COD_SERVICE_FEE_DIRECTIONS: WalletEntryDirection[] = [
  WalletEntryDirection.INSTANT_PAY_FEE,
  WalletEntryDirection.COD_COLLECTION_FEE,
];

/**
 * Where an order's money sits on this report, by the status it is in —
 * F2-exhaustive, so a new `OrderStatus` fails to compile until somebody
 * decides which line an order in it belongs to. Every status is here
 * exactly once, which is what proves no charged or costed order falls
 * between the lines:
 *
 *  - `delivered`: DELIVERED, and LOST_IN_TRANSIT (its cost, and only
 *    whatever fee is still held on it). The delivery line, dated by the
 *    first event of the final stretch in that fate (see `walkFate`).
 *  - `returned`: received back — RTO_RECEIVED and what follows it
 *    (RESTOCKED, DAMAGED). The returns line, dated by the receipt.
 *  - `called_off`: cancelled or rejected. Such an order can still carry
 *    money: a delivery fee taken at the waybill (AT_AWB timing) and
 *    never refunded — a cancel after DISPATCHED keeps it by design — and
 *    the courier's charge on a parcel that had left us. The delivery
 *    line, dated by the cancellation, labelled. A parcel VOIDED before it
 *    left (its shipment soft-deleted) is not in it: that charge is on the
 *    "no live Skydrop parcel" line already.
 *  - `open`: every other status — waiting on a call, in the warehouse, or
 *    with the courier. Its fate is not known, so it is on NO line; the
 *    delivery note counts the parcels and the courier cost already on
 *    them (a waybill is charged when it is booked, at confirmation, so a
 *    parcel still in the warehouse can already carry one).
 *
 * `pnl.service.spec` pins this against the state machine: every TERMINAL
 * status is a known fate, and no `open` status is terminal.
 */
export function orderFate(status: OrderStatus): 'delivered' | 'returned' | 'called_off' | 'open' {
  switch (status) {
    case OrderStatus.DELIVERED:
    case OrderStatus.LOST_IN_TRANSIT:
      return 'delivered';
    case OrderStatus.RTO_RECEIVED:
    case OrderStatus.RTO_RESTOCKED:
    case OrderStatus.RTO_DAMAGED:
      return 'returned';
    case OrderStatus.CANCELLED:
    case OrderStatus.CANCELLED_BY_ADMIN:
    case OrderStatus.REJECTED:
    case OrderStatus.REJECTED_BY_CUSTOMER:
    case OrderStatus.REJECTED_NDR:
      return 'called_off';
    case OrderStatus.DRAFT:
    case OrderStatus.PENDING_CONFIRMATION:
    case OrderStatus.CALL_NO_RESPONSE:
    case OrderStatus.CALL_RESCHEDULED:
    case OrderStatus.AWAITING_SELLER_DECISION:
    case OrderStatus.OUT_OF_STOCK:
    case OrderStatus.CONFIRMED:
    case OrderStatus.AWAITING_COURIER:
    case OrderStatus.PENDING_MANUAL_PLACEMENT:
    case OrderStatus.PENDING_PICK:
    case OrderStatus.PICKED:
    case OrderStatus.PACK_FAILED:
    case OrderStatus.PACKED:
    case OrderStatus.PENDING_DISPATCH:
    case OrderStatus.DISPATCHED:
    case OrderStatus.IN_TRANSIT:
    case OrderStatus.OUT_FOR_DELIVERY:
    case OrderStatus.DELIVERY_FAILED:
    case OrderStatus.RTO_INITIATED:
    case OrderStatus.RTO_IN_TRANSIT:
      return 'open';
    default: {
      const unplaced: never = status;
      return unplaced;
    }
  }
}

type Fate = ReturnType<typeof orderFate>;

/**
 * Every status `orderFate` places on `fate`. Each cohort selects with
 * this, never with a list of its own: a hand-written list had drifted
 * (RTO_DAMAGED was a returned fate that the returns cohort did not
 * select, so an order forced straight to it was on no line).
 */
function statusesOf(fate: Fate): OrderStatus[] {
  return Object.values(OrderStatus).filter((s) => orderFate(s) === fate);
}

/** Fate not yet known: on no line (see `orderFate`). */
const OPEN_STATUSES = statusesOf('open');

/**
 * The return leg of a parcel that WAS delivered — a customer return on
 * its way back. It keeps the order's delivered fate until the parcel is
 * received (then returns) or lost (still delivery, labelled): the
 * delivery happened, and it is restated only when the parcel is back.
 * After anything but a delivery these statuses are open (an RTO after a
 * failed delivery).
 */
const RETURN_LEG_AFTER_DELIVERY: readonly OrderStatus[] = [
  OrderStatus.RTO_INITIATED,
  OrderStatus.RTO_IN_TRANSIT,
];

/**
 * Where an order's lifecycle SETTLED, read from its status events in
 * order: the fate it is in, and the first event of the final unbroken
 * stretch in that fate — the instant it got there and stayed.
 *
 * A stretch is broken by any event into a different fate, so an order
 * forced to DELIVERED by mistake, corrected back to IN_TRANSIT and truly
 * delivered later is dated by the REAL delivery; a rejection that was
 * reopened and rejected again, by the final rejection. The one exception
 * is `RETURN_LEG_AFTER_DELIVERY`, which continues a delivered stretch.
 *
 * The flags describe the final stretch only.
 */
interface FateWalk {
  readonly fate: Fate;
  readonly start: Date | null;
  /** DELIVERED is in the stretch. */
  readonly delivered: boolean;
  /** LOST_IN_TRANSIT is in the stretch. */
  readonly lost: boolean;
  /** Lost, then found and delivered. */
  readonly found: boolean;
  /** Delivered, then lost. */
  readonly lostAfterDelivery: boolean;
  /** The parcel was on its way back after the delivery (a customer return). */
  readonly onReturnLeg: boolean;
  /** Delivered at some point BEFORE the stretch began. */
  readonly deliveredBefore: boolean;
}

const OPEN_WALK: FateWalk = {
  fate: 'open',
  start: null,
  delivered: false,
  lost: false,
  found: false,
  lostAfterDelivery: false,
  onReturnLeg: false,
  deliveredBefore: false,
};

function walkFate(events: ReadonlyArray<{ toStatus: OrderStatus; createdAt: Date }>): FateWalk {
  let w = { ...OPEN_WALK };
  let everDelivered = false;
  for (const e of events) {
    const f = orderFate(e.toStatus);
    if (
      f === 'open' &&
      w.fate === 'delivered' &&
      w.delivered &&
      RETURN_LEG_AFTER_DELIVERY.includes(e.toStatus)
    ) {
      w = { ...w, onReturnLeg: true };
      continue;
    }
    if (f !== w.fate) {
      w = { ...OPEN_WALK, fate: f, start: e.createdAt, deliveredBefore: everDelivered };
    }
    if (e.toStatus === OrderStatus.DELIVERED) {
      w = { ...w, delivered: true, found: w.found || w.lost };
      everDelivered = true;
    } else if (e.toStatus === OrderStatus.LOST_IN_TRANSIT) {
      w = { ...w, lost: true, lostAfterDelivery: w.lostAfterDelivery || w.delivered };
    }
  }
  return w;
}

/**
 * The fate an order is in NOW, by its current status — a parcel on its
 * way back after a delivery still counting as delivered (see
 * `RETURN_LEG_AFTER_DELIVERY`). A cohort counts an order only when this
 * agrees with its events' `walkFate`: the events date it, the status
 * says it is still there.
 */
function currentFate(status: OrderStatus | null, w: FateWalk): Fate {
  if (status === null) return 'open';
  const f = orderFate(status);
  return f === 'open' && w.fate === 'delivered' && RETURN_LEG_AFTER_DELIVERY.includes(status)
    ? 'delivered'
    : f;
}

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
 * Rupees per unit of `currency` at a payout's OWN rate: the rupees the
 * wallet was debited over the units that left. Null when the entry is not
 * in the payout's currency or the payout was not debited in rupees.
 */
function remittanceRate(
  currency: Currency,
  r: {
    amount: Prisma.Decimal;
    currency: Currency;
    sourceAmount: Prisma.Decimal;
    sourceCurrency: Currency;
  } | null,
): Prisma.Decimal | null {
  if (currency === Currency.INR) return new Prisma.Decimal(1);
  if (r === null) return null;
  if (r.currency === currency && r.sourceCurrency === Currency.INR && r.amount.gt(0)) {
    return r.sourceAmount.div(r.amount);
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
  /** When it reached the fate it is in (see `walkFate`). */
  readonly at: Date;
  /**
   * Lost in transit and never delivered. On the delivery line for its
   * courier cost; its revenue is whatever fee is still HELD on it — ₹0
   * once refunded (a lost parcel is not charged, the founder 2026-09-12),
   * the real figure while it is not.
   */
  readonly lost: boolean;
  /** Delivered, then lost; `onReturnLeg` when it was a return on its way back. */
  readonly lostAfterDelivery: boolean;
  readonly onReturnLeg: boolean;
  /** Lost, then found and delivered. */
  readonly found: boolean;
  /** Delivered before it came back (returns). */
  readonly deliveredFirst: boolean;
  /**
   * Cancelled or rejected (the status it is in), for an order on the
   * delivery line because it still carries money (see `orderFate`).
   */
  readonly calledOff: OrderStatus | null;
  /** The BILLED_DIRECTIONS debits on the order. */
  readonly debits: ReadonlyArray<{ direction: WalletEntryDirection; amount: Prisma.Decimal }>;
  /** ORDER_CHARGES_REFUNDs on the order. */
  readonly refunds: readonly Prisma.Decimal[];
  /** Debits less refunds: what the order earned us. */
  readonly billed: Prisma.Decimal;
  /** Charge lines beyond what was debited — quoted, never billed, not counted. */
  readonly unbilled: Prisma.Decimal;
  /** Sum of what is recorded on its live shipments; null when nothing is. */
  readonly cost: Prisma.Decimal | null;
  readonly priced: boolean;
  readonly parcels: readonly string[];
}

interface FateCohort {
  readonly orders: readonly FateOrder[];
  /**
   * Fate-based recognition RESTATES a window, by design (TRE-6). Counted
   * so the notes can say so when it happens:
   *
   *  - `leftForReturns` (delivery): reached delivery in this window and
   *    since received back — on the returns line of the window it came
   *    back in, and no longer here.
   *  - `movedOn`: reached this fate in this window and has since left it
   *    — reopened, cancelled, returned (returns: forced elsewhere), or
   *    delivered again later — so it is counted where its current fate
   *    began, and not here.
   */
  readonly leftForReturns: number;
  readonly movedOn: number;
}

/** A courier charge on a waybill that is no live Skydrop parcel. */
interface UnmatchedCharge {
  readonly awb: string;
  readonly net: Prisma.Decimal;
  readonly at: Date;
  /** `dead`: a voided or replaced Skydrop parcel. `stray`: nobody's we know. */
  readonly kind: 'dead' | 'stray';
}

/** The labels of one group's billed parts (see `billedParts`). */
interface BilledLabels {
  readonly charges: string;
  readonly returnFee: string;
  readonly customerReturnFee: string;
  readonly refunded: string;
}

const BILLED_LABELS = {
  delivered: {
    charges: 'Delivery fees debited to sellers',
    returnFee: 'Return fees debited',
    customerReturnFee: 'Customer-return fees debited',
    refunded: 'Refunded to the seller on these orders',
  },
  lost: {
    charges: 'Fees debited on parcels lost in transit',
    returnFee: 'Return fees debited on parcels lost in transit',
    customerReturnFee: 'Customer-return fees debited on parcels lost in transit',
    refunded: 'Refunded on parcels lost in transit',
  },
  calledOff: {
    charges: 'Delivery fee taken on orders since called off',
    returnFee: 'Return fee taken on orders since called off',
    customerReturnFee: 'Customer-return fee taken on orders since called off',
    refunded: 'Refunded to the seller on those orders',
  },
  returned: {
    charges: 'Delivery fees debited on returned parcels',
    returnFee: 'Return fees debited',
    customerReturnFee: 'Customer-return fees debited',
    refunded: 'Refunded to the seller on these orders',
  },
} as const satisfies Record<string, BilledLabels>;

function group<T>(xs: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = out.get(k);
    if (list === undefined) out.set(k, [x]);
    else list.push(x);
  }
  return out;
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
      freightAtTodaysRate,
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
      this.freightPaymentsAtTodaysRate(from, to),
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
    // The same, inside a freight bill's cost: the bill stores its cost
    // already in rupees (FRT-4), so the report would otherwise pass on an
    // approximation as if it were exact.
    if (freightAtTodaysRate > 0) {
      warnings.push(
        `${freightAtTodaysRate} forwarder payment(s) on freight bills raised in this window had ` +
          "no exchange rate recorded at or before the payment, so the bill's cost used today's " +
          'rate. Record the rate for those days on /fx-rates for an exact figure.',
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
        expenses.unconverted === 0 &&
        freightAtTodaysRate === 0 &&
        lines.every((l) => l.coverage.priced === l.coverage.total),
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
   * How many forwarder payments on the window's freight bills (the bills
   * the inbound line counts) were put in rupees at TODAY's rate because no
   * rate was recorded at or before the payment. The bill's `our_cost_inr`
   * is stamped by the freight service with the same rule (`inrRateAt`), so
   * asking the same question here says exactly which figures are
   * approximate. A payment with no rate at all cannot be attached — the
   * freight service refuses it — but is counted too, rather than assumed.
   */
  private async freightPaymentsAtTodaysRate(from: Date, to: Date): Promise<number> {
    const payments = await this.prisma.client.bankEntry.findMany({
      where: {
        type: BankEntryType.EXPENSE,
        currency: { not: Currency.INR },
        inboundFreightCharge: { createdAt: win(from, to) },
      },
      select: { currency: true, occurredAt: true },
    });
    let approximate = 0;
    for (const p of payments) {
      const rate = await inrRateAt(this.prisma.client, p.currency, p.occurredAt);
      if (rate === null || rate.source === 'CURRENT') approximate += 1;
    }
    return approximate;
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
   * The orders whose parcel's FATE settled in the window, one entry per
   * ORDER, with its revenue and cost already worked out — the ONE
   * computation both a line's total and its drill-down read, so the rows
   * always add up to the figure above them.
   *
   * WHICH: an order is in a cohort when its CURRENT fate (`currentFate`)
   * is the cohort's, and the final stretch of its events in that fate
   * (`walkFate`) began in the window — `delivery`: delivered or lost;
   * `rto`: received back; `called_off`: cancelled or rejected, and only
   * with money on it. Each order has exactly one such (fate, instant), so
   * it is in one window of one cohort and adjacent windows tile. An order
   * whose fate is later corrected leaves the window that first counted it
   * — said in the notes.
   *
   * Dated by `order_events`: written for every transition however it
   * happened — a courier scan, a manual scan, god mode. The statuses each
   * cohort selects come from `orderFate` (`statusesOf`).
   *
   * REVENUE is what was BILLED: the order's BILLED_DIRECTIONS debits less
   * its ORDER_CHARGES_REFUNDs — the same rule in every cohort, so an order
   * moving between them never changes what it earned. A charge line with
   * no debit behind it is a quote, not revenue (`unbilled`, named in the
   * notes). A lost parcel earns only the fee still held on it.
   *
   * COST is summed over the order's LIVE shipments (not deleted, never
   * replaced — a voided or superseded one's charges are on the
   * no-live-parcel line), both columns added. An order with no such
   * shipment, or one whose parcel never got a waybill, has nothing
   * recorded and is UNCOVERED.
   */
  private async fateCohort(
    kind: 'delivery' | 'rto' | 'called_off',
    from: Date,
    to: Date,
  ): Promise<FateCohort> {
    const fate: Fate =
      kind === 'delivery' ? 'delivered' : kind === 'rto' ? 'returned' : 'called_off';
    const empty: FateCohort = { orders: [], leftForReturns: 0, movedOn: 0 };
    // Every order with an event into this fate in the window. A stretch
    // always begins with such an event, so none is missed.
    const hits = await this.prisma.client.orderEvent.findMany({
      where: { toStatus: { in: statusesOf(fate) }, createdAt: win(from, to) },
      select: { orderId: true },
      distinct: ['orderId'],
    });
    if (hits.length === 0) return empty;
    const candidates = hits.map((h) => h.orderId);
    const [walks, rows] = await Promise.all([
      this.fateWalks(candidates),
      this.prisma.client.order.findMany({
        where: { id: { in: candidates } },
        select: { id: true, orderNumber: true, status: true },
      }),
    ]);
    const orderById = new Map(rows.map((o) => [o.id, o]));

    const included = new Map<string, { walk: FateWalk; at: Date }>();
    let leftForReturns = 0;
    let movedOn = 0;
    for (const id of candidates) {
      const walk = walks.get(id) ?? OPEN_WALK;
      const now = currentFate(orderById.get(id)?.status ?? null, walk);
      const start = walk.start;
      if (walk.fate === fate && now === fate && start !== null && start.getTime() < to.getTime()) {
        if (start.getTime() >= from.getTime()) included.set(id, { walk, at: start });
        // Otherwise its stretch began in an earlier window, which counts
        // it — this is a second event of the same fate (restocked after
        // received, found after lost).
        continue;
      }
      if (kind === 'delivery' && now === 'returned') leftForReturns += 1;
      else movedOn += 1;
    }
    if (included.size === 0) return { ...empty, leftForReturns, movedOn };

    const ids = [...included.keys()];
    const [links, entries, charges] = await Promise.all([
      this.prisma.client.orderShipment.findMany({
        where: { orderId: { in: ids } },
        select: { orderId: true, shipmentId: true },
      }),
      this.prisma.client.sellerWalletEntry.findMany({
        where: {
          direction: { in: [...BILLED_DIRECTIONS, WalletEntryDirection.ORDER_CHARGES_REFUND] },
          currency: Currency.INR,
          linkedOrderId: { in: ids },
        },
        select: { linkedOrderId: true, direction: true, amount: true },
      }),
      this.prisma.client.orderCharge.findMany({
        where: { deletedAt: null, orderId: { in: ids } },
        select: { orderId: true, type: true, amountInr: true },
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
    const linksOf = group(links, (l) => l.orderId);
    const entriesOf = group(entries, (e) => e.linkedOrderId ?? '');
    const chargesOf = group(charges, (c) => c.orderId);
    const hasCost = (s: {
      actualCourierCostInr: Prisma.Decimal | null;
      actualRtoCostInr: Prisma.Decimal | null;
    }): boolean => s.actualCourierCostInr !== null || s.actualRtoCostInr !== null;

    const out: FateOrder[] = [];
    for (const [id, { walk, at }] of included) {
      const mine = (linksOf.get(id) ?? [])
        .map((l) => shipmentById.get(l.shipmentId))
        .filter((s): s is NonNullable<typeof s> => s !== undefined);
      const recorded = mine.filter(hasCost);
      const waybilled = mine.filter((s) => s.awbNumber !== null);
      const own = entriesOf.get(id) ?? [];
      const debits = own
        .filter((e) => e.direction !== WalletEntryDirection.ORDER_CHARGES_REFUND)
        .map((e) => ({ direction: e.direction, amount: e.amount }));
      const refunds = own
        .filter((e) => e.direction === WalletEntryDirection.ORDER_CHARGES_REFUND)
        .map((e) => e.amount);
      const debited = sum(debits.map((d) => d.amount));
      const billed = debited.sub(sum(refunds));
      // A cancelled order with nothing on it — a quote never billed, no
      // parcel that left us — is no row at all.
      if (
        kind === 'called_off' &&
        billed.isZero() &&
        waybilled.length === 0 &&
        recorded.length === 0
      ) {
        continue;
      }
      const lost = walk.lost && !walk.delivered;
      const quoted = sum(
        (chargesOf.get(id) ?? [])
          .filter((c) => chargeLeg(c.type) !== 'excluded')
          .map((c) => c.amountInr),
      );
      // A settled delivery or return is owed its fee; a lost parcel or a
      // called-off order is not, so a quote on those is no gap.
      const unbilled =
        kind !== 'called_off' && !lost && quoted.gt(debited) ? quoted.sub(debited) : ZERO;
      out.push({
        orderId: id,
        orderNumber: orderById.get(id)?.orderNumber ?? id,
        at,
        lost,
        lostAfterDelivery: walk.lostAfterDelivery,
        onReturnLeg: walk.onReturnLeg,
        found: walk.found,
        deliveredFirst: walk.deliveredBefore,
        calledOff: kind === 'called_off' ? (orderById.get(id)?.status ?? null) : null,
        debits,
        refunds,
        billed,
        unbilled,
        cost:
          recorded.length === 0
            ? null
            : sum(recorded.flatMap((s) => [s.actualCourierCostInr, s.actualRtoCostInr])),
        // MEASURED: delivery once every live parcel carries a figure; a
        // return only once the RETURN itself has been billed — until then
        // the forward figure is all we know, and it is not the whole cost;
        // a called-off order once every parcel that had a waybill is
        // billed (one with no live waybill has nothing to price).
        priced:
          kind === 'called_off'
            ? waybilled.every(hasCost)
            : mine.length > 0 &&
              mine.every((s) => (kind === 'delivery' ? hasCost(s) : s.actualRtoCostInr !== null)),
        parcels: mine.map((s) => s.awbNumber ?? s.shipmentNumber),
      });
    }
    out.sort((a, b) => b.at.getTime() - a.at.getTime());
    return { orders: out, leftForReturns, movedOn };
  }

  /**
   * Each order's `walkFate` over its status events — all of them, or only
   * those before `before` (the fate it was in at that instant).
   */
  private async fateWalks(ids: readonly string[], before?: Date): Promise<Map<string, FateWalk>> {
    if (ids.length === 0) return new Map();
    const events = await this.prisma.client.orderEvent.findMany({
      where: {
        orderId: { in: [...ids] },
        toStatus: { not: null },
        ...(before === undefined ? {} : { createdAt: { lt: before } }),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { orderId: true, toStatus: true, createdAt: true },
    });
    const byOrder = new Map<string, Array<{ toStatus: OrderStatus; createdAt: Date }>>();
    for (const e of events) {
      if (e.toStatus === null) continue;
      const list = byOrder.get(e.orderId) ?? [];
      list.push({ toStatus: e.toStatus, createdAt: e.createdAt });
      byOrder.set(e.orderId, list);
    }
    return new Map([...byOrder].map(([id, evs]) => [id, walkFate(evs)]));
  }

  /**
   * Parcels on orders whose fate was NOT YET KNOWN at the end of the
   * window (`walkFate` over the events before `to` says open), and the
   * courier cost recorded on them. For the delivery note — these are on
   * no line — not a figure in any total.
   *
   * As of `to`, so a past month says what was still moving THEN: a parcel
   * booked before `to` and not voided or replaced by then. Candidates are
   * orders open now, or with an event at or after `to` (anything else was
   * already settled at `to` and still is). The courier cost is the figure
   * recorded today — the import stamps it when the courier bills, which
   * can be after the window closed.
   */
  private async openParcels(to: Date): Promise<{
    parcels: number;
    costed: number;
    cost: Prisma.Decimal;
  }> {
    const shipments = await this.prisma.client.shipment.findMany({
      where: {
        createdAt: { lt: to },
        AND: [
          { OR: [{ deletedAt: null }, { deletedAt: { gte: to } }] },
          { OR: [{ supersededAt: null }, { supersededAt: { gte: to } }] },
          {
            OR: [
              { awbNumber: { not: null } },
              { actualCourierCostInr: { not: null } },
              { actualRtoCostInr: { not: null } },
            ],
          },
        ],
        orderShipments: {
          some: {
            order: {
              OR: [
                { status: { in: OPEN_STATUSES } },
                { events: { some: { createdAt: { gte: to } } } },
              ],
            },
          },
        },
      },
      select: {
        awbNumber: true,
        actualCourierCostInr: true,
        actualRtoCostInr: true,
        orderShipments: { select: { orderId: true } },
      },
    });
    // An order with no event before `to` is not in the map: open.
    const asOf = await this.fateWalks(
      [...new Set(shipments.flatMap((s) => s.orderShipments.map((l) => l.orderId)))],
      to,
    );
    const open = shipments.filter((s) =>
      s.orderShipments.some((l) => (asOf.get(l.orderId) ?? OPEN_WALK).fate === 'open'),
    );
    const costed = open.filter(
      (s) => s.actualCourierCostInr !== null || s.actualRtoCostInr !== null,
    );
    return {
      parcels: open.filter((s) => s.awbNumber !== null).length,
      costed: costed.length,
      cost: sum(costed.flatMap((s) => [s.actualCourierCostInr, s.actualRtoCostInr])),
    };
  }

  /**
   * The Indian delivery leg. What we billed for carriage, less what the
   * courier charged, for every order DELIVERED (or lost), and every order
   * called off with money on it, in the window (see `fateCohort`).
   *
   * BOTH sides are anchored on the same ORDERS, so a parcel's revenue and
   * its cost can never land in different reports. Revenue is what the
   * seller was DEBITED, net of refunds — base, surcharges and the GST on
   * them (we file no return against it; it is ours). The cost is BOTH
   * columns added: the importer nets refunds (COST-1), so the sum is what
   * the parcel cost whichever leg it was billed on.
   */
  private async delivery(from: Date, to: Date): Promise<PnlLine> {
    const [cohort, calledOff, open] = await Promise.all([
      this.fateCohort('delivery', from, to),
      this.fateCohort('called_off', from, to),
      // Orders whose fate was not known at the end of the window are on no
      // line. Counted, with the courier cost on their parcels, so the
      // report says so.
      this.openParcels(to),
    ]);
    const orders = cohort.orders;
    const delivered = orders.filter((o) => !o.lost);
    const lost = orders.filter((o) => o.lost);
    const off = calledOff.orders;
    const all = [...orders, ...off];
    const revenue = sum(all.map((o) => o.billed));
    const deliveredCost = sum(delivered.map((o) => o.cost));
    const lostCost = sum(lost.map((o) => o.cost));
    const offCost = sum(off.map((o) => o.cost));
    const offRevenue = sum(off.map((o) => o.billed));
    const priced = all.filter((o) => o.priced).length;
    const total = all.length;
    const lostHeld = sum(lost.map((o) => o.billed));
    const lostDebited = sum(lost.flatMap((o) => o.debits.map((d) => d.amount)));
    const lostRefunded = sum(lost.flatMap((o) => o.refunds));
    const lostOnTheWayBack = delivered.filter((o) => o.lostAfterDelivery);
    const found = delivered.filter((o) => o.found);
    const lostParts = this.billedParts(
      lost,
      BILLED_LABELS.lost,
      'lost in transit in window, never delivered',
    );

    const notes = [
      ...(priced < total
        ? [
            `${total - priced} order(s) on this line have no courier cost yet. The ` +
              'nightly wallet sync fills these in once the courier has billed them; a parcel on ' +
              'a manual courier has no ledger at all and needs its cost recorded by hand on the ' +
              'order; and an order whose parcel never got a waybill has nothing to price.',
          ]
        : []),
      // What happened to a lost parcel's fee, whichever way it went: it
      // should have come back (a lost parcel is not charged), and until it
      // does it is real money on this line.
      ...(lost.length > 0
        ? [
            `${lost.length} parcel(s) were lost in transit: their courier cost ` +
              `(₹${lostCost.toFixed(2)}) is counted here` +
              (lostHeld.gt(0)
                ? `; ₹${lostHeld.toFixed(2)} of fees debited on them is still held — a lost ` +
                  'parcel is not charged, so it is owed back to the seller'
                : lostDebited.isZero()
                  ? ' and nothing was billed for them'
                  : '') +
              (lostRefunded.gt(0) ? `; ₹${lostRefunded.toFixed(2)} was refunded` : '') +
              '.',
          ]
        : []),
      ...(lostOnTheWayBack.length > 0
        ? [
            `${lostOnTheWayBack.length} order(s) were delivered and then lost` +
              (lostOnTheWayBack.every((o) => o.onReturnLeg)
                ? ' on their way back (a customer return lost in transit)'
                : '') +
              ': billed as delivered, dated by the delivery, with their courier cost counted here.',
          ]
        : []),
      ...this.unbilledNote(orders),
      ...(off.length > 0
        ? [
            `${off.length} order(s) were called off (cancelled or rejected) with money still on ` +
              `them: the fee we kept (₹${offRevenue.toFixed(2)}) and the courier cost on ` +
              `parcels that had left us (₹${offCost.toFixed(2)}) are counted here, dated by the ` +
              'cancellation. A parcel voided before it left is on the "no live Skydrop parcel" ' +
              'line instead.',
          ]
        : []),
      // Fate-based recognition restates a window in these cases, by
      // design (TRE-6). Said, so a figure that moved is seen to have.
      ...(cohort.leftForReturns > 0
        ? [
            `${cohort.leftForReturns} order(s) first delivered in this window have since come ` +
              'back: they are on the returns line of the window they were received in and no ' +
              'longer here, so this window reads lower than it did when they were delivered.',
          ]
        : []),
      ...(cohort.movedOn > 0
        ? [
            `${cohort.movedOn} order(s) delivered or lost in this window have since left that ` +
              'fate — reopened, cancelled, or delivered again later — and are counted where the ' +
              'fate they are in now began, not here.',
          ]
        : []),
      ...(found.length > 0
        ? [
            `${found.length} order(s) were lost in transit in this window and later ` +
              'found and delivered: they stay dated by the loss, so this window now carries their ' +
              'revenue.',
          ]
        : []),
      ...(open.parcels > 0 || open.costed > 0
        ? [
            `At the end of this window ${open.parcels} parcel(s) on orders not yet delivered, ` +
              'returned or called off hold a waybill' +
              (open.costed > 0
                ? ` and ${open.costed} already carry ₹${open.cost.toFixed(2)} of courier cost ` +
                  '(as recorded today; a waybill is charged when it is booked, so a parcel still ' +
                  'in the warehouse can carry one)'
                : '') +
              '. They are on no line until their fate is known.',
          ]
        : []),
    ];

    const built = this.line({
      key: 'delivery',
      label: 'India delivery',
      revenue,
      cost: deliveredCost.add(lostCost).add(offCost),
      priced,
      total,
      note: notes.length === 0 ? null : notes.join(' '),
      basis: {
        // By wallet DIRECTION — what was debited — and what came back.
        revenue: [
          ...this.billedParts(delivered, BILLED_LABELS.delivered, 'delivered in window'),
          ...(lost.length === 0 || lostParts.length > 0
            ? lostParts
            : [
                {
                  label: 'Lost in transit — never billed',
                  source: 'orders LOST_IN_TRANSIT and never DELIVERED, with no fee debited',
                  count: lost.length,
                  amountInr: '0.00',
                },
              ]),
          ...this.billedParts(off, BILLED_LABELS.calledOff, 'orders now cancelled or rejected'),
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
                  label: 'Courier cost on parcels lost in transit',
                  source:
                    'shipments.actual_courier_cost_inr + actual_rto_cost_inr, orders LOST_IN_TRANSIT and never DELIVERED',
                  count: lost.filter((o) => o.cost !== null).length,
                  amountInr: lostCost.toFixed(2),
                },
              ]),
          ...(off.length === 0
            ? []
            : [
                {
                  label: 'Courier cost on parcels of orders called off after they left us',
                  source:
                    'shipments.actual_courier_cost_inr + actual_rto_cost_inr over the LIVE shipments of orders now cancelled or rejected (a voided one is on the no-live-parcel line)',
                  count: off.filter((o) => o.cost !== null).length,
                  amountInr: offCost.toFixed(2),
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

  /** Charge lines on settled orders that no debit covers — quoted, never billed. */
  private unbilledNote(orders: readonly FateOrder[]): string[] {
    const gaps = orders.filter((o) => o.unbilled.gt(0));
    if (gaps.length === 0) return [];
    return [
      `${gaps.length} order(s) carry ₹${sum(gaps.map((o) => o.unbilled)).toFixed(2)} of charge ` +
        'lines that were never debited to the seller — quoted, not billed — and are not counted.',
    ];
  }

  /**
   * What a group of orders was debited, by wallet direction, and the
   * refunds that came off — basis parts that add up to their revenue.
   */
  private billedParts(
    orders: readonly FateOrder[],
    labels: BilledLabels,
    filter: string,
  ): PnlBasisPart[] {
    const parts: PnlBasisPart[] = [];
    const push = (label: string, direction: string, amounts: Prisma.Decimal[], sign = 1): void => {
      if (amounts.length === 0) return;
      const total = sum(amounts);
      parts.push({
        label,
        source: `seller_wallet_entries.amount WHERE direction=${direction} (${filter})`,
        count: amounts.length,
        amountInr: (sign < 0 ? total.negated() : total).toFixed(2),
      });
    };
    const debited = (d: WalletEntryDirection): Prisma.Decimal[] =>
      orders.flatMap((o) => o.debits.filter((x) => x.direction === d).map((x) => x.amount));
    push(labels.charges, 'ORDER_CHARGES', debited(WalletEntryDirection.ORDER_CHARGES));
    push(labels.returnFee, 'RTO_FEE', debited(WalletEntryDirection.RTO_FEE));
    push(
      labels.customerReturnFee,
      'CUSTOMER_RETURN_FEE',
      debited(WalletEntryDirection.CUSTOMER_RETURN_FEE),
    );
    push(
      labels.refunded,
      'ORDER_CHARGES_REFUND',
      orders.flatMap((o) => o.refunds),
      -1,
    );
    return parts;
  }

  /**
   * Returns — every order whose parcel came BACK in the window (see
   * `fateCohort`).
   *
   * Revenue is what the seller was debited for a parcel that came back:
   * its delivery fee AND its return fee, less anything refunded on the
   * order — exactly as delivery nets its refunds, or a refunded fee is
   * income twice.
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
    const deliveredFirst = orders.filter((o) => o.deliveredFirst).length;
    const notes = [
      ...(priced < orders.length
        ? [
            `${orders.length - priced} returns have no return cost recorded, so this margin is flattering.`,
          ]
        : []),
      ...this.unbilledNote(orders),
      // Restatements, by design (TRE-6): said so the moved figure is seen.
      ...(deliveredFirst > 0
        ? [
            `${deliveredFirst} of these had been delivered first: the window they were ` +
              'delivered in no longer counts them on its delivery line.',
          ]
        : []),
      ...(cohort.movedOn > 0
        ? [
            `${cohort.movedOn} order(s) received back in this window have since left that state ` +
              'and are counted where the fate they are in now began, not here.',
          ]
        : []),
    ];
    const built = this.line({
      key: 'rto',
      label: 'Returns',
      revenue,
      cost,
      priced,
      total: orders.length,
      note: notes.length === 0 ? null : notes.join(' '),
      basis: {
        revenue: this.billedParts(orders, BILLED_LABELS.returned, 'received back in window'),
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
    // `line()` drops a note once the line is fully priced; a restatement
    // is worth saying even then.
    return notes.length === 0
      ? built
      : { ...built, coverage: { ...built.coverage, note: notes.join(' ') } };
  }

  /**
   * FX spread entries in the window, each put in rupees at its OWN
   * transfer's or payout's rate (the one that produced it), and only
   * failing that at the rate in force at its instant. Null `inr` = no
   * rate at all.
   *
   * The spread is posted in the RECEIVING account's currency — usually
   * taka. Summed as it stood it was taka read as rupees. A payout's is
   * the realised FX on a taka remittance: the units paid against the
   * units the seller's book said the rupees were worth.
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
        remittance: {
          select: { amount: true, currency: true, sourceAmount: true, sourceCurrency: true },
        },
      },
    });
    const out: Array<{ ref: string; subRef: string; at: Date; inr: Prisma.Decimal | null }> = [];
    for (const r of rows) {
      const rate =
        transferRate(r.currency, r.transfer) ??
        remittanceRate(r.currency, r.remittance) ??
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
            source:
              'bank_entries.signed_amount WHERE type=FX_SPREAD × the transfer’s (or payout’s) own rate',
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
  /**
   * The courier-account adjustments in `[from, to)`, each marked counted
   * or not — the ONE computation the line total, its note and its
   * drill-down read.
   *
   * Counted: everything from the cutover on, and — before it — any
   * adjustment that names a Skydrop PARCEL (`parcelMatcher`: live or
   * voided, forward or return waybill, or its courier order id). The
   * cutover exists only because the accounts' earlier waybills were the
   * business's parcels shipped OUTSIDE Skydrop; a reconciliation on one
   * of ours is ours whenever it is dated (production: Delhivery's
   * "Monthly Recon Aug'26" on 38061110523994, net ₹1.18, was on no line).
   */
  private async adjustmentRows(
    from: Date,
    to: Date,
  ): Promise<{
    cutover: Date | null;
    rows: Array<{
      txnId: string;
      awb: string | null;
      shipmentStatus: string | null;
      /** Signed: a debit is a cost, a credit reduces it. */
      signed: Prisma.Decimal;
      kind: CourierWalletTxnKind;
      at: Date;
      counted: boolean;
      /** Dated before the cutover and counted because it names our parcel. */
      oursBeforeCutover: boolean;
    }>;
  }> {
    const { cutover, countFrom } = await this.adjustmentWindow(from, to);
    const rows = await this.prisma.client.courierWalletTransaction.findMany({
      where: { ...ADJUSTMENT_BASE, occurredAt: win(from, to) },
      orderBy: { occurredAt: 'desc' },
      select: {
        txnId: true,
        courierAccountId: true,
        awbNumber: true,
        courierOrderRef: true,
        kind: true,
        amountInr: true,
        occurredAt: true,
        shipmentStatus: true,
      },
    });
    const early = rows.filter((r) => r.occurredAt.getTime() < countFrom.getTime());
    const key = (
      r: (typeof rows)[number],
    ): {
      accountId: string;
      awb: string | null;
      ref: string | null;
    } => ({ accountId: r.courierAccountId, awb: r.awbNumber, ref: r.courierOrderRef });
    const match = await this.parcelMatcher(early.map(key));
    return {
      cutover,
      rows: rows.map((r) => {
        const before = r.occurredAt.getTime() < countFrom.getTime();
        const ours = before && match(key(r)) !== null;
        return {
          txnId: r.txnId,
          awb: r.awbNumber,
          shipmentStatus: r.shipmentStatus,
          signed: r.kind === CourierWalletTxnKind.DEBIT ? r.amountInr : r.amountInr.negated(),
          kind: r.kind,
          at: r.occurredAt,
          counted: !before || ours,
          oursBeforeCutover: ours,
        };
      }),
    };
  }

  private async courierAdjustments(from: Date, to: Date): Promise<PnlLine> {
    const { cutover, rows } = await this.adjustmentRows(from, to);
    const counted = rows.filter((r) => r.counted);
    const excluded = rows.filter((r) => !r.counted);
    const oursBefore = counted.filter((r) => r.oursBeforeCutover);
    const excludedCount = excluded.length;
    const excludedNet = sum(excluded.map((r) => r.signed));

    const debits = counted.filter((r) => r.kind === CourierWalletTxnKind.DEBIT);
    const credits = counted.filter((r) => r.kind !== CourierWalletTxnKind.DEBIT);
    const debited = sum(debits.map((r) => r.signed));
    const credited = sum(credits.map((r) => r.signed)).negated();
    const debitCount = debits.length;
    const creditCount = credits.length;
    const cost = debited.sub(credited);
    const count = debitCount + creditCount;
    // Said even though the line is fully measured — `line()` keeps a note
    // only for missing coverage, and money deliberately left out of a
    // total (or counted despite the cutover) is exactly what a reader of
    // that total needs told.
    const cutoverNotes = [
      ...(excludedCount > 0 && cutover !== null
        ? [
            `${excludedCount} adjustment(s) dated before ${istDate(cutover)} (net ` +
              `${excludedNet.isNegative() ? 'credit' : 'debit'} ₹${excludedNet.abs().toFixed(2)}) ` +
              'are not counted: they belong to parcels shipped outside Skydrop, whose cost and ' +
              'revenue are not in this report either.',
          ]
        : []),
      ...(oursBefore.length > 0 && cutover !== null
        ? [
            `${oursBefore.length} adjustment(s) dated before ${istDate(cutover)} (net ` +
              `₹${sum(oursBefore.map((r) => r.signed)).toFixed(2)}) name a Skydrop parcel and ` +
              'ARE counted: the cutover exists for parcels shipped outside Skydrop, and these ' +
              'were not.',
          ]
        : []),
    ];
    const cutoverNote = cutoverNotes.length === 0 ? null : cutoverNotes.join(' ');

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
            source:
              "courier_wallet_transactions WHERE category='adjustment' AND kind='debit' (from the cutover, or naming a Skydrop parcel)",
            count: debitCount,
            amountInr: debited.toFixed(2),
          },
          {
            label: 'Credited back',
            source:
              "courier_wallet_transactions WHERE category='adjustment' AND kind='credit' (from the cutover, or naming a Skydrop parcel)",
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
   *
   * Dated by when the payout was RECORDED (the entry's `created_at`, the
   * same instant as the payout and every credit it wrote), not by its
   * typed `occurred_at` — see `PAYOUT_DATING`.
   */
  private async courierCodFees(from: Date, to: Date): Promise<PnlLine> {
    const agg = await this.prisma.client.bankEntry.aggregate({
      where: {
        type: BankEntryType.EXPENSE,
        settlementId: { not: null },
        createdAt: win(from, to),
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
            source:
              'bank_entries.signed_amount WHERE type=EXPENSE AND settlement_id IS NOT NULL (by created_at: when the payout was recorded)',
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
   * nothing.
   *
   * Dated by when the LINE was recorded (`PAYOUT_DATING`): a line added
   * later by `allocateMore` is recognised when it was added, with the
   * credit it wrote, not back in the month the payout's typed
   * `received_at` names.
   *
   * A payout that brought in MORE than it was allocated to (courier
   * overpayment, or allocation not finished) sits in capital as
   * "unallocated". It is not income — until it is allocated nobody can
   * say whose COD it is — so it is counted on no line, and NAMED in this
   * line's note so it is seen.
   */
  private async codShortfall(from: Date, to: Date): Promise<PnlLine> {
    const [short, recovered, payouts] = await Promise.all([
      this.prisma.client.courierSettlementLine.aggregate({
        where: { shortfallInr: { gt: 0 }, createdAt: win(from, to) },
        _sum: { shortfallInr: true },
        _count: { _all: true },
      }),
      this.prisma.client.courierSettlementLine.aggregate({
        where: { shortfallInr: { lt: 0 }, createdAt: win(from, to) },
        _sum: { shortfallInr: true },
        _count: { _all: true },
      }),
      this.prisma.client.courierSettlement.findMany({
        where: { createdAt: win(from, to) },
        select: {
          amountInr: true,
          allocatedInr: true,
          earlyCodFeeInr: true,
          freightDeductedInr: true,
        },
      }),
    ]);
    const shortSum = short._sum.shortfallInr ?? ZERO;
    const recoveredSum = recovered._sum.shortfallInr ?? ZERO;
    const cost = shortSum.add(recoveredSum);
    const count = short._count._all + recovered._count._all;
    // "Fully explained" is amount + early-COD fee + freight kept = allocated
    // (the settlement service's own definition); anything above is cash
    // that arrived for no order yet.
    const unallocated = payouts
      .map((p) => p.amountInr.add(p.earlyCodFeeInr).add(p.freightDeductedInr).sub(p.allocatedInr))
      .filter((x) => x.gt(0));
    const overNote =
      unallocated.length === 0
        ? null
        : `${unallocated.length} payout(s) recorded in this window brought in ` +
          `₹${sum(unallocated).toFixed(2)} more than they were allocated to orders. It sits in ` +
          'capital as unallocated and is on no line — not income, because until it is allocated ' +
          'nobody can say whose COD it is. Allocate it on /settlements, or ask the courier.';
    const built = this.line({
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
    return overNote === null
      ? built
      : { ...built, coverage: { ...built.coverage, note: overNote } };
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
    // A Shiprocket charge's ORDER id: a waybill Shiprocket has since
    // replaced still belongs to the parcel that order is, and that
    // parcel's cost already carries it (the importer nets by order id).
    const refOf = new Map<string, string>();
    for (const r of windowRows) {
      if (r.awbNumber !== null && typeof r.courierOrderRef === 'string') {
        refOf.set(`${r.courierAccountId}|${r.awbNumber}`, r.courierOrderRef);
      }
    }
    const split = (key: string): { accountId: string; awb: string; ref: string | null } => {
      const bar = key.indexOf('|');
      return {
        accountId: key.slice(0, bar),
        awb: key.slice(bar + 1),
        ref: refOf.get(key) ?? null,
      };
    };
    const match = await this.parcelMatcher(keys.map(split));

    const out: UnmatchedCharge[] = [];
    for (const key of keys) {
      const k = split(key);
      const awb = k.awb;
      const found = match(k);
      if (found === 'live') continue;
      if (found === 'dead') {
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

  /**
   * Whether a courier transaction names a Skydrop parcel — the ONE
   * matcher the no-live-parcel line and the adjustments line share, so
   * "ours" cannot mean two things on one report.
   *
   * It answers with the shipment the IMPORTER nets the charge onto
   * (`WalletImportService`: the parcel lookup, then `waybillAliases` and
   * `dropTaken`), in the same order, so every charge lands on exactly one
   * line — a charge netted onto a voided shipment is read by no cohort,
   * and must not be excused from this line by some OTHER live shipment
   * that merely shares its order id. In scope: shipments of the SAME
   * courier as the charging account (a waybill is unique only within a
   * courier) on that account or on none.
   *
   *  1. A shipment holding the waybill as its OWN — whatever else matches.
   *  2. A waybill some other shipment holds as its own is never netted as
   *     an alias: nobody we know.
   *  3. A shipment holding it as its return waybill (`reverse_awb_number`
   *     — a customer-return pickup).
   *  4. For Shiprocket, shipments under the charge's courier ORDER id (a
   *     waybill Shiprocket replaced is still that order's), the live one
   *     preferred as the importer prefers it.
   *
   * `live`: the parcel it nets onto is live. `dead`: only a voided or
   * replaced one — booked through us all the same. Null: nobody we know.
   */
  private async parcelMatcher(
    keys: ReadonlyArray<{ accountId: string; awb: string | null; ref: string | null }>,
  ): Promise<
    (k: { accountId: string; awb: string | null; ref: string | null }) => 'live' | 'dead' | null
  > {
    const awbs = [...new Set(keys.flatMap((k) => (k.awb === null ? [] : [k.awb])))];
    const refs = [...new Set(keys.flatMap((k) => (k.ref === null ? [] : [k.ref])))];
    if (awbs.length === 0 && refs.length === 0) return () => null;
    const [accounts, shipments] = await Promise.all([
      this.prisma.client.courierAccount.findMany({
        where: { id: { in: [...new Set(keys.map((k) => k.accountId))] } },
        select: { id: true, courier: { select: { code: true } } },
      }),
      // Every shipment that ever carried one of these waybills — voided
      // and replaced ones included, which is the point.
      this.prisma.client.shipment.findMany({
        where: {
          OR: [
            ...(awbs.length > 0
              ? [{ awbNumber: { in: awbs } }, { reverseAwbNumber: { in: awbs } }]
              : []),
            ...(refs.length > 0 ? [{ courierOrderId: { in: refs } }] : []),
          ],
        },
        select: {
          awbNumber: true,
          reverseAwbNumber: true,
          courierOrderId: true,
          courierCode: true,
          courierAccountId: true,
          deletedAt: true,
          supersededAt: true,
        },
      }),
    ]);
    const courierOf = new Map(accounts.map((a) => [a.id, a.courier.code]));
    type Held = (typeof shipments)[number];
    const verdict = (held: readonly Held[]): 'live' | 'dead' | null =>
      held.length === 0
        ? null
        : held.some((s) => s.deletedAt === null && s.supersededAt === null)
          ? 'live'
          : 'dead';
    return (k) => {
      const code = courierOf.get(k.accountId);
      if (code === undefined) return null;
      const inScope = shipments.filter(
        (s) =>
          s.courierCode === code &&
          (s.courierAccountId === null || s.courierAccountId === k.accountId),
      );
      if (k.awb !== null) {
        const own = inScope.filter((s) => s.awbNumber === k.awb);
        if (own.length > 0) return verdict(own);
        if (shipments.some((s) => s.awbNumber === k.awb)) return null;
        const reverse = inScope.filter((s) => s.reverseAwbNumber === k.awb && s.awbNumber !== null);
        if (reverse.length > 0) return verdict(reverse);
      }
      if (k.ref !== null) {
        return verdict(inScope.filter((s) => s.courierOrderId === k.ref && s.awbNumber !== null));
      }
      return null;
    };
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
   * An entry the operator MARKED as the account's opening balance
   * (`is_opening_balance`) is money the business already had when the
   * book started — capital put in, not earned — and is left off. Marked,
   * not inferred: this used to take the account's first capital entry,
   * and charges, transfers and remittances post capital rows by
   * themselves, so on a new account a system row could come first and a
   * real opening balance then read as income. Money put in LATER has its
   * own entry type (OWNER_CONTRIBUTION) and never reaches this line.
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
        isOpeningBalance: true,
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
      const rate = await this.inrPerUnit(r.currency, r.occurredAt, rates, `bank_entries:${r.id}`);
      const opening = r.isOpeningBalance;
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
              "bank_entries.signed_amount WHERE type=RECONCILIATION_ADJUSTMENT AND owner='capital' AND NOT is_opening_balance",
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
        // One row per ORDER — what it was billed once, its cost summed over
        // its live shipments — from the very cohorts the total is built from.
        const [cohort, calledOff] = await Promise.all([
          this.fateCohort(key, from, to),
          key === 'delivery' ? this.fateCohort('called_off', from, to) : Promise.resolve(null),
        ]);
        return capped(
          [...cohort.orders, ...(calledOff?.orders ?? [])].map((o) => ({
            ref: o.orderNumber,
            subRef:
              (o.parcels.length === 0 ? 'no live parcel' : o.parcels.join(', ')) +
              (o.lost
                ? ' · lost in transit — ' +
                  (o.billed.gt(0)
                    ? `₹${o.billed.toFixed(2)} fee still held`
                    : o.refunds.length > 0
                      ? 'fee refunded'
                      : 'never billed')
                : '') +
              (o.lostAfterDelivery
                ? o.onReturnLeg
                  ? ' · delivered, then lost on its way back'
                  : ' · delivered, then lost'
                : '') +
              (o.found ? ' · lost, then found and delivered' : '') +
              (o.unbilled.gt(0) ? ` · ₹${o.unbilled.toFixed(2)} quoted, never billed` : '') +
              (o.calledOff === null
                ? ''
                : ` · called off (${o.calledOff.toLowerCase()}) — fee kept, dated by the cancellation`),
            at: o.at.toISOString(),
            revenueInr: o.billed.toFixed(2),
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
        // Exactly the rows the total counts — from the cutover, plus any
        // earlier one naming a Skydrop parcel.
        const { rows } = await this.adjustmentRows(from, to);
        return capped(
          rows
            .filter((t) => t.counted)
            .map((t) => {
              const parts = [
                t.awb ?? t.shipmentStatus,
                t.oursBeforeCutover ? 'a Skydrop parcel — counted before the cutover' : null,
              ].filter((p): p is string => p !== null);
              return {
                ref: t.txnId,
                subRef: parts.length === 0 ? null : parts.join(' · '),
                at: t.at.toISOString(),
                revenueInr: null,
                // Signed: a credit reduces the cost.
                costInr: t.signed.toFixed(2),
              };
            }),
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
            createdAt: win(from, to),
          },
          orderBy: { createdAt: 'desc' },
          take: take + 1,
          select: {
            signedAmount: true,
            createdAt: true,
            reference: true,
            account: { select: { label: true } },
          },
        });
        return capped(
          rows.map((e) => ({
            ref: e.reference ?? '—',
            subRef: e.account.label,
            at: e.createdAt.toISOString(),
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
            createdAt: win(from, to),
          },
          orderBy: { createdAt: 'desc' },
          take: take + 1,
          select: {
            shortfallInr: true,
            createdAt: true,
            order: { select: { orderNumber: true } },
            settlement: { select: { reference: true, receivedAt: true } },
          },
        });
        return capped(
          rows.map((l) => ({
            ref: l.order.orderNumber,
            // Recorded when `at` says; the typed receipt date kept visible.
            subRef: `${l.settlement.reference} · received ${istDate(l.settlement.receivedAt)}`,
            at: l.createdAt.toISOString(),
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
