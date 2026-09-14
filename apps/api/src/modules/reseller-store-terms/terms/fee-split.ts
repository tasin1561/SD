import { Prisma } from '@skydrop/db';
import {
  RESELLER_FEE_TYPES,
  storePercentField,
  storePercentOf,
  type ResellerFeeType,
  type StorePercents,
} from './reseller-fee-types';

/**
 * RS-4 — THE fee-split arithmetic. Pure: no Prisma client, no clock, no I/O.
 *
 * Every place that divides a Skydrop fee between a reseller store and its
 * seller calls this — the seller's worked example on the Terms tab (served
 * by the API, never recomputed in a browser), and phase 3b's order
 * snapshot and wallet entries. Two copies of "round the store's share"
 * would disagree by a paisa on some fee, and a paisa that is nobody's
 * breaks the rule below.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────
 *   storeInr  = round_half_up(amount × storePercent / 100, to the paisa)
 *   sellerInr = amount − storeInr            (the REMAINDER)
 *
 * So the two shares always add up to the fee EXACTLY — Skydrop's total per
 * order is unchanged by any split — and the rounding paisa, when there is
 * one, falls to the STORE's side of the half (0.5 paisa rounds up onto the
 * store) while the seller simply takes what is left. With 0 ≤ percent ≤ 100
 * neither share can be negative: 0% and 100% are exact by construction.
 *
 * Inputs are refused rather than coerced: a fee below zero, a fee with a
 * fraction of a paisa, a percent outside 0–100 or with more than two
 * decimals. A refund is not a negative fee — phase 3b reverses the shares
 * it recorded, it does not split a negative amount.
 */

const D = Prisma.Decimal;

export type DecimalInput = Prisma.Decimal | string | number;

/** How the store's share is rounded — stated so a reader never has to guess. */
export const FEE_SPLIT_ROUNDING =
  'The store’s share is rounded to the paisa, half up; the seller pays the rest, so the two always add up to the fee.' as const;

export class FeeSplitError extends Error {
  constructor(
    readonly code:
      | 'FEE_SPLIT_AMOUNT_INVALID'
      | 'FEE_SPLIT_AMOUNT_NEGATIVE'
      | 'FEE_SPLIT_AMOUNT_NOT_PAISA'
      | 'FEE_SPLIT_PERCENT_INVALID'
      | 'FEE_SPLIT_PERCENT_OUT_OF_RANGE'
      | 'FEE_SPLIT_PERCENT_TOO_PRECISE',
    message: string,
  ) {
    super(message);
    this.name = 'FeeSplitError';
  }
}

function decimalOf(input: DecimalInput, code: 'amount' | 'percent'): Prisma.Decimal {
  const errorCode = code === 'amount' ? 'FEE_SPLIT_AMOUNT_INVALID' : 'FEE_SPLIT_PERCENT_INVALID';
  if (typeof input === 'number' && !Number.isFinite(input)) {
    throw new FeeSplitError(errorCode, `The ${code} must be a finite number.`);
  }
  if (typeof input === 'string' && !/^-?\d+(\.\d+)?$/.test(input.trim())) {
    throw new FeeSplitError(errorCode, `“${input}” is not a number.`);
  }
  // A number goes through its string form: new Decimal(0.1) would carry
  // the binary float's tail, new Decimal('0.1') does not.
  return input instanceof D
    ? input
    : new D(typeof input === 'number' ? String(input) : input.trim());
}

/** A fee amount: ≥ 0 and exact to the paisa. */
export function toFeeAmount(input: DecimalInput): Prisma.Decimal {
  const d = decimalOf(input, 'amount');
  if (d.isNegative()) {
    throw new FeeSplitError(
      'FEE_SPLIT_AMOUNT_NEGATIVE',
      `A fee cannot be negative (${d.toString()}). A refund reverses the shares it recorded.`,
    );
  }
  if (d.decimalPlaces() > 2) {
    throw new FeeSplitError(
      'FEE_SPLIT_AMOUNT_NOT_PAISA',
      `A fee is exact to the paisa; ${d.toString()} is not.`,
    );
  }
  return d;
}

/** A store share: 0–100 with at most two decimals. */
export function toStorePercent(input: DecimalInput): Prisma.Decimal {
  const d = decimalOf(input, 'percent');
  if (d.isNegative() || d.greaterThan(100)) {
    throw new FeeSplitError(
      'FEE_SPLIT_PERCENT_OUT_OF_RANGE',
      `The store’s share must be between 0 and 100 per cent; ${d.toString()} is not.`,
    );
  }
  if (d.decimalPlaces() > 2) {
    throw new FeeSplitError(
      'FEE_SPLIT_PERCENT_TOO_PRECISE',
      `The store’s share takes at most two decimals; ${d.toString()} has more.`,
    );
  }
  return d;
}

export interface FeeSplit {
  readonly amountInr: Prisma.Decimal;
  readonly storePercent: Prisma.Decimal;
  readonly storeInr: Prisma.Decimal;
  readonly sellerInr: Prisma.Decimal;
}

/** Split ONE fee. See the rule at the top of the file. */
export function splitFee(amountInr: DecimalInput, storePercent: DecimalInput): FeeSplit {
  const amount = toFeeAmount(amountInr);
  const percent = toStorePercent(storePercent);
  const storeInr = amount.mul(percent).div(100).toDecimalPlaces(2, D.ROUND_HALF_UP);
  const sellerInr = amount.sub(storeInr);
  return { amountInr: amount, storePercent: percent, storeInr, sellerInr };
}

export interface FeeLine {
  readonly feeType: ResellerFeeType;
  readonly amountInr: DecimalInput;
}

export interface SplitFeeLine extends FeeSplit {
  readonly feeType: ResellerFeeType;
}

export interface SplitFeeLinesResult {
  readonly lines: readonly SplitFeeLine[];
  readonly totalInr: Prisma.Decimal;
  readonly storeTotalInr: Prisma.Decimal;
  readonly sellerTotalInr: Prisma.Decimal;
}

/**
 * Split a whole set of fee lines under one version's shares.
 *
 * Each line is split ON ITS OWN and the totals are sums of the per-line
 * shares — never a split of the total. Splitting the total would round
 * once where the lines round several times, and the per-line wallet
 * entries would then not add up to the order's split.
 */
export function splitFeeLines(
  lines: readonly FeeLine[],
  percents: StorePercents<DecimalInput>,
): SplitFeeLinesResult {
  const out = lines.map((line) => ({
    feeType: line.feeType,
    ...splitFee(line.amountInr, storePercentOf(percents, line.feeType)),
  }));
  const zero = new D(0);
  return {
    lines: out,
    totalInr: out.reduce((s, l) => s.add(l.amountInr), zero),
    storeTotalInr: out.reduce((s, l) => s.add(l.storeInr), zero),
    sellerTotalInr: out.reduce((s, l) => s.add(l.sellerInr), zero),
  };
}

/** Every fee type's share, validated — for a version or a draft of one. */
export function validatePercents(
  percents: StorePercents<DecimalInput>,
): StorePercents<Prisma.Decimal> {
  const entries = RESELLER_FEE_TYPES.map((t) => {
    const field = storePercentField(t);
    return [field, toStorePercent(percents[field])] as const;
  });
  return Object.fromEntries(entries) as unknown as StorePercents<Prisma.Decimal>;
}
