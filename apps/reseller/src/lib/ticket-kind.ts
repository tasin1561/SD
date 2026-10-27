import { TicketType } from '@skydrop/db';
import { makeTranslator, type Translate } from '@skydrop/ui/app/i18n';
import { CATALOGS, type MessageKey } from '@/i18n/catalog';

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

/**
 * The words live in the message catalogue (`tktk.*`), one entry per type, so
 * the English half is the single source for English and Bangla sits beside it.
 * A `Record<TicketType, …>` keeps the F2 rule: a new `TicketType` fails to
 * compile here rather than rendering a blank label.
 */
const KINDS: Readonly<
  Record<
    TicketType,
    { readonly label: MessageKey; readonly counterparty: MessageKey; readonly blurb: MessageKey }
  >
> = {
  [TicketType.STORE_DISPUTE]: {
    label: 'tktk.client.label',
    counterparty: 'tktk.client.who',
    blurb: 'tktk.client.blurb',
  },
  [TicketType.STORE_ISSUE]: {
    label: 'tktk.skydrop.label',
    counterparty: 'tktk.skydrop.who',
    blurb: 'tktk.skydrop.blurb',
  },
  [TicketType.SCRAP_DAMAGE]: {
    label: 'tktk.damage.label',
    counterparty: 'tktk.skydrop.who',
    blurb: 'tktk.damage.blurb',
  },
  [TicketType.SELLER_RAISED_ISSUE]: {
    label: 'tktk.sellerRaised.label',
    counterparty: 'tktk.skydrop.who',
    blurb: 'tktk.sellerRaised.blurb',
  },
  [TicketType.COURIER_NDR_ESCALATION]: {
    label: 'tktk.ndr.label',
    counterparty: 'tktk.ndr.who',
    blurb: 'tktk.ndr.blurb',
  },
  [TicketType.RECEIPT_SHORTFALL]: {
    label: 'tktk.shortfall.label',
    counterparty: 'tktk.skydrop.who',
    blurb: 'tktk.shortfall.blurb',
  },
};

const ENGLISH: Translate<MessageKey> = makeTranslator<MessageKey>(CATALOGS.en, CATALOGS.en);

/** The kind's words in the caller's language; English when no translator is passed. */
export function storeTicketKind(
  type: TicketType,
  t: Translate<MessageKey> = ENGLISH,
): StoreTicketKind {
  const k = KINDS[type];
  return { label: t(k.label), counterparty: t(k.counterparty), blurb: t(k.blurb) };
}
