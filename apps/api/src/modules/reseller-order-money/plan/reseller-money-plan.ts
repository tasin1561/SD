import { OrderStatus, PaymentMode, Prisma, ResellerCreditTrigger } from '@skydrop/db';
import { splitFee } from '../../reseller-store-terms/terms/fee-split';
import type { StorePercents } from '../../reseller-store-terms/terms/reseller-fee-types';
import type { CreditTiming } from '../../reseller-store-terms/terms/terms-rules';
import { VOIDABLE_TERMINAL_STATES } from '../../order/order-carriage';

/**
 * RS-6 phase 3c — THE ONE PLACE a reseller order's money is decided.
 * Pure: no Prisma client, no clock of its own, no I/O. The services only
 * EXECUTE what this returns (`ResellerOrderMoneyService`); nothing else
 * computes a share, a credit or a due date.
 *
 * ── THE OWNER'S RULE (docs/reseller-stores.md "Order money as built") ──
 * On a COD order, each party at its own credit trigger:
 *
 *   store  += COD − its share of the COD tax − transfer price
 *               − its shares of the COD fee and the Instant Pay fee
 *   seller += transfer price − its shares of the COD tax, COD fee and
 *               Instant Pay fee
 *
 * and, whenever Skydrop bills them, the delivery / return / customer-return
 * fee split between the two by the order's snapshot. Every share is
 * `splitFee` (the store's share rounded half up to the paisa, the seller
 * pays the remainder), so each fee's two shares add up to the fee EXACTLY,
 * and the store's net plus the seller's net is exactly what an identical
 * channel order credits its seller:
 *
 *   (COD − T_s − Tr − C_s − I_s) + (Tr − T_se − C_se − I_se)
 *     = COD − T − C − I          (T_s + T_se = T, and so on)
 *
 * SKYDROP's total per order is unchanged; only WHO pays moves.
 *
 * ── THE FEES ARE THE CHANNEL'S, TO THE PAISA ─────────────────────────
 * `codFees` is `CodCreditService.creditForOrder`'s arithmetic, expression
 * for expression (the tax EXTRACTED from the tax-inclusive COD, WAL-4;
 * the COD fee on every COD credit; the Instant Pay fee on top, capped at
 * what the COD fee left, WAL-5). A reseller order and a channel order
 * with the same COD and rates carry the same three figures —
 * `reseller-money-plan.spec.ts` pins it against the real service.
 *
 * The Instant Pay fee applies when EITHER party is credited INSTANT (the
 * owner: "INSTANT — at delivery; the Instant Pay fee applies"), and is
 * split by the order's Instant Pay share like every other fee. It is
 * charged on the COD's post-tax amount at the seller's rate, exactly as a
 * channel order on Instant Pay would be.
 */

const D = Prisma.Decimal;
const ZERO = new D(0);
const DAY_MS = 24 * 60 * 60 * 1000;

const positive = (d: Prisma.Decimal): Prisma.Decimal => (d.greaterThan(0) ? d : ZERO);

/** The per-seller COD rates, as `CodCreditService` resolves them (SET-1). */
export interface CodRates {
  readonly gstPercent: Prisma.Decimal;
  readonly codFeePercent: Prisma.Decimal;
  readonly instantPayFeePercent: Prisma.Decimal;
}

/** The three fees a COD credit carries, for the WHOLE order. */
export interface CodFees {
  readonly grossInr: Prisma.Decimal;
  readonly taxInr: Prisma.Decimal;
  readonly postGstInr: Prisma.Decimal;
  readonly codFeeInr: Prisma.Decimal;
  readonly instantFeeInr: Prisma.Decimal;
}

/**
 * `CodCreditService.creditForOrder`'s arithmetic, unchanged — the same
 * expressions in the same order, so the figures agree to the paisa.
 */
export function codFees(gross: Prisma.Decimal, rates: CodRates, instantApplies: boolean): CodFees {
  if (gross.lessThanOrEqualTo(0)) {
    return { grossInr: ZERO, taxInr: ZERO, postGstInr: ZERO, codFeeInr: ZERO, instantFeeInr: ZERO };
  }
  const tax = gross
    .times(rates.gstPercent)
    .dividedBy(new D(100).plus(rates.gstPercent))
    .toDecimalPlaces(2);
  const postGst = gross.minus(tax);
  const codFee = D.min(
    postGst.times(rates.codFeePercent).dividedBy(100).toDecimalPlaces(2),
    postGst,
  );
  const instantPercent = instantApplies ? rates.instantPayFeePercent : ZERO;
  const instantFee = D.min(
    postGst.times(instantPercent).dividedBy(100).toDecimalPlaces(2),
    D.max(postGst.minus(codFee), 0),
  );
  return {
    grossInr: gross,
    taxInr: tax,
    postGstInr: postGst,
    codFeeInr: codFee,
    instantFeeInr: instantFee,
  };
}

export type MoneyParty = 'STORE' | 'SELLER';

/** One party's credit on one order — a `reseller_order_credits` row's figures. */
export interface PartyCreditPlan {
  readonly party: MoneyParty;
  readonly trigger: ResellerCreditTrigger;
  readonly days: number;
  /** Store: the COD collected. Seller: the transfer price. */
  readonly grossInr: Prisma.Decimal;
  /** Store (COD): the transfer price it pays the seller. Seller: 0. */
  readonly transferInr: Prisma.Decimal;
  readonly taxShareInr: Prisma.Decimal;
  readonly codFeeShareInr: Prisma.Decimal;
  readonly instantFeeShareInr: Prisma.Decimal;
  /** gross − transfer − the three shares. Negative when a store sold below the transfer price. */
  readonly netInr: Prisma.Decimal;
}

export interface ResellerCreditPlan {
  readonly paymentMode: PaymentMode;
  /** Null on a prepaid order — there is no COD to take fees from. */
  readonly fees: CodFees | null;
  readonly instantApplies: boolean;
  /** Null on a prepaid order: the store collected the money itself and pays at confirmation. */
  readonly store: PartyCreditPlan | null;
  readonly seller: PartyCreditPlan;
}

export interface PlanCreditsInput {
  readonly paymentMode: PaymentMode;
  /** The order's COD — what the courier collects for the store. */
  readonly codInr: Prisma.Decimal | null;
  /** Σ transfer price × quantity, from the order's line snapshot. */
  readonly transferTotalInr: Prisma.Decimal;
  readonly storePercents: StorePercents<Prisma.Decimal>;
  readonly storeCredit: CreditTiming;
  readonly sellerCredit: CreditTiming;
  readonly rates: CodRates;
}

function party(
  who: MoneyParty,
  timing: CreditTiming,
  gross: Prisma.Decimal,
  transfer: Prisma.Decimal,
  tax: Prisma.Decimal,
  codFee: Prisma.Decimal,
  instantFee: Prisma.Decimal,
): PartyCreditPlan {
  return {
    party: who,
    trigger: timing.trigger,
    days: timing.days,
    grossInr: gross,
    transferInr: transfer,
    taxShareInr: tax,
    codFeeShareInr: codFee,
    instantFeeShareInr: instantFee,
    netInr: gross.sub(transfer).sub(tax).sub(codFee).sub(instantFee),
  };
}

/** Each party's credit on a reseller order. See the rule at the top. */
export function planCredits(input: PlanCreditsInput): ResellerCreditPlan {
  const transfer = input.transferTotalInr;
  if (input.paymentMode !== PaymentMode.COD) {
    // PREPAID: the store collected the retail itself. It pays the transfer
    // price (and its delivery share) from its wallet at confirmation; the
    // seller is credited the transfer price at the seller's trigger. No
    // COD, so no COD tax, COD fee or Instant Pay fee.
    return {
      paymentMode: input.paymentMode,
      fees: null,
      instantApplies: false,
      store: null,
      seller: party('SELLER', input.sellerCredit, transfer, ZERO, ZERO, ZERO, ZERO),
    };
  }
  const instantApplies =
    input.storeCredit.trigger === ResellerCreditTrigger.INSTANT ||
    input.sellerCredit.trigger === ResellerCreditTrigger.INSTANT;
  const fees = codFees(input.codInr ?? ZERO, input.rates, instantApplies);
  const tax = splitFee(fees.taxInr, input.storePercents.codTaxStorePercent);
  const codFee = splitFee(fees.codFeeInr, input.storePercents.codFeeStorePercent);
  const instant = splitFee(fees.instantFeeInr, input.storePercents.instantPayFeeStorePercent);
  return {
    paymentMode: input.paymentMode,
    fees,
    instantApplies,
    store: party(
      'STORE',
      input.storeCredit,
      fees.grossInr,
      transfer,
      tax.storeInr,
      codFee.storeInr,
      instant.storeInr,
    ),
    seller: party(
      'SELLER',
      input.sellerCredit,
      transfer,
      ZERO,
      tax.sellerInr,
      codFee.sellerInr,
      instant.sellerInr,
    ),
  };
}

// ── WHEN ─────────────────────────────────────────────────────────────

/** The event a trigger counts from. */
export type CreditAnchor = 'CONFIRMATION' | 'DELIVERY' | 'PAYOUT';

/**
 * F2-exhaustive: a fifth trigger fails to compile until somebody decides
 * what it counts from. A PREPAID order has no courier payout (nothing is
 * collected), so ON_PAYOUT on one counts from DELIVERY — the nearest fact.
 */
export function anchorOf(trigger: ResellerCreditTrigger, paymentMode: PaymentMode): CreditAnchor {
  switch (trigger) {
    case ResellerCreditTrigger.AFTER_CONFIRMATION:
      return 'CONFIRMATION';
    case ResellerCreditTrigger.INSTANT:
    case ResellerCreditTrigger.AFTER_DELIVERY:
      return 'DELIVERY';
    case ResellerCreditTrigger.ON_PAYOUT:
      return paymentMode === PaymentMode.COD ? 'PAYOUT' : 'DELIVERY';
    default: {
      const exhaustive: never = trigger;
      throw new Error(`Unhandled reseller credit trigger: ${String(exhaustive)}`);
    }
  }
}

/**
 * Why a credit may be ARMED AGAIN by a later courier payout: it was
 * skipped or taken back only because the courier had not paid (or had
 * reversed), and now it has paid. A credit skipped because the order was
 * called off, lost or returned undelivered is never re-armed — that is
 * its fate, not a timing.
 */
export const REARM_ON_PAYOUT_REASONS: ReadonlySet<string> = new Set([
  'COURIER_REVERSED',
  'COURIER_HAS_NOT_PAID',
  'NOT_DELIVERED',
]);

/** When a credit armed at `at` (its anchor's moment) comes due. */
export function dueAt(at: Date, days: number): Date {
  return new Date(at.getTime() + days * DAY_MS);
}

// ── MAY IT RUN ───────────────────────────────────────────────────────

/** The statuses that mean the parcel came back to us or is on its way. */
export const RETURN_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.RTO_INITIATED,
  OrderStatus.RTO_IN_TRANSIT,
  OrderStatus.RTO_RECEIVED,
  OrderStatus.RTO_RESTOCKED,
  OrderStatus.RTO_DAMAGED,
]);

export interface CreditEligibilityInput {
  readonly anchor: CreditAnchor;
  readonly status: OrderStatus;
  /** Has the order EVER reached DELIVERED (an `order_events` row)? */
  readonly everDelivered: boolean;
  /** Net COD the courier has paid on the order across recorded payouts. */
  readonly courierPaidInr: Prisma.Decimal;
}

/**
 * Money follows the order's FATE (WAL-8): a credit that came due is
 * written only when the order is still one that earns it.
 *
 *  - Called off (cancelled / rejected) or LOST: never — no customer paid.
 *  - Came back without ever being delivered: never — the COD was not
 *    collected.
 *  - CONFIRMATION-anchored (money fronted before anything is collected):
 *    otherwise yes.
 *  - DELIVERY-anchored: once it has been delivered — or once a courier
 *    has PAID for it (a payout that outran our delivery scan is proof
 *    enough; skipping on it would lose the credit for good).
 *  - PAYOUT-anchored: only while the courier's net payment is positive (a
 *    payout the courier then reversed pays nobody).
 *
 * A customer return after delivery does NOT stop a due credit: the COD
 * was collected, and the courier's reversal on a payout takes it back
 * from both parties (as it takes back a channel order's COD).
 */
export function creditMayRun(
  input: CreditEligibilityInput,
): { readonly run: true } | { readonly run: false; readonly reason: string } {
  if (VOIDABLE_TERMINAL_STATES.has(input.status)) {
    return { run: false, reason: `ORDER_${input.status}` };
  }
  if (input.status === OrderStatus.LOST_IN_TRANSIT) {
    return { run: false, reason: 'ORDER_LOST_IN_TRANSIT' };
  }
  if (RETURN_STATUSES.has(input.status) && !input.everDelivered) {
    return { run: false, reason: 'RETURNED_UNDELIVERED' };
  }
  switch (input.anchor) {
    case 'CONFIRMATION':
      return { run: true };
    case 'DELIVERY':
      return input.everDelivered || input.courierPaidInr.greaterThan(0)
        ? { run: true }
        : { run: false, reason: 'NOT_DELIVERED' };
    case 'PAYOUT':
      return input.courierPaidInr.greaterThan(0)
        ? { run: true }
        : { run: false, reason: 'COURIER_HAS_NOT_PAID' };
    default: {
      const exhaustive: never = input.anchor;
      throw new Error(`Unhandled credit anchor: ${String(exhaustive)}`);
    }
  }
}

// ── PREPAID ──────────────────────────────────────────────────────────

export interface PrepaidDebitPlan {
  /** The transfer price the store pays the seller for the goods. */
  readonly transferInr: Prisma.Decimal;
  /** The store's share of the delivery fee. */
  readonly deliveryShareInr: Prisma.Decimal;
  /** What the store's wallet must cover. */
  readonly totalInr: Prisma.Decimal;
}

/**
 * What a prepaid order takes from the store's wallet at confirmation (and
 * what its wallet must cover when the order is placed): the transfer
 * price, and the store's share of the delivery fee. The seller's share of
 * the delivery fee is billed to the seller when Skydrop bills it.
 */
export function prepaidDebit(
  transferTotal: Prisma.Decimal,
  deliveryFee: Prisma.Decimal,
  deliveryStorePercent: Prisma.Decimal,
): PrepaidDebitPlan {
  const share = splitFee(deliveryFee, deliveryStorePercent).storeInr;
  return {
    transferInr: transferTotal,
    deliveryShareInr: share,
    totalInr: transferTotal.add(share),
  };
}

// ── THE CASH OF A REVERSAL ───────────────────────────────────────────

/**
 * The seller group's cash that stops being theirs when a credit of
 * `gross` is reversed, `before` being the group balance just before the
 * reversal entry — the same arithmetic as a COD reversal
 * (`CourierSettlementService`, `EndedOrderMoneyService`):
 *
 *   max(0, before) − max(0, before − gross)
 *
 * The refunds of the credit's deductions are TO_SELLER and move their own
 * share back as each is written; together they net to
 * max(0, after) − max(0, before), which keeps held = max(0, group).
 */
export function cashTakenOnReversal(before: Prisma.Decimal, gross: Prisma.Decimal): Prisma.Decimal {
  return positive(before).sub(positive(before.sub(gross)));
}
