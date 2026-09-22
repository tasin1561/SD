/**
 * SECTION 15 — the FAQ. Questions and their categories live here so the
 * accordion and the FAQPage structured data are generated from ONE array;
 * a second hand-written copy is how the schema ends up advertising an
 * answer the page no longer gives.
 *
 * EVERY answer is true of the product as `platform.claims` in `site.ts`
 * states it — that block is the source of truth, and nothing here may
 * claim more than it does. No `dummy()` lives in this file and none may:
 * this is `platform` content, and `jsonLd()` would refuse a placeholder
 * inside the schema anyway. **No figure appears in an answer** — not a
 * price, a rate, a fee percentage, a transit time or a volume. Those are
 * `business` values the owner supplies, so where a question needs one the
 * answer says it in words ("one flat delivery fee per order, agreed with
 * you before anything ships") and stops.
 *
 * Only Delhivery and Shiprocket are ever named; no other company is.
 */

export type FaqHue = 'blue' | 'green' | 'saffron' | 'teal' | 'violet' | 'magenta' | 'red';

export type FaqCategoryId =
  | 'sending'
  | 'sellers'
  | 'platform'
  | 'reseller'
  | 'money'
  | 'customs'
  | 'returns';

export interface FaqCategory {
  id: FaqCategoryId;
  /** The tab's word. Sentence case, like every other heading on the site. */
  label: string;
  hue: FaqHue;
}

export interface FaqItem {
  /** Stable, human-readable — the anchor on the card and the React key. */
  id: string;
  category: FaqCategoryId;
  q: string;
  a: string;
}

/**
 * Seven categories, seven hues, each borrowed from the association the
 * site already made: saffron is the India lane (`services` "Send to
 * India"), teal the seller's stock, blue the platform, violet the stores,
 * green the money, red the border restrictions ("Not carried" in
 * `goods`), magenta the returns. The "All" tab shares blue with the
 * platform — there are eight tabs and seven hues, and those two are the
 * pair it costs least to repeat.
 */
export const faqCategories: readonly FaqCategory[] = [
  { id: 'sending', label: 'Sending', hue: 'saffron' },
  { id: 'sellers', label: 'Sellers', hue: 'teal' },
  { id: 'platform', label: 'Platform', hue: 'blue' },
  { id: 'reseller', label: 'Reseller stores', hue: 'violet' },
  { id: 'money', label: 'Payments & COD', hue: 'green' },
  { id: 'customs', label: 'Customs', hue: 'red' },
  { id: 'returns', label: 'Returns', hue: 'magenta' },
];

export const faq: readonly FaqItem[] = [
  // ── Sellers ────────────────────────────────────────────────────────
  {
    id: 'who-can-join',
    category: 'sellers',
    q: 'Who can join?',
    a: 'Businesses in Bangladesh selling into India. Skydrop is invite-only through the beta: write to us with a little about what you sell and where it sells, and we will tell you whether the corridor suits it before you ship anything. Shipments the other way, India to Bangladesh, are arranged the same way — by talking to us first.',
  },
  {
    id: 'gst-registration',
    category: 'sellers',
    q: 'Do I need an Indian GST registration?',
    a: 'Not to start. Stock is held and dispatched under ours, so there is no Indian company to register, no Indian office and no Indian staff to hire. GST invoices are issued from your seller account on delivered orders. If you grow to the point where your own Indian entity makes more sense, we help you move to it rather than holding you here.',
  },
  {
    id: 'stock-to-india',
    category: 'sellers',
    q: 'How does my stock get to India?',
    a: 'You declare a consignment — either straight to India, or two-leg via our Dhaka intake, where the goods are counted in, flown, and counted again in India. Each leg is counted and the variance recorded in both directions: a short count opens a ticket naming the leg, a surplus sends a notice, and neither blocks your stock. You can cancel before dispatch, and the goods go back to you recorded as returned rather than written off.',
  },

  // ── Sending ────────────────────────────────────────────────────────
  {
    id: 'both-directions',
    category: 'sending',
    q: 'Can you send from India to Bangladesh as well?',
    a: 'Yes. The corridor runs both ways on the same rails in reverse: one quote agreed before anything moves, a waybill booked with the courier the moment you confirm, every scan on the public tracking page in English and Hindi, and a desk to ring on either side of the border.',
  },
  {
    id: 'couriers',
    category: 'sending',
    q: 'Which couriers carry my parcels?',
    a: "Delhivery and Shiprocket, and the couriers in their networks. The waybill is booked through the courier's own API the moment an order is confirmed. If one will not carry a lane, the parcel is re-routed to the other; if both refuse it, a person places it by hand rather than letting it sit.",
  },
  {
    id: 'phone-confirmation',
    category: 'sending',
    q: 'Is every COD order really confirmed by phone?',
    a: 'Yes — an order is not dispatched because it was placed. Our call desk reaches the customer first and confirms the order, the address and the amount they will pay, in their own language. Every attempt and its outcome sits on the order for you to read: no answer and it is re-queued, and a customer we cannot reach is held rather than shipped.',
  },

  // ── Customs ────────────────────────────────────────────────────────
  {
    id: 'what-ships',
    category: 'customs',
    q: 'What kind of products work in this corridor?',
    a: 'Export-eligible goods with enough margin to absorb shipping and the occasional return: apparel and textiles, handicrafts and home, beauty in sealed retail packs, packaged snacks, books and stationery. Electronics and jewellery are looked at case by case. Liquids and aerosols, loose batteries, perishables, currency, weapons, tobacco and alcohol are not carried at all — and we would rather say so here than at the counter.',
  },
  {
    id: 'customs-paperwork',
    category: 'customs',
    q: 'Who handles the customs paperwork?',
    a: 'We do. The parcel crosses as part of a declared consignment, and preparing and filing that declaration is ours rather than yours. You see the consignment leave and you see it land, both stamped, with the count at each end on its own timeline.',
  },

  // ── Platform ───────────────────────────────────────────────────────
  {
    id: 'live-stock',
    category: 'platform',
    q: 'How do I know what is actually on the shelf?',
    a: 'Because it is a real stock system, not a spreadsheet: bins and batches across warehouses, an append-only ledger behind every movement, and low-stock alerts as a line runs down. On hand, reserved, available and in transit are four different numbers and you see all four. For goods that warrant it, STRICT mode gives every unit its own serial, scanned at pick and again at pack, with a discrepancy report wherever the count and the ledger disagree.',
  },
  {
    id: 'own-system',
    category: 'platform',
    q: 'Can I run it from my own system, with my own team?',
    a: 'Orders arrive by single entry, by bulk CSV, or from your own system through an API key and webhooks. Your team members get roles and permissions you set, a notification inbox alongside email that can be silenced per topic, and per-seller settings — fee currency, courier choice policy, call-attempt caps, credit timing — that are yours rather than ours.',
  },

  // ── Reseller stores ────────────────────────────────────────────────
  {
    id: 'reseller-what',
    category: 'reseller',
    q: 'What is a reseller store?',
    a: "Another business that sells your goods under its own name, with its own login. The customer never sees you: the tracking page, the courier label and the emails all carry the store's name and logo. You decide which products it may sell and at what transfer price, how much of your stock it is shown — hide a share, or set units aside for it — and, per store and per task, whether it may recall a parcel, change an order, cancel or send one back, and whether that happens directly or waits for your approval.",
  },
  {
    id: 'reseller-visibility',
    category: 'reseller',
    q: 'What does a reseller store see of my business?',
    a: 'Its own price and its own visible stock, and nothing else — never your cost, never your real stock figures, never another store. It gets its own team and permissions, its own wallet, P&L and expense book, and terms it must accept, versioned, so a change is a new version rather than a quiet edit. A dispute between the two of you is settled between your two wallets, never from ours.',
  },

  // ── Payments & COD ─────────────────────────────────────────────────
  {
    id: 'money-home',
    category: 'money',
    q: 'How does the money get back to Bangladesh?',
    a: 'COD is collected in rupees at the door in India. It reaches your wallet when the courier settles it, or at delivery itself if you switch on Instant Pay for a fee, and the wallet carries a full ledger of every movement in and out. From there it is withdrawn to you in Bangladesh, manually or automatically, on a schedule that suits you.',
  },
  {
    id: 'what-it-costs',
    category: 'money',
    q: 'What does it cost?',
    a: 'One flat delivery fee per order, agreed with you before anything ships, and a fee on a parcel that has to come back. Inbound freight for a consignment is billed one of three ways, your choice per seller or per consignment: on arrival, per unit as each one is delivered, or in advance at the Dhaka count before it flies. Every rate is agreed in taka or rupees and converted at the moment you are charged, and every charge is itemised per order. The figures depend on what you are sending, so they are settled when we talk rather than guessed at on this page.',
  },

  // ── Returns ────────────────────────────────────────────────────────
  {
    id: 'returned-parcel',
    category: 'returns',
    q: 'What happens to a parcel that comes back?',
    a: 'It is tracked back to our warehouse, then opened and inspected there, unit by unit. You decide whether each unit is restocked, kept aside as damaged, or written off, and the stock ledger moves to match — so what you are told you own is what is actually on the shelf. Scrap and damage tickets are opened automatically with the details already on them, and a refund is settled onto the ticket rather than argued out over email.',
  },
  {
    id: 'split-inspection',
    category: 'returns',
    q: 'Can two of the same item go different ways?',
    a: 'Yes. Two of an item on one returned line are judged separately: one restocked because it came back fine, the other kept aside as damaged or written off. That is why the inspection is per unit rather than per line — a single verdict for the line would either throw away good stock or put damaged stock back on the shelf, and both of those cost you later.',
  },
];
