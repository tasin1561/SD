import { OrderStatus, TicketStatus } from '@skydrop/db';

/** The ticket category the cancel button raises into (delhivery-issue-taxonomy). */
export const CANCEL_REQUEST_CATEGORY = 'cancel';

/** The reason every cancel request carries, word for word (owner, 2026-11-15). */
export const CANCEL_REQUEST_REASON = 'Shipment has been returned by merchant';

/**
 * Where the cancel button turns into a request to Skydrop.
 *
 * The direct cancel closes at PACKED (`SELLER_CANCELLABLE_STATES`): from
 * there the parcel is a physical object and undoing it is warehouse and
 * courier work. These are exactly the in-flight states after that point,
 * where the order is still alive and a person at Skydrop can still stop it
 * (pull it off the manifest, ask the courier to hold or return it).
 *
 * NOT here, on purpose: DELIVERED (it has "Request return"), every
 * cancelled/rejected state, RTO_* and LOST_IN_TRANSIT (already coming back
 * or gone), and every state the seller can still cancel directly.
 */
export const CANCEL_REQUEST_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.PACKED,
  OrderStatus.PENDING_DISPATCH,
  OrderStatus.DISPATCHED,
  OrderStatus.IN_TRANSIT,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERY_FAILED,
]);

/** A cancel ticket still being worked: the button stays disabled while one is. */
export const CANCEL_REQUEST_OPEN_TICKET_STATUSES: readonly TicketStatus[] = [
  TicketStatus.OPEN,
  TicketStatus.NEGOTIATING,
];

export interface CancelRequestView {
  /** The button may be shown: the order is past the direct-cancel window and in flight. */
  readonly available: boolean;
  /** The cancel ticket still open for this order, if any — the button is disabled while set. */
  readonly openTicket: { readonly id: string; readonly number: string } | null;
}

export function isCancelRequestEligible(status: OrderStatus): boolean {
  return CANCEL_REQUEST_STATUSES.has(status);
}
