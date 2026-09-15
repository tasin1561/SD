import { OrderStatus, ResellerCreditStatus } from '@skydrop/db';

/**
 * RS-1, amended 2026-09-15 (owner): a reseller store is CLOSED only when its
 * business with us is DONE — paused first so nothing new can be placed,
 * every parcel delivered or back in our warehouse, no credit still to run,
 * and the wallet at ₹0 (the caller checks the wallet). After that the
 * store's team needs no access, and close revokes it.
 *
 * "Done" is deliberately NOT "terminal". The order state machine calls a
 * status terminal when nothing can follow it, and DELIVERED stopped being
 * terminal when a customer could send a parcel back — so the old rule,
 * which read terminality, refused every store that had ever delivered
 * anything, forever (found on production, 2026-09-15). For the store a
 * delivered parcel, and a return received at our warehouse, are finished;
 * the money they still owe is on the credit rows, which are checked on
 * their own below.
 */
export const FINISHED_FOR_STORE_CLOSE: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.DELIVERED,
  OrderStatus.RTO_RECEIVED,
]);

/** A credit not yet written for its party (taken back or skipped is final). */
export const CREDIT_STILL_TO_RUN: readonly ResellerCreditStatus[] = [
  ResellerCreditStatus.WAITING,
  ResellerCreditStatus.DUE,
];

/** True when an order in this status still keeps its store from closing. */
export function orderBlocksStoreClose(
  status: OrderStatus,
  isTerminal: (s: OrderStatus) => boolean,
): boolean {
  return !isTerminal(status) && !FINISHED_FOR_STORE_CLOSE.has(status);
}

export interface StoreCloseBlockers {
  /** Orders whose parcel is neither delivered nor back with us — the first few. */
  readonly moving: ReadonlyArray<{ readonly orderNumber: string; readonly status: OrderStatus }>;
  readonly movingCount: number;
  /** Credits still to run for either party — the first few. */
  readonly creditsToRun: ReadonlyArray<{
    readonly orderNumber: string;
    readonly party: string;
    readonly status: ResellerCreditStatus;
  }>;
  readonly creditsToRunCount: number;
}
