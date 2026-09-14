import { ResellerCreditTrigger } from '@skydrop/db';
import { FEE_SPLIT_ROUNDING } from './fee-split';
import { feeTypeLabel, type ResellerFeeType } from './reseller-fee-types';

/**
 * RS-4 — what makes a terms version valid, and how it reads in words.
 * Pure: the service calls it before writing, and both portals show the
 * sentences it produces rather than composing their own.
 */

/** A credit delay longer than a year is a typo, not a policy. */
export const MAX_CREDIT_DAYS = 365;

export type TermsParty = 'store' | 'seller';

export interface CreditTiming {
  readonly trigger: ResellerCreditTrigger;
  readonly days: number;
}

export class TermsRuleError extends Error {
  constructor(
    readonly code:
      | 'CREDIT_DAYS_INVALID'
      | 'INSTANT_TAKES_NO_DAYS'
      | 'AFTER_DELIVERY_NEEDS_DAYS'
      | 'CREDIT_TRIGGER_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'TermsRuleError';
  }
}

const TRIGGERS = Object.values(ResellerCreditTrigger) as readonly string[];

/**
 * One party's credit timing.
 *
 *  - days are a whole number, 0 … 365;
 *  - INSTANT is "at delivery", so it takes no days (0 only — the CHECK in
 *    the migration says the same);
 *  - AFTER_DELIVERY needs at least one day. Zero days after delivery IS
 *    Instant Pay, and INSTANT carries the Instant Pay fee: allowing
 *    AFTER_DELIVERY(0) would be Instant Pay with its fee quietly left off.
 */
export function assertTiming(timing: CreditTiming, party: TermsParty): void {
  const who = party === 'store' ? 'the store' : 'the seller';
  if (!TRIGGERS.includes(timing.trigger)) {
    throw new TermsRuleError(
      'CREDIT_TRIGGER_INVALID',
      `“${String(timing.trigger)}” is not a way ${who} can be credited.`,
    );
  }
  if (!Number.isInteger(timing.days) || timing.days < 0 || timing.days > MAX_CREDIT_DAYS) {
    throw new TermsRuleError(
      'CREDIT_DAYS_INVALID',
      `The days before ${who} is credited must be a whole number from 0 to ${MAX_CREDIT_DAYS}.`,
    );
  }
  if (timing.trigger === ResellerCreditTrigger.INSTANT && timing.days !== 0) {
    throw new TermsRuleError(
      'INSTANT_TAKES_NO_DAYS',
      `Instant credit is paid the moment the customer receives the order, so it takes no days (${who}).`,
    );
  }
  if (timing.trigger === ResellerCreditTrigger.AFTER_DELIVERY && timing.days === 0) {
    throw new TermsRuleError(
      'AFTER_DELIVERY_NEEDS_DAYS',
      `Credit on the day of delivery is Instant credit, which carries the Instant Pay fee — choose Instant, or at least one day after delivery (${who}).`,
    );
  }
}

export function usesAfterConfirmation(timings: readonly CreditTiming[]): boolean {
  return timings.some((t) => t.trigger === ResellerCreditTrigger.AFTER_CONFIRMATION);
}

function dayWords(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

/** Short label for a trigger. F2-exhaustive. */
export function creditTriggerLabel(trigger: ResellerCreditTrigger): string {
  switch (trigger) {
    case ResellerCreditTrigger.ON_PAYOUT:
      return 'When the courier pays us';
    case ResellerCreditTrigger.AFTER_DELIVERY:
      return 'Days after delivery';
    case ResellerCreditTrigger.INSTANT:
      return 'Instant, at delivery';
    case ResellerCreditTrigger.AFTER_CONFIRMATION:
      return 'Days after confirmation';
    default: {
      const exhaustive: never = trigger;
      throw new Error(`Unhandled credit trigger: ${String(exhaustive)}`);
    }
  }
}

/** One party's timing as a sentence, naming the party. F2-exhaustive. */
export function timingWords(timing: CreditTiming, partyName: string): string {
  switch (timing.trigger) {
    case ResellerCreditTrigger.ON_PAYOUT:
      return timing.days === 0
        ? `${partyName} is credited when the courier pays Skydrop for the order.`
        : `${partyName} is credited ${dayWords(timing.days)} after the courier pays Skydrop for the order.`;
    case ResellerCreditTrigger.AFTER_DELIVERY:
      return `${partyName} is credited ${dayWords(timing.days)} after the customer receives the order.`;
    case ResellerCreditTrigger.INSTANT:
      return `${partyName} is credited the moment the customer receives the order (Instant Pay — its fee applies).`;
    case ResellerCreditTrigger.AFTER_CONFIRMATION:
      return timing.days === 0
        ? `${partyName} is credited as soon as the order is confirmed on the phone — before the customer has paid.`
        : `${partyName} is credited ${dayWords(timing.days)} after the order is confirmed on the phone — before the customer has paid.`;
    default: {
      const exhaustive: never = timing.trigger;
      throw new Error(`Unhandled credit trigger: ${String(exhaustive)}`);
    }
  }
}

/** A percent as people write it: "80%", "33.33%". */
export function percentWords(percent: { toString(): string }): string {
  const s = percent.toString();
  const trimmed = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  return `${trimmed}%`;
}

/** One fee's split as a sentence. */
export function shareWords(
  feeType: ResellerFeeType,
  storePercent: { toString(): string },
  sellerPercent: { toString(): string },
  names: { store: string; seller: string },
): string {
  const label = feeTypeLabel(feeType);
  const store = percentWords(storePercent);
  const seller = percentWords(sellerPercent);
  if (store === '0%') return `${label}: ${names.seller} pays all of it.`;
  if (seller === '0%') return `${label}: ${names.store} pays all of it.`;
  return `${label}: ${names.store} pays ${store}, ${names.seller} pays ${seller}.`;
}

export { FEE_SPLIT_ROUNDING };
