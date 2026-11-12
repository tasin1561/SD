import type { MessageKey } from '@/i18n/catalog';

/**
 * The two short sentences under the header, as MESSAGE KEYS (the page
 * translates them) so the rule can be unit-tested for every status.
 *
 * Only data already on the page is used. The "next" sentence exists only on
 * the normal forward path: for a cancelled, rejected, failed, returning or
 * lost order, "Next, we…" would be a promise nobody is keeping, so those
 * statuses get a sentence about what HAPPENED and nothing about what comes
 * next. A banner on the page (unreachable customer, re-attempt notice) also
 * drops it — the banner already says what is needed.
 */
export const ALL_STATUSES = [
  'DRAFT',
  'PENDING_CONFIRMATION',
  'CALL_NO_RESPONSE',
  'CALL_RESCHEDULED',
  'CONFIRMED',
  'OUT_OF_STOCK',
  'CANCELLED',
  'CANCELLED_BY_ADMIN',
  'REJECTED',
  'REJECTED_BY_CUSTOMER',
  'REJECTED_NDR',
  'AWAITING_SELLER_DECISION',
  'AWAITING_COURIER',
  'PENDING_PICK',
  'PICKED',
  'PACKED',
  'PACK_FAILED',
  'PENDING_DISPATCH',
  'DISPATCHED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_FAILED',
  'RTO_INITIATED',
  'RTO_IN_TRANSIT',
  'RTO_RECEIVED',
  'RTO_RESTOCKED',
  'RTO_DAMAGED',
  'LOST_IN_TRANSIT',
  'PENDING_MANUAL_PLACEMENT',
] as const;

export type SummaryStatus = (typeof ALL_STATUSES)[number];

/** Statuses on the normal forward path — the only ones that may say "Next, …". */
const FORWARD: ReadonlySet<string> = new Set([
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'AWAITING_COURIER',
  'PENDING_PICK',
  'PICKED',
  'PACKED',
  'PENDING_DISPATCH',
  'DISPATCHED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
]);

/** The tracker milestone keys a "next" sentence exists for. */
const NEXT_KEYS: ReadonlySet<string> = new Set([
  'call_confirmed',
  'picked',
  'packed',
  'ready_to_dispatch',
  'dispatched',
  'in_transit',
  'out_for_delivery',
  'delivered',
]);

/** Money is not "about to be collected" on these: nothing is going to the door. */
const NO_MONEY_LINE: ReadonlySet<string> = new Set([
  'CANCELLED',
  'CANCELLED_BY_ADMIN',
  'REJECTED',
  'REJECTED_BY_CUSTOMER',
  'REJECTED_NDR',
  'DELIVERED',
  'DELIVERY_FAILED',
  'RTO_INITIATED',
  'RTO_IN_TRANSIT',
  'RTO_RECEIVED',
  'RTO_RESTOCKED',
  'RTO_DAMAGED',
  'LOST_IN_TRANSIT',
]);

export interface SummaryInput {
  readonly status: string;
  readonly paymentMode: string;
  readonly codAmountInr: string | null;
  /** The tracker's next not-yet-reached milestone key, when it has loaded. */
  readonly nextMilestoneKey: string | null;
  /** Any of the three banners is showing. */
  readonly hasBanner: boolean;
  readonly addressNeedsFix: boolean;
  readonly collectableMismatch: boolean;
}

export interface Summary {
  readonly where: MessageKey | null;
  readonly next: MessageKey | null;
  /** Rupees the courier will collect, when COD and known. */
  readonly collectInr: string | null;
  readonly prepaid: boolean;
  readonly addressFix: boolean;
  readonly mismatch: boolean;
}

export function summaryFor(input: SummaryInput): Summary {
  const known = (ALL_STATUSES as readonly string[]).includes(input.status);
  // An unknown status (a new server state) says nothing rather than guess.
  const where = known ? (`orderPage.sum.where.${input.status}` as MessageKey) : null;
  const next: MessageKey | null =
    known &&
    FORWARD.has(input.status) &&
    !input.hasBanner &&
    input.nextMilestoneKey !== null &&
    NEXT_KEYS.has(input.nextMilestoneKey)
      ? (`orderPage.sum.next.${input.nextMilestoneKey}` as MessageKey)
      : null;
  const cod = input.paymentMode === 'COD';
  const showMoney = !NO_MONEY_LINE.has(input.status);
  return {
    where,
    next,
    collectInr: showMoney && cod && input.codAmountInr !== null ? input.codAmountInr : null,
    prepaid: showMoney && !cod,
    addressFix: input.addressNeedsFix,
    mismatch: input.collectableMismatch,
  };
}

/** The first milestone after the current one that is still to come. */
export function nextMilestoneKey(
  milestones: ReadonlyArray<{ readonly key: string; readonly state: string }>,
): string | null {
  const cur = milestones.findIndex((m) => m.state === 'CURRENT');
  if (cur < 0) return null;
  const nxt = milestones.slice(cur + 1).find((m) => m.state === 'PENDING');
  return nxt?.key ?? null;
}
