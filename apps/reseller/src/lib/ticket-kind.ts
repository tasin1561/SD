import { TicketType } from '@skydrop/db';

/**
 * WHICH CONVERSATION IS THIS — the seller, or Skydrop?
 *
 * Both kinds live in the store's one ticket list (the API's store-facing
 * reads admit both), and they are not interchangeable:
 *
 *   STORE_DISPUTE — an argument with the SELLER about one of this
 *   store's orders. Skydrop referees it, and a settlement moves money
 *   between the store's wallet and the seller's.
 *
 *   STORE_ISSUE — the store telling SKYDROP we got something wrong:
 *   damaged in our hands, lost, or sitting in our warehouse. The seller
 *   is not party to it and is not told, and it can never be settled
 *   through the dispute money path.
 *
 * A list that showed them identically would leave somebody unable to
 * tell whether they are arguing with their supplier or talking to their
 * logistics provider — which changes what they say next.
 *
 * F2-exhaustive: a new `TicketType` fails to compile here rather than
 * rendering a blank label. The four staff-only types are named too,
 * because `getForStore` filters by a list this file cannot see and a
 * silent blank would be worse than an honest name if that list widens.
 *
 * Deliberately NOT in `@skydrop/ui/status`: these are the STORE's words
 * for its own two conversations, and apps/admin already has its own
 * staff-facing names for the same enum ("Reseller store dispute" /
 * "Reseller store issue") which are right for a queue of every seller's
 * tickets and wrong here. What FE-6 is protecting — a colour vocabulary
 * being re-derived per component — is untouched: the colour still comes
 * from `ticketStatusKind`.
 */
export interface StoreTicketKind {
  /** One or two words for a table cell. */
  readonly label: string;
  /** Who is on the other end, for a sentence. */
  readonly counterparty: string;
  /** What raising it actually does, for the form and the detail page. */
  readonly blurb: string;
}

export function storeTicketKind(type: TicketType): StoreTicketKind {
  switch (type) {
    case TicketType.STORE_DISPUTE:
      return {
        label: 'With your seller',
        counterparty: 'your seller',
        blurb:
          'Your seller reads it and Skydrop referees. If it is settled with money, it moves between your wallet and theirs.',
      };
    case TicketType.STORE_ISSUE:
      return {
        label: 'With Skydrop',
        counterparty: 'Skydrop',
        blurb:
          'Skydrop reads it — something damaged in our hands, lost, or sitting in our warehouse. Your seller is not told and is not part of it.',
      };
    // Raised by Skydrop or the seller rather than by the store. Named
    // rather than blank: if the store-readable list ever widens to one
    // of these, a person still reads a word instead of an empty cell.
    case TicketType.SCRAP_DAMAGE:
      return {
        label: 'Damage found',
        counterparty: 'Skydrop',
        blurb: 'Raised by Skydrop after a returned parcel was inspected.',
      };
    case TicketType.SELLER_RAISED_ISSUE:
      return {
        label: 'Raised by your seller',
        counterparty: 'Skydrop',
        blurb: 'Raised by your seller with Skydrop about a parcel.',
      };
    case TicketType.COURIER_NDR_ESCALATION:
      return {
        label: 'Delivery escalation',
        counterparty: 'the courier',
        blurb: 'Raised by Skydrop with the courier after a failed delivery.',
      };
    case TicketType.RECEIPT_SHORTFALL:
      return {
        label: 'Stock count short',
        counterparty: 'Skydrop',
        blurb: 'Raised by Skydrop when stock arrived short or damaged.',
      };
    default: {
      const exhaustive: never = type;
      throw new Error(`Unhandled TicketType: ${String(exhaustive)}`);
    }
  }
}
