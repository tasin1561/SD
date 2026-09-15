/**
 * Every event code the outbound webhook pipeline can send, with the words a
 * person picks it by. Pure data, no DI: the store's webhook form offers
 * exactly this list, and a store endpoint may subscribe to nothing else.
 *
 * It is DECLARED rather than derived because the codes come out of an F2
 * switch (`WebhookEventMappingService.resolveForOrderStatus`) that returns
 * one code per status; `webhook-event-catalogue.spec.ts` runs that switch
 * over every `OrderStatus` and fails when the two disagree in either
 * direction — a code nobody can pick, or a pickable code nothing sends.
 */
export const WEBHOOK_EVENT_CATALOGUE: ReadonlyArray<{
  readonly code: string;
  readonly description: string;
}> = [
  { code: 'order.confirmed', description: 'The customer confirmed the order on the call.' },
  { code: 'order.out_of_stock', description: 'The order could not be confirmed — no stock.' },
  { code: 'order.cancelled', description: 'The order was cancelled.' },
  { code: 'order.rejected', description: 'The customer turned the order down.' },
  { code: 'order.rejected_ndr', description: 'We could not reach the customer and stopped.' },
  {
    code: 'order.awaiting_seller_decision',
    description: 'Calling stopped; waiting to be told whether to keep trying.',
  },
  { code: 'order.pending_pick', description: 'The parcel is on the picking sheet.' },
  { code: 'order.picked', description: 'The goods were picked from the shelf.' },
  { code: 'order.packed', description: 'The parcel was packed.' },
  { code: 'order.pack_failed', description: 'The parcel could not be packed.' },
  {
    code: 'order.requires_manual_courier',
    description: 'Couriers refused it; a person is arranging one.',
  },
  { code: 'shipment.dispatched', description: 'The courier collected the parcel.' },
  { code: 'shipment.in_transit', description: 'The parcel is on its way.' },
  { code: 'shipment.out_for_delivery', description: 'The parcel is out for delivery today.' },
  { code: 'shipment.delivered', description: 'The parcel was delivered.' },
  { code: 'shipment.delivery_attempted', description: 'A delivery attempt failed.' },
  { code: 'shipment.return_initiated', description: 'The parcel is being sent back.' },
  { code: 'shipment.returning', description: 'The parcel is on its way back to us.' },
  { code: 'shipment.returned', description: 'The returned parcel reached our warehouse.' },
  { code: 'shipment.return_finalized', description: 'The return was inspected and restocked.' },
  { code: 'shipment.return_damaged', description: 'The return was inspected and found damaged.' },
  { code: 'shipment.lost', description: 'The courier lost the parcel.' },
];

const CODES = new Set(WEBHOOK_EVENT_CATALOGUE.map((e) => e.code));

/** The codes in `events` that are not in the catalogue (empty when all are). */
export function unknownWebhookEvents(events: readonly string[]): string[] {
  return events.filter((e) => !CODES.has(e));
}
