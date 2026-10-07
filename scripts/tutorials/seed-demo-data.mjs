/**
 * Demo data for the seller-app tutorial recordings.
 *
 * WHY this exists rather than filming whatever is in the dev database: a
 * tutorial has to be re-takeable. Filming against leftover rows means the
 * second take shows different products, different stock and a different
 * order count, so every frame the narration refers to goes stale. This
 * script owns the world the camera sees.
 *
 * IDEMPOTENT in both directions:
 *   - the demo seller, its catalogue and its stock are created once and
 *     then topped up, never piled up;
 *   - the product the SECOND video creates ON CAMERA is DELETED here,
 *     because a SKU is permanent once saved (the products form says so
 *     in its own words) and a re-take would otherwise collide on it.
 *
 * LOCAL ONLY. It refuses to run against a non-local DATABASE_URL — it
 * writes sellers, products and stock, and none of that belongs anywhere
 * but a dev box.
 *
 *   node scripts/tutorials/seed-demo-data.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { prisma, pdfLib } from './lib/deps.mjs';
import { MOCK_ROOT, mockObjectPath } from './lib/spaces-shim.mjs';
import { GENERATED_DIR, TUTORIALS_DIR } from './lib/paths.mjs';
import { API, call, waitFor } from './lib/api.mjs';
import {
  callThisOneFirst,
  driveOrderThrough,
  driveOrderToOutForDelivery,
  ensureLifecycleParcels,
  lifecycleReport,
  settleRetiredReturns,
  LIFECYCLE_PARCELS,
} from './lib/lifecycle.mjs';
import { clearLoginThrottle } from './lib/clear-login-throttle.mjs';
import { writeFixture } from './lib/fixture.mjs';
import { ensureOpsStaff, hashPassword as hash, OPS } from './lib/ops-user.mjs';
import { assertStackEnvironment, resolveStack } from './lib/stacks.mjs';
import { ensureConsignmentWorld, consignmentReport } from './lib/consignments.mjs';
import { ensureFreightWorld, freightReport } from './lib/freight.mjs';

/*
 * The staff account the seeding needs — goods receipts are received by
 * ops, not by the seller — is `OPS` from `lib/ops-user.mjs`, imported
 * above and shared with `provision-stack.mjs`.
 */

/** The seller the camera signs in as. Both videos use this one account. */
export const DEMO_SELLER = {
  email: 'demo@rangpursilk.test',
  password: 'Skydrop-Demo-2026',
  companyName: 'Rangpur Silk House',
  contactPersonName: 'Farhana Rahman',
  phone: '+8801711223344',
};

/** Catalogue the ORDER video picks from. Each one is stocked. */
const CATALOGUE = [
  {
    name: 'Jamdani Cotton Saree',
    sku: 'RSH-JAMDANI-IVORY',
    weightGrams: 450,
    valueInr: 2400,
    /**
     * Raised from 60 when G7 landed, and the number matters less than
     * the reason: `ensureStockedVariant` receives only the SHORTFALL, so
     * on a box already holding 60 nothing would be received and the
     * costed batch below would never exist. The bump buys one receipt
     * that carries a cost; after it the target is met and nothing more
     * happens. No narration names this figure.
     */
    qty: 72,
    /**
     * What the seller paid for one, which is what makes a MARGIN real —
     * the reseller reports read `stock_batches.unitCostInr` (the picked
     * batch, else the latest costed batch for the variant) and show a
     * zero with "cost known 0 / N" when there is none. Recorded through
     * the goods receipt, which takes it per line, rather than written
     * onto the batch by hand.
     *
     * Deliberately on THIS product only: the reports page carries a
     * coverage figure beside every margin precisely because a cost is
     * not always known, and a world where every line is priced cannot
     * show what a partial looks like.
     */
    costInr: 1150,
  },
  {
    name: 'Nakshi Kantha Throw',
    sku: 'RSH-KANTHA-BLUE',
    weightGrams: 900,
    valueInr: 1850,
    qty: 40,
  },
  {
    name: 'Rajshahi Silk Scarf',
    sku: 'RSH-SCARF-EMERALD',
    weightGrams: 120,
    valueInr: 950,
    qty: 75,
  },
  {
    name: 'Dhaka Muslin Dupatta',
    sku: 'RSH-MUSLIN-ROSE',
    weightGrams: 180,
    valueInr: 1300,
    qty: 50,
  },
];

/**
 * What the PRODUCT video creates while the camera is running. Nothing
 * here is created by this script — it is named so the cleanup below can
 * remove a previous take's rows. Keep it in step with `narration.mjs`.
 */
export const TUTORIAL_PRODUCT = { name: 'Rajshahi Silk Kurti', externalRef: 'RSH-KURTI' };

/**
 * The customer the ORDER video ships to. Named here so a previous take's
 * order and customer row can be removed — the app warns about a
 * duplicate order to the same number with the same items (correctly),
 * and a returning customer draws a history panel that a first-time one
 * does not. Both would make the second take a different video.
 * Keep in step with `flows.mjs`.
 */
export const TUTORIAL_CUSTOMER = { phoneE164: '+919845017722' };

/**
 * The customers the BULK IMPORT video's CSV ships to — the fixture at
 * `fixtures/rangpur-bulk-orders.csv`, one entry per row. Same reason as
 * `TUTORIAL_CUSTOMER`: a returning customer draws a panel a first-time one
 * does not, so leaving these behind makes the second take a different
 * video from the first. Keep in step with the fixture.
 */
export const TUTORIAL_CSV_CUSTOMERS = [
  '+919845011021',
  '+919845011034',
  '+919845011047',
  '+919845011052',
  '+919845011068',
];

/**
 * The consignment the A4 video declares, and the profile fields the A2
 * video types. Named here so a previous take's rows can be removed —
 * a second consignment on the register makes the closing shot a
 * different picture, and a pending bank change makes the save dialog
 * ask a different question. Keep in step with `flows.mjs`.
 */
export const TUTORIAL_CONSIGNMENT_REF = 'RSH-CN-2026-07';

/** The shopfront the store video adds ON CAMERA. Keep in step with flows.mjs. */
export const TUTORIAL_STORE_NAME = 'Dhaka Boutique';

/**
 * The product the C3 video edits ON CAMERA, and the size it adds to it.
 *
 * A product with DEFAULTS is the point of that video, and the seeded
 * catalogue does not have one: `ensureStockedVariant` sets weight and
 * value on the VARIANT, so every product's own defaults are null and
 * the tiles read "Not set". The video's whole third scene is those
 * tiles and its ninth is a new size INHERITING them, so the defaults
 * are put on this one product here rather than the narration being
 * written around their absence.
 *
 * The dimensions are deliberately left null: filling them in is what
 * the video does, and it is the scene that explains volumetric weight.
 */
export const TUTORIAL_EDIT_PRODUCT = {
  name: 'Dhaka Muslin Dupatta',
  defaultWeightGrams: 180,
  defaultDeclaredValueInr: '1300',
  /** The size added on camera. Deleted before every take — a SKU is permanent. */
  newVariantSku: 'RSH-MUSLIN-INDIGO',
};

/** The role the roles video builds ON CAMERA. Keep in step with flows.mjs. */
export const TUTORIAL_ROLE_NAME = 'Warehouse manager';

/**
 * The colleague the TEAM video changes the role of, and the person it
 * invites on camera. Keep in step with flows.mjs.
 *
 * `role` is the invitation's enum; `roleKey` is the `seller_roles` row
 * it maps to, which is what the seed resets to. The two must name the
 * same role or the reset puts them somewhere the video does not expect.
 */
export const TEAM_COLLEAGUE = {
  email: 'shahidul@rangpursilk.test',
  fullName: 'Shahidul Islam',
  password: 'Skydrop-Demo-2026',
  role: 'INVENTORY',
  roleKey: 'inventory',
};

/** Invited ON CAMERA. Removed before every take — an email may be invited once. */
export const TEAM_INVITEE = { email: 'nusrat@rangpursilk.test' };

/** The SKU the photos video uploads pictures to. Cleared before every take. */
export const TUTORIAL_PHOTO_SKU = 'RSH-MUSLIN-ROSE';

/**
 * What the WITHDRAWAL video needs in the wallet, and where a payout
 * would go. Nothing here is a real bank.
 *
 * The floor is a round number well clear of `wallet.minimum_balance_inr`
 * so the withdrawable figure on screen is the balance itself, and the
 * amount the video types is comfortably inside it.
 */
const WALLET_FLOOR_INR = 60000;

const WALLET_PAYOUT_BANK = {
  name: 'BRAC Bank',
  branch: 'Rangpur Branch',
  holder: 'Rangpur Silk House',
  account: '1501204536789012',
  routing: '060851726',
  swift: 'BRAKBDDH',
};

/** The three the withdrawal-schedule card writes. Cleared before every take. */
const WITHDRAWAL_SCHEDULE_KEYS = [
  'wallet.auto_withdraw_enabled',
  'wallet.auto_withdraw_hour_local',
  'wallet.auto_withdraw_keep_balance_inr',
];

/**
 * What the INTEGRATIONS video creates on camera, and the endpoint it
 * finds already broken. Keep in step with flows.mjs.
 *
 * The URLs use `example.com` on purpose: the SSRF guard resolves a
 * webhook host and FAILS CLOSED on one that does not
 * (`assertPublicHttpsUrl`), so an invented domain would be refused at
 * create — and `example.com` is the address reserved for exactly this,
 * which is also what the form's own placeholder suggests.
 */
export const INTEGRATIONS = {
  keyName: 'Rangpur order sync',
  expiredKeyName: 'Stocktake script (2025)',
  endpointUrl: 'https://example.com/skydrop/orders',
  endpointName: 'Order sync',
  brokenUrl: 'https://example.com/skydrop/old-warehouse',
  brokenName: 'Warehouse screen (old)',
  events: ['order.confirmed', 'shipment.dispatched', 'shipment.delivered'],
};

/** What the two RESELLING videos create on camera. Keep in step with flows.mjs. */
export const RESELLING = {
  storeName: 'Kolkata Silk Room',
  priceSku: 'RSH-SCARF-EMERALD',
  // The rest of the store's own details, needed from G3 on — where the
  // store is SEEDED rather than opened on camera. Keep in step with
  // `RESELLER` in flows.mjs, which types these into the G1 form.
  displayName: 'Silk Room',
  contactEmail: 'hello@kolkatasilkroom.test',
  contactPhone: '+919833014477',
  inviteEmail: 'priya@kolkatasilkroom.test',
  inviteName: 'Priya Bose',
};

/**
 * The SECOND reseller store — the one whose requests G6 answers and
 * whose figures G7 reads. Keep in step with `REQUEST_STORE` in flows.mjs.
 *
 * ── WHY A SECOND STORE AND NOT THE STANDING ONE ──────────────────────
 * Because G4's seeding DELETES every terms version of the store it
 * configures, and an order snapshots the version it was placed under
 * through a RESTRICT foreign key (RS-4). The moment a store has an
 * order, that delete is refused BY THE DATABASE — so putting G6's orders
 * on the standing store would make G4's own seed throw on its next run,
 * and G4 could never be re-taken. The CURRICULUM entry for G4 named this
 * exact trap and ended "there are no store orders until G6"; this is
 * G6, and the answer is to keep the two worlds apart rather than to
 * weaken a delete that is right.
 *
 * It also reads better: the queue's first column is the STORE, and a
 * column with one value in it teaches nothing about what it is for.
 *
 * G1's video opens a store on camera and its narration never names a
 * figure, so a second store standing in the list costs it nothing; G3,
 * G4 and G5 find their store BY NAME.
 */
export const REQUEST_STORE = {
  storeName: 'Pune Silk Studio',
  displayName: 'Silk Studio',
  contactEmail: 'hello@punesilkstudio.test',
  contactPhone: '+919833022155',
  inviteEmail: 'anjali@punesilkstudio.test',
  inviteName: 'Anjali Deshpande',
  /** Forced on every run, exactly as the demo seller's is. */
  password: 'Store-Demo-2026',
  /** The one product this store sells. Stocked, and the lifecycle SKU. */
  sku: 'RSH-JAMDANI-IVORY',
  transferPriceInr: '1850',
  minRetailInr: '2400',
  maxRetailInr: '3200',
  suggestedRetailInr: '2800',
  /**
   * A SECOND product, added for G7 and deliberately WITHOUT a recorded
   * unit cost (the first one has one — see `CATALOGUE`).
   *
   * Margin needs a cost, and the cost is not known for every line, which
   * is why every margin figure on the reports page carries how many
   * lines it could price. One costed product and one uncosted is what
   * makes that figure read as a partial rather than as none or as all —
   * and a page whose every number is complete cannot teach what an
   * incomplete one looks like.
   */
  secondSku: 'RSH-KANTHA-BLUE',
  secondTransferPriceInr: '1400',
  secondMinRetailInr: '1900',
  secondMaxRetailInr: '2600',
  secondSuggestedRetailInr: '2200',
};

/**
 * The two store orders whose FATE IS KNOWN — what G7's scorecards divide
 * by. Built once and never spent: G7's take writes the auto-pause rule
 * and touches no order.
 */
export const STORE_REPORT_ORDERS = {
  delivered: {
    family: 'RSH-STORE-DELIVERED',
    want: 'DELIVERED',
    sku: REQUEST_STORE.sku,
    recipientName: 'Kavya Srinivasan',
    phone: '+919845070044',
    line1: '7, Langford Road',
    line2: 'The blue gate beside the chemist',
    postalCode: '560025',
    stages: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'],
  },
  returned: {
    family: 'RSH-STORE-RETURNED',
    want: 'RTO_RESTOCKED',
    sku: REQUEST_STORE.secondSku,
    recipientName: 'Harish Kumar',
    phone: '+919845070055',
    line1: '21, Wheeler Road',
    line2: 'Above the tailor, opposite the temple',
    postalCode: '560005',
    retailInr: REQUEST_STORE.secondSuggestedRetailInr,
    stages: [
      'IN_TRANSIT',
      'OUT_FOR_DELIVERY',
      ['NDR', 'Customer refused the parcel at the door'],
      'RTO_INITIATED',
      'RTO_IN_TRANSIT',
    ],
    // One unit, one verdict: it came back unopened and goes back on the
    // shelf. A write-off would open a scrap ticket and make this parcel
    // D6's subject as well as G7's.
    disposition: {
      condition: 'GOOD',
      disposition: 'RESTOCK',
      notes: 'Refused at the door, unopened and sellable.',
    },
  },
};

/**
 * The three store orders G6's queue is about, keyed by FAMILY.
 *
 * Each family is one row on the screen, and each is re-made only when
 * the previous take spent it — see `storeRequestsWorldFor`. The refs
 * carry a counter, because a spent order is RETIRED rather than
 * rewound (the D4 rule): a cancelled order keeps its number, its events
 * and its history and simply stops being the one this video films.
 */
export const STORE_REQUEST_ORDERS = {
  cancel: {
    family: 'RSH-STORE-CANCEL',
    recipientName: 'Ritu Chatterjee',
    phone: '+919845070011',
    line1: '44, Ballygunge Place',
    line2: 'Opposite the park gate, the green door',
    postalCode: '560025',
    note: 'The customer rang us to say she has already bought one locally.',
  },
  change: {
    family: 'RSH-STORE-CHANGE',
    recipientName: 'Sanjay Mehta',
    phone: '+919845070022',
    line1: '9, Church Street',
    line2: 'Above the bakery, first floor',
    postalCode: '560001',
    /** What the store proposes instead — only fields that really differ. */
    newLine2: 'Second floor, the door on the left past the bakery',
    newPhone: '+919845070099',
    reason: 'The customer rang: she has moved up a floor, and the old number is her husband’s.',
    issueSubject: 'Parcel has not moved for four days',
    issueBody:
      'Tracking has said the same thing since Tuesday and the customer has rung us twice about it.',
  },
  delivery: {
    family: 'RSH-STORE-DELIVERY',
    recipientName: 'Deepa Ranganathan',
    phone: '+919845070033',
    line1: '12, Infantry Road',
    line2: 'Next to the old post office, second gate',
    postalCode: '560001',
    reason: 'The customer has stopped answering and has told us she no longer wants it.',
  },
};

/**
 * The videos that need the CONSIGNMENT world (C0, `lib/consignments.mjs`).
 *
 * Expensive-ish — four goods receipts, a dispatch and an arrival, all
 * through the real endpoints — and BUILD-ONCE, so it runs only for the
 * videos that read it or when asked by name with `--consignments`.
 */
const CONSIGNMENT_SLUGS = new Set([
  'follow-a-consignment',
  'read-your-stock',
  // N8 BILLS an arrival on camera, so it needs the landed consignment
  // and its counted India receipt. It is deliberately NOT in
  // `FREIGHT_SLUGS` below: E5's bill occupies the only billable stop,
  // and the form's own select would draw it disabled.
  'bill-the-freight',
  // E5's bill hangs on the landed consignment's INDIA arrival, so that
  // consignment has to exist before the freight pass can bill it.
  'what-the-freight-cost',
]);

/**
 * The videos that need the FREIGHT world (E5, `lib/freight.mjs`).
 *
 * Separate from the list above because the two costs are different: C0
 * is four goods receipts and is build-once, and this adds a real bill
 * plus a whole parcel driven to DELIVERED so some of that bill has
 * actually been charged.
 */
const FREIGHT_SLUGS = new Set([
  'what-the-freight-cost',
  // C1 is here because E5 BILLS the consignment C1 films. Its freight
  // scene used to say "nothing has been billed against this one yet";
  // it now describes the bill, so a re-take on a box without the freight
  // world would film the old page under the new words.
  'follow-a-consignment',
]);

/** The videos that need the second store, its orders and their held requests. */
const STORE_ORDER_SLUGS = new Set(['answer-what-a-store-asked']);

/**
 * …and the ones that need that store to have TRADED: parcels whose fate
 * is known, so the scorecards have outcomes to divide by.
 *
 * A separate list rather than a flag on the one above, because the two
 * are genuinely different costs: G6's world is three cheap orders and one
 * driven parcel, and this adds two more full journeys, one of them
 * through the returns bench.
 */
const STORE_REPORT_SLUGS = new Set(['how-your-stores-are-doing']);

/**
 * P3 — the one video that needs a STORE DISPUTE on the register.
 *
 * It needs the trading store (for a store that can place an order at
 * all) and nothing else that world builds: no held requests, no driven
 * parcels, no scorecards. A dispute is argued on an order whatever
 * became of it, so the cheapest order this store can have is the right
 * one — a third list rather than a flag on either of the two above,
 * for the same reason those two are apart.
 */
const STORE_DISPUTE_SLUGS = new Set(['refunds-and-disputes']);

/**
 * Section R — the STORE's OWN portal, filmed as Anjali Deshpande.
 *
 * ── WHY THESE REUSE G6/G7's WORLD RATHER THAN BUILDING ONE ──────────
 * Anjali is the invited user of Pune Silk Studio, which IS
 * `REQUEST_STORE` — the trading store. `tradingStoreWorld` already gives
 * it the four things the portal cannot open without: accepted terms (a
 * store whose current version is unaccepted is shown a banner and little
 * else), a priced and enabled catalogue (R2 is a video ABOUT that
 * table), `reseller.orders_enabled` ON for the seller (RS-5 seeds it
 * FALSE and the create is refused by name without it), and an action
 * policy. Building a second store for section R would mean a second
 * place for all four to drift, and the first symptom would be a video
 * narrating a table that is empty.
 *
 * `ensureSettledStoreOrders` is added for the same reason G7 has it:
 * R5 films the status chips HAVING COUNTS and R6 reads one order's
 * tracker top to bottom, and both of those need parcels whose fate is
 * known. R1's dashboard reads the same orders.
 *
 * The HELD REQUESTS are deliberately NOT built here. Those are the
 * SELLER's queue — what a store asked and a seller has not yet
 * answered — and they belong to G6 and to day 2's R7, not to a video
 * about placing and finding an order.
 */
const STORE_PORTAL_SLUGS = new Set([
  'store-find-your-way-around',
  'store-what-you-may-sell',
  'store-place-an-order',
  'store-upload-bulk-orders',
  'store-find-an-order',
  'store-read-an-order',
]);

/**
 * M6 — the THIRD kind of row on the failed-delivery register, and the
 * only one that still shows a decision anybody could make.
 *
 * A seller's own ask is created already approved (the service says so in
 * as many words: "ALL THREE ACT AT ONCE. None of them waits for an
 * approval"), so nothing a seller raises ever sits there waiting. A
 * RESELLER STORE's ask whose seller chose to see it first DOES — and it
 * is marked "Waiting on seller staff", because Seller staff decide it
 * and Skydrop admin does not. Without it the video can show two kinds of
 * ask and not the one the page's own subtitle is about.
 *
 * `ensureHeldDeliveryAsk` is G6's and is reused rather than rebuilt: it
 * drives a store parcel to a failed delivery and raises the held ask,
 * and G6 films REJECTING it, which changes nothing about the parcel. The
 * expensive half is re-used for ever and only the ask is raised again.
 */
const STORE_DELIVERY_ASK_SLUGS = new Set(['acting-on-a-failed-delivery']);

/**
 * The order the store argues about, and what it says.
 *
 * GENERAL rather than FIGURE_CORRECTION deliberately: a figure
 * correction seeds the settle form from the claim, which is a good
 * thing on the day and the wrong thing to film — the video is about
 * somebody DECIDING an amount, and a form that arrives already holding
 * one reads as a form that has decided for them.
 */
export const STORE_DISPUTE_ORDER = {
  family: 'RSH-STORE-DISPUTE',
  recipientName: 'Anita Bardhan',
  phone: '+919845070044',
  line1: '27, Lavelle Road',
  line2: 'The blue gate beside the tailor',
  postalCode: '560001',
  subject: 'Saree arrived with a tear along the border',
  body:
    'The customer sent us photographs within the hour and we have refunded her ourselves. The ' +
    'tear runs along the border and is not something that happens in a courier bag, so we think ' +
    'it left the warehouse that way and we are asking the seller to carry it.',
};

/**
 * What the CATALOGUE IMPORT video uploads. Keep in step with
 * `fixtures/rangpur-catalogue.csv` — the preview's figures are narrated
 * word for word, so the file and the words move together or not at all.
 */
export const CATALOGUE_IMPORT = {
  productRefs: ['RSH-HALFSILK', 'RSH-TANGAIL', 'RSH-MONIPURI', 'RSH-ENDI', 'RSH-KATAN'],
  mappingName: 'Our stock sheet',
};

/**
 * The videos that need a parcel to have MOVED, and therefore the ones
 * that pay for the lifecycle pass. Anything in section D, plus the
 * money and reporting videos that read a delivered order.
 *
 * Passing `--lifecycle` runs it whatever the slug, which is how it is
 * built the first time.
 */
const LIFECYCLE_SLUGS = new Set([
  'where-is-my-parcel',
  'the-customer-was-not-there',
  'what-needs-you-today',
  'the-customer-would-not-answer',
  'something-arrived-damaged',
  // D4 is the one video that SPENDS its parcels — both of its actions
  // are irreversible — so its two are retired and remade on every seed
  // run (`retireSpentParcel`). That is why it must be in this list even
  // though it films no state the other videos do not already reach.
  'ask-for-a-parcel-back',
  // E2's subject IS the ledger, and every interesting line in it —
  // charges, return fees, a damage refund — is written by a parcel
  // having moved.
  'read-your-wallet',
  // C2's subject is the difference between what a seller HAS and what
  // they may sell, and the number that draws it — "held for orders" —
  // is zero unless something is actually reserved. `RSH-LIFE-CONFIRMED`
  // is the one parcel at rest holding a reservation (ORD-10 reserves on
  // entry to CONFIRMED), so C2 pays for the lifecycle pass to guarantee
  // it is there. Cheap in practice: the pass is idempotent and only
  // rebuilds it after a B7 take has spent it.
  'read-your-stock',
  // H2 reads ONE order end to end, and `RSH-LIFE-RESTOCKED` is the
  // richest D0 leaves: a whole journey, a failed delivery with the
  // courier's own reason code, a return and a disposition.
  'find-an-order',
  // H1 reads the admin dashboard's attention band, and a band of
  // zeroes teaches nothing — D0's parcels are what light it.
  'the-ops-dashboard',
  // P5 walks the RTO station and reads its "At our door" worklist out
  // loud. `RSH-LIFE-ATDOOR` is the only parcel that ever puts a row in
  // it — a return the courier has handed back that nobody has received.
  'what-we-cannot-undo',
  // B7 cancels `RSH-LIFE-CONFIRMED` on camera — the second of its two
  // orders, and the one that has stock held and a waybill booked. It is
  // `spendable` for that reason, so this pass retires the spent one and
  // builds a fresh one each run.
  'cancelling-an-order',
  // K1 RECEIVES `RSH-LIFE-ATDOOR`, which P5 only reads. That spends it
  // — the order goes to RTO_RECEIVED and its units are booked into the
  // returns hold — so the parcel is `spendable` now and this pass
  // retires and rebuilds it. K1 also needs `RSH-LIFE-RETURNING` for its
  // "still with the courier" scene, which the same pass keeps alive.
  'take-a-return-in',
  // K2 works the same parcel one step further on: K1 leaves it RECEIVED
  // and K2 inspects and finalises it, which is what moves its stock.
  // `returnsBenchWorldFor` receives it afterwards so this video opens on
  // the bench rather than at the door — the world K1 hands over.
  'inspect-and-finalise-a-return',
  // SECTION N — the money desk. Every one of these reads a wallet whose
  // interesting lines were written by a parcel moving: the delivery
  // charge, the return fee, the damage refund and above all the COD
  // credit, which needs a DELIVERED order for the courier to have
  // collected against. N5 goes further and needs delivered COD that has
  // NOT been paid for yet, which is what D0's two delivered parcels are.
  'how-seller-money-works',
  'accept-a-top-up',
  'pay-a-seller-out',
  'approve-a-bank-change',
  'record-a-courier-payout',
  'move-money-by-hand',
  'the-bank-book',
  'is-the-money-picture-true',
  'close-a-month',
  // P1 forces `RSH-LIFE-REVIEW`, the one order D0 parks in a state the
  // matrix will not move on its own; P2 drives the courier-ops panel on
  // parcels that are genuinely with the courier; P3 closes a damage
  // ticket RTO inspection raised.
  'god-mode',
  'live-courier-writes',
  'refunds-and-disputes',
  // M6 decides what a seller has asked us to do about a parcel the
  // driver could not hand over, which needs the parcel first:
  // `RSH-LIFE-FAILED` for the re-attempt and `RSH-LIFE-OVERDUE`, still
  // out for delivery, for the recall.
  'acting-on-a-failed-delivery',
]);

/** Keyed on the seller's own reference — see lib/lifecycle.mjs. */
const LIFECYCLE_REFS = LIFECYCLE_PARCELS.map((p) => p.ref);

/**
 * What every lifecycle reference starts with, retired ones included.
 *
 * Asserted rather than assumed: the prefix is what `clearPreviousOrders`
 * protects, so a parcel added with a ref that does not carry it would be
 * swept by the next seed run of any other video.
 */
const LIFECYCLE_REF_PREFIX = 'RSH-LIFE-';
{
  const stray = LIFECYCLE_REFS.filter((r) => !r.startsWith(LIFECYCLE_REF_PREFIX));
  if (stray.length > 0) {
    throw new Error(
      `Lifecycle refs must start with ${LIFECYCLE_REF_PREFIX} so clearPreviousOrders leaves ` +
        `them alone: ${stray.join(', ')}`,
    );
  }
}

/**
 * References this function must never sweep.
 *
 * `RSH-LIFE-` is D0's parcels, which cost a real courier booking and a
 * warehouse run. `RSH-STORE-` is G6's store orders, and protecting those
 * is not an economy — it is a REFUSAL: a reseller order carries held
 * requests, a terms snapshot and its store's money rows, none of which
 * this function's delete list knows about, so sweeping one would fail on
 * a foreign key half way through somebody else's seed run.
 */
// I1's order is CONFIRMED by its own take, and CONFIRMED is in
// `REMOVABLE_STATUSES` — so without this the next seed run would try to
// delete an order holding a live stock reservation and a booked waybill.
// It is retired forward by `callWorldFor` instead, the D4 / B7 rule.
/*
  `RSH-PICK-` joins them for exactly the reason `RSH-CALL-` did: J3's
  parcels end the take CONFIRMED-or-later holding a LIVE RESERVATION, and
  CONFIRMED is in `REMOVABLE_STATUSES` — so the shared clearing would try
  to delete an order whose `order_items` are referenced by
  `stock_reservations` under a RESTRICT foreign key, and die there rather
  than in the video's own seeding. `pickWorldFor` retires them forward
  itself.
*/
const PROTECTED_REF_PREFIXES = [
  LIFECYCLE_REF_PREFIX,
  'RSH-STORE-',
  'RSH-FRT-',
  'RSH-CALL-',
  'RSH-PICK-',
];

/** The per-seller key the delivery-fee video writes. Cleared before every take. */
const DELIVERY_FEE_KEY = 'orders.default_customer_delivery_fee_inr';

/**
 * Orders placed so the ORIENTATION video has a dashboard with something
 * on it. Only that video wants them: every other seed run clears the
 * seller's pre-dispatch orders, which is what makes each take identical.
 */
const TOUR_ORDERS = [
  { name: 'Meera Krishnan', phone: '+919845030011', ref: 'RSH-TOUR-01', qty: 1 },
  { name: 'Arjun Nair', phone: '+919845030012', ref: 'RSH-TOUR-02', qty: 2 },
  { name: 'Divya Menon', phone: '+919845030013', ref: 'RSH-TOUR-03', qty: 1 },
  { name: 'Rohit Sharma', phone: '+919845030014', ref: 'RSH-TOUR-04', qty: 3 },
];

/**
 * Refuse to run unless the ambient environment is THIS FILMING STACK's.
 *
 * It replaced a plain `assertLocal`, which asked only whether the host
 * was local — true of both stacks, and therefore unable to tell them
 * apart. Two agents now film at once (`lib/stacks.mjs`), and this script
 * REBUILDS a world: a seed aimed at the wrong database deletes the
 * product the other agent's next scene is about, clears their order
 * list, and succeeds. The guard is a one-line question — does the
 * connection string name the database this stack owns — and it is the
 * only thing standing between a forgotten `TUT_STACK` and a ruined take
 * somebody else is in the middle of.
 */
function assertStack() {
  assertStackEnvironment(resolveStack());
}

/**
 * `hash` and `ensureOps` live in `lib/ops-user.mjs` now.
 *
 * `provision-stack.mjs` needs the same ops account — a fresh stack has
 * no staff user at all, and nothing can be provisioned through the admin
 * API without one — and it cannot import this file, because this file
 * calls `main()` at its top level. Two copies of that upsert would be
 * two answers to "what password does tutorial-ops have", and the second
 * one to run would win silently.
 */
async function ensureOps() {
  return ensureOpsStaff();
}

/** The demo seller, created through the real invite flow the first time. */
async function ensureSeller(staffToken) {
  const existing = await prisma.seller.findUnique({ where: { email: DEMO_SELLER.email } });
  if (existing === null) {
    const invite = await call('/admin/seller-invitations', {
      method: 'POST',
      token: staffToken,
      body: { email: DEMO_SELLER.email },
    });
    await call('/auth/seller/register/invite', {
      method: 'POST',
      body: {
        token: invite.token,
        companyName: DEMO_SELLER.companyName,
        contactPersonName: DEMO_SELLER.contactPersonName,
        phone: DEMO_SELLER.phone,
        password: DEMO_SELLER.password,
      },
    });
  }

  // Force APPROVED and a known password. A registration lands PENDING and
  // the recording cannot wait on a human approval step; forcing the
  // password means a re-run recovers an account whose password drifted.
  const seller = await prisma.seller.findUniqueOrThrow({ where: { email: DEMO_SELLER.email } });
  await prisma.seller.update({
    where: { id: seller.id },
    data: { status: 'APPROVED', approvedAt: seller.approvedAt ?? new Date() },
  });
  await prisma.sellerUser.updateMany({
    where: { sellerId: seller.id },
    data: { passwordHash: await hash(DEMO_SELLER.password), emailVerifiedAt: new Date() },
  });

  // LAZY. Seller login is throttled at 5 attempts per 15 minutes per
  // email+IP, and the recorder needs one of those for every take — so a
  // steady-state re-seed, which has no catalogue work to do, must not
  // spend one just to hold a token it never uses.
  let token = null;
  return {
    id: seller.id,
    async token() {
      if (token === null) {
        const login = await call('/auth/seller/login', {
          method: 'POST',
          body: { email: DEMO_SELLER.email, password: DEMO_SELLER.password },
        });
        token = login.accessToken;
      }
      return token;
    },
  };
}

/** One product, one variant, and enough stock that the order form is never short. */
async function ensureStockedVariant(sellerToken, staffToken, binId, item) {
  const variant = await prisma.productVariant.findFirst({
    where: { skuCode: item.sku, deletedAt: null },
    select: { id: true },
  });

  let variantId;
  if (variant === null) {
    const product = await call('/seller/products', {
      method: 'POST',
      token: await sellerToken(),
      body: { name: item.name, externalRef: item.sku },
    });
    const created = await call(`/seller/products/${product.id}/variants`, {
      method: 'POST',
      token: await sellerToken(),
      body: { skuCode: item.sku, weightGrams: item.weightGrams, declaredValueInr: item.valueInr },
    });
    variantId = created.id;
  } else {
    variantId = variant.id;
  }

  // Top up rather than always receiving: re-running must not pile 60 more
  // of everything into the warehouse on every take.
  const onHand = await prisma.stockLevel.aggregate({
    where: { variantId },
    _sum: { qtyOnHand: true },
  });
  const have = onHand._sum.qtyOnHand ?? 0;
  if (have >= item.qty) {
    console.log(`  · ${item.name} — ${have} on hand, nothing to receive`);
    return;
  }
  const want = item.qty - have;

  const gr = await call('/seller/goods-receipts', {
    method: 'POST',
    token: await sellerToken(),
    body: { lines: [{ variantId, expectedQty: want }] },
  });
  await call(`/admin/goods-receipts/${gr.id}/start-receiving`, {
    method: 'POST',
    token: staffToken,
  });
  await call(`/admin/goods-receipts/${gr.id}/lines`, {
    method: 'POST',
    token: staffToken,
    body: {
      lines: [
        {
          lineId: gr.lines[0].id,
          receivedQty: want,
          ...(binId === null ? {} : { putawayBinId: binId }),
          // What it cost, where the fixture records one. It lands on the
          // BATCH, which is where every margin in the product reads it
          // from; an item with no `costInr` is received without one, on
          // purpose.
          ...(item.costInr === undefined ? {} : { unitCostInr: item.costInr }),
        },
      ],
    },
  });
  await call(`/admin/goods-receipts/${gr.id}/complete`, { method: 'POST', token: staffToken });
  console.log(`  · ${item.name} (${item.sku}) — received ${want}, now ${have + want}`);
}

/**
 * Put the catalogue back the way the C3 video finds it.
 *
 * That video does four things on camera that outlive it, and all four
 * make the second take a different video from the first:
 *
 *  1. It ARCHIVES a product, and archiving CASCADES to every variant
 *     (`CatalogProductService.archive` updates them in the same tx).
 *     Restoring does NOT cascade back — the service says so in its own
 *     audit note, "variants left as-is" — which is the single most
 *     useful thing the video teaches and the reason this function
 *     cannot just trust the on-camera restore. Left alone, the whole
 *     seeded catalogue product is unsellable and the ORDER video's
 *     picker would not list it.
 *  2. It adds a size. A SKU is permanent, so a second take collides on
 *     it (the same reason `clearTutorialProduct` exists).
 *  3. It fills in the product's box dimensions, which is the scene that
 *     explains volumetric weight — true only from a standing start.
 *  4. It may override the new size's own weight, which goes with it.
 *
 * It also SETS the defaults the video's third scene is about, because
 * the shared seeding does not: `ensureStockedVariant` puts weight and
 * value on the variant, leaving the product's own defaults null.
 *
 * Runs BEFORE the catalogue loop, not with the other clears: a goods
 * receipt against an archived variant is refused, so an archived
 * catalogue left over from a previous take would fail the top-up.
 */
async function resetCatalogueEdits(sellerId) {
  const product = await prisma.product.findFirst({
    where: { sellerId, name: TUTORIAL_EDIT_PRODUCT.name, deletedAt: null },
    select: { id: true },
  });

  // Archiving cascades and restoring does not, so BOTH halves are put
  // back — and across the whole catalogue rather than just this one
  // product, because an archived SKU anywhere is a row the order
  // video's picker silently stops offering.
  const products = await prisma.product.updateMany({
    where: { sellerId, status: 'ARCHIVED' },
    data: { status: 'ACTIVE' },
  });
  const variants = await prisma.productVariant.updateMany({
    where: { product: { sellerId }, status: 'ARCHIVED', deletedAt: null },
    data: { status: 'ACTIVE' },
  });
  if (products.count > 0 || variants.count > 0) {
    console.log(
      `  · restored ${products.count} archived product(s) and ${variants.count} archived SKU(s)`,
    );
  }

  const added = await prisma.productVariant.findFirst({
    where: { skuCode: TUTORIAL_EDIT_PRODUCT.newVariantSku, product: { sellerId } },
    select: { id: true },
  });
  if (added !== null) {
    // Same guard as the tutorial product: a variant with order lines
    // against it is somebody else's work, and a video is not a reason
    // to delete it.
    const referenced = await prisma.orderItem.count({ where: { variantId: added.id } });
    if (referenced > 0) {
      throw new Error(
        `"${TUTORIAL_EDIT_PRODUCT.newVariantSku}" has order lines against it — refusing to delete.`,
      );
    }
    await prisma.$transaction([
      prisma.productImage.deleteMany({ where: { variantId: added.id } }),
      prisma.stockLevel.deleteMany({ where: { variantId: added.id } }),
      prisma.productVariant.delete({ where: { id: added.id } }),
    ]);
    console.log(`  · removed a previous take's "${TUTORIAL_EDIT_PRODUCT.newVariantSku}" size`);
  }

  if (product === null) return;
  await prisma.product.update({
    where: { id: product.id },
    data: {
      defaultWeightGrams: TUTORIAL_EDIT_PRODUCT.defaultWeightGrams,
      defaultDeclaredValueInr: TUTORIAL_EDIT_PRODUCT.defaultDeclaredValueInr,
      defaultLengthCm: null,
      defaultWidthCm: null,
      defaultHeightCm: null,
    },
  });
  console.log(`  · "${TUTORIAL_EDIT_PRODUCT.name}" back to its defaults, box unset`);
}

/**
 * Clear the pictures the PHOTOS video uploads, on disk as well as in
 * the database.
 *
 * Its first two scenes are an empty drop zone and an empty gallery, and
 * its eighth is about WHICH picture stands for the rest — which is the
 * earliest one uploaded. Leave a previous take's three behind and the
 * gallery opens with six in it, the delete scene removes a different
 * one, and the "earliest" the narration points at was uploaded by a
 * take nobody is watching.
 *
 * HARD delete, and the objects go too. A soft delete would leave the
 * rows out of every read path but keep the files in mock storage
 * forever, and the whole directory is per variant — so removing it is
 * exactly as wide as removing the rows.
 */
async function clearVariantPhotos(sellerId) {
  const variant = await prisma.productVariant.findFirst({
    where: { skuCode: TUTORIAL_PHOTO_SKU, product: { sellerId } },
    select: { id: true },
  });
  if (variant === null) return;

  const images = await prisma.productImage.deleteMany({ where: { variantId: variant.id } });
  const bucket = process.env.SPACES_BUCKET ?? 'skydrop-storage';
  const dir = path.join(MOCK_ROOT, bucket, 'sellers', sellerId, 'variants', variant.id);
  await fs.rm(dir, { recursive: true, force: true });
  if (images.count > 0) {
    console.log(`  · removed ${images.count} picture(s) from ${TUTORIAL_PHOTO_SKU}`);
  }
}

/**
 * Give the TEAM video a colleague, and take away the ones it invited.
 *
 * The demo seller is one person, so `/team` opens on a Members list
 * with a single row — and that row is YOU, which is exactly the row
 * that has no role control and no Deactivate button (you may not
 * change your own role, and the page says so with a chip instead of a
 * select). A video about changing somebody's role needs somebody else.
 *
 * So one colleague is seeded through the REAL invite-and-accept path
 * rather than inserted: `sellerRoleIdForEnum` maps the invitation's
 * enum role onto one of the seller's own `seller_roles` rows, and an
 * inserted user with a hand-picked `roleId` would be a row the product
 * never makes.
 *
 * Everything the video CREATES goes: the invitation it writes on camera
 * (twice over, since the resend re-issues it), and the colleague's role
 * is put back — the video changes it, and the fourth scene's tile and
 * the confirm dialog both name the role being moved FROM.
 */
async function ensureTeamColleague(sellerId, sellerToken) {
  const existing = await prisma.sellerUser.findFirst({
    where: { sellerId, email: TEAM_COLLEAGUE.email },
    select: { id: true },
  });

  if (existing === null) {
    const invite = await call('/seller/team/invitations', {
      method: 'POST',
      token: await sellerToken(),
      body: {
        email: TEAM_COLLEAGUE.email,
        fullName: TEAM_COLLEAGUE.fullName,
        role: TEAM_COLLEAGUE.role,
      },
    });
    await call('/auth/seller/accept-team-invitation', {
      method: 'POST',
      body: {
        token: invite.token,
        password: TEAM_COLLEAGUE.password,
        fullName: TEAM_COLLEAGUE.fullName,
      },
    });
    console.log(`  · added "${TEAM_COLLEAGUE.fullName}" to the team`);
  }

  // Back to the role the video moves them OFF. The confirm dialog
  // restates "moves from X to Y", so a second take starting on Y would
  // film a sentence that reads backwards.
  const role = await prisma.sellerRoleDefinition.findFirst({
    where: { sellerId, key: TEAM_COLLEAGUE.roleKey },
    select: { id: true, name: true },
  });
  if (role !== null) {
    const reset = await prisma.sellerUser.updateMany({
      where: { sellerId, email: TEAM_COLLEAGUE.email, roleId: { not: role.id } },
      data: { roleId: role.id, role: TEAM_COLLEAGUE.role, deletedAt: null },
    });
    if (reset.count > 0) {
      console.log(`  · put ${TEAM_COLLEAGUE.fullName} back on "${role.name}"`);
    }
  }

  // The invitation the video writes on camera. HARD delete: the page
  // lists revoked and expired ones too, so a soft delete would leave
  // the Invitations table growing by a row per take while the
  // narration calls it "the one you just made".
  const invites = await prisma.sellerUserInvitation.deleteMany({
    where: { sellerId, email: TEAM_INVITEE.email },
  });
  if (invites.count > 0) {
    console.log(`  · removed ${invites.count} invitation(s) to ${TEAM_INVITEE.email}`);
  }
}

/**
 * The world the two WALLET videos need, and neither of them leaves.
 *
 * E1 films a transfer being DECLARED, and its closing sentence is "your
 * ledger has not moved". E3 films money going OUT, which needs a
 * balance to take it from — and a balance only exists because somebody
 * accepted a top-up. Each video's world is the other's contradiction,
 * so this is slug-tailored in BOTH directions rather than left to
 * whichever ran last.
 *
 * Neither half writes anything the product could not have written: the
 * balance comes from a real claim accepted through the real review
 * endpoint, and the removal takes the CLAIM AND ITS LEDGER ROW
 * together, so no credit is ever left with nothing explaining it. That
 * is the whole reason `clearTutorialSettings` deletes only PENDING
 * claims; this one may go further because it undoes both sides.
 *
 * It REFUSES to touch a wallet carrying anything else. On a dev box an
 * order charge or a COD credit means somebody has been using this
 * seller for something, and quietly rewriting a money ledger to tidy a
 * video would be the worst thing in this file.
 */
/**
 * E2's wallet — the one video whose subject is the LEDGER itself.
 *
 * The other money videos are about an ACTION (declaring a transfer,
 * asking for a payout) and their worlds are built around what that
 * action needs. This one is about reading what has already happened, so
 * what it needs is history: money in, money out, and money back.
 *
 * D0 supplies four of the five kinds — a top-up, two delivery charges,
 * two return fees and a damage refund. The fifth is the one a seller
 * actually cares about and the hardest to arrange, because it is
 * deliberately NOT a consequence of delivery: on the default
 * `wallet.cod_credit_mode` of SETTLEMENT a COD is credited when the
 * COURIER PAYS US (WAL-5), which is a thing an operator records, not a
 * thing a parcel does. So the seeding records one — through
 * `POST /admin/courier-settlements`, the real path, which writes the
 * credit, the GST we withhold and the COD fee as three separate ledger
 * lines. That trio IS the scene: "what comes off a COD before it
 * reaches you" is unanswerable from a screen that has never shown one.
 *
 * TWO PREREQUISITES, both real product state rather than fixtures:
 *
 *   - the courier account must have a rupee bank account to be paid
 *     into (TRE-3: a settlement whose cash was never recorded reads on
 *     the coverage page as money we hold and do not);
 *   - the payout's reference is UNIQUE per account (SETL-1), which is
 *     what makes recording the same bank credit twice a 409 rather than
 *     a double count — so this is idempotent by construction and simply
 *     skips when its own reference is already on file.
 *
 * It settles `RSH-LIFE-DELIVERED` and nothing else: the canonical
 * delivered parcel, which no video moves. D4's `RSH-LIFE-RETURNREQ` is
 * deliberately left out — it is remade whenever a take spends it, and a
 * settlement against an order that is about to be retired would leave
 * money against a parcel nobody can find.
 */
const COD_SETTLEMENT = {
  /** The courier's own payout reference. Unique per account — SETL-1. */
  reference: 'RSH-TUTORIAL-PAYOUT-01',
  /** The ref of the parcel it pays for. */
  orderRef: 'RSH-LIFE-DELIVERED',
};

async function settleOneCodForLedger(sellerId, staffToken) {
  const order = await prisma.order.findFirst({
    where: { sellerId, sellerOrderRef: COD_SETTLEMENT.orderRef, status: 'DELIVERED' },
    select: { id: true, orderNumber: true, codAmountInr: true },
  });
  if (order === null || order.codAmountInr === null) {
    console.log(
      `  \u00b7 no delivered ${COD_SETTLEMENT.orderRef} to settle — skipping the COD credit`,
    );
    return;
  }

  // Already credited? Ask the LEDGER, not the settlement table: WAL-6's
  // rule is that an order is credited iff it has more COD_COLLECTION
  // entries than COD_REVERSAL ones, and that is the fact this video
  // films.
  const credited = await prisma.sellerWalletEntry.findFirst({
    where: { sellerId, linkedOrderId: order.id, direction: 'COD_COLLECTION' },
    select: { id: true },
  });
  if (credited !== null) {
    console.log(`  \u00b7 ${order.orderNumber}'s COD is already credited`);
    return;
  }

  // THE ACCOUNT THAT CARRIED IT (CACC-1), read off the parcel — never
  // the default or the first one on file. A settlement is refused
  // outright against an account that did not carry the order
  // (`SETTLEMENT_ORDER_OTHER_COURIER`), and this box has two Delhivery
  // accounts whose labels differ by one word: the lifecycle parcels go
  // out on the SANDBOX one and picking the production one by name is
  // exactly the mistake that guard exists to catch.
  const shipment = await prisma.shipment.findFirst({
    where: { orderShipments: { some: { orderId: order.id } }, supersededAt: null },
    select: { courierAccountId: true },
    orderBy: { createdAt: 'desc' },
  });
  const account =
    shipment?.courierAccountId == null
      ? null
      : await prisma.courierAccount.findUnique({
          where: { id: shipment.courierAccountId },
          select: { id: true, label: true, payoutBankAccountId: true, deletedAt: true },
        });
  if (account === null || account.deletedAt !== null) {
    console.log(
      `  \u00b7 ${order.orderNumber} names no live courier account — skipping the COD credit`,
    );
    return;
  }

  // TRE-3. Through the admin endpoint rather than a Prisma update: it is
  // the path that checks the account exists and is a rupee one, and a
  // settlement recorded against a bank account nobody validated is the
  // thing that guard is for.
  if (account.payoutBankAccountId === null) {
    const bank = await prisma.platformBankAccount.findFirst({
      where: { currency: 'INR', deletedAt: null, isActive: true },
      select: { id: true, label: true },
    });
    if (bank === null) {
      console.log('  \u00b7 no rupee bank account — skipping the COD credit');
      return;
    }
    await call(`/admin/courier-accounts/${account.id}`, {
      method: 'PATCH',
      token: staffToken,
      body: { payoutBankAccountId: bank.id },
    });
    console.log(`  \u00b7 paid-into account for ${account.label}: ${bank.label}`);
  }

  // The courier pays the whole COD here. A short payment is a real and
  // interesting case (WAL-6 absorbs it against capital), but it is not
  // this video's subject and a seller reading their first ledger should
  // not meet it in a tutorial.
  const cod = String(order.codAmountInr);
  await call('/admin/courier-settlements', {
    method: 'POST',
    token: staffToken,
    body: {
      courierAccountId: account.id,
      reference: COD_SETTLEMENT.reference,
      amountInr: cod,
      receivedAt: new Date().toISOString(),
      lines: [{ orderId: order.id, settledInr: cod }],
      note: 'Tutorial demo payout',
    },
  }).catch((err) => {
    // SETL-1's unique is the idempotency gate, and it answers 409. The
    // check above should have caught it; this is the backstop for a
    // payout recorded with no credit behind it (which would be a bug
    // worth seeing rather than a seed worth failing).
    if (String(err).includes('SETTLEMENT_ALREADY_RECORDED')) {
      console.log(`  \u00b7 payout ${COD_SETTLEMENT.reference} is already on file`);
      return;
    }
    throw err;
  });
  console.log(`  \u00b7 credited ${order.orderNumber}'s COD through a recorded courier payout`);
}

/**
 * P5's world — the three irreversible acts whose screens would otherwise
 * read as empty states.
 *
 * P5 is a TOUR: it presses nothing, and its whole method is to read each
 * screen's own warning copy out beside what the act writes. Seven of its
 * ten screens already carry the act. Three did not, and a video about
 * what cannot be undone reading "Nothing waiting" three times is the
 * weakest version of the one tutorial this document argues is worth
 * making on its own.
 *
 * The return AT OUR DOOR is not here — it is `RSH-LIFE-ATDOOR` in D0,
 * because it is a parcel and parcels are built there.
 */
/**
 * H3's world: the system-issue board, made REAL and made readable.
 *
 * ── WHY IT DRIVES THE SWEEP RATHER THAN WRITING ROWS ─────────────────
 * `SystemIssueService.raise` is the only writer, and a row inserted by
 * hand skips the notification NOTIF-16 sends on a NEW issue — so a
 * hand-written board is one the product could never have produced. It
 * would also carry whatever severity and wording the seed felt like,
 * which is the opposite of a tutorial's job.
 *
 * `POST /admin/nsa/sweep` runs the SAME sweep the hourly cron runs
 * (`OrderAttentionService.sweep`) — every check, against real state. So
 * each card on camera was raised by the code that raises it in
 * production, saying what it says in production. On this box it takes
 * under two seconds.
 *
 * ── WHY IT THEN CLOSES TWENTY-ODD OF THEM ────────────────────────────
 * The board here is ~37 open, and 25 of those are one issue repeated:
 * `awb-label-missing`, because every lifecycle parcel is booked against
 * the local courier SIMULATOR, which has no label endpoint at all. That
 * is a dev-box artifact, not a lesson — a real deployment does not have
 * twenty-five of them — and left in place it buries the twelve that
 * teach something, which is the exact failure the service's own comments
 * warn about ("alerts like that bury the ones that matter").
 *
 * They are CLOSED, with a note saying why, rather than deleted: the
 * board's whole contract is that a row stays until a person closes it,
 * and "Show closed too" is a scene in the video. A future run's sweep
 * raises them again as fresh rows and closes them again, so the closed
 * history grows by ~25 a take. Harmless for a long while; `list()` takes
 * 200, so if the history ever reaches that, prune it here.
 *
 * ── WHAT THE TAKE WRITES, AND WHAT PUTS IT BACK ──────────────────────
 * The video presses "I'm on it" on one card and opens the Close dialog
 * on another WITHOUT closing it (a closed issue would have to be
 * re-opened, and re-opening is a rewind — the D4 rule). So the only
 * thing to undo is the acknowledgement, which is cleared below on every
 * open issue, not just the one filmed: whichever card the flow picks,
 * the board starts with nobody on anything.
 */
const SYSTEM_ISSUE_SLUGS = new Set(['things-the-system-has-raised']);

/** The dedupe-key prefix of the issue the video films first. */
const LIVE_WAYBILL_PREFIX = 'live-waybill:';

/** Why the label noise is closed. It is on camera under "Show closed too". */
const LABEL_NOISE_NOTE =
  'Booked against the local courier simulator, which serves no label — there was never one to ' +
  'store.';

async function openIssuesWithPrefix(prefix) {
  return prisma.systemIssue.findMany({
    where: { dedupeKey: { startsWith: prefix }, resolvedAt: null },
    select: { id: true, title: true },
  });
}

/**
 * Refuse a seed that a take could not survive.
 *
 * The NSA sweep runs on the hour at minute 10 (`NSA_SWEEP_CRON`), and
 * its label leg raises a fresh issue per pre-dispatch waybill with no
 * label — twenty-five of them on this box, every time, because the
 * courier simulator serves no label and never will. Closing them is
 * therefore only true until the next tick.
 *
 * It is not hypothetical: the second `--check` of this flow straddled
 * :10 and the closing frame showed a board of thirty-seven where the
 * opening frame showed twelve, cards moving under the camera the whole
 * way. Every step passed; only the frame said so.
 *
 * So a seed that lands in the window a take would run through is
 * REFUSED rather than left to produce a take somebody has to notice is
 * wrong. Eight minutes an hour, and the message says how long to wait.
 * There is no honest alternative: the candidate set is
 * `status = CREATED` with a waybill and no label, which those parcels
 * genuinely are, and the only ways out are to store a label that does
 * not exist or to back-date the waybill so the watchdog looks past it.
 */
function refuseNearTheSweep() {
  const minute = new Date().getMinutes();
  const SWEEP_MINUTE = 10;
  const FIRST_UNSAFE = 4;
  if (minute < FIRST_UNSAFE || minute > SWEEP_MINUTE + 1) return;
  const wait = SWEEP_MINUTE + 2 - minute;
  throw new Error(
    `The hourly attention sweep runs at minute ${SWEEP_MINUTE} and it is minute ${minute}, so a ` +
      'take started now would have twenty-five label issues appear on the board half way ' +
      `through. Wait ${wait} minute(s) and run this again.`,
  );
}

async function systemIssueWorldFor(slug, staffToken) {
  if (!SYSTEM_ISSUE_SLUGS.has(slug ?? '')) return;
  refuseNearTheSweep();

  await call('/admin/nsa/sweep', { method: 'POST', token: staffToken });
  console.log('  · ran the real attention sweep');

  // The card the video acknowledges is a LIVE WAYBILL — the one kind on
  // this board that carries an order link, which is the scene about deep
  // links. It comes from a cancelled order whose waybill was never
  // cancelled with the courier, and `checkLiveWaybills` only raises once
  // the void is older than `ops.cancelled_waybill_alert_hours` (2). A
  // cancel filmed by B7 half an hour ago is therefore invisible here, so
  // a candidate that is merely TOO RECENT is aged and the sweep re-run.
  let waybills = await openIssuesWithPrefix(LIVE_WAYBILL_PREFIX);
  if (waybills.length === 0) {
    const candidates = await prisma.shipment.findMany({
      where: {
        status: 'CANCELLED',
        awbNumber: { not: null },
        isManualCourier: false,
        courierCancelledAt: null,
      },
      select: { id: true, shipmentNumber: true },
      take: 2,
    });
    if (candidates.length === 0) {
      throw new Error(
        'No cancelled shipment is still holding a waybill, so the board has nothing for H3 to ' +
          'film its deep-link scene on. Take B7 (`cancelling-an-order`), or seed and cancel one: ' +
          'a confirmed order books a waybill (CUR-2b) and cancelling voids the shipment without ' +
          'telling the courier.',
      );
    }
    const aged = new Date(Date.now() - 6 * 3_600_000);
    await prisma.shipment.updateMany({
      where: { id: { in: candidates.map((s) => s.id) } },
      data: { deletedAt: aged },
    });
    console.log(
      `  · aged ${candidates.length} voided waybill(s) past the alert window ` +
        `(${candidates.map((s) => s.shipmentNumber).join(', ')})`,
    );
    await call('/admin/nsa/sweep', { method: 'POST', token: staffToken });
    waybills = await openIssuesWithPrefix(LIVE_WAYBILL_PREFIX);
    if (waybills.length === 0) {
      throw new Error('Aged a voided waybill and the sweep still raised nothing for it.');
    }
  }

  const noise = await openIssuesWithPrefix('awb-label-missing:');
  if (noise.length > 0) {
    await prisma.systemIssue.updateMany({
      where: { id: { in: noise.map((r) => r.id) } },
      data: { resolvedAt: new Date(), resolutionNote: LABEL_NOISE_NOTE },
    });
    console.log(`  · closed ${noise.length} simulator label issue(s) so the board reads`);
  }

  // Whatever a previous take pressed "I'm on it" on.
  const unacked = await prisma.systemIssue.updateMany({
    where: { resolvedAt: null, acknowledgedAt: { not: null } },
    data: { acknowledgedAt: null, acknowledgedByStaffId: null },
  });
  if (unacked.count > 0) {
    console.log(`  · un-acknowledged ${unacked.count} issue(s) a previous take claimed`);
  }

  const board = await prisma.systemIssue.findMany({
    where: { resolvedAt: null },
    orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }],
    select: { severity: true, occurrenceCount: true, title: true },
  });
  console.log(`\nThe board the take will film (${board.length} open):`);
  for (const r of board) {
    console.log(`  ${r.severity.padEnd(8)} ${String(r.occurrenceCount).padStart(3)}x  ${r.title}`);
  }
}

async function dangerousActsWorldFor(slug, sellerId, sellerToken, staffToken) {
  if (slug !== 'what-we-cannot-undo') return;

  await pendingBankChange(sellerId, sellerToken);
  await closeAnEndedMonth(staffToken);
  await aReceiptReadyToComplete(staffToken);
}

/**
 * A goods receipt standing at the moment BEFORE the irreversible one.
 *
 * The receive station's detail page only offers "Complete" once counting
 * has STARTED — a PENDING receipt shows "Start receiving" and "Cancel
 * receipt" instead, which is the right page and the wrong sentence for a
 * video about completing one. (It cost a check run to find, which is
 * what the rule about reading what a form opens on is for.)
 *
 * So this takes the one PENDING receipt as far as it can WITHOUT writing
 * any stock: receiving started, every line counted at what was declared.
 * Completing is still the act nobody has performed, which is what P5
 * points at. Idempotent, and it never completes anything — a receipt
 * already past PENDING is left exactly as it is.
 */
async function aReceiptReadyToComplete(staffToken) {
  // EVERY receipt already being counted, not just one. The station's
  // list opens on PENDING and the video switches it to ARRIVING, so
  // whichever row sorts first is the one it films — and a box left
  // half-started by an earlier run reads "recorded: 0" under a line
  // about stock being written for what was counted. (It did: the first
  // check run filmed exactly that.)
  const arriving = await call('/admin/goods-receipts?status=ARRIVING&pageSize=25', {
    token: staffToken,
  });
  let receipts = Array.isArray(arriving.items) ? arriving.items : [];

  if (receipts.length === 0) {
    const pending = await call('/admin/goods-receipts?status=PENDING&pageSize=5', {
      token: staffToken,
    });
    const first = (Array.isArray(pending.items) ? pending.items : [])[0];
    if (first === undefined) {
      throw new Error('No PENDING or ARRIVING goods receipt for P5 to point at');
    }
    await call(`/admin/goods-receipts/${first.id}/start-receiving`, {
      method: 'POST',
      token: staffToken,
    });
    receipts = [first];
  }

  for (const r of receipts) {
    const detail = await call(`/admin/goods-receipts/${r.id}`, { token: staffToken });
    const lines = (detail.lines ?? []).map((l) => ({
      lineId: l.id,
      receivedQty: l.expectedQty ?? 0,
      damagedQty: 0,
    }));
    if (lines.length === 0) continue;
    await call(`/admin/goods-receipts/${r.id}/lines`, {
      method: 'POST',
      token: staffToken,
      body: { lines },
    });
    console.log(`  · ${r.receiptNumber} counted and waiting to be completed`);
  }
}

/**
 * A bank change waiting for an admin to approve it.
 *
 * `clearTutorialConsignments` deletes any pending change and then wipes
 * the seller's account entirely, because A2 films the FIRST-TIME path
 * and a seller with an account on file gets a different form. So this
 * runs after it and puts both halves back: an account on file, then a
 * change to it — which is what raises the request (SellerProfileService:
 * "A seller with no account on file has nothing to redirect").
 *
 * Through the product's own endpoint rather than Prisma, and not only
 * for honesty: the account number is ENCRYPTED and carries its own mask
 * and key version, so a row written by hand would be one nothing can
 * read.
 */
async function pendingBankChange(sellerId, sellerToken) {
  const open = await prisma.sellerBankChangeRequest.count({
    where: { sellerId, status: 'PENDING' },
  });
  if (open > 0) {
    console.log('  · a bank change is already waiting for review');
    return;
  }
  /*
    CLEAR THE ACCOUNT FIRST, because the two PATCHes below only work
    from nothing.

    `SellerProfileService` writes a FIRST ADD straight through and sends
    every later EDIT to an admin, and "on file" means all six fields are
    present — it does not ask whether the values actually moved. So with
    an account already on file the first PATCH below is itself a change,
    raises the request, and the second one gets
    `BANK_CHANGE_ALREADY_PENDING`. That is exactly what N4 hit:
    `moneyDeskWorldFor` puts the payout details back on every run (a
    withdrawal is refused outright without them), so by the time this
    runs there is always an account.

    Clearing is the one other edit the product writes straight through —
    there is nowhere for money to go, so there is nothing to redirect —
    and it must take the MASK and the KEY VERSION with it, or the row is
    left claiming an account number it no longer holds. It is also what
    makes the "what is on file" side of the diff card honest: the direct
    `prisma.seller.update` upstream writes the account number in
    PLAINTEXT into a column the product keeps encrypted, and the first
    PATCH below is what replaces it with a properly encrypted one.
  */
  await prisma.seller.update({
    where: { id: sellerId },
    data: {
      bankName: null,
      bankBranchName: null,
      bankAccountName: null,
      bankAccountNumber: null,
      bankAccountNumberMasked: null,
      bankAccountNumberKeyVersion: null,
      bankRoutingNumber: null,
      bankSwiftCode: null,
    },
  });
  // `sellerToken` is the LAZY LOGIN this file passes everywhere, not a
  // string — it signs in on first use and caches.
  const token = await sellerToken();
  // First add — writes straight through, no request.
  await call('/seller/profile/bank-details', {
    method: 'PATCH',
    token,
    body: {
      bankName: WALLET_PAYOUT_BANK.name,
      bankBranchName: WALLET_PAYOUT_BANK.branch,
      bankAccountName: WALLET_PAYOUT_BANK.holder,
      bankAccountNumber: WALLET_PAYOUT_BANK.account,
      bankRoutingNumber: WALLET_PAYOUT_BANK.routing,
      bankSwiftCode: WALLET_PAYOUT_BANK.swift,
    },
  });
  // …and now a CHANGE to it, which is the act an admin has to approve.
  await call('/seller/profile/bank-details', {
    method: 'PATCH',
    token,
    body: {
      bankName: 'Dutch-Bangla Bank',
      bankBranchName: 'Rangpur Branch',
      bankAccountName: WALLET_PAYOUT_BANK.holder,
      bankAccountNumber: '1471100098765432',
      bankRoutingNumber: '090851733',
      bankSwiftCode: 'DBBLBDDH',
    },
  });
  const now = await prisma.sellerBankChangeRequest.count({
    where: { sellerId, status: 'PENDING' },
  });
  if (now !== 1) {
    throw new Error(`Expected one pending bank change for P5, found ${now}`);
  }
  console.log('  · a bank change is waiting for review');
}

/**
 * One month closed, so the carry-forward page has a frozen month AND a
 * month still to close.
 *
 * WHY JULY AND NOT AUGUST. The month list is built from the months
 * BETWEEN the earliest closed period and today, so with nothing ever
 * closed it holds only the open month and there is no close to point at.
 * Closing July puts three on the page at once: July frozen, August
 * "has ended and is not closed yet" with its own amber warning and the
 * Close button beside it, and September live. Closing August would give
 * the first and the third and lose the middle one — which is the only
 * one carrying the product's own sentence about what closing costs.
 *
 * THIS IS ITSELF IRREVERSIBLE, and that is the point of the video. A
 * closed month is never reopened, and PNL-CF-1 refuses any month EARLIER
 * than a closed one for ever after — so on this box June and before can
 * never be closed once this has run. It is guarded accordingly: it runs
 * only when nothing is closed already, and it refuses rather than
 * guesses if the world is not what it expects.
 */
async function closeAnEndedMonth(staffToken) {
  const MONTH = '2026-07';
  const closed = await prisma.pnlPeriod.count();
  if (closed > 0) {
    const first = await prisma.pnlPeriod.findFirst({
      orderBy: { month: 'asc' },
      select: { month: true },
    });
    console.log(`  · ${first?.month ?? 'a month'} is already closed — leaving the P&L alone`);
    return;
  }
  await call(`/admin/treasury/pnl-periods/${MONTH}/close`, {
    method: 'POST',
    token: staffToken,
    body: { reason: 'Closed for the tutorial library so the page has a frozen month to show.' },
  });
  console.log(`  · closed ${MONTH} — frozen for good, as the video says`);
}

async function walletWorldFor(slug, sellerId, sellerToken, staffToken) {
  // A request moves no money (WAL-3: the balance changes when the
  // remittance is recorded), so these are free to remove — and the
  // video's closing shot is a table with exactly the one it just made.
  const reqs = await prisma.withdrawalRequest.deleteMany({ where: { sellerId } });
  if (reqs.count > 0) {
    console.log(`  · removed ${reqs.count} withdrawal request(s) from a previous take`);
  }

  // The schedule the video changes on camera. Its third scene is the
  // switch being OFF and its confirm dialog says "Turn ON"; a second
  // take starting from ON would film the opposite sentence.
  const sched = await prisma.sellerSettingOverride.deleteMany({
    where: { sellerId, key: { in: WITHDRAWAL_SCHEDULE_KEYS } },
  });
  if (sched.count > 0) {
    console.log(`  · put the withdrawal schedule back to the Skydrop default`);
  }

  const entries = await prisma.sellerWalletEntry.findMany({
    where: { sellerId, currency: 'INR' },
    select: { id: true, direction: true },
  });
  const onlyTopups = entries.every((e) => e.direction === 'TOPUP');

  if (slug === 'pay-money-in') {
    if (entries.length === 0) return;
    if (!onlyTopups) {
      console.log(
        `  · leaving the wallet alone — ${entries.length} entries and not all of them top-ups`,
      );
      return;
    }
    // BOTH sides, in one transaction: the claim that explains the
    // credit and the credit itself. Either alone is worse than both.
    const accepted = await prisma.walletTopupRequest.findMany({
      where: { sellerId, status: 'ACCEPTED' },
      select: { id: true, walletEntryId: true },
    });
    await prisma.$transaction([
      prisma.walletTopupRequest.deleteMany({ where: { id: { in: accepted.map((a) => a.id) } } }),
      prisma.sellerWalletEntry.deleteMany({ where: { id: { in: entries.map((e) => e.id) } } }),
    ]);
    console.log(`  · emptied the wallet — ${accepted.length} accepted top-up(s) and their ledger`);
    return;
  }

  if (slug !== 'take-money-out') return;

  // A withdrawal is refused without somewhere to send it
  // (NO_BANK_ACCOUNT_ON_FILE), and the clearing above has just taken
  // the bank details off — the profile video films the first-time path
  // and needs them gone. So they go back on, for this video only.
  await prisma.seller.update({
    where: { id: sellerId },
    data: {
      bankName: WALLET_PAYOUT_BANK.name,
      bankBranchName: WALLET_PAYOUT_BANK.branch,
      bankAccountName: WALLET_PAYOUT_BANK.holder,
      bankAccountNumber: WALLET_PAYOUT_BANK.account,
      bankAccountNumberMasked: `••••${WALLET_PAYOUT_BANK.account.slice(-4)}`,
      bankRoutingNumber: WALLET_PAYOUT_BANK.routing,
      bankSwiftCode: WALLET_PAYOUT_BANK.swift,
    },
  });

  const last = await prisma.sellerWalletEntry.findFirst({
    where: { sellerId, currency: 'INR' },
    orderBy: { id: 'desc' },
    select: { runningBalanceAfter: true },
  });
  const balance = Number(last?.runningBalanceAfter ?? 0);
  if (balance >= WALLET_FLOOR_INR) {
    console.log(`  · wallet holds ₹${balance.toLocaleString('en-IN')}, nothing to top up`);
    return;
  }
  if (entries.length > 0 && !onlyTopups) {
    throw new Error(
      'This wallet carries entries that are not top-ups — refusing to add money to it for a video.',
    );
  }

  // A RUPEE account, by name: the claim's amount is in the account's
  // own currency (which is what the top-up video's fourth scene is
  // about), so topping up against the taka one would credit a different
  // figure from the one asked for.
  const { accounts } = await call('/seller/wallet/topups/bank-accounts', {
    token: await sellerToken(),
  });
  const account = (accounts ?? []).find((a) => a.currency === 'INR');
  if (account === undefined) {
    throw new Error('No active rupee platform bank account — run the db seed first.');
  }
  const claim = await call('/seller/wallet/topups', {
    method: 'POST',
    token: await sellerToken(),
    body: {
      bankAccountId: account.id,
      amount: WALLET_FLOOR_INR - balance,
      // ON CAMERA in E2's Top-ups tab, and it is what a seller would
      // copy off their own banking app — so it is shaped like one rather
      // than announcing itself as a fixture. Still unique per run.
      transactionRef: `NEFT${Date.now().toString().slice(-10)}`,
    },
  });
  await call(`/admin/wallet/topups/${claim.id}/accept`, {
    method: 'POST',
    token: staffToken,
    // A note an OPERATOR would write, because it is on camera: the
    // Top-ups tab shows an accepted claim's note in full, and "seeded
    // for the tutorial" in the middle of a published video is the kind
    // of tell that makes a viewer stop believing the rest of it.
    body: { note: TOPUP_ACCEPT_NOTE },
  });
  console.log(`  · wallet topped up to ₹${WALLET_FLOOR_INR.toLocaleString('en-IN')}`);
}

/**
 * E2's world: a ledger worth reading, and one row on each of the other
 * two tabs.
 *
 * The video's whole argument is that the three tabs answer DIFFERENT
 * questions — Ledger is what happened, Top-ups and Withdrawal requests
 * are what has merely been ASKED FOR — and that argument cannot be made
 * on a screen where two of the three say "nothing here". So each gets
 * exactly one pending row, made through the real endpoints, and the
 * scene that compares them has something to compare.
 *
 * NEITHER MOVES MONEY, which is the point being taught and also what
 * makes them safe to seed on every take: a top-up claim writes nothing
 * until somebody accepts it (WAL-2) and a withdrawal request writes
 * nothing until a remittance is recorded (WAL-3). `walletWorldFor` has
 * already removed the previous take's, so the tables hold one row each
 * however many times this runs.
 */
/**
 * What an operator writes when they accept a claim.
 *
 * ON CAMERA: the Top-ups tab prints an accepted claim's note in full,
 * beneath its Credited chip. E2 dwells on that table for eight seconds.
 */
const TOPUP_ACCEPT_NOTE = 'Matched against the HDFC statement.';

const READING_TOPUP_INR = 15000;
const READING_WITHDRAWAL_INR = 5000;

async function ledgerWorldForReading(sellerId, sellerToken, staffToken) {
  await settleOneCodForLedger(sellerId, staffToken);

  // A claim ACCEPTED by an earlier run of a different video still
  // carries that run's wording, and all of it is on screen here: the
  // operator's note under the Credited chip, the bank reference beside
  // it, and the same reference again inside the ledger row's own note.
  // "Seeded for the withdrawal tutorial" and "TXN-SEED-…" in the middle
  // of a published video are the kind of tell that makes a viewer stop
  // believing the rest of it.
  //
  // COSMETIC ONLY, and deliberately narrow: notes and a reference, on
  // this demo seller, never an amount, a direction or a running
  // balance. No money is rewritten and no chain is touched — the
  // ledger's append-only rule is about the numbers, and these rows are
  // being brought into line with what the seeding writes today rather
  // than corrected.
  const stale = await prisma.walletTopupRequest.updateMany({
    where: { sellerId, status: 'ACCEPTED', reviewNote: { contains: 'tutorial' } },
    data: { reviewNote: TOPUP_ACCEPT_NOTE },
  });
  if (stale.count > 0) console.log(`  \u00b7 tidied ${stale.count} accepted top-up note(s)`);

  // The ledger row quotes the reference that was on the claim when it
  // was accepted, so correcting one without the other leaves the two
  // disagreeing on the same screen.
  const staleRefs = await prisma.sellerWalletEntry.findMany({
    where: { sellerId, direction: 'TOPUP', note: { contains: 'TXN-SEED-' } },
    select: { id: true, note: true, topupRequest: { select: { transactionRef: true } } },
  });
  for (const entry of staleRefs) {
    const ref = entry.topupRequest?.transactionRef;
    if (ref == null || entry.note == null) continue;
    await prisma.sellerWalletEntry.update({
      where: { id: entry.id },
      data: { note: entry.note.replace(/TXN-SEED-\d+/, ref) },
    });
  }
  if (staleRefs.length > 0) {
    console.log(`  \u00b7 ${staleRefs.length} ledger note(s) now quote the claim's own reference`);
  }

  const { accounts } = await call('/seller/wallet/topups/bank-accounts', {
    token: await sellerToken(),
  });
  // The TAKA one, deliberately. E1 films why a Bangladeshi seller pays
  // into it, and a claim whose amount is in the account's own currency
  // is the thing the Top-ups tab then has to show two figures for.
  const account = (accounts ?? []).find((a) => a.currency === 'BDT') ?? (accounts ?? [])[0];
  if (account === undefined) {
    throw new Error('No active platform bank account — run the db seed first.');
  }
  await call('/seller/wallet/topups', {
    method: 'POST',
    token: await sellerToken(),
    body: {
      bankAccountId: account.id,
      amount: READING_TOPUP_INR,
      transactionRef: `TXN-RSH-${Date.now()}`,
    },
  });
  console.log(`  \u00b7 one pending top-up claim against ${account.bankName ?? account.label}`);

  // A withdrawal is refused without somewhere to send it, and the
  // profile video's clearing takes the bank details off — so they go
  // back on here for the same reason `take-money-out` puts them back.
  await prisma.seller.update({
    where: { id: sellerId },
    data: {
      bankName: WALLET_PAYOUT_BANK.name,
      bankBranchName: WALLET_PAYOUT_BANK.branch,
      bankAccountName: WALLET_PAYOUT_BANK.holder,
      bankAccountNumber: WALLET_PAYOUT_BANK.account,
      bankAccountNumberMasked: `\u2022\u2022\u2022\u2022${WALLET_PAYOUT_BANK.account.slice(-4)}`,
      bankRoutingNumber: WALLET_PAYOUT_BANK.routing,
      bankSwiftCode: WALLET_PAYOUT_BANK.swift,
    },
  });
  await call('/seller/wallet/withdrawal-requests', {
    method: 'POST',
    token: await sellerToken(),
    body: {
      currency: 'INR',
      amount: `${READING_WITHDRAWAL_INR}.00`,
      note: 'Monthly payout to our BRAC account.',
    },
  });
  console.log(`  \u00b7 one pending withdrawal request`);
}

/**
 * The world the INTEGRATIONS video needs: nothing it is about to make,
 * and one endpoint that has already failed.
 *
 * Both screens it films are "issue a thing, see its secret once" —
 * so a second take must start with neither the key nor the endpoint the
 * first one created. A key cannot be deleted through the product at all
 * (the controller has create, list and revoke, and nothing else), so a
 * take left behind would pile up a revoked row per run under a
 * narration calling the list "your keys".
 *
 * The auto-disabled endpoint is SEEDED rather than produced, because
 * producing one means fifty consecutive failed deliveries. Every column
 * written here is one `OutboundWebhookDispatchService` writes itself,
 * with its own wording for the reason, so the row is the one the
 * pipeline would have made — and it is the state a seller meets at
 * three in the morning and understands least, which is why the video
 * spends a scene on it rather than describing it.
 */
async function integrationsWorldFor(slug, sellerId) {
  if (slug !== 'keys-and-webhooks') return;

  const keys = await prisma.sellerApiKey.deleteMany({
    where: { sellerId, name: { in: [INTEGRATIONS.keyName, INTEGRATIONS.expiredKeyName] } },
  });
  if (keys.count > 0) {
    console.log(`  · removed ${keys.count} previous take's API key(s)`);
  }

  // An EXPIRED key, so the scene about the two dead states has both on
  // screen instead of one and a description of the other. Expiry is
  // judged in the BROWSER (`keyState()` compares `expiresAt` against
  // `Date.now()`), so a date in the past is the whole of it — there is
  // no column and no job that marks a key expired.
  await prisma.sellerApiKey.create({
    data: {
      sellerId,
      name: INTEGRATIONS.expiredKeyName,
      keyPrefix: 'skd_b_TutExp',
      // Never a usable key: `ApiKeyGuard` looks a caller up by the
      // SHA-256 of what they present, and nothing hashes to this.
      keyHash: `tutorial-expired-key-${sellerId}`,
      lastUsedAt: new Date(Date.now() - 40 * 86_400_000),
      expiresAt: new Date(Date.now() - 9 * 86_400_000),
      createdAt: new Date(Date.now() - 100 * 86_400_000),
    },
  });
  console.log(`  · seeded the expired "${INTEGRATIONS.expiredKeyName}" API key`);

  // Deliveries first: they FK the endpoint, and a soft delete would
  // leave the row on nobody's screen while still holding the URL.
  const stale = await prisma.sellerWebhookEndpoint.findMany({
    where: { sellerId, url: { in: [INTEGRATIONS.endpointUrl, INTEGRATIONS.brokenUrl] } },
    select: { id: true },
  });
  if (stale.length > 0) {
    await prisma.$transaction([
      prisma.outboundWebhookDelivery.deleteMany({
        where: { endpointId: { in: stale.map((e) => e.id) } },
      }),
      prisma.sellerWebhookEndpoint.deleteMany({ where: { id: { in: stale.map((e) => e.id) } } }),
    ]);
    console.log(`  · removed ${stale.length} previous take's webhook endpoint(s)`);
  }

  const failedAt = new Date(Date.now() - 3 * 3_600_000);
  await prisma.sellerWebhookEndpoint.create({
    data: {
      sellerId,
      url: INTEGRATIONS.brokenUrl,
      name: INTEGRATIONS.brokenName,
      secretKey: 'seeded-for-the-tutorial-not-a-real-secret',
      subscribedEvents: INTEGRATIONS.events,
      isActive: false,
      lastSuccessAt: new Date(Date.now() - 6 * 86_400_000),
      lastFailureAt: failedAt,
      consecutiveFailureCount: 50,
      autoDisabledAt: failedAt,
      // The dispatcher's own wording, so the paragraph on screen is the
      // one a real auto-disable writes.
      autoDisabledReason: 'consecutive failures reached threshold (50)',
    },
  });
  console.log(`  · seeded the auto-disabled "${INTEGRATIONS.brokenName}" endpoint`);
}

/**
 * Undo what the two RESELLING videos do on camera.
 *
 * G1 opens a store and invites its first user; G2 puts a price on a
 * product. Both are "there was none, now there is one" scenes, and both
 * are refused on a second take — a store name is unique per seller
 * (`STORE_NAME_TAKEN`), and a priced row's button reads Edit rather
 * than Set price.
 *
 * The store goes with a HARD delete, which is safe here for a reason
 * worth stating: almost everything hanging off `seller_stores` is
 * `onDelete: Cascade` (its roles, invitations, users, events, wallet,
 * terms, tickets, webhooks), and the things that are NOT — orders above
 * all — are exactly what this refuses to delete around. A store with an
 * order against it is somebody's real work, and a video is not a reason
 * to take it.
 */
async function resellingWorldFor(slug, sellerId, sellerToken) {
  // G3 onwards need the store to EXIST, which is the opposite of what
  // G1 and G2 need. Handled first and returned from, so the removal
  // below can stay unconditional for the two videos that build one on
  // camera.
  if (STORE_REQUIRED_SLUGS.has(slug ?? '')) {
    await standingStoreFor(sellerId, sellerToken);
    return;
  }
  if (slug !== 'open-a-reseller-store' && slug !== 'set-a-reseller-price') return;

  const store = await prisma.sellerStore.findFirst({
    where: { sellerId, name: RESELLING.storeName },
    select: { id: true },
  });
  if (store !== null) {
    const orders = await prisma.order.count({ where: { storeId: store.id } });
    if (orders > 0) {
      console.log(
        `  · leaving the "${RESELLING.storeName}" store alone — ${orders} order(s) are filed under it`,
      );
    } else {
      await prisma.sellerStore.delete({ where: { id: store.id } });
      console.log(`  · removed a previous take's "${RESELLING.storeName}" store`);
    }
  }

  // The price the G2 video sets. Its fourth scene is a row whose button
  // says "Set price" — a priced row says "Edit" and opens a form with
  // the figures already in it, which is a different video.
  const variant = await prisma.productVariant.findFirst({
    where: { skuCode: RESELLING.priceSku, product: { sellerId } },
    select: { id: true },
  });
  if (variant !== null) {
    const priced = await prisma.resellerPriceListItem.deleteMany({
      where: { sellerId, variantId: variant.id },
    });
    if (priced.count > 0) {
      console.log(`  · cleared the reseller price of ${RESELLING.priceSku}`);
    }
  }
}

/**
 * The videos that need a reseller store ALREADY OPEN.
 *
 * G1 and G2 want the opposite — G1 opens one on camera and would collide
 * on the name (`STORE_NAME_TAKEN`), G2's fourth scene is an UNPRICED row
 * whose button says "Set price" — so these two worlds are each other's
 * contradiction and `resellingWorldFor` builds one and dismantles the
 * other, exactly as `walletWorldFor` does for E1 and E3.
 */
const STORE_REQUIRED_SLUGS = new Set(['what-one-store-sells', 'the-deal', 'what-a-store-may-do']);

/**
 * Three products the standing store's catalogue is built from.
 *
 * All three are PRICED on the seller's default price list, because the
 * catalogue tab's own copy turns on that: an unpriced row tells the
 * store "set one on your price list, or give this store its own", and a
 * video about choosing what a store sells should not spend its first
 * scene on a product that cannot be sold at all.
 *
 * G3 then gives ONE of them a price of its own on camera, which is the
 * override the tab exists for.
 */
const STANDING_STORE_PRICES = [
  { sku: 'RSH-JAMDANI-IVORY', transfer: '1850', min: '2400', max: '3200', suggested: '2800' },
  { sku: 'RSH-SCARF-EMERALD', transfer: '620', min: '850', max: '1100', suggested: '950' },
  { sku: 'RSH-KANTHA-BLUE', transfer: '1400', min: '1900', max: '2600', suggested: '2200' },
];

/**
 * A reseller store that is already open, with a priced catalogue behind
 * it and NO per-variant terms of its own.
 *
 * The last part is what makes the take repeatable: G3 enables a product,
 * gives it a price override and sets a set-aside, all on camera. A
 * second take starting from a row that is already enabled would film the
 * switch going the other way and a form pre-filled with the first take's
 * figures, which is a different video.
 *
 * Built through the REAL endpoints, not Prisma inserts: `initialStatusFor`
 * maps a SELLER-created store to ACTIVE and an ADMIN-created one to
 * PENDING_SELLER_APPROVAL (derived from the actor, never the body), and a
 * row written by hand would not have been through that at all. The invite
 * is required by the DTO for its own good reason — "a store with nobody
 * able to sign in is a row that looks open and can do nothing".
 */
async function standingStoreFor(sellerId, sellerToken) {
  const token = await sellerToken();
  let store = await prisma.sellerStore.findFirst({
    where: { sellerId, name: RESELLING.storeName, kind: 'RESELLER', deletedAt: null },
    select: { id: true, status: true },
  });

  if (store === null) {
    const created = await call('/seller/reseller-stores', {
      method: 'POST',
      token,
      body: {
        name: RESELLING.storeName,
        displayName: RESELLING.displayName,
        contactEmail: RESELLING.contactEmail,
        contactPhone: RESELLING.contactPhone,
        invite: {
          email: RESELLING.inviteEmail,
          fullName: RESELLING.inviteName,
          // PLURAL since multi-role — the DTO's `@ArrayMinSize(1)`
          // refuses the old singular `roleKey` with a 400, which would
          // have failed the seed on the store it opens.
          roleKeys: ['owner'],
        },
      },
    });
    store = { id: created.store?.id ?? created.id, status: 'ACTIVE' };
    console.log(`  · opened the standing "${RESELLING.storeName}" store`);
  } else {
    console.log(`  · "${RESELLING.storeName}" is already open`);
  }

  // The default price list, through the real PUT — which is what applies
  // the ordering rules (`RETAIL_RANGE_INVERTED`, `SUGGESTED_OUTSIDE_RANGE`),
  // so a figure set here is a figure the product would accept.
  for (const price of STANDING_STORE_PRICES) {
    const variant = await prisma.productVariant.findFirst({
      where: { skuCode: price.sku, product: { sellerId } },
      select: { id: true },
    });
    if (variant === null) continue;
    await call(`/seller/reseller-price-list/${variant.id}`, {
      method: 'PUT',
      token,
      body: {
        transferPriceInr: price.transfer,
        minRetailInr: price.min,
        maxRetailInr: price.max,
        suggestedRetailInr: price.suggested,
      },
    });
  }
  console.log(`  · ${STANDING_STORE_PRICES.length} product(s) priced on the default list`);

  // The store's OWN terms, wiped. Deleted rather than reset through the
  // API: "no row at all" is the state the tab renders as a product this
  // store has never been given, and a row saying enabled=false is not
  // the same thing on screen.
  const wiped = await prisma.resellerStoreVariant.deleteMany({ where: { storeId: store.id } });
  if (wiped.count > 0) {
    console.log(`  · cleared ${wiped.count} per-product term(s) from a previous take`);
  }

  // G4 publishes a TERMS VERSION on camera, and versions are
  // append-only and NUMBERED (RS-4): a second take would open on
  // "Publish version 2" over a card already holding the first take's
  // percentages, and every sentence about "the first terms" would be
  // wrong. So the store goes back to having none.
  //
  // Deleted rather than superseded, and safe for a stated reason: an
  // ORDER snapshots the version it was placed under through a RESTRICT
  // foreign key, so a version any order points at cannot be deleted at
  // all — the database refuses it rather than this script having to
  // judge. There are no store orders until G6.
  const versions = await prisma.resellerStoreTermsVersion.deleteMany({
    where: { storeId: store.id },
  });
  if (versions.count > 0) {
    console.log(`  · cleared ${versions.count} terms version(s) from a previous take`);
  }

  // G5 SAVES the action policy on camera, and its page says two
  // different things depending on whether a row exists: "Running on the
  // defaults — you have not set this store yet" or "Your settings for
  // this store". The first is what the video opens on and argues from,
  // so the row goes.
  //
  // Deleting is exactly right rather than merely convenient: a MISSING
  // ROW IS THE DEFAULTS (`DEFAULT_POLICY`, pinned against the
  // migration's own column defaults), so removing it is not clearing the
  // store's permissions — it is putting them back to what a store that
  // has never been configured has.
  const policy = await prisma.resellerStoreActionPolicy.deleteMany({
    where: { storeId: store.id },
  });
  if (policy.count > 0) {
    console.log('  · put what-they-can-do back to the Skydrop defaults');
  }
}

/**
 * The DRAFT order the B6 video edits on camera.
 *
 * A draft, not a submitted one, and that is the whole reason this exists:
 * `EditOrderForm` computes `canEdit = isDraft || isPending` and then
 * renders "Save + submit" and "Discard draft" ONLY for a draft; on a
 * PENDING_CONFIRMATION order its own notice says the server allows
 * "recipient + notes" alone. The video is about the window while
 * everything is still changeable, so it needs the state where everything
 * still is.
 *
 * NOTHING CLEARS IT SPECIALLY. `clearPreviousOrders` already removes
 * every pre-dispatch order that is not under a protected prefix, and
 * DRAFT is the first entry in `REMOVABLE_STATUSES` — so a take that
 * saved it, submitted it, or discarded it leaves nothing for the next
 * run to collide with, and this simply creates a fresh one afterwards.
 * Cheap for the same reason the call-cap parcel is cheap to rebuild:
 * nothing is reserved before confirmation (ORD-10).
 */
export const EDIT_DRAFT = {
  ref: 'RSH-EDIT-DRAFT',
  sku: 'RSH-KANTHA-BLUE',
  recipientName: 'Aparna Balakrishnan',
  phone: '+919845080011',
  line1: '31, Dickenson Road',
  // Deliberately VAGUE — the video corrects it on camera, and ORD-5's
  // 2026-08-07 amendment is why: line two is the landmark, and the
  // landmark is what decides whether a driver finds the place.
  line2: 'Near the main road',
  betterLine2: 'The lane beside Holy Ghost church, third gate on the left',
  postalCode: '560042',
  /**
   * ONE unit at the catalogue's own price, so the draft opens looking
   * like an ordinary order rather than a half-filled one: the seller's
   * form pre-fills a line's unit price and the API leaves it blank, and
   * a blank price makes the payment section open already disagreeing
   * with itself. The video changes the QUANTITY and lets it disagree
   * then, which is the moment worth filming.
   */
  unitPriceInr: '1850',
  codAmountInr: '1850',
};

/** The master switch RS-5 guards store orders with (SET-1, seeded FALSE). */
const RESELLER_ORDERS_KEY = 'reseller.orders_enabled';

/**
 * The draft B6 edits. Created AFTER the clearing, so it is always fresh.
 *
 * Through the real endpoint, which is what makes it a DRAFT at all:
 * `OrderService.create` defaults `initialStatus` to DRAFT and the
 * seller's own submit is a separate call the lifecycle makes and this
 * deliberately does not.
 */
async function editDraftWorldFor(slug, sellerId, sellerToken) {
  if (slug !== 'changing-an-order') return;
  const variant = await prisma.productVariant.findFirst({
    where: { skuCode: EDIT_DRAFT.sku, product: { sellerId } },
    select: { id: true },
  });
  if (variant === null) {
    throw new Error(`No ${EDIT_DRAFT.sku} for this seller — the catalogue seeding runs first.`);
  }
  const order = await call('/seller/orders', {
    method: 'POST',
    token: await sellerToken(),
    body: {
      recipientName: EDIT_DRAFT.recipientName,
      recipientPhoneE164: EDIT_DRAFT.phone,
      recipientAddressLine1: EDIT_DRAFT.line1,
      recipientAddressLine2: EDIT_DRAFT.line2,
      recipientPostalCode: EDIT_DRAFT.postalCode,
      paymentMode: 'COD',
      codAmountInr: EDIT_DRAFT.codAmountInr,
      sellerOrderRef: EDIT_DRAFT.ref,
      items: [{ variantId: variant.id, quantity: 1, unitPriceInr: EDIT_DRAFT.unitPriceInr }],
    },
  });
  console.log(`  · drafted ${order.orderNumber} (${EDIT_DRAFT.ref}) for the edit video`);
}

/**
 * F4's world — an inbox that has not been read, and no silences set.
 *
 * The video PRESSES: it marks a message read, dismisses one, and
 * switches a topic and a category off. Every one of those is a durable
 * per-person or per-company choice, so without this the second take
 * opens on a half-read inbox with a category already silenced, under
 * narration about turning one off.
 *
 * THE MESSAGES ARE NOT DELETED. `notification_logs` is the ledger the
 * NOTIF-2 dedup gate reads, and NOTIF-21 is explicit that a "delete" in
 * this inbox is a DISMISS for exactly that reason — removing a row would
 * quietly let a re-emit of the same event send again. The two columns
 * that make a row read or hidden are cleared instead, which is the same
 * shape the product's own un-read does.
 *
 * The other two are row-absence defaults, so deleting really is the
 * reset: a topic with no `notification_subscriptions` row reaches the
 * inbox, and a category with no `seller_notification_preferences` row is
 * emailed (`SellerNotificationPreferenceResolver` fails open — NOTIF-15,
 * "a missing row means send").
 *
 * The inbox itself needs no seeding at all: D0's parcels and the nightly
 * sweeps have filled it many times over, and this video reads whatever
 * is there rather than naming any of it.
 */
/** `SellerNotificationCategory`, which the settings page lists one row per. */
const SELLER_NOTIFICATION_CATEGORIES = [
  'ORDER_UPDATES',
  'SHIPMENT_UPDATES',
  'STOCK_ALERTS',
  'CALL_CENTER_OUTCOMES',
  'BILLING',
  'SYSTEM_ANNOUNCEMENTS',
  'MARKETING',
];

async function notificationWorldFor(slug, sellerId) {
  if (slug !== 'quieten-your-notifications') return;

  const users = await prisma.sellerUser.findMany({ where: { sellerId }, select: { id: true } });
  const userIds = users.map((u) => u.id);

  const silences = await prisma.notificationSubscription.deleteMany({
    where: { subjectType: 'SELLER_USER', subjectId: { in: userIds } },
  });
  /*
    The company's categories are UPSERT-TO-DEFAULT, not deleted.

    Deleting looked right — `SellerNotificationPreferenceResolver` fails
    open, so an absent row means send (NOTIF-15) — and it left the
    company half of the settings page EMPTY, because nothing recreates
    those rows on a read. The video's scene about it would have been an
    empty state under a line describing a table. Seen in a check-run
    frame: "Company categories — 0".
  */
  const categories = [];
  for (const category of SELLER_NOTIFICATION_CATEGORIES) {
    categories.push(
      prisma.sellerNotificationPreference.upsert({
        where: { sellerId_category: { sellerId, category } },
        update: {
          emailEnabled: true,
          inAppEnabled: true,
          quietHoursStart: null,
          quietHoursEnd: null,
        },
        create: { sellerId, category },
      }),
    );
  }
  await prisma.$transaction(categories);
  const unread = await prisma.notificationLog.updateMany({
    where: {
      toInAppUserId: { in: userIds },
      channel: 'IN_APP',
      OR: [{ readAt: { not: null } }, { dismissedAt: { not: null } }],
    },
    data: { readAt: null, dismissedAt: null },
  });

  console.log(
    `  · notifications reset: ${silences.count} topic silence(s) removed, ${categories.length} ` +
      `category preference(s) put back to their defaults, ` +
      `${unread.count} message(s) put back in the inbox`,
  );
}

/**
 * B3's world — B2's import, RUN AND STOPPED.
 *
 * The bulk video uploads `fixtures/rangpur-bulk-orders.csv` on camera
 * and the file is written so that exactly one of its six rows cannot
 * become an order: Kavya Reddy's has no Address Line 2, and ORD-5's
 * 2026-08-07 amendment made the landmark REQUIRED, because it is the
 * field that decides whether a rural address is found at all. That one
 * row is the whole of B3, and it is why this seeding is the cheapest in
 * the library — it runs the import B2 already owns and stops.
 *
 * THROUGH THE REAL ENDPOINTS, not by inserting a staged row. The row's
 * `problems` are written by the import worker, and a hand-made row would
 * be one somebody wrote to look like what the worker produces — which is
 * exactly the kind of fixture that goes on passing after the worker's
 * output changes shape. Presign, put the bytes where `SpacesService`
 * will look for them (`mockObjectPath`, the one place that knows the
 * layout), process, and wait for the job to land.
 *
 * NOTHING CLEARS IT SPECIALLY: `clearPreviousImports` already removes
 * every upload, its staged rows and the objects behind them, and it runs
 * before this. So a take that imported the row, discarded it, or did
 * neither all leave the same nothing behind.
 */
/** `BulkUploadStatus`, the values a finished job can carry. */
const TERMINAL_IMPORT = ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED'];

const PENDING_IMPORT = {
  fileName: 'rangpur-bulk-orders.csv',
  /** The row the camera fixes: the one with no landmark. */
  customer: 'Kavya Reddy',
  ref: 'RSH-2026-0505',
  landmark: 'The lane behind the Hoodi circle bus stop',
};

async function pendingRowsWorldFor(slug, sellerId, sellerToken) {
  if (slug !== 'fix-the-rows-that-failed') return;
  const token = await sellerToken();

  const presign = await call('/seller/order-imports/presign', {
    method: 'POST',
    token,
    body: { fileName: PENDING_IMPORT.fileName },
  });
  const target = mockObjectPath(presign.uploadUrl);
  if (target === null) {
    throw new Error(
      `The API handed back a non-mock upload URL (${presign.uploadUrl}). ` +
        'Is DEV_MOCK_SPACES off?',
    );
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(path.join(TUTORIALS_DIR, 'fixtures', PENDING_IMPORT.fileName), target);

  const job = await call('/seller/order-imports/process', {
    method: 'POST',
    token,
    body: { spacesKey: presign.spacesKey, fileName: PENDING_IMPORT.fileName },
  });

  // The worker runs in-process (SCALE-1) but not synchronously, so wait
  // for a terminal status rather than for a fixed beat.
  let landed = null;
  for (let i = 0; i < 60; i += 1) {
    landed = await call(`/seller/order-imports/${job.id}`, { token });
    if (TERMINAL_IMPORT.includes(landed.status)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (landed === null || !TERMINAL_IMPORT.includes(landed.status)) {
    throw new Error(`The import never finished (last status ${landed?.status ?? 'unknown'}).`);
  }

  // THE ROW IS THE POINT, so it is asserted rather than assumed. An
  // import that suddenly accepts every row would leave B3 filming an
  // empty state under a line about fixing one.
  const rows = await prisma.stagedOrderRow.findMany({
    where: { upload: { sellerId } },
    select: { rowNumber: true, data: true },
  });
  const wanted = rows.find((r) => String(r.data?.customerName ?? '') === PENDING_IMPORT.customer);
  if (wanted === undefined) {
    throw new Error(
      `The import left ${rows.length} row(s) waiting and none of them is ` +
        `${PENDING_IMPORT.customer}'s — B3 has nothing to film. Has the landmark stopped ` +
        'being required (ORD-5)?',
    );
  }
  console.log(
    `  · imported ${PENDING_IMPORT.fileName}: ${landed.ordersCreated} order(s), ` +
      `row ${wanted.rowNumber} (${PENDING_IMPORT.customer}) waiting on a landmark`,
  );
}

/**
 * B7's cheap half — an order WAITING ON THE CALL CENTRE, to be called
 * off on camera.
 *
 * The video needs two orders and they teach opposite halves of the same
 * sentence. This one is the "nothing was held" case: ORD-10 says
 * reservation is LATE, so an order nobody has confirmed has claimed no
 * stock at all and cancelling it releases nothing. The other is D0's
 * `RSH-LIFE-CONFIRMED`, which has been confirmed on a call and carries
 * a waybill — that one gives its stock back and leaves a live waybill
 * for us to close with the courier.
 *
 * PENDING_CONFIRMATION, not DRAFT: a draft is not in anybody's queue,
 * so the dialog's "it leaves the call queue — nobody will phone this
 * customer about it" would be a sentence about nothing.
 *
 * ── HOW IT STAYS RE-TAKEABLE ─────────────────────────────────────────
 * It is RETIRED, not deleted, and that is forced rather than chosen:
 * `clearPreviousOrders` sweeps PENDING_CONFIRMATION but not CANCELLED,
 * and a cancelled order cannot simply be deleted here either — the
 * cancel sends the seller an email, and `notification_logs.order_id`
 * would refuse the row. So the spent one keeps everything it has and
 * only its NAME moves aside (the D4 rule, `retireSpentParcel`), which
 * it must, because `sellerOrderRef` is unique per seller and store.
 *
 * A take that did NOT reach the cancel leaves it PENDING_CONFIRMATION,
 * which the shared clearing has already removed by the time this runs —
 * so either way this ends with exactly one, freshly placed.
 */
const CANCEL_PENDING = {
  ref: 'RSH-CANCEL-PENDING',
  sku: 'RSH-KANTHA-BLUE',
  recipientName: 'Shalini Prabhu',
  phone: '+919845090011',
  line1: '9, Wood Street',
  line2: 'Opposite the Bishop Cotton school gate',
  postalCode: '560025',
  codAmountInr: '1850',
  unitPriceInr: '1850',
};

/**
 * I1's world: ONE confirmation call waiting at the head of the queue.
 *
 * ── WHY IT PLACES AN ORDER RATHER THAN USING WHAT IS THERE ───────────
 * The box has 157 orders in PENDING_CONFIRMATION and THREE live
 * `call_queue_entries`, because 153 of those were bulk-loaded straight
 * into the status without ever being submitted (H1's entry explains the
 * split, and it is why no figure is spoken on that video). Of the three
 * that are live, two are `DELIVERY_FAILED` follow-ups on parcels that
 * have since come back — a TICKET call, which the station gives a
 * different vocabulary (one outcome, "Called", and the note is the
 * answer). So filming "the next customer in the queue" against whatever
 * is there would film the wrong kind of call.
 *
 * `callThisOneFirst` puts ours at the head — ahead of the queue and in
 * the past, because the entry is claimed on `available_at` and an entry
 * scheduled into the future is correctly handed back as nothing.
 *
 * ── WHY THE CUSTOMER IS A LIFECYCLE ONE ──────────────────────────────
 * `CustomerRiskStrip` renders NOTHING for a first-time customer, on
 * purpose — most calls are first-time customers and a strip that always
 * says "nothing known" is a strip nobody reads on the call where it
 * finally matters. The video is about the call where it matters, so the
 * order is placed for the phone D0's returned parcels belong to, and the
 * strip has a return rate to show. Assert it rather than hope: a box
 * whose lifecycle orders were wiped would film an empty space under a
 * line about reading the customer's history.
 *
 * ── WHAT THE TAKE SPENDS, AND WHAT PUTS IT BACK ──────────────────────
 * Recording an outcome is append-only (CC-1), a CONFIRMED one reserves
 * stock (ORD-10) and books a waybill (CUR-2b). None of that is undone —
 * the spent order is RENAMED and left exactly as it is, and a fresh one
 * follows, which is the D4 rule. The only thing reset is the agent: any
 * entry still ASSIGNED to them goes back to PENDING, and their
 * availability goes back to OFF, because the video's second scene is
 * turning it on.
 */
const CALL_WAITING = {
  ref: 'RSH-CALL-1',
  sku: 'RSH-JAMDANI-IVORY',
  // The phone D0's RETURNREQ parcels belong to — five orders, three of
  // them returned, so the risk strip has something to say.
  recipientName: 'RSH Kaushik Iyer',
  phone: '+919845060099',
  line1: '14, Nandidurga Road',
  line2: 'Beside the Jayamahal Palace gate',
  postalCode: '560046',
  codAmountInr: '2400',
  unitPriceInr: '2400',
};

async function callWorldFor(slug, sellerId, sellerToken, staffToken) {
  if (slug !== 'taking-calls') return;

  const ops = await prisma.staffUser.findUniqueOrThrow({
    where: { email: OPS.email },
    select: { id: true },
  });

  // Whatever the last take was left holding. Released rather than
  // completed: no attempt was recorded against it, so it is still
  // somebody's to make.
  const held = await prisma.callQueueEntry.updateMany({
    where: { assignedAgentId: ops.id, status: 'ASSIGNED' },
    data: { status: 'PENDING', assignedAgentId: null, assignedAt: null },
  });
  if (held.count > 0) {
    console.log(`  · released ${held.count} call(s) a previous take was still holding`);
  }
  // OFF, because turning it on is the video's second scene.
  await call('/agent/settings', {
    method: 'PATCH',
    token: staffToken,
    body: { isAvailable: false },
  });

  const spent = await prisma.order.findFirst({
    where: { sellerId, sellerOrderRef: CALL_WAITING.ref },
    select: { id: true, orderNumber: true, status: true },
  });
  if (spent !== null && spent.status !== 'PENDING_CONFIRMATION') {
    const parked = await prisma.order.count({
      where: { sellerId, sellerOrderRef: { startsWith: `${CALL_WAITING.ref}-SPENT-` } },
    });
    const retiredRef = `${CALL_WAITING.ref}-SPENT-${parked + 1}`;
    await prisma.order.update({ where: { id: spent.id }, data: { sellerOrderRef: retiredRef } });
    console.log(
      `  · ${CALL_WAITING.ref} is spent — ${spent.orderNumber} is ${spent.status}. ` +
        `Renamed ${retiredRef} and left intact; a fresh one follows`,
    );
  }

  let orderId = spent !== null && spent.status === 'PENDING_CONFIRMATION' ? spent.id : null;
  if (orderId === null) {
    const variant = await prisma.productVariant.findFirst({
      where: { skuCode: CALL_WAITING.sku, product: { sellerId } },
      select: { id: true },
    });
    if (variant === null) {
      throw new Error(`No ${CALL_WAITING.sku} for this seller — the catalogue seeding runs first.`);
    }
    const token = await sellerToken();
    const order = await call('/seller/orders', {
      method: 'POST',
      token,
      body: {
        recipientName: CALL_WAITING.recipientName,
        recipientPhoneE164: CALL_WAITING.phone,
        recipientAddressLine1: CALL_WAITING.line1,
        recipientAddressLine2: CALL_WAITING.line2,
        recipientPostalCode: CALL_WAITING.postalCode,
        paymentMode: 'COD',
        codAmountInr: CALL_WAITING.codAmountInr,
        sellerOrderRef: CALL_WAITING.ref,
        items: [{ variantId: variant.id, quantity: 1, unitPriceInr: CALL_WAITING.unitPriceInr }],
        // The take before this one confirmed an order for the SAME
        // customer and it is still unpacked, so `create` refuses the
        // next one as `DUPLICATE_ORDER_SUSPECTED` — correctly: a repeat
        // order for a customer whose last parcel has not left is
        // usually somebody submitting twice. Here it is deliberate, and
        // acknowledging is what the real form makes a person do too.
        acknowledgeDuplicate: true,
      },
    });
    // Submitting is what puts it on the queue (CC-6), post-commit.
    await call(`/seller/orders/${order.id}/submit`, { method: 'POST', token });
    orderId = order.id;
    console.log(`  · placed ${order.orderNumber} (${CALL_WAITING.ref}) for the call station`);
  }

  /*
    AND `callThisOneFirst` IS NOT ENOUGH ON ITS OWN.

    The pull is `ORDER BY (scheduled_attempts > 0) DESC, available_at
    ASC, created_at ASC` — a call somebody has already pulled and given
    back goes to the FRONT of the whole queue, ahead of every unstarted
    one whatever its time. Correct product behaviour, and it is exactly
    what the previous TAKE leaves behind: the release scene hands an
    entry back with its pull counter at one, so the next run's first
    call is that one rather than the seeded one.

    It did exactly that, and the check PASSED — every step found its
    target, the risk strip rendered, and nine scenes were filmed about a
    reseller store's order whose customer has one clean previous parcel,
    under a line about a customer whose parcels keep coming back. Only
    the frame said so.

    So the counter is put back on everything the take could have
    touched. That is the seed contract rather than a rewrite of history:
    the take is what incremented it, `call_queue_entries` is mutable
    state (CC-1's append-only rule is about `call_attempts`), and the
    entry goes back to being what it was before the camera reached it.
  */
  const jumped = await prisma.callQueueEntry.updateMany({
    // OURS INCLUDED. A check run that released the seeded call leaves it
    // at one, and the card then opens on "pull #2" for what the video
    // calls a first call — true of the box's history and false of the
    // shift being filmed.
    where: { status: 'PENDING', scheduledAttempts: { gt: 0 } },
    data: { scheduledAttempts: 0 },
  });
  if (jumped.count > 0) {
    console.log(
      `  \u00b7 put ${jumped.count} released call(s) back behind the queue \u2014 a pulled one jumps it`,
    );
  }

  await callThisOneFirst(orderId);
  console.log('  · moved it to the head of the call queue');

  // The risk strip is a SCENE, and it renders nothing without history.
  const history = await prisma.order.count({
    where: { sellerId, recipientPhoneE164: CALL_WAITING.phone, id: { not: orderId } },
  });
  if (history === 0) {
    throw new Error(
      `${CALL_WAITING.phone} has no previous orders, so the customer-risk strip will render ` +
        'nothing and I1 has a scene about an empty space. Run `seed-demo-data.mjs --lifecycle` ' +
        'first: the strip is about a customer whose parcels have come back before, and D0 is ' +
        'where those parcels are.',
    );
  }
  console.log(`  · the customer has ${history} previous order(s) — the risk strip will render`);
}

/**
 * I2's world: a supervisor's queue with somebody's name on a stuck call.
 *
 * ── THE ROSTER WAS EMPTY, AND NOTHING SAID SO ────────────────────────
 * `AdminAgentService.listAgents` selects `staff_users` by the LEGACY
 * `role` enum being `CALL_AGENT`. This box had 39 staff users and NOT
 * ONE of them carried it — every sim-e2e account is a SUPER_ADMIN — so
 * `/call-center/agents` rendered its empty state ("No call agents") and,
 * far worse for a video about moving work between people, the Reassign
 * dialog's dropdown was EMPTY: it lists `useAgents()` filtered to
 * available, so with no agents at all there is nobody to reassign to and
 * the dialog says so in red.
 *
 * The curriculum's own note for this entry said the roster was "five
 * rows, four of them debris". That was measured off `agent_call_settings`
 * (5 rows, all on SUPER_ADMINs) rather than off the PAGE, which reads a
 * different table. Both halves matter and only one of them was true —
 * which is the standing lesson of this library restated: LOOK at the
 * screen before writing what the video does to it.
 *
 * So this seeds two real call agents, upserted exactly as `ensureOps`
 * upserts the ops account: the legacy enum AND the RBAC row together,
 * which is what `StaffInvitationService.accept` writes for a staff
 * member invited for real (`role: inv.role` beside
 * `staffRole: { connect: { key: staffRoleKeyForEnum(inv.role) } }`). One
 * without the other is a staff user who either holds no permissions or
 * is invisible to every screen that asks the enum.
 *
 * ── WHY ONE IS OFF AND HOLDING, AND THE OTHER IS ON AND IDLE ─────────
 * It is the shape `QueueIndex`'s own docstring names as the reason the
 * screen exists: "an entry assigned to someone who went home stayed
 * assigned until its timer expired and nobody could see that it had".
 * Marking yourself unavailable does NOT hand back what you are already
 * holding — `AgentSettingsService.apply` upserts the row and nothing
 * else — so an agent who closed their laptop keeps the customer's order.
 * Asha holds the call and is marked off; Imran is on and idle, and is
 * therefore the only name the Reassign dropdown can offer.
 *
 * ── THE PRESENCE SWEEP IS ON A ONE-MINUTE CRON AND WILL EAT THIS ─────
 * `AgentPresenceService.sweep` stands down every agent who is AVAILABLE
 * and whose `lastSeenAt` is older than `ops.agent_presence_timeout_minutes`
 * (10), and hands back whatever they were holding. A seeded available
 * agent with a null `lastSeenAt` is stood down inside sixty seconds and
 * the Reassign dropdown is empty again — so `lastSeenAt` is stamped NOW,
 * which is honest (they are at their desk) and buys the ten minutes a
 * take needs. Generate the voice BEFORE the take rather than inside it
 * if the clips are not cached: that step is the only thing between this
 * seed and the camera.
 *
 * The one holding the call is deliberately NOT available, so the sweep
 * has no interest in her and the assignment cannot evaporate mid-scene.
 *
 * ── THE ASSIGNMENT IS WRITTEN, NOT PULLED ────────────────────────────
 * Pulling it through `/agent/calls/next` as Asha would cost a login and
 * arm CC-7's fifteen-minute expiry job, which would hand the row back
 * part-way through a take that started late — a take failing on the
 * scene AFTER the one that broke it. `call_queue_entries` is mutable
 * state (CC-1's append-only rule is about `call_attempts`, which this
 * writes none of) and `callWorldFor` above already writes it directly,
 * so the row is set ASSIGNED here with no timer behind it.
 *
 * `scheduledAttempts` is set to 1 because somebody DID pull it — the
 * column counts claims, not conversations, and leaving it at 0 beside an
 * agent's name would contradict the screen's own explanation of itself.
 * `attemptsCounting` stays 0, which is the whole point: a row somebody
 * took and never rang.
 *
 * ── AND EXACTLY ONE ASSIGNED ROW, ACROSS THE WHOLE QUEUE ─────────────
 * "Reassign" renders only on an ASSIGNED row, so with one such row the
 * flow can reach for the button by name and cannot land on the wrong
 * parcel (P5's lesson: when a seed stages one row and a flow takes
 * `.first()`, they can be different rows). Anything else left ASSIGNED
 * by an earlier take — I1's release scene can leave one behind — is
 * released back to PENDING first.
 */
const SUPERVISE_AGENTS = [
  {
    email: 'asha.pillai@skydrop.local',
    // Holds the stuck call, and has gone off shift while holding it.
    isAvailable: false,
    languages: ['en', 'hi', 'bn'],
    holdsTheCall: true,
  },
  {
    email: 'imran.shaikh@skydrop.local',
    // On the roster and idle — the only name Reassign can offer.
    isAvailable: true,
    languages: ['en', 'hi'],
    holdsTheCall: false,
  },
];

/** Every seeded agent shares one password; nothing signs in as them. */
const SUPERVISE_AGENT_PASSWORD = 'Tutorial-Agent-2026';

/**
 * Three confirmation calls waiting, so the queue reads as a queue.
 *
 * `waitedMinutes` back-dates the queue entry's `createdAt`, which is
 * what the "Waiting since" column is computed from. Everything placed in
 * one seed run is otherwise the same age, and a column where every row
 * says "0m" teaches nothing about the column. The ORDERS keep their real
 * timestamps; this moves the queue row only, which is the thing on
 * screen.
 */
const SUPERVISE_ORDERS = [
  {
    ref: 'RSH-QUEUE-1',
    sku: 'RSH-JAMDANI-IVORY',
    recipientName: 'Sunita Bhattacharya',
    phone: '+919845070101',
    line1: '27, Cunningham Road',
    line2: 'Above the Sikh gurudwara',
    postalCode: '560052',
    codAmountInr: '2400',
    unitPriceInr: '2400',
    waitedMinutes: 305,
    assigned: true,
  },
  {
    ref: 'RSH-QUEUE-2',
    sku: 'RSH-KANTHA-BLUE',
    recipientName: 'Farhan Qureshi',
    phone: '+919845070102',
    line1: '5, Tannery Road',
    line2: 'Next to the Kaval Byrasandra post office',
    postalCode: '560005',
    codAmountInr: '1850',
    unitPriceInr: '1850',
    waitedMinutes: 164,
    assigned: false,
  },
  {
    ref: 'RSH-QUEUE-3',
    sku: 'RSH-SCARF-EMERALD',
    recipientName: 'Lakshmi Venkatesh',
    phone: '+919845070103',
    line1: '112, Sarjapur Road',
    line2: 'Opposite the Wipro gate',
    postalCode: '560035',
    codAmountInr: '990',
    unitPriceInr: '990',
    waitedMinutes: 38,
    assigned: false,
  },
];

/**
 * BOTH I2 AND I3 record against this world, and they want the same
 * thing: a queue with a real roster behind it and exactly one call
 * assigned to somebody who is not going to make it. I2 moves it; I3
 * records what the call would have come to. One world, two videos,
 * rather than a second copy that drifts.
 */
const SUPERVISE_SLUGS = new Set(['supervising-the-queue', 'forcing-an-outcome']);

async function superviseWorldFor(slug, sellerId, sellerToken) {
  if (!SUPERVISE_SLUGS.has(slug)) return;

  const callAgentRole = await prisma.staffRoleDefinition.findFirstOrThrow({
    where: { key: 'call_agent' },
    select: { id: true },
  });
  const passwordHash = await hash(SUPERVISE_AGENT_PASSWORD);

  const seeded = [];
  for (const a of SUPERVISE_AGENTS) {
    const staff = await prisma.staffUser.upsert({
      where: { email: a.email },
      update: {
        passwordHash,
        role: 'CALL_AGENT',
        staffRole: { connect: { id: callAgentRole.id } },
        deletedAt: null,
      },
      create: {
        email: a.email,
        emailDisplay: a.email,
        passwordHash,
        role: 'CALL_AGENT',
        staffRole: { connect: { id: callAgentRole.id } },
      },
      select: { id: true, email: true },
    });
    // maxActiveCalls back to 1 on EVERY run: the video raises it to
    // three on camera, and a second take opening on a cap that is
    // already three films a change that changes nothing.
    const settings = {
      isAvailable: a.isAvailable,
      maxActiveCalls: 1,
      languages: a.languages,
      // See the presence-sweep note above. NOW, not null.
      lastSeenAt: new Date(),
    };
    await prisma.agentCallSettings.upsert({
      where: { agentId: staff.id },
      create: { agentId: staff.id, ...settings },
      update: settings,
    });
    seeded.push({ ...a, id: staff.id });
  }
  console.log(
    `  · two call agents on the roster: ${seeded
      .map((a) => `${a.email} (${a.isAvailable ? 'available' : 'off'})`)
      .join(', ')}`,
  );

  // Nothing else may be ASSIGNED, or "Reassign" is not a unique button.
  const released = await prisma.callQueueEntry.updateMany({
    where: { status: 'ASSIGNED' },
    data: { status: 'PENDING', assignedAgentId: null, assignedAt: null },
  });
  if (released.count > 0) {
    console.log(`  · released ${released.count} call(s) an earlier take was still holding`);
  }

  const holder = seeded.find((a) => a.holdsTheCall);
  if (holder === undefined) throw new Error('No seeded agent is marked as holding the call.');

  for (const o of SUPERVISE_ORDERS) {
    /*
      RETIRE A SPENT ONE FORWARD rather than rewinding it (the D4 / B7
      rule). I3 forces CUSTOMER_DECLINED on the assigned entry, which is
      TERMINAL and append-only — the order lands REJECTED_BY_CUSTOMER,
      which is not in `REMOVABLE_STATUSES`, so the shared clearing
      correctly leaves it alone and the next run's create would collide
      on `sellerOrderRef`, which is unique per seller. Only its NAME
      moves; everything it carries stays exactly as the take left it.

      A take that did not reach the press leaves it PENDING_CONFIRMATION,
      which the clearing has already removed by the time this runs — so
      either way this ends with exactly one, freshly placed.
    */
    const spent = await prisma.order.findFirst({
      where: { sellerId, sellerOrderRef: o.ref },
      select: { id: true, orderNumber: true, status: true },
    });
    if (spent !== null) {
      const parked = await prisma.order.count({
        where: { sellerId, sellerOrderRef: { startsWith: `${o.ref}-SPENT-` } },
      });
      const retiredRef = `${o.ref}-SPENT-${parked + 1}`;
      await prisma.order.update({ where: { id: spent.id }, data: { sellerOrderRef: retiredRef } });
      console.log(
        `  · ${o.ref} is spent — ${spent.orderNumber} is ${spent.status}. ` +
          `Renamed ${retiredRef} and left intact; a fresh one follows`,
      );
    }

    const variant = await prisma.productVariant.findFirst({
      where: { skuCode: o.sku, product: { sellerId } },
      select: { id: true },
    });
    if (variant === null) {
      throw new Error(`No ${o.sku} for this seller — the catalogue seeding runs first.`);
    }
    const token = await sellerToken();
    const order = await call('/seller/orders', {
      method: 'POST',
      token,
      body: {
        recipientName: o.recipientName,
        recipientPhoneE164: o.phone,
        recipientAddressLine1: o.line1,
        recipientAddressLine2: o.line2,
        recipientPostalCode: o.postalCode,
        paymentMode: 'COD',
        codAmountInr: o.codAmountInr,
        sellerOrderRef: o.ref,
        items: [{ variantId: variant.id, quantity: 1, unitPriceInr: o.unitPriceInr }],
      },
    });
    // Submitting is what puts it on the queue (CC-6), post-commit — so
    // the row is a heartbeat behind the call that caused it.
    await call(`/seller/orders/${order.id}/submit`, { method: 'POST', token });
    const entry = await waitFor(`${o.ref} to reach the call queue`, () =>
      prisma.callQueueEntry.findFirst({
        where: { orderId: order.id, status: 'PENDING' },
        select: { id: true },
      }),
    );

    const waitedSince = new Date(Date.now() - o.waitedMinutes * 60_000);
    await prisma.callQueueEntry.update({
      where: { id: entry.id },
      data: {
        createdAt: waitedSince,
        availableAt: waitedSince,
        ...(o.assigned
          ? {
              status: 'ASSIGNED',
              assignedAgentId: holder.id,
              // Taken about an hour after it arrived, and never rung.
              assignedAt: new Date(waitedSince.getTime() + 60 * 60_000),
              scheduledAttempts: 1,
            }
          : {}),
      },
    });
    console.log(
      `  · ${order.orderNumber} (${o.ref}) waiting ${o.waitedMinutes}m` +
        (o.assigned ? ` — assigned to ${holder.email}, who is marked off` : ''),
    );
  }

  const assigned = await prisma.callQueueEntry.count({ where: { status: 'ASSIGNED' } });
  if (assigned !== 1) {
    throw new Error(
      `${assigned} ASSIGNED call-queue entries, and the flow reaches for "Reassign" by name — ` +
        'it renders on every assigned row, so anything but exactly one films the wrong parcel.',
    );
  }
}

/**
 * I4's world: two sellers asking us to ring a customer who said no.
 *
 * ── WHY IT DRIVES THE ORDER RATHER THAN WRITING THE ROW ──────────────
 * `REJECTED_BY_CUSTOMER` is where a re-attempt request is allowed from
 * (`orders.reattempt_requestable_statuses`, seeded to exactly that one),
 * and the honest way to an order in it is the way one really gets there:
 * an attempt recorded with outcome `CUSTOMER_DECLINED`. So each order is
 * placed, submitted, and then FORCED through the very endpoint I3 films
 * — `POST /admin/call-queue/:entryId/force-outcome` — which appends a
 * real `call_attempts` row (CC-1) under the ops account and moves the
 * order by the ordinary mapping (CC-2). Nothing here reaches past a
 * service to write a status.
 *
 * The request itself is then raised by the SELLER through the seller
 * endpoint, because the whole point of the screen is that a person asked
 * for this and gave a reason. A row inserted by hand would film a
 * request nobody made.
 *
 * ── RETIRED FORWARD, LIKE EVERY SPENT ORDER ──────────────────────────
 * Approving on camera puts the order back to PENDING_CONFIRMATION and
 * marks the request APPROVED; declining leaves it rejected. Either way
 * the world is used up, and either way the order is NOT rebuildable in
 * place — `REJECTED_BY_CUSTOMER` is outside `REMOVABLE_STATUSES`, and a
 * second request on an order that already has one is refused by the
 * partial unique (`REQUEST_ALREADY_OPEN`). So the order's NAME moves
 * aside and a fresh pair is built, which is the D4 / B7 rule again.
 *
 * ── AND IT ASSERTS THE LIST IS OURS ──────────────────────────────────
 * The screen opens on "waiting for a decision" and the video acts on
 * both cards, so a third request from somewhere else would put an
 * unnarrated card between them. Two, or it says so.
 */
const REATTEMPT_ORDERS = [
  {
    ref: 'RSH-REATTEMPT-1',
    sku: 'RSH-JAMDANI-IVORY',
    recipientName: 'Parvati Deshmukh',
    phone: '+919845080201',
    line1: '61, Richmond Road',
    line2: 'Beside the Baldwin girls school gate',
    postalCode: '560025',
    codAmountInr: '2400',
    unitPriceInr: '2400',
    declinedNotes: 'Said she had ordered by mistake and did not want it.',
    // ≥20 chars (CreateReattemptRequestDto). Written as a seller would
    // write it, because it is read out on camera.
    reason:
      'She rang our shop an hour later to say she had confused this with another order and does want the saree. Please try her once more.',
  },
  {
    ref: 'RSH-REATTEMPT-2',
    sku: 'RSH-MUSLIN-ROSE',
    recipientName: 'Tarun Ghoshal',
    phone: '+919845080202',
    line1: '3, Pottery Road',
    line2: 'Opposite the Frazer Town market',
    postalCode: '560005',
    codAmountInr: '1650',
    unitPriceInr: '1650',
    declinedNotes: 'Said the price was higher than he expected and refused it.',
    reason:
      'Customer only declined over the delivery charge. We will absorb it ourselves, so please put him back in the queue and call again today.',
  },
];

/**
 * M6 — two things a seller has asked us to do about a failed delivery,
 * and they are deliberately DIFFERENT KINDS of ask.
 *
 * A RE-ATTEMPT reaches Delhivery and dispatches a van at our cost. A
 * RECALL reaches no courier at all — it queues one of our own agents to
 * phone the customer. The video's whole spine is that those two sit in
 * one queue, look alike on the row, and cost wildly different things,
 * so the world needs one of each.
 *
 * ONE OPEN REQUEST PER ORDER (not per kind — the service takes an
 * advisory lock on the order and refuses a second), so they have to be
 * on two parcels. `RSH-LIFE-FAILED` is the ordinary case, the one the
 * driver could not hand over; `RSH-LIFE-OVERDUE` is still out for
 * delivery, which is allowed on purpose — "a seller who has just heard
 * from their customer that nobody is home should be able to say so
 * before the driver knocks".
 *
 * RAISED THROUGH THE SELLER'S OWN ENDPOINT as the seller, because the
 * queue prints the seller's words back and an operator reads them before
 * deciding. A row written round the back would have nothing to read.
 *
 * `clearDeliveryTakeArtefacts` DELETES every seller ask on every seed
 * run of every video, so this runs AFTER it in the per-video tailoring
 * and leaves nothing behind for anybody else. That is also what puts a
 * DECLINED request back: the take declines one, the next run removes the
 * decided row and raises a fresh one.
 */
const DELIVERY_ASKS = [
  {
    ref: 'RSH-LIFE-FAILED',
    action: 'REATTEMPT',
    reason:
      'The customer has rung us to say she was at work when the driver came and will be home all ' +
      'day tomorrow. Please ask them to try again.',
  },
  {
    ref: 'RSH-LIFE-OVERDUE',
    action: 'RECALL',
    reason:
      'Tracking says it is out for delivery but the customer is not answering our calls. Could one ' +
      'of your agents try her before the driver gets there?',
  },
];

async function deliveryAsksWorldFor(slug, sellerId, sellerToken) {
  if (slug !== 'acting-on-a-failed-delivery') return;

  const token = await sellerToken();
  for (const ask of DELIVERY_ASKS) {
    const order = await prisma.order.findFirst({
      where: { sellerId, sellerOrderRef: ask.ref },
      select: { id: true, orderNumber: true, status: true },
    });
    if (order === null) {
      throw new Error(`No ${ask.ref} — the lifecycle seeding runs before this and builds it.`);
    }
    /*
      A GATE RATHER THAN A HOPE. `DELIVERY_ACTION_STATUSES` is the
      server's list and it refuses anything outside it, so a parcel that
      has moved on since would fail inside the POST with a code nobody
      reads. Saying so here names the parcel instead.
    */
    if (order.status !== 'DELIVERY_FAILED' && order.status !== 'OUT_FOR_DELIVERY') {
      throw new Error(
        `${ask.ref} is ${order.status}; a delivery action can only be asked for on a parcel that ` +
          'is out for delivery or has failed one.',
      );
    }
    await call(`/seller/orders/${order.id}/delivery-actions`, {
      method: 'POST',
      token,
      body: { action: ask.action, reason: ask.reason },
    });
    console.log(`  · the seller has asked us to ${ask.action.toLowerCase()} ${order.orderNumber}`);
  }
}

async function reattemptWorldFor(slug, sellerId, sellerToken, staffToken) {
  if (slug !== 'sellers-asking-to-call-again') return;

  /*
    EVERY PREVIOUS TAKE'S REQUESTS GO FIRST, and that is not a detail:
    the video's last scene switches the filter to "all" and reads the
    two decisions it just made. A decided request is not removed by
    anything — the order it points at is retired forward, not deleted —
    so without this the list grows by one card per take and the second
    take narrates "both decisions" over three of them.

    Deleting them here is between-takes housekeeping rather than a
    product act: nothing in the app removes one, which is exactly what
    that scene says.
  */
  const cleared = await prisma.orderReattemptRequest.deleteMany({ where: { sellerId } });
  if (cleared.count > 0) {
    console.log(`  · removed ${cleared.count} re-attempt request(s) a previous take decided`);
  }

  for (const o of REATTEMPT_ORDERS) {
    const spent = await prisma.order.findFirst({
      where: { sellerId, sellerOrderRef: o.ref },
      select: { id: true, orderNumber: true, status: true },
    });
    if (spent !== null) {
      const parked = await prisma.order.count({
        where: { sellerId, sellerOrderRef: { startsWith: `${o.ref}-SPENT-` } },
      });
      const retiredRef = `${o.ref}-SPENT-${parked + 1}`;
      await prisma.order.update({ where: { id: spent.id }, data: { sellerOrderRef: retiredRef } });
      console.log(
        `  · ${o.ref} is spent — ${spent.orderNumber} is ${spent.status}. ` +
          `Renamed ${retiredRef} and left intact; a fresh one follows`,
      );
    }

    const variant = await prisma.productVariant.findFirst({
      where: { skuCode: o.sku, product: { sellerId } },
      select: { id: true },
    });
    if (variant === null) {
      throw new Error(`No ${o.sku} for this seller — the catalogue seeding runs first.`);
    }
    const token = await sellerToken();
    const order = await call('/seller/orders', {
      method: 'POST',
      token,
      body: {
        recipientName: o.recipientName,
        recipientPhoneE164: o.phone,
        recipientAddressLine1: o.line1,
        recipientAddressLine2: o.line2,
        recipientPostalCode: o.postalCode,
        paymentMode: 'COD',
        codAmountInr: o.codAmountInr,
        sellerOrderRef: o.ref,
        items: [{ variantId: variant.id, quantity: 1, unitPriceInr: o.unitPriceInr }],
      },
    });
    await call(`/seller/orders/${order.id}/submit`, { method: 'POST', token });

    const entry = await waitFor(`${o.ref} to reach the call queue`, () =>
      prisma.callQueueEntry.findFirst({
        where: { orderId: order.id, status: 'PENDING' },
        select: { id: true },
      }),
    );
    await call(`/admin/call-queue/${entry.id}/force-outcome`, {
      method: 'POST',
      token: staffToken,
      body: {
        outcome: 'CUSTOMER_DECLINED',
        startedAt: new Date(Date.now() - 90 * 60_000).toISOString(),
        endedAt: new Date(Date.now() - 89 * 60_000).toISOString(),
        outcomeNotes: o.declinedNotes,
      },
    });
    // The transition is POST-COMMIT of the attempt (CC-3), so the order
    // is a heartbeat behind the call that moved it.
    await waitFor(`${o.ref} to reach REJECTED_BY_CUSTOMER`, async () => {
      const row = await prisma.order.findUnique({
        where: { id: order.id },
        select: { status: true },
      });
      return row?.status === 'REJECTED_BY_CUSTOMER' ? row : null;
    });

    await call(`/seller/orders/${order.id}/reattempt-request`, {
      method: 'POST',
      token,
      body: { reason: o.reason },
    });
    console.log(`  · ${order.orderNumber} (${o.ref}) declined, and the seller has asked again`);
  }

  // BOTH LISTS, because the video reads both: it opens on "waiting for
  // a decision" and closes on "all". A third request from anywhere puts
  // an unnarrated card between the two this world is about.
  const waiting = await prisma.orderReattemptRequest.count({ where: { status: 'PENDING' } });
  const everything = await prisma.orderReattemptRequest.count();
  if (waiting !== REATTEMPT_ORDERS.length || everything !== REATTEMPT_ORDERS.length) {
    throw new Error(
      `${waiting} re-attempt request(s) waiting and ${everything} in all, expected ` +
        `${REATTEMPT_ORDERS.length} of each — the video acts on every card on this screen, ` +
        'so one from anywhere else would be filmed and never explained.',
    );
  }
}

async function cancelWorldFor(slug, sellerId, sellerToken) {
  if (slug !== 'cancelling-an-order') return;

  const spent = await prisma.order.findFirst({
    where: { sellerId, sellerOrderRef: CANCEL_PENDING.ref },
    select: { id: true, orderNumber: true, status: true },
  });
  if (spent !== null) {
    const parked = await prisma.order.count({
      where: { sellerId, sellerOrderRef: { startsWith: `${CANCEL_PENDING.ref}-SPENT-` } },
    });
    const retiredRef = `${CANCEL_PENDING.ref}-SPENT-${parked + 1}`;
    await prisma.order.update({ where: { id: spent.id }, data: { sellerOrderRef: retiredRef } });
    console.log(
      `  · ${CANCEL_PENDING.ref} is spent — ${spent.orderNumber} is ${spent.status}. ` +
        `Renamed ${retiredRef} and left intact; a fresh one follows`,
    );
  }

  const variant = await prisma.productVariant.findFirst({
    where: { skuCode: CANCEL_PENDING.sku, product: { sellerId } },
    select: { id: true },
  });
  if (variant === null) {
    throw new Error(`No ${CANCEL_PENDING.sku} for this seller — the catalogue seeding runs first.`);
  }
  const token = await sellerToken();
  const order = await call('/seller/orders', {
    method: 'POST',
    token,
    body: {
      recipientName: CANCEL_PENDING.recipientName,
      recipientPhoneE164: CANCEL_PENDING.phone,
      recipientAddressLine1: CANCEL_PENDING.line1,
      recipientAddressLine2: CANCEL_PENDING.line2,
      recipientPostalCode: CANCEL_PENDING.postalCode,
      paymentMode: 'COD',
      codAmountInr: CANCEL_PENDING.codAmountInr,
      sellerOrderRef: CANCEL_PENDING.ref,
      items: [{ variantId: variant.id, quantity: 1, unitPriceInr: CANCEL_PENDING.unitPriceInr }],
    },
  });
  // Submitting is what puts it in the call queue (CC-6), which is the
  // fact the dialog's own consequence line is about.
  await call(`/seller/orders/${order.id}/submit`, { method: 'POST', token });
  console.log(
    `  · placed ${order.orderNumber} (${CANCEL_PENDING.ref}) waiting on the call centre, for the cancel video`,
  );
}

/**
 * G6's world: a second reseller store with three orders on it, each
 * carrying something its seller has to answer.
 *
 * WHAT IT HAS TO BUILD, in the order it has to be built: a store user
 * who has actually SIGNED IN (a store whose invitation nobody accepted
 * can do nothing at all), the master switch `reseller.orders_enabled` —
 * seeded FALSE and fail-closed, because it guards money — terms
 * PUBLISHED and ACCEPTED (an order is refused until both,
 * `RESELLER_TERMS_NOT_READY`), one product enabled in the store's
 * catalogue at a price of its own, and a policy saying the seller wants
 * to see these tasks first. Only then can the store place anything.
 *
 * ── HOW IT STAYS RE-TAKEABLE ─────────────────────────────────────────
 * The video answers exactly two of the four rows, and WHICH two is a
 * seeding decision as much as a teaching one:
 *
 *   · it APPROVES the cancel, which ends that order — so that family
 *     gets a NEW order on the next run, numbered, and the spent one is
 *     left exactly as it is. Forward motion, never a rewind (the D4
 *     rule). It is also the cheapest order in the library to remake:
 *     nothing is reserved before confirmation (ORD-10).
 *   · it REJECTS the delivery ask, which changes NOTHING about the
 *     parcel — so the expensive one (a real courier booking, a warehouse
 *     run and two simulator scans) is re-used for ever and only the ask
 *     is raised again.
 *   · the issue and the order change are READ and not answered, so they
 *     stand from one take to the next.
 */
async function storeRequestsWorldFor(slug, sellerId, sellerToken, staffToken) {
  const wantsStore =
    STORE_ORDER_SLUGS.has(slug ?? '') ||
    STORE_REPORT_SLUGS.has(slug ?? '') ||
    STORE_DISPUTE_SLUGS.has(slug ?? '') ||
    STORE_DELIVERY_ASK_SLUGS.has(slug ?? '') ||
    STORE_PORTAL_SLUGS.has(slug ?? '');
  if (!wantsStore) return;
  const log = (m) => console.log(m);
  const world = await tradingStoreWorld(sellerId, sellerToken, staffToken, log);

  if (STORE_ORDER_SLUGS.has(slug ?? '')) {
    await ensureHeldCancel(sellerId, world.storeToken, world.variantId, log);
    await ensureHeldChangeAndIssue(sellerId, world.storeToken, world.variantId, log);
    await ensureHeldDeliveryAsk(sellerId, world.storeToken, staffToken, world.variantId, log);
  }
  if (STORE_REPORT_SLUGS.has(slug ?? '')) {
    await ensureSettledStoreOrders(sellerId, world, staffToken, log);
  }
  if (STORE_DISPUTE_SLUGS.has(slug ?? '')) {
    await ensureStoreDispute(sellerId, world, log);
  }
  if (STORE_DELIVERY_ASK_SLUGS.has(slug ?? '')) {
    await ensureHeldDeliveryAsk(sellerId, world.storeToken, staffToken, world.variantId, log);
  }
  if (STORE_PORTAL_SLUGS.has(slug ?? '')) {
    // The SAME call G7 makes, for the same reason: a status chip with no
    // count teaches nothing about what it is for, and an order detail
    // with no scans is a tracker drawn on nothing.
    await ensureSettledStoreOrders(sellerId, world, staffToken, log);
  }
}

/**
 * P3 — the reseller store's open dispute with its seller.
 *
 * Raised through the STORE's own endpoint as the STORE's user, because
 * who opened it is what the detail page draws the opening bubble from
 * (TKT-1's `openedBy`) and a dispute Skydrop raised against itself reads
 * as a different thing entirely.
 *
 * IT IS NEVER SETTLED HERE, and the video never settles it either —
 * `settleStoreDispute` is terminal and moves money between two wallets,
 * so a take that pressed it would need this to rebuild an order and a
 * dispute every run and would spend real wallet entries doing it. The
 * video opens the settle form, reads what it says, and leaves. So the
 * one thing this has to put back is a previous take's REPLY, below.
 *
 * Idempotent on the dispute, and on the order it hangs from: the order
 * is only remade if one is missing, because nothing in the video
 * changes its status.
 */
async function ensureStoreDispute(sellerId, world, log) {
  const spec = STORE_DISPUTE_ORDER;
  let order = await newestStoreOrder(sellerId, spec.family);
  if (order === null) {
    order = await placeStoreOrder(sellerId, world.storeToken, world.variantId, spec, log);
  }

  const existing = await prisma.ticket.findFirst({
    where: { orderId: order.id, ticketType: 'STORE_DISPUTE' },
    select: { id: true, ticketNumber: true, status: true },
  });
  if (existing === null) {
    const raised = await call('/store/tickets', {
      method: 'POST',
      token: world.storeToken,
      body: { orderId: order.id, subject: spec.subject, description: spec.body },
    });
    log(
      `  · ${REQUEST_STORE.displayName} has disputed ${order.orderNumber} (${raised.ticketNumber})`,
    );
    return;
  }

  /*
    A SETTLED dispute cannot be reopened (the matrix has no outbound
    edge from a resolution, and reopening one would mean re-arguing
    money that has already moved between two wallets). So if a take ever
    does settle it, the honest repair is a NEW dispute on a NEW order
    rather than a status written round the back — which is the same
    `retireSpentParcel` shape the lifecycle uses.
  */
  if (existing.status !== 'OPEN' && existing.status !== 'NEGOTIATING') {
    log(`  · ${existing.ticketNumber} is ${existing.status} — a fresh order and dispute follow`);
    const fresh = await placeStoreOrder(sellerId, world.storeToken, world.variantId, spec, log);
    const raised = await call('/store/tickets', {
      method: 'POST',
      token: world.storeToken,
      body: { orderId: fresh.id, subject: spec.subject, description: spec.body },
    });
    log(
      `  · ${REQUEST_STORE.displayName} has disputed ${fresh.orderNumber} (${raised.ticketNumber})`,
    );
    return;
  }
  log(`  · ${existing.ticketNumber} is still open on ${order.orderNumber}`);
}

/**
 * The store that TRADES, and everything it needs before it can.
 *
 * Shared by G6 and G7 rather than built twice: they film two halves of
 * one world — what the store has ASKED for, and how it has DONE — and
 * two copies of this would be two places for the terms, the catalogue
 * and the policy to drift apart.
 */
async function tradingStoreWorld(sellerId, sellerToken, staffToken, log) {
  const token = await sellerToken();
  const storeId = await ensureRequestStore(sellerId, token, log);
  const storeToken = await ensureStoreSession(storeId, log);

  await call(`/admin/sellers/${sellerId}/settings/${RESELLER_ORDERS_KEY}`, {
    method: 'PATCH',
    token: staffToken,
    body: {
      valueType: 'BOOLEAN',
      value: true,
      note: 'Tutorial demo world — the reseller-store videos place store orders.',
    },
  });

  await ensureStoreTerms(storeId, token, storeToken, log);
  const variantId = await ensureStoreCatalogue(sellerId, storeId, token, log);

  // What the seller wants to see first — the G5 lesson applied. Only a
  // task set to "ask me first" ever reaches G6's queue, so every row that
  // video films is a row this policy put there.
  await call(`/seller/reseller-stores/${storeId}/action-policy`, {
    method: 'PUT',
    token,
    body: {
      recall: 'DIRECT',
      orderChange: 'ASK_SELLER',
      cancel: 'ASK_SELLER',
      callCapDecision: 'ASK_SELLER',
      chaseSkydrop: 'ASK_SELLER',
      reattempt: 'ASK_SELLER',
      sendBack: 'ASK_SELLER',
    },
  });
  return { storeId, storeToken, sellerTok: token, variantId };
}

/** The store itself, opened through the real endpoint (`initialStatusFor`). */
async function ensureRequestStore(sellerId, sellerTok, log) {
  const existing = await prisma.sellerStore.findFirst({
    where: {
      sellerId,
      name: REQUEST_STORE.storeName,
      kind: 'RESELLER',
      deletedAt: null,
    },
    select: { id: true, status: true },
  });
  if (existing !== null) {
    // PAUSED refuses new orders (RS-1), and G6 places them.
    if (existing.status !== 'ACTIVE') {
      await call(`/seller/reseller-stores/${existing.id}/resume`, {
        method: 'POST',
        token: sellerTok,
      });
      log(`  · resumed "${REQUEST_STORE.storeName}" (it was ${existing.status})`);
    }
    return existing.id;
  }
  const created = await call('/seller/reseller-stores', {
    method: 'POST',
    token: sellerTok,
    body: {
      name: REQUEST_STORE.storeName,
      displayName: REQUEST_STORE.displayName,
      contactEmail: REQUEST_STORE.contactEmail,
      contactPhone: REQUEST_STORE.contactPhone,
      invite: {
        email: REQUEST_STORE.inviteEmail,
        fullName: REQUEST_STORE.inviteName,
        roleKey: 'owner',
      },
    },
  });
  log(`  · opened the "${REQUEST_STORE.storeName}" store`);
  return created.store?.id ?? created.id;
}

/**
 * A signed-in store user, and a token to act as them.
 *
 * THE INVITATION TOKEN IS NOT RECOVERABLE, and that is the interesting
 * part. `store_user_invitations.token` holds a SHA-256 of it; the
 * plaintext exists only in the email, and there is no mail here. So the
 * seeding mints a plaintext of its own, writes its hash onto the
 * invitation, and then goes through the PRODUCT'S OWN acceptance
 * endpoint with it — which is what creates the user, hashes the
 * password, attaches the role and opens the session. Only the delivery
 * of the token is faked; everything the endpoint does is real.
 *
 * On later runs the user exists, so the password is force-set (exactly
 * as `ensureSeller` does for the seller) and this signs in normally.
 */
async function ensureStoreSession(storeId, log) {
  const user = await prisma.storeUser.findFirst({
    where: { storeId, email: REQUEST_STORE.inviteEmail, deletedAt: null },
    select: { id: true },
  });
  if (user === null) {
    const invitation = await prisma.storeUserInvitation.findFirst({
      where: { storeId, email: REQUEST_STORE.inviteEmail, usedAt: null, deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    if (invitation === null) {
      throw new Error(
        `No open invitation for ${REQUEST_STORE.inviteEmail} — the store was opened without one, ` +
          'which the create DTO is supposed to refuse.',
      );
    }
    const plaintext = randomBytes(32).toString('base64url');
    await prisma.storeUserInvitation.update({
      where: { id: invitation.id },
      data: {
        token: createHash('sha256').update(plaintext, 'utf8').digest('hex'),
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    const session = await call('/auth/store/invitations/accept', {
      method: 'POST',
      body: {
        token: plaintext,
        password: REQUEST_STORE.password,
        fullName: REQUEST_STORE.inviteName,
      },
    });
    log(`  · ${REQUEST_STORE.inviteName} accepted her invitation to "${REQUEST_STORE.storeName}"`);
    return session.accessToken;
  }

  await prisma.storeUser.update({
    where: { id: user.id },
    data: { passwordHash: await hash(REQUEST_STORE.password), emailVerifiedAt: new Date() },
  });
  return storeLogin(log);
}

/**
 * Sign the store user in, clearing the local rate-limit counter if it
 * is what refused.
 *
 * Store login is throttled like every other (5 per 15 minutes per
 * email + IP), and a seed run costs one of those — so the third seed of
 * a quarter of an hour, which is exactly what "check, seed, check, seed,
 * take" produces, would otherwise be refused. The counter is the local
 * Redis one the recording pipeline already clears before every video.
 */
async function storeLogin(log) {
  const body = { email: REQUEST_STORE.inviteEmail, password: REQUEST_STORE.password };
  try {
    return (await call('/auth/store/login', { method: 'POST', body })).accessToken;
  } catch (e) {
    if (!/429|too many|ThrottlerException/i.test(String(e))) throw e;
    log('  · store sign-in was rate-limited; clearing the local counter and trying once more');
    await clearLoginThrottle({ log: () => {} });
    return (await call('/auth/store/login', { method: 'POST', body })).accessToken;
  }
}

/**
 * Terms published by the seller and accepted by the store.
 *
 * Both halves are required before a single order can be placed
 * (`orderReadiness`), and neither is something this can write by hand:
 * versions are numbered and append-only (RS-4), and the acceptance
 * records who accepted and from where. So it publishes only when there
 * is none, and accepts only when the version in force is unaccepted.
 */
async function ensureStoreTerms(storeId, sellerTok, storeTok, log) {
  const view = await call(`/seller/reseller-stores/${storeId}/terms`, { token: sellerTok });
  if (view.current === null || view.current === undefined) {
    await call(`/seller/reseller-stores/${storeId}/terms`, {
      method: 'POST',
      token: sellerTok,
      body: {
        deliveryFeeStorePercent: '50',
        returnFeeStorePercent: '40',
        customerReturnFeeStorePercent: '100',
        codFeeStorePercent: '50',
        codTaxStorePercent: '100',
        instantPayFeeStorePercent: '100',
        storeCreditTrigger: 'AFTER_DELIVERY',
        storeCreditDays: 3,
        sellerCreditTrigger: 'AFTER_DELIVERY',
        sellerCreditDays: 3,
        note: 'Opening terms.',
        basedOnVersion: 0,
      },
    });
    log(`  · published version 1 of "${REQUEST_STORE.storeName}"’s terms`);
  }
  const mine = await call('/store/terms', { token: storeTok });
  const current = mine.current;
  // `acceptance`, not `acceptedAt` — the version view carries WHO
  // accepted and when as an object, and reading a key that is not there
  // made this re-accept on every run and say so in the log.
  if (current != null && current.acceptance == null) {
    await call(`/store/terms/${current.id}/accept`, { method: 'POST', token: storeTok });
    log(`  · the store accepted version ${current.version}`);
  }
}

/** One product, enabled for this store at a price of its own. */
async function ensureStoreCatalogue(sellerId, storeId, sellerTok, log) {
  const variant = await prisma.productVariant.findFirst({
    where: { skuCode: REQUEST_STORE.sku, product: { sellerId } },
    select: { id: true },
  });
  if (variant === null) {
    throw new Error(`No ${REQUEST_STORE.sku} for this seller — the catalogue seeding runs first.`);
  }
  // A price OF ITS OWN rather than the seller's default list, so this
  // store's catalogue does not depend on what G2's take last did to that
  // list — G2 clears a default price on every run.
  await call(`/seller/reseller-stores/${storeId}/catalogue/${variant.id}`, {
    method: 'PUT',
    token: sellerTok,
    body: {
      enabled: true,
      priceOverride: {
        transferPriceInr: REQUEST_STORE.transferPriceInr,
        minRetailInr: REQUEST_STORE.minRetailInr,
        maxRetailInr: REQUEST_STORE.maxRetailInr,
        suggestedRetailInr: REQUEST_STORE.suggestedRetailInr,
      },
      stockMode: 'SHARED',
      hiddenPercent: 0,
    },
  });
  log(`  · ${REQUEST_STORE.sku} is on "${REQUEST_STORE.storeName}"’s shelf`);
  return variant.id;
}

/** The newest order of one family, whatever became of it. */
async function newestStoreOrder(sellerId, family) {
  return prisma.order.findFirst({
    where: { sellerId, sellerOrderRef: { startsWith: `${family}-` } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, orderNumber: true, status: true, sellerOrderRef: true },
  });
}

/** Place one, numbered after whatever is already parked under that family. */
async function placeStoreOrder(sellerId, storeTok, variantId, spec, log) {
  const placed = await prisma.order.count({
    where: { sellerId, sellerOrderRef: { startsWith: `${spec.family}-` } },
  });
  const order = await call('/store/orders', {
    method: 'POST',
    token: storeTok,
    body: {
      recipientName: spec.recipientName,
      recipientPhoneE164: spec.phone,
      recipientAddressLine1: spec.line1,
      // ORD-5: line two is the LANDMARK and is required.
      recipientAddressLine2: spec.line2,
      recipientPostalCode: spec.postalCode,
      paymentMode: 'COD',
      // The RETAIL the store sells at — per spec, because a store may
      // sell two products and each has its own range; sending one
      // product's suggestion for another is refused by name
      // (`RETAIL_OUT_OF_RANGE`), which is the check doing its job.
      codAmountInr: spec.retailInr ?? REQUEST_STORE.suggestedRetailInr,
      sellerOrderRef: `${spec.family}-${placed + 1}`,
      items: [
        {
          variantId,
          quantity: 1,
          retailUnitPriceInr: Number(spec.retailInr ?? REQUEST_STORE.suggestedRetailInr),
        },
      ],
    },
  });
  log(
    `  · ${REQUEST_STORE.displayName} placed ${order.orderNumber} (${spec.family}-${placed + 1})`,
  );
  return { id: order.id, orderNumber: order.orderNumber, status: order.status };
}

/** Is one of this store's held requests still waiting for an answer? */
async function hasPendingRequest(orderId, kind) {
  const row = await prisma.storeOrderRequest.findFirst({
    where: { orderId, kind, status: 'PENDING' },
    select: { id: true },
  });
  return row !== null;
}

/**
 * The held CANCEL — the row the video APPROVES.
 *
 * Approving ends the order, so this family is remade whenever the one
 * it finds is no longer callable off. The spent one keeps its number and
 * its history and is simply not this video's order any more.
 */
async function ensureHeldCancel(sellerId, storeTok, variantId, log) {
  const spec = STORE_REQUEST_ORDERS.cancel;
  let order = await newestStoreOrder(sellerId, spec.family);
  if (order !== null && order.status !== 'PENDING_CONFIRMATION') {
    log(
      `  · ${order.sellerOrderRef} is ${order.status} — a previous take answered it; a fresh one follows`,
    );
    order = null;
  }
  if (order === null) order = await placeStoreOrder(sellerId, storeTok, variantId, spec, log);
  if (await hasPendingRequest(order.id, 'CANCEL')) {
    log(`  · ${order.orderNumber} already has a cancel waiting`);
    return;
  }
  await call(`/store/orders/${order.id}/cancel`, {
    method: 'POST',
    token: storeTok,
    body: { reason: 'CUSTOMER_REQUESTED', note: spec.note },
  });
  log(`  · the store has asked to call ${order.orderNumber} off`);
}

/**
 * The held ORDER CHANGE and the held ISSUE, both on one order.
 *
 * Neither is answered on camera, so this order is stable across takes
 * and only tops up whichever request is missing. They can share an order
 * because they are different things in different tables — the one-open
 * rule is per KIND for a request and per ORDER for a correction.
 */
async function ensureHeldChangeAndIssue(sellerId, storeTok, variantId, log) {
  const spec = STORE_REQUEST_ORDERS.change;
  let order = await newestStoreOrder(sellerId, spec.family);
  if (order !== null && order.status !== 'PENDING_CONFIRMATION') {
    log(`  · ${order.sellerOrderRef} is ${order.status} — a fresh one follows`);
    order = null;
  }
  if (order === null) order = await placeStoreOrder(sellerId, storeTok, variantId, spec, log);

  const openChange = await prisma.storeAddressChangeRequest.findFirst({
    where: { orderId: order.id, status: { in: ['PENDING', 'APPROVED'] } },
    select: { id: true },
  });
  if (openChange === null) {
    // Only the fields that really DIFFER. A patch carrying a value the
    // order already holds renders "9, Church Street → 9, Church Street"
    // on the queue, which is a before-and-after that teaches the
    // opposite of what it is there for.
    await call(`/store/orders/${order.id}/recipient`, {
      method: 'PATCH',
      token: storeTok,
      body: {
        recipientAddressLine2: spec.newLine2,
        recipientPhoneE164: spec.newPhone,
        reason: spec.reason,
      },
    });
    log(`  · the store has asked to correct ${order.orderNumber}`);
  }

  if (!(await hasPendingRequest(order.id, 'RAISE_ISSUE'))) {
    await call('/store/issues', {
      method: 'POST',
      token: storeTok,
      body: { orderId: order.id, subject: spec.issueSubject, description: spec.issueBody },
    });
    log(`  · the store has asked to raise an issue on ${order.orderNumber}`);
  }
}

/**
 * The held DELIVERY ASK — the row the video TURNS DOWN.
 *
 * Its parcel is the expensive one: a real waybill against the local
 * simulator, a pick, the pack bench, a handover scan and two scans on
 * the road, because `DeliveryActionService.request` refuses anything
 * that is not out for delivery or freshly failed. Turning the ask down
 * leaves all of that untouched, so the parcel is re-used and only the
 * ask is raised again — which is why the video rejects this one and
 * approves the cheap one.
 */
async function ensureHeldDeliveryAsk(sellerId, storeTok, staffToken, variantId, log) {
  const spec = STORE_REQUEST_ORDERS.delivery;
  const usable = new Set(['OUT_FOR_DELIVERY', 'DELIVERY_FAILED']);
  let order = await newestStoreOrder(sellerId, spec.family);

  // A parcel the courier has already been told to return is spent: its
  // status does not move when that happens (CUR-11), so the status alone
  // cannot tell. `courierCancelledAt` is stamped only on a real reply.
  const turnedRound =
    order === null
      ? false
      : (await prisma.shipment.findFirst({
          where: {
            orderShipments: { some: { orderId: order.id } },
            supersededAt: null,
            courierCancelledAt: { not: null },
          },
          select: { id: true },
        })) !== null;

  if (order !== null && (turnedRound || !RESUMABLE_TO_DELIVERY.has(order.status))) {
    log(
      `  · ${order.sellerOrderRef} is ${order.status}${turnedRound ? ' and already turned round' : ''}` +
        ' — a fresh parcel follows',
    );
    order = null;
  }
  if (order === null) order = await placeStoreOrder(sellerId, storeTok, variantId, spec, log);

  if (!usable.has(order.status)) {
    console.log('\nDriving the store’s parcel out for delivery (this takes a minute)…');
    const out = await driveOrderToOutForDelivery({ orderId: order.id, staffToken, log });
    if (!usable.has(out.status ?? '')) {
      throw new Error(
        `The store's parcel is ${out.status}, not out for delivery — a delivery ask cannot be raised on it.`,
      );
    }
  }

  const pending = await prisma.orderDeliveryActionRequest.findFirst({
    where: { orderId: order.id, status: 'PENDING', needsSellerApproval: true },
    select: { id: true },
  });
  if (pending !== null) {
    log(`  · ${order.orderNumber} already has a delivery ask waiting`);
    return;
  }
  await call(`/store/orders/${order.id}/actions`, {
    method: 'POST',
    token: storeTok,
    body: { action: 'RTO', reason: spec.reason },
  });
  log(`  · the store has asked for ${order.orderNumber} to be sent back`);
}

/**
 * G7's world: two store orders whose FATE IS KNOWN — one delivered, one
 * come back and restocked.
 *
 * The scorecards divide by outcomes, not by orders (`reseller-scorecard.ts`:
 * a delivery rate over delivered + returned + lost, never over everything
 * placed), so a store whose parcels are all still moving has four dashes
 * where its rates should be. G6's world leaves exactly that: two cancels,
 * one order waiting on a call and one parked out for delivery for ever,
 * because G6's take re-uses it.
 *
 * THESE TWO ARE NEVER ANSWERED, ANSWERABLE OR SPENT. G7's take writes one
 * thing — the auto-pause rule — and touches no order at all, so the pair
 * is built once and stands. They are also the most expensive rows in this
 * file: a courier booking, a warehouse run and a full set of scans each,
 * and the returned one goes through the returns bench as well. Idempotent
 * and forward-only, exactly as the D0 parcels are.
 *
 * TWO DIFFERENT PRODUCTS, ON PURPOSE. Margin needs a unit cost, and the
 * cost is not known for every line — which is why every margin figure on
 * that page carries how many lines it could price (TRE-6's rule applied
 * to a store). One product is received WITH a cost and one without, so
 * the coverage figure reads one of two rather than none of two or all of
 * them: a partial, which is the state the column exists for.
 */
async function ensureSettledStoreOrders(sellerId, world, staffToken, log) {
  const second = await ensureSecondStoreProduct(sellerId, world, log);

  /*
    G7 SAVES the auto-pause rule on camera, so the row it opens on must
    read "Off" — and the dialog behind it must open on Skydrop's own
    defaults rather than on the last take's figures. Deleting the row is
    exactly right rather than merely convenient: the page draws a missing
    row AS "Off" and the dialog falls back to the defaults, so removing
    it is not switching the rule off, it is putting the store back to one
    nobody has configured. The same shape as G5's action policy.
  */
  const rule = await prisma.resellerStoreAutoPause.deleteMany({
    where: { storeId: world.storeId },
  });
  if (rule.count > 0) {
    log('  · removed a previous take’s auto-pause rule');
  }

  for (const spec of [STORE_REPORT_ORDERS.delivered, STORE_REPORT_ORDERS.returned]) {
    const variantId = spec.sku === REQUEST_STORE.sku ? world.variantId : second;
    if (variantId === null) {
      log(`  · no ${spec.sku} for this seller — skipping ${spec.family}`);
      continue;
    }
    let order = await newestStoreOrder(sellerId, spec.family);
    if (order !== null && order.status !== spec.want) {
      if (SETTLED_UNREACHABLE.has(order.status)) {
        log(
          `  · ${order.sellerOrderRef} is ${order.status}, not ${spec.want} — a fresh one follows`,
        );
        order = null;
      }
    }
    if (order === null) {
      order = await placeStoreOrder(sellerId, world.storeToken, variantId, spec, log);
    }
    if (order.status === spec.want) {
      log(`  · ${order.sellerOrderRef} is already ${spec.want}`);
      continue;
    }
    console.log(`\nDriving ${spec.family} to ${spec.want} (this takes a minute)…`);
    const out = await driveOrderThrough({
      orderId: order.id,
      staffToken,
      log,
      want: spec.want,
      stages: spec.stages,
      disposition: spec.disposition ?? null,
    });
    if (out.status !== spec.want) {
      throw new Error(`${spec.family} is ${out.status}, not ${spec.want}.`);
    }
    log(`  · ${order.orderNumber} → ${out.status}`);
  }
}

/**
 * A SECOND product on the store's shelf, deliberately without a recorded
 * unit cost.
 *
 * `ensureStockedVariant` receives the first one WITH a cost (see
 * `CATALOGUE`), so the reports page can show a real margin; this one has
 * none, so the coverage figure beside that margin reads a partial rather
 * than a full house. A page whose every figure is complete cannot teach
 * what the incomplete ones look like.
 */
async function ensureSecondStoreProduct(sellerId, world, log) {
  const variant = await prisma.productVariant.findFirst({
    where: { skuCode: REQUEST_STORE.secondSku, product: { sellerId } },
    select: { id: true },
  });
  if (variant === null) return null;
  await call(`/seller/reseller-stores/${world.storeId}/catalogue/${variant.id}`, {
    method: 'PUT',
    token: world.sellerTok,
    body: {
      enabled: true,
      priceOverride: {
        transferPriceInr: REQUEST_STORE.secondTransferPriceInr,
        minRetailInr: REQUEST_STORE.secondMinRetailInr,
        maxRetailInr: REQUEST_STORE.secondMaxRetailInr,
        suggestedRetailInr: REQUEST_STORE.secondSuggestedRetailInr,
      },
      stockMode: 'SHARED',
      hiddenPercent: 0,
    },
  });
  log(`  · ${REQUEST_STORE.secondSku} is on "${REQUEST_STORE.storeName}"’s shelf too`);
  return variant.id;
}

/**
 * States a settled parcel cannot be carried on from, so a NEW one is
 * built instead.
 *
 * Everything else is resumed where it stands — these two are expensive
 * and are never rewound. A parcel that reached a different terminal
 * (cancelled, rejected, written off) is not the row G7 needs and cannot
 * be turned into it, so it is left exactly as it is and replaced.
 */
const SETTLED_UNREACHABLE = new Set([
  'CANCELLED',
  'CANCELLED_BY_ADMIN',
  'REJECTED_BY_CUSTOMER',
  'REJECTED_NDR',
  'RTO_DAMAGED',
  'LOST_IN_TRANSIT',
  'OUT_OF_STOCK',
  'DELIVERED',
  'RTO_RESTOCKED',
]);

/**
 * States the delivery parcel can be carried forward from.
 *
 * Deliberately narrower than the lifecycle's own list: a parcel already
 * delivered, returned or cancelled cannot be asked about, and picking up
 * one abandoned mid-warehouse is how a seed corrupts stock.
 */
const RESUMABLE_TO_DELIVERY = new Set([
  'PENDING_CONFIRMATION',
  'CALL_NO_RESPONSE',
  'CALL_RESCHEDULED',
  'CONFIRMED',
  'DISPATCHED',
  'OUT_FOR_DELIVERY',
  'DELIVERY_FAILED',
]);

/**
 * Undo the CATALOGUE IMPORT video, which leaves more behind than any
 * other: products, variants, an import job, a saved column mapping and
 * an object in mock storage.
 *
 * Its whole subject is a file whose headers are the SELLER's rather than
 * ours, so a second take must find none of those products and no mapping
 * — a saved mapping is applied to every later import by default, which
 * would make the second take's preview match columns the first take had
 * to teach it.
 *
 * Products go by their own reference, which is what the importer matches
 * on (`productExternalRef`), and only when nothing has been ordered
 * against them.
 */
async function clearCatalogueImport(sellerId) {
  const products = await prisma.product.findMany({
    where: { sellerId, externalRef: { in: CATALOGUE_IMPORT.productRefs } },
    select: { id: true, variants: { select: { id: true } } },
  });
  if (products.length > 0) {
    const variantIds = products.flatMap((p) => p.variants.map((v) => v.id));
    const referenced =
      variantIds.length === 0
        ? 0
        : await prisma.orderItem.count({ where: { variantId: { in: variantIds } } });
    if (referenced > 0) {
      console.log(
        `  · leaving the imported catalogue alone — ${referenced} order line(s) point at it`,
      );
    } else {
      await prisma.$transaction([
        prisma.productImage.deleteMany({ where: { variantId: { in: variantIds } } }),
        prisma.stockLevel.deleteMany({ where: { variantId: { in: variantIds } } }),
        prisma.productVariant.deleteMany({ where: { id: { in: variantIds } } }),
        prisma.product.deleteMany({ where: { id: { in: products.map((p) => p.id) } } }),
      ]);
      console.log(
        `  · removed a previous take's ${products.length} imported product(s), ${variantIds.length} SKU(s)`,
      );
    }
  }

  const uploads = await prisma.bulkProductUpload.deleteMany({ where: { sellerId } });
  if (uploads.count > 0) {
    console.log(`  · removed ${uploads.count} catalogue import job(s) from a previous take`);
  }

  const mappings = await prisma.sellerCsvMapping.deleteMany({
    where: { sellerId, name: CATALOGUE_IMPORT.mappingName },
  });
  if (mappings.count > 0) {
    console.log(`  · removed a previous take's "${CATALOGUE_IMPORT.mappingName}" column mapping`);
  }

  // Keep in step with `buildCsvKey` (`sellers/<id>/csv-imports/...`).
  const bucket = process.env.SPACES_BUCKET ?? 'skydrop-storage';
  const dir = path.join(MOCK_ROOT, bucket, 'sellers', sellerId, 'csv-imports');
  const files = await fs.readdir(dir).catch(() => null);
  if (files !== null && files.length > 0) {
    await fs.rm(dir, { recursive: true, force: true });
    console.log(`  · removed ${files.length} stale catalogue CSV object(s)`);
  }
}

/**
 * Remove the product the second video creates, so the take can create it
 * again. Hard delete: these rows are minutes old, carry no stock and no
 * order, and a soft delete would leave the SKU's unique key occupied —
 * which is exactly what a re-take would collide on.
 */
async function clearTutorialProduct(sellerId) {
  const products = await prisma.product.findMany({
    where: {
      sellerId,
      OR: [{ name: TUTORIAL_PRODUCT.name }, { externalRef: TUTORIAL_PRODUCT.externalRef }],
    },
    select: { id: true, variants: { select: { id: true } } },
  });
  if (products.length === 0) return;

  const variantIds = products.flatMap((p) => p.variants.map((v) => v.id));
  const referenced =
    variantIds.length === 0
      ? 0
      : await prisma.orderItem.count({ where: { variantId: { in: variantIds } } });
  if (referenced > 0) {
    throw new Error(
      `"${TUTORIAL_PRODUCT.name}" has order lines against it — refusing to delete. ` +
        'Rename the tutorial product here and in narration.mjs, or clear those orders by hand.',
    );
  }

  await prisma.$transaction([
    prisma.productImage.deleteMany({ where: { variantId: { in: variantIds } } }),
    prisma.productVariant.deleteMany({ where: { id: { in: variantIds } } }),
    prisma.product.deleteMany({ where: { id: { in: products.map((p) => p.id) } } }),
  ]);
  console.log(
    `  · removed a previous take's "${TUTORIAL_PRODUCT.name}" (${variantIds.length} variants)`,
  );
}

/**
 * Remove the orders a previous take placed, and the customer they
 * created. Hard delete, for the same reason the tutorial product is:
 * these rows are minutes old, nothing has shipped, and what is wanted is
 * a world identical to the one the first take filmed.
 *
 * Only PRE-DISPATCH orders are removable. Anything further along has
 * stock movements and money behind it and is left alone with a warning —
 * on a local dev box that means somebody has been using this seller for
 * something else, and quietly deleting their work would be worse than a
 * duplicate-order dialog on camera.
 */
const REMOVABLE_STATUSES = ['DRAFT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'AWAITING_COURIER'];

async function clearPreviousOrders(sellerId) {
  const orders = await prisma.order.findMany({
    // The LIFECYCLE parcels are the seeded world, not a previous take's
    // leftovers, and two of them (CONFIRMED and AWAITING_SELLER_DECISION)
    // sit in statuses this function would otherwise delete. Rebuilding
    // them costs a real courier booking and a warehouse run; leaving them
    // costs nothing, because each is keyed on its own reference and the
    // lifecycle pass skips one it finds already in the right state.
    //
    // The PREFIX, not only the exact refs. D4's two parcels are spent by
    // their own take and retired to `<ref>-SPENT-<n>` rather than
    // unwound (see `retireSpentParcel`), so the family grows by one per
    // take. Every one is past dispatch and would be "left alone" by the
    // status filter below anyway — but named, one line per take, in a
    // log whose job is to say what a take left behind.
    where: {
      sellerId,
      NOT: { OR: PROTECTED_REF_PREFIXES.map((p) => ({ sellerOrderRef: { startsWith: p } })) },
    },
    select: { id: true, orderNumber: true, status: true },
  });
  if (orders.length === 0) return;

  const removable = orders.filter((o) => REMOVABLE_STATUSES.includes(o.status));
  const kept = orders.filter((o) => !REMOVABLE_STATUSES.includes(o.status));
  if (kept.length > 0) {
    console.log(
      `  · leaving ${kept.length} order(s) past dispatch alone: ${kept
        .map((o) => `${o.orderNumber} (${o.status})`)
        .join(', ')}`,
    );
  }
  if (removable.length === 0) return;

  const ids = removable.map((o) => o.id);
  try {
    await prisma.$transaction([
      prisma.orderCharge.deleteMany({ where: { orderId: { in: ids } } }),
      prisma.callQueueEntry.deleteMany({ where: { orderId: { in: ids } } }),
      /*
        I4's LANDMINE, and it is the MUST #12 shape one level along:
        `order_reattempt_requests` FKs `orders` with RESTRICT, and
        APPROVING a re-attempt puts its order back to
        PENDING_CONFIRMATION — the first entry in `REMOVABLE_STATUSES`.
        So the take that films an approval leaves an order this function
        will try to delete and a request row that refuses to let it, and
        the NEXT run dies here rather than in the video's own seeding.
        The request is about an order that is being removed, so it goes
        with it.

        **When a tutorial's take creates a row that FKs `orders`, add it
        here in the same commit.** The catch below is the backstop, not
        a substitute: it names the table instead of printing a wall of
        Prisma.
      */
      prisma.orderReattemptRequest.deleteMany({ where: { orderId: { in: ids } } }),
      prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } }),
      prisma.orderEvent.deleteMany({ where: { orderId: { in: ids } } }),
      prisma.order.deleteMany({ where: { id: { in: ids } } }),
    ]);
  } catch (e) {
    // Both shapes: a row pointing at the ORDER, and one pointing at an
    // order ITEM (`stock_reservations`, which is what a confirmation
    // leaves behind).
    const blocked = /foreign key constraint "([a-z_]+)_order_(?:item_)?id_fkey"/.exec(String(e));
    if (blocked !== null) {
      throw new Error(
        `Cannot clear a previous take's orders: rows in "${blocked[1]}" reference them and that ` +
          'foreign key is RESTRICT. A take created them; add a deleteMany for that table to ' +
          '`clearPreviousOrders`, beside the others, so the next run starts from the same world.',
      );
    }
    throw e;
  }
  console.log(`  · removed a previous take's ${removable.length} order(s)`);

  // The customer row outlives the order and makes the recipient panel
  // show a history the first take did not have.
  const gone = await prisma.customer.deleteMany({
    where: {
      sellerId,
      phoneE164: { in: [TUTORIAL_CUSTOMER.phoneE164, ...TUTORIAL_CSV_CUSTOMERS] },
    },
  });
  if (gone.count > 0) console.log(`  · removed ${gone.count} demo customer record(s)`);
}

/**
 * Remove the bulk imports a previous take ran, and the CSVs they were
 * run from.
 *
 * The orders those imports CREATED are already gone: `clearPreviousOrders`
 * above removes every pre-dispatch order of this seller, and a
 * freshly-imported order is PENDING_CONFIRMATION — the first entry in
 * `REMOVABLE_STATUSES`. So the references are cleared before this runs and
 * nothing here has to reason about them. What it removes is the IMPORT
 * RECORD itself, which the "Recent imports" table on camera lists newest
 * first: leave it and the second take opens on a table already holding the
 * first take's run, and the scene that says "no imports yet" is a lie.
 *
 * `staged_order_rows` cascade from the upload, but they are deleted
 * EXPLICITLY here: they FK `sellers` with RESTRICT as well, so leaving
 * them to the cascade would make this depend on delete order rather than
 * saying what it means.
 *
 * The CSV itself lives in local object storage (DEV_MOCK_SPACES), under
 * the seller's own `order-imports/` prefix — the uploaded file AND the
 * error report the worker writes beside it. Both go, because the external
 * references in the fixture are re-used by every take and an orphaned
 * object is the one piece of a previous run nothing else would clear.
 */
/**
 * Remove what a SECTION D take leaves on the lifecycle parcels.
 *
 * The D parcels themselves are never rebuilt (they cost a real courier
 * booking and a warehouse run, and `clearPreviousOrders` excludes them),
 * so anything a take WRITES ON one of them survives into the next take
 * unless it is cleared here — which is exactly the trap the bulk-import
 * video's "Recent imports" table was:
 *
 *   · the "Ask admin to act" request D2 sends. Leave it and the second
 *     take opens on "What you asked for" already holding the first
 *     take's card, so the scene that says "and there it is" shows two.
 *   · the issue D6 raises on camera. Leave it and the register opens on
 *     four tickets where the narration says what the two kinds are.
 *
 * The SCRAP_DAMAGE ticket is deliberately kept: it is the seeded world
 * (opened by the RTO inspection, settled with a refund by the lifecycle
 * pass), and re-raising it would mean re-running the warehouse leg.
 */
async function clearDeliveryTakeArtefacts(sellerId) {
  const orders = await prisma.order.findMany({ where: { sellerId }, select: { id: true } });
  const ids = orders.map((o) => o.id);
  if (ids.length > 0) {
    const asks = await prisma.orderDeliveryActionRequest.deleteMany({
      // The SELLER's own asks only. A reseller store's held ask is not
      // a take's leftover — it is G6's seeded world, and sweeping it
      // here would half-dismantle that world on every OTHER video's seed
      // run, leaving a queue the G6 seeding then has to rebuild.
      where: { orderId: { in: ids }, resellerStoreId: null },
    });
    if (asks.count > 0) {
      console.log(`  · removed a previous take's ${asks.count} delivery-action request(s)`);
    }
  }

  // A seller's own SELLER_ASKED call, queued by the recall D2 sends.
  // Legitimate product state, and one more of it per take.
  if (ids.length > 0) {
    const calls = await prisma.callQueueEntry.deleteMany({
      where: { orderId: { in: ids }, reason: { in: ['SELLER_ASKED', 'STORE_ASKED'] } },
    });
    if (calls.count > 0) {
      console.log(`  · removed a previous take's ${calls.count} requested call(s)`);
    }
  }

  // `ticket_events` is append-only by construction, so there is no
  // service path that removes a ticket — a take's own row goes by hand,
  // children first.
  //
  // BOTH kinds a take can raise: "Raise an issue" opens a
  // SELLER_RAISED_ISSUE, and so does a RECALL; a REATTEMPT opens a
  // COURIER_NDR_ESCALATION with a courier thread hanging off it (which
  // cascades from the ticket). SCRAP_DAMAGE and RECEIPT_SHORTFALL are
  // OURS and are the seeded world, so they stay.
  const raised = await prisma.ticket.findMany({
    where: { sellerId, ticketType: { in: ['SELLER_RAISED_ISSUE', 'COURIER_NDR_ESCALATION'] } },
    select: { id: true, ticketNumber: true },
  });
  if (raised.length > 0) {
    const ticketIds = raised.map((t) => t.id);
    await prisma.$transaction([
      prisma.ticketEvent.deleteMany({ where: { ticketId: { in: ticketIds } } }),
      prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } }),
    ]);
    console.log(`  · removed a previous take's ${raised.length} seller-raised ticket(s)`);
  }

  /*
    P2 RECORDS A SCAN BY HAND, on D0's failed parcel.

    `ManualTrackingService` writes a `tracking_events` row with
    `source = MANUAL_ENTRY` and, for a DELIVERY_ATTEMPTED scan, a
    `delivery_attempts` row beside it (TRK-4 keeps the attempt even when
    it skips the transition). Neither is undone by anything, so a second
    take would open on a parcel with two failed attempts under a line
    about one — and the NDR readiness strip prints that count.

    SCOPED TO THAT ONE PARCEL. `RSH-LIFE-OVERDUE` is BUILT from
    back-dated MANUAL_ENTRY scans (it is the one parcel the simulator
    cannot produce), so a sweep of every hand-entered event on this
    seller would delete the world instead of a take's leftovers.

    `webhookId: null` is what tells a hand-recorded attempt from the
    simulator's: every webhook-driven one carries the row it came from.
  */
  const failed = await prisma.order.findFirst({
    where: { sellerId, sellerOrderRef: 'RSH-LIFE-FAILED' },
    select: { orderShipments: { select: { shipmentId: true } } },
  });
  const failedShipments = (failed?.orderShipments ?? []).map((l) => l.shipmentId);
  if (failedShipments.length > 0) {
    const events = await prisma.trackingEvent.deleteMany({
      where: { shipmentId: { in: failedShipments }, source: 'MANUAL_ENTRY' },
    });
    const attempts = await prisma.deliveryAttempt.deleteMany({
      where: { shipmentId: { in: failedShipments }, webhookId: null },
    });
    if (events.count > 0 || attempts.count > 0) {
      console.log(
        `  · removed a previous take's ${events.count} hand-recorded scan(s) and ` +
          `${attempts.count} attempt row(s) on RSH-LIFE-FAILED`,
      );
    }
  }

  await clearTicketReplies(sellerId);
}

/**
 * P3 REPLIES ON A TICKET, and a reply is a `ticket_events` row.
 *
 * The History panel is on screen in that video, and the conversation is
 * the whole first half of it — so a take's reply left behind would give
 * the next one a thread that already contains the sentence it is about
 * to type, said by us, a take ago. Four takes in, the ticket reads like
 * a chatbot.
 *
 * `ticket_events` is APPEND-ONLY BY CONSTRUCTION (TKT-1): there is no
 * service path that removes one, which is right for the product and is
 * why this goes through Prisma, exactly as the seller-raised tickets a
 * few lines up do.
 *
 * SCOPED THREE WAYS, and each one matters. Only the tickets P3 touches
 * — the India-leg shortfall it replies on and the store dispute it
 * reads — because every OTHER ticket's history is somebody's seeded
 * world (TK-…0001's refund conversation is D6's whole subject). Only
 * STAFF events, because a shortfall is opened by SYSTEM and a dispute by
 * the STORE, so nothing we seed on either is ours and anything that is
 * came from a take. And only events that CHANGED NO STATUS, which is
 * what a reply is — a transition is the ticket's life and deleting one
 * would leave a status with nothing behind it explaining it.
 *
 * The status comparison is done HERE rather than in the query: Prisma
 * cannot compare two columns in a `where`, and these are a handful of
 * rows on two tickets.
 */
async function clearTicketReplies(sellerId) {
  const tickets = await prisma.ticket.findMany({
    where: { sellerId, ticketType: { in: ['RECEIPT_SHORTFALL', 'STORE_DISPUTE'] } },
    select: { id: true },
  });
  if (tickets.length === 0) return;
  const events = await prisma.ticketEvent.findMany({
    where: {
      ticketId: { in: tickets.map((t) => t.id) },
      actorType: 'STAFF',
      note: { not: null },
    },
    select: { id: true, fromStatus: true, toStatus: true },
  });
  const replies = events.filter((e) => e.fromStatus === e.toStatus).map((e) => e.id);
  if (replies.length === 0) return;
  await prisma.ticketEvent.deleteMany({ where: { id: { in: replies } } });
  console.log(`  · removed a previous take's ${replies.length} ticket repl(ies)`);
}

async function clearPreviousImports(sellerId) {
  const uploads = await prisma.bulkOrderUpload.findMany({
    where: { sellerId },
    select: { id: true, fileName: true },
  });
  if (uploads.length > 0) {
    const ids = uploads.map((u) => u.id);
    await prisma.$transaction([
      prisma.stagedOrderRow.deleteMany({ where: { uploadId: { in: ids } } }),
      prisma.bulkOrderUpload.deleteMany({ where: { id: { in: ids } } }),
    ]);
    console.log(`  \u00b7 removed a previous take's ${uploads.length} bulk import(s)`);
  }

  // Keep in step with SpacesService (`MOCK_ROOT/<bucket>/<key>`) and with
  // `buildOrderCsvKey` (`sellers/<id>/order-imports/...`).
  const bucket = process.env.SPACES_BUCKET ?? 'skydrop-storage';
  const dir = path.join(MOCK_ROOT, bucket, 'sellers', sellerId, 'order-imports');
  const files = await fs.readdir(dir).catch(() => null);
  if (files !== null && files.length > 0) {
    await fs.rm(dir, { recursive: true, force: true });
    console.log(`  \u00b7 removed ${files.length} stale upload object(s) from ${dir}`);
  }
}

/**
 * The Bangladesh intake warehouse, and the setting that points at it.
 *
 * CNS-2: `ops.bd_intake_warehouse_id` is seeded EMPTY on purpose, and a
 * VIA_BD declaration is REFUSED rather than quietly routed to India —
 * which is correct, and which makes the more interesting half of the
 * consignment form unfilmable until somebody configures one. So the
 * seed configures one.
 *
 * `fulfilsOrders: false` is not decoration: the resolver re-checks the
 * flag on every read and refuses an intake warehouse that still fulfils
 * orders (`BD_WAREHOUSE_FULFILS_ORDERS`), because nothing in Bangladesh
 * is sellable from Bangladesh.
 *
 * Idempotent in both halves — the warehouse is found by its code, and
 * the setting is only written when it does not already point somewhere.
 */
const BD_WAREHOUSE = { code: 'BD-DHK-1', name: 'Dhaka Intake' };

async function ensureBdIntakeWarehouse(staffToken) {
  const warehouses = await call('/admin/warehouses', { token: staffToken });
  let bd = warehouses.find((w) => w.code === BD_WAREHOUSE.code);
  if (bd === undefined) {
    bd = await call('/admin/warehouses', {
      method: 'POST',
      token: staffToken,
      body: {
        code: BD_WAREHOUSE.code,
        name: BD_WAREHOUSE.name,
        countryCode: 'BD',
        timezone: 'Asia/Dhaka',
        fulfilsOrders: false,
      },
    });
    console.log(`  · created the Bangladesh intake warehouse (${BD_WAREHOUSE.code})`);
  }

  const current = await prisma.systemSetting.findUnique({
    where: { key: 'ops.bd_intake_warehouse_id' },
    select: { valueString: true },
  });
  if (current !== null && (current.valueString ?? '') !== bd.id) {
    await call('/admin/system-settings/ops.bd_intake_warehouse_id', {
      method: 'PATCH',
      token: staffToken,
      body: { valueType: 'STRING', value: bd.id },
    });
    console.log('  · pointed ops.bd_intake_warehouse_id at it');
  }
}

/**
 * The two bins a warehouse that takes returns has to have, and the
 * demo box did not.
 *
 * ── WHY THIS IS A SEEDING GAP RATHER THAN A PRODUCT ONE ──────────────
 * WMS-8e books a returned parcel's units into the receiving warehouse's
 * RTO_HOLD bin AT RECEIVE, so a received-but-undecided return is on the
 * stock ledger rather than nowhere. CCU-01 had no RTO_HOLD bin and no
 * DAMAGED one, so every receive here answered `NO_HOLD_BIN`: nothing
 * was booked, a MEDIUM `rto-hold-bin-missing` issue was raised, and the
 * toast said so on screen. The product degrades correctly — it is the
 * WORLD that was wrong, and it was wrong in the exact words the owner
 * used when WMS-8d/8e were specified: "R-01-01 should hold products
 * that are received but not decided yet… D-01-01 (damaged) for
 * damaged."
 *
 * Found on 2026-10-01 while writing K2, by reading the stock movements
 * on K1's own parcel: no `RETURN_RECEIVE` row anywhere, under a line of
 * narration saying the units had just been booked into the hold.
 *
 * ── AND WITHOUT THE DAMAGED BIN, HALF OF K2 CANNOT BE FILMED ─────────
 * "Keep aside (damaged)" moves the unit from the hold into the DAMAGED
 * bin at finalise and is REFUSED by name (`RTO_NO_DAMAGED_BIN`) when
 * there is none — deliberately, because the fallbacks are both wrong
 * (the hold would let putaway shelve it, storage would sell it). So a
 * video about the four dispositions could only ever press three.
 *
 * Built through the product's own endpoint, with coordinates rather
 * than a typed name (BIN-4), in the MAIN zone every warehouse is
 * created with (BIN-1). Idempotent on the composed code.
 */
const RETURNS_BINS = [
  { type: 'RTO_HOLD', aisle: 'R', rack: '1', shelf: '1', code: 'R-01-01', what: 'returns hold' },
  { type: 'DAMAGED', aisle: 'D', rack: '1', shelf: '1', code: 'D-01-01', what: 'damaged' },
];

async function ensureReturnsBins(staffToken, warehouse) {
  const bins = await call(`/admin/warehouses/${warehouse.id}/bins`, { token: staffToken });
  const zones = await call(`/admin/warehouses/${warehouse.id}/zones`, { token: staffToken });
  const main = zones.find((z) => z.code === 'MAIN') ?? zones[0];
  if (main === undefined) {
    throw new Error(
      `${warehouse.code} has no zones, so a bin cannot be created in it — every warehouse is ` +
        'supposed to get a MAIN zone at creation (BIN-1).',
    );
  }

  for (const want of RETURNS_BINS) {
    /*
      BY TYPE FIRST, THEN BY CODE. The type is what the product looks
      up (`findBinByType`), so a warehouse that already has a returns
      hold under some other name needs nothing — and creating a second
      one would leave two and make which-one-wins a coin toss.
    */
    if (bins.some((b) => b.type === want.type)) continue;
    if (bins.some((b) => b.code === want.code)) continue;
    await call(`/admin/warehouses/${warehouse.id}/bins`, {
      method: 'POST',
      token: staffToken,
      body: {
        zoneId: main.id,
        type: want.type,
        aisle: want.aisle,
        rack: want.rack,
        shelf: want.shelf,
      },
    });
    console.log(`  · built the ${want.what} bin ${want.code} in ${warehouse.code}`);
  }
}

/**
 * J2's world: one consignment standing at the Indian door, uncounted.
 *
 * ── WHY IT IS ITS OWN, AND DIRECT_IN ─────────────────────────────────
 * C0 builds two consignments and J2 would spend either of them. The
 * landed one is already counted; the flying one's Indian leg is the
 * ONLY thing putting units in the TRANSIT bin, which C2's in-transit
 * column and J1's "counted somewhere it cannot be sold" scene both read
 * — and `ensureConsignmentWorld` is build-once, so a flying consignment
 * that is received is finished for ever and never rebuilt. Receiving it
 * on camera would quietly take a scene out of two other videos.
 *
 * DIRECT_IN rather than VIA_BD because of what the two leave at the
 * door. A counted VIA_BD dispatch creates its Indian leg ALREADY
 * `ARRIVING` (`ConsignmentDispatchService` writes PENDING and updates it
 * in the same transaction), so "Start receiving" — the step that CLAIMS
 * the receipt and records who is counting — has already happened and
 * cannot be filmed. A DIRECT_IN consignment is the seller shipping
 * straight to India, and its one leg lands PENDING: the whole ritual,
 * start to complete, is on camera.
 *
 * ── THE COUNT IS THE POINT, SO THE DECLARATION IS ROUND ──────────────
 * The seller declares twenty and ten. The video counts eighteen good,
 * one damaged and ten, so one line is SHORT and the other is exact —
 * because a receipt whose numbers all match teaches nothing about the
 * column that exists to hold the difference. CNS-3: the variance is a
 * NUMBER, it blocks nothing, and the goods carry on.
 *
 * ── IT SPENDS ITSELF, SO IT IS RETIRED FORWARD ───────────────────────
 * Completing writes real stock through the one sanctioned writer
 * (INV-1) and a batch points back at the receipt, so nothing about it
 * can be deleted or rewound. A consignment whose receipt has left
 * PENDING has its `sellerReference` moved aside and a fresh one is
 * declared — the D4 / B7 rule, fourth instance. One still PENDING is
 * REUSED rather than replaced, so a `--check` run costs nothing and the
 * second take opens on the same row as the first.
 */
const RECEIVE_CONSIGNMENT = {
  ref: 'RSH-CN-RECEIVE',
  lines: [
    { sku: 'RSH-JAMDANI-IVORY', declared: 20 },
    { sku: 'RSH-KANTHA-BLUE', declared: 10 },
  ],
};

async function receiveWorldFor(slug, sellerId, sellerToken, staffToken) {
  if (slug !== 'receive-a-consignment') return;

  const live = await prisma.consignment.findFirst({
    where: { sellerId, sellerReference: RECEIVE_CONSIGNMENT.ref, deletedAt: null },
    select: {
      id: true,
      consignmentNumber: true,
      status: true,
      receipts: { select: { id: true, status: true, receiptNumber: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (live !== null) {
    const untouched =
      live.receipts.length > 0 && live.receipts.every((r) => r.status === 'PENDING');
    if (untouched) {
      console.log(
        `  · ${RECEIVE_CONSIGNMENT.ref} is still uncounted (${live.consignmentNumber}) — reused`,
      );
      return;
    }
    const parked = await prisma.consignment.count({
      where: { sellerId, sellerReference: { startsWith: `${RECEIVE_CONSIGNMENT.ref}-SPENT-` } },
    });
    const retiredRef = `${RECEIVE_CONSIGNMENT.ref}-SPENT-${parked + 1}`;
    await prisma.consignment.update({
      where: { id: live.id },
      data: { sellerReference: retiredRef },
    });
    console.log(
      `  · ${RECEIVE_CONSIGNMENT.ref} is spent — ${live.consignmentNumber} is ${live.status}. ` +
        `Renamed ${retiredRef} and left intact; a fresh one follows`,
    );

    /*
      AND A HALF-COUNTED ONE IS PUT AWAY PROPERLY.

      A `--check` run spends this world exactly as a take does — it
      presses "Start receiving", which moves the receipt PENDING →
      ARRIVING — so on a busy afternoon these pile up, each one a receipt
      somebody started and abandoned. It is a real state and the product
      has a way out of it, so the seed uses that rather than leaving
      litter: the CONSIGNMENT is cancelled (a leg cannot be cancelled on
      its own — the goods-receipt endpoint refuses one and says to cancel
      the consignment instead), which CNS-6 allows right up to dispatch
      and which a DIRECT_IN consignment never reaches. A COMPLETED one is
      left exactly alone: it has written stock through the one sanctioned
      writer and unwinding it is an adjustment, not a tidy-up.
    */
    const half = live.receipts.filter((r) => r.status === 'ARRIVING');
    if (half.length > 0 && !live.receipts.some((r) => r.status === 'COMPLETED')) {
      await call(`/admin/consignments/${live.id}/cancel`, {
        method: 'POST',
        token: staffToken,
        body: { reason: 'Abandoned half-counted by a tutorial check run; rebuilding the world.' },
      }).catch((e) => {
        console.log(`  · could not cancel ${live.consignmentNumber}, leaving it: ${String(e)}`);
      });
      console.log(`  · cancelled ${live.consignmentNumber}, which was left part-counted`);
    }
  }

  const lines = [];
  for (const l of RECEIVE_CONSIGNMENT.lines) {
    const variant = await prisma.productVariant.findFirst({
      where: { skuCode: l.sku, product: { sellerId } },
      select: { id: true },
    });
    if (variant === null) {
      throw new Error(`No ${l.sku} for this seller — the catalogue seeding runs first.`);
    }
    lines.push({ variantId: variant.id, expectedQty: l.declared });
  }

  const declared = await call('/seller/consignments', {
    method: 'POST',
    token: await sellerToken(),
    body: { route: 'DIRECT_IN', sellerReference: RECEIVE_CONSIGNMENT.ref, lines },
  });

  // The receipt is what the video opens on, and the list opens on
  // PENDING — so assert the state rather than assume the route made it.
  const receipts = await call(`/admin/consignments/${declared.id}`, { token: staffToken });
  const pending = (receipts.receipts ?? []).filter((r) => r.status === 'PENDING');
  if (pending.length !== 1) {
    throw new Error(
      `${declared.consignmentNumber} has ${pending.length} PENDING leg(s), expected exactly one — ` +
        'a DIRECT_IN consignment is supposed to land one uncounted receipt at the Indian ' +
        'warehouse, and the receive station opens on that status.',
    );
  }
  /*
    AND IT MUST BE THE ONLY ONE ON THE BOX. The receive station opens on
    PENDING and its columns are the receipt number, the consignment, the
    seller and the status — the seller's own reference is not among
    them, so there is nothing to name our row by and the flow takes the
    single pending row. A second one from anywhere else would be filmed
    and never explained, or counted on camera by mistake.
  */
  const waiting = await prisma.goodsReceipt.count({ where: { status: 'PENDING' } });
  if (waiting !== 1) {
    throw new Error(
      `${waiting} goods receipt(s) are PENDING, expected exactly one — the receive station opens ` +
        'on that list and the video acts on whichever row is in it.',
    );
  }
  console.log(
    `  · ${RECEIVE_CONSIGNMENT.ref} declared as ${declared.consignmentNumber}, ` +
      `waiting to be counted on ${pending[0].receiptNumber} — the only receipt waiting`,
  );
}

/**
 * J3's and J4's world: three parcels of our own moving through the
 * printing station and onto the pack bench, and nothing else of ours in
 * either queue that the video must not touch.
 *
 * Which of the two it stops at is `PICK_STAGE`; everything below is
 * shared, because building a parcel here costs a confirmation, a real
 * waybill and a stored label, and two copies of that would drift the
 * moment one of them was fixed.
 *
 * ── WHY IT PLACES ITS OWN RATHER THAN USING WHAT IS THERE ────────────
 * The label queue is genuinely busy on this box — two dozen parcels,
 * because every confirmed order carries a waybill from the moment it is
 * confirmed (CUR-2b). That is the right picture for a video about a
 * delivery morning, and it is exactly why the video must not simply
 * select the top rows: among them are `RSH-LIFE-CONFIRMED`, which is D0's
 * parcel for B7 and whose whole value is sitting at CONFIRMED, and
 * `RSH-CALL-1`, which is I1's. Printing and picking either would move it
 * and `lifecycleReport` would fail the next seed run naming it.
 *
 * ── SO THEY ARE NAMED BY THE ONE THING THE ROW SHOWS ─────────────────
 * The label queue's columns are the order number, the seller, the
 * courier, the waybill, the DESTINATION, the COD and the item count.
 * Order and waybill numbers are minted per run and the seller is shared
 * with five other parcels, so the only stable handle is the destination:
 * all three are addressed to `560103`, a pin nothing else on the box
 * uses, and the seeding ASSERTS exactly three waiting parcels carry it.
 * The flow selects those rows by that pin.
 *
 * ── WHAT CONFIRMING COSTS, AND WHY IT IS DONE THROUGH FORCE-OUTCOME ──
 * A confirmation reserves stock (ORD-10) and books a waybill (CUR-2b),
 * so these are real parcels. Driving them through the AGENT station
 * would need a login each; `POST /admin/call-queue/:entryId/force-outcome`
 * is the same `CallAttemptService` by another door (I3 films it), so the
 * attempt is a real appended fact under the ops account and the order
 * moves by the ordinary mapping. Three different SKUs, so the picking
 * sheet has more than one line to walk.
 *
 * ── AND IT IS FORWARD-ONLY ───────────────────────────────────────────
 * The take prints, confirms, allocates phase-2 and marks picked, so the
 * orders end at PICKED — outside `REMOVABLE_STATUSES`, holding live
 * reservations, and not rewindable. Each is retired forward by name and
 * three fresh ones are placed (the D4 / B7 rule, fifth instance).
 *
 * **And the retire CANCELS, which is what stops it accumulating.** An
 * earlier version of this note said three units stayed reserved per take
 * and that the honest fix would be a J4 that packed them. J4 exists now
 * and packs exactly one of the three, so the seed still has to unwind
 * them — but the ordinary admin cancel does it correctly at every stage
 * the two takes can end in: CONFIRMED and PENDING_PICK release a
 * reservation, PICKED releases a phase-2 one, and PACKED reverses the
 * physical decrement through `UNPACK_STOCK` (CUR-3). Nothing leaks.
 */
const PICK_PIN = '560103';

/**
 * The slugs this world serves, and the ONE thing that differs between
 * them: where it stops.
 *
 * J3 films the printing station, so its parcels have to be sitting at
 * CONFIRMED with a stored label NOBODY HAS PRINTED — the label queue
 * selects on exactly that. J4 films the pack bench, which selects on
 * `o.status = 'picked'` (WMS-2), so its parcels have to be through the
 * printing station already. Same three orders, same pin, same waybills;
 * `PICK_STAGE` decides whether the API walks them the last four steps.
 *
 * Shared rather than duplicated for the reason `SUPERVISE_SLUGS` is:
 * building the world is a confirmation, a waybill and a label per
 * parcel, and two copies of that would drift the moment one was fixed.
 */
const PICK_STAGE = new Map([
  ['print-and-pick', 'LABELLED'],
  ['pack-a-parcel', 'PICKED'],
  ['pack-without-scanning', 'PICKED'],
  ['hand-over-to-the-courier', 'PACKED'],
  /*
    J8 reads the DRAFT manifest, and a manifest with no live parcels on
    it has no shipment table and no move panel (`MoveShipmentPanel`
    returns null on an empty sheet) — so two of its scenes would have
    nothing to point at. Packing three puts them on the day's draft
    through WMS-7's auto-attach, which is also the only way a parcel
    gets onto one.
  */
  ['what-went-out-together', 'PACKED'],
]);

/**
 * ── WHY THE FIRST PARCEL CARRIES TWO LINES ───────────────────────────
 * Because the pack bench's whole argument is that contents are checked
 * as a SET and not as a count (PACK-1), and a one-line box cannot show
 * that. Two of the Jamdani and one Kantha means the bench can reach
 * "two of one thing and none of another" ON SCREEN — the exact state a
 * count would wave through — and the over-scan refusal then lands on a
 * line that is already satisfied while another is still empty.
 *
 * J3 is unaffected: its narration names no line count, and the label
 * queue's item-count column simply reads 2 for that row.
 */
const PICK_ORDERS = [
  {
    ref: 'RSH-PICK-1',
    recipientName: 'Ananya Iyer',
    phone: '+919845090301',
    line1: '4, Neeladri Road',
    line2: 'Behind the Electronic City bus depot',
    codAmountInr: '6650',
    lines: [
      { sku: 'RSH-JAMDANI-IVORY', quantity: 2, unitPriceInr: '2400' },
      { sku: 'RSH-KANTHA-BLUE', quantity: 1, unitPriceInr: '1850' },
    ],
  },
  {
    ref: 'RSH-PICK-2',
    recipientName: 'Vikram Choudhury',
    phone: '+919845090302',
    line1: '21, Hosa Road',
    line2: 'Opposite the Infosys gate three',
    codAmountInr: '1850',
    lines: [{ sku: 'RSH-KANTHA-BLUE', quantity: 1, unitPriceInr: '1850' }],
  },
  {
    ref: 'RSH-PICK-3',
    recipientName: 'Nandini Rao',
    phone: '+919845090303',
    line1: '7, Doddathoguru Main Road',
    line2: 'Next to the Konappana Agrahara temple',
    codAmountInr: '990',
    lines: [{ sku: 'RSH-SCARF-EMERALD', quantity: 1, unitPriceInr: '990' }],
  },
];

/**
 * Write the label the courier leg would have written.
 *
 * ── WHY THIS EXISTS AT ALL ───────────────────────────────────────────
 * The label leg CANNOT succeed against the local Delhivery simulator,
 * and that is correct product behaviour rather than a bug.
 * `DelhiveryLabelService` puts the courier's `pdf_download_link` through
 * `assertPublicHttpsUrl` — the same SSRF guard a seller-supplied webhook
 * URL goes through, because the bytes are stored in our bucket and later
 * presigned for a seller to open — and the simulator's link is
 * `http://127.0.0.1`, refused on the scheme. So every confirmation on
 * this box logs "AWB persisted but label upload pending", the waybill is
 * durable and the label never arrives: 64 shipments carrying a waybill
 * and 10 carrying a label, at the time this was written.
 *
 * Without a stored label `/warehouse/printing` builds a sheet of ZERO
 * pages and names every parcel `NO_STORED_LABEL` — which is the screen
 * behaving perfectly and J3 being unfilmable. The picking tab is gated
 * on labels having been CONFIRMED, so the whole of J3 to J6 is behind
 * this one file.
 *
 * ── AND WHY IT IS A REAL PDF ─────────────────────────────────────────
 * `LabelSheetService` loads every label with pdf-lib and merges them,
 * reporting anything it cannot parse as `UNREADABLE_PDF`. A hand-rolled
 * `%PDF-1.4 … %%EOF` — which is what STUB MODE returns — would fail one
 * layer further along and present as a different problem, so this
 * builds a genuine one-page document with the parcel named on it.
 *
 * The bytes go where `SpacesService`'s mock mode looks for them
 * (`/tmp/skydrop-spaces-mock/<bucket>/<key>`, `DEV_MOCK_SPACES=true` on
 * this box) and the `awb_labels` row is the ordinary CUR-6 shape:
 * version 1, current, generated INITIAL. Idempotent — a shipment that
 * already has a current label is left alone.
 */
const LABEL_BUCKET = process.env.SPACES_BUCKET ?? 'skydrop-storage';

async function storeStubLabel(shipmentId, shipmentNumber, awbNumber) {
  const already = await prisma.awbLabel.findFirst({
    where: { shipmentId, isCurrent: true },
    select: { id: true },
  });
  if (already !== null) return;

  const doc = await pdfLib.PDFDocument.create();
  // 4R, which is the size the real fetch asks Delhivery for.
  const page = doc.addPage([288, 432]);
  page.drawText('SKYDROP', { x: 24, y: 380, size: 22 });
  page.drawText(shipmentNumber, { x: 24, y: 344, size: 14 });
  page.drawText(`AWB ${awbNumber}`, { x: 24, y: 320, size: 12 });
  page.drawText('Demo label — local recording box', { x: 24, y: 32, size: 8 });
  const bytes = Buffer.from(await doc.save());

  const key = `labels/${shipmentId}/v1.pdf`;
  const target = path.join('/tmp/skydrop-spaces-mock', LABEL_BUCKET, key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);

  await prisma.awbLabel.create({
    data: {
      shipmentId,
      version: 1,
      isCurrent: true,
      spacesKey: key,
      spacesBucket: LABEL_BUCKET,
      fileSizeBytes: bytes.byteLength,
      mimeType: 'application/pdf',
    },
  });
}

async function pickWorldFor(slug, sellerId, sellerToken, staffToken) {
  const stage = PICK_STAGE.get(slug ?? '');
  if (stage === undefined) return;
  // PACKED is PICKED and one more step, so the walk through the printing
  // station is wanted for both.
  const wantsPacked = stage === 'PACKED';
  const wantsPicked = stage === 'PICKED' || wantsPacked;

  /*
    AND THE SCAN BLOCK IS LIFTED FIRST, for every one of these videos.

    SCAN-1: a repeated box STOPS the operator who scanned it, at EVERY
    scanning surface, until an admin resolves the issue — which is the
    whole of J6's last scene and is therefore something a take creates on
    purpose. Left standing, the next run's very first scan is refused and
    the failure arrives as a bench saying "Scanning is stopped" rather
    than as anything to do with the video being made. The same rule the
    e2e reset follows (`resetAuthState` truncates `system_issues`), one
    row at a time because this is a live database.
  */
  const ops = await prisma.staffUser.findUnique({
    where: { email: OPS.email },
    select: { id: true },
  });
  if (ops !== null) {
    const lifted = await prisma.systemIssue.updateMany({
      where: { blocksScanForStaffId: ops.id, resolvedAt: null },
      data: {
        resolvedAt: new Date(),
        resolutionNote: 'Cleared by the tutorial seeding: raised by a previous take on camera.',
      },
    });
    if (lifted.count > 0) {
      console.log(`  · lifted ${lifted.count} scan block(s) a previous take left on the ops user`);
    }
  }

  /* Parcels this run has to walk through the printing station itself —
     only the FRESH ones. A reused parcel is already where it belongs, and
     re-confirming its labels would be refused as already printed. */
  const toDrive = [];

  for (const o of PICK_ORDERS) {
    /*
      REUSED WHERE IT CAN BE, RETIRED AND CANCELLED WHERE IT CANNOT.

      This world is spent progressively rather than all at once: the take
      confirms labels, then confirms a picking sheet, then marks the
      batch picked, and a check can stop between any two. A parcel still
      CONFIRMED with NO label printed is exactly where the video expects
      to find it, so it is REUSED and a failed check costs nothing.

      Anything else is retired forward — and then CANCELLED, which the
      other retire-forwards do not do and which this one has to. The pin
      is the only handle the label queue's columns offer (see
      `ourParcels` in `flows.mjs`), and a retired parcel carries the same
      pin for ever: leave three of them CONFIRMED and the next take opens
      on six rows where the narration says three. The admin cancel is the
      product's own path out — it releases the reservation (ORD-3) and
      voids the shipment — so it also gives back the unit the spent take
      was holding, which is what stops three units a take accumulating.

      Past PENDING_PICK it is left alone and said out loud: a picked or
      packed parcel has been through stock in ways a cancel here should
      not guess at, and it is out of both queues anyway.
    */
    const spent = await prisma.order.findFirst({
      where: { sellerId, sellerOrderRef: o.ref },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        items: { select: { skuCode: true, quantity: true } },
      },
    });
    if (spent !== null) {
      /*
        WHERE "REUSABLE" IS depends on which video is asking, and that is
        the whole of the difference between the two. J3 wants a parcel
        CONFIRMED with a label nobody has printed; J4 wants one PICKED
        with a live, un-packed parcel — which is what the pack bench
        selects on (WMS-2). Asked of the SHIPMENT rather than of a
        timestamp on the order, because `labelPrintedAt` and
        `packCompletedAt` are the two columns the two queues read.

        AND ITS CONTENTS HAVE TO BE THE ONES THE NARRATION DESCRIBES.
        `PICK_ORDERS` grew a second line on the first parcel when J4 was
        written, and the parcels a PREVIOUS run left behind carry the old
        single-line shape. They would pass every other test for
        reusability and then open a box with one line in it under a
        sentence about two — the "reuse what is there" economy quietly
        pinning the world to a stale definition of it.
      */
      const wanted = [...o.lines]
        .map((l) => `${l.sku}×${l.quantity}`)
        .sort()
        .join(' ');
      const has = spent.items
        .map((i) => `${i.skuCode}×${i.quantity}`)
        .sort()
        .join(' ');
      const sameContents = wanted === has;
      if (!sameContents) {
        console.log(`  · ${o.ref} holds ${has}; the video wants ${wanted} — replacing it`);
      }
      const wherePutBack = wantsPacked
        ? { deletedAt: null, status: 'CREATED', handoverScannedAt: null }
        : wantsPicked
          ? { deletedAt: null, status: 'CREATED', packCompletedAt: null }
          : { deletedAt: null, labelPrintedAt: null, awbNumber: { not: null } };
      const wantStatus = wantsPacked ? 'PACKED' : wantsPicked ? 'PICKED' : 'CONFIRMED';
      const stillWaiting =
        sameContents &&
        spent.status === wantStatus &&
        (await prisma.orderShipment.count({
          where: { orderId: spent.id, shipment: wherePutBack },
        })) > 0;
      if (stillWaiting) {
        console.log(
          `  · ${o.ref} (${spent.orderNumber}) is ${spent.status.toLowerCase()} and ` +
            'where the video expects it — reused as it is',
        );
        continue;
      }
      const parked = await prisma.order.count({
        where: { sellerId, sellerOrderRef: { startsWith: `${o.ref}-SPENT-` } },
      });
      const retiredRef = `${o.ref}-SPENT-${parked + 1}`;
      await prisma.order.update({ where: { id: spent.id }, data: { sellerOrderRef: retiredRef } });
      console.log(
        `  · ${o.ref} is spent — ${spent.orderNumber} is ${spent.status}. ` +
          `Renamed ${retiredRef}; a fresh one follows`,
      );
      /*
        PICKED IS CANCELLABLE TOO, and it has to be. A full take ends its
        three parcels at PICKED, which is exactly what the pack bench
        selects on (WMS-2) — so left alone they pile into J4's queue
        carrying the same pin as the live ones, and each keeps a
        phase-2 reservation for ever. The matrix has
        `PICKED → CANCELLED_BY_ADMIN` with RELEASE_STOCK ("the goods are
        off the shelf and in a tote, but nothing has been handed to a
        courier"), so the ordinary admin cancel is the right door and it
        gives the unit back. Past that — packed or dispatched — stock has
        really moved and it is left alone and said out loud.
      */
      /*
        PACKED JOINED THEM FOR J4, and for the same reason PICKED joined
        them for J3: a full take of the pack bench CLOSES a box, so one
        of the three ends PACKED holding a physical decrement rather than
        a reservation. `PACKED → CANCELLED_BY_ADMIN` carries
        `UNPACK_STOCK` (CUR-3) — "the parcel is boxed and sitting in the
        warehouse, not with a courier" — so the ordinary admin cancel
        reverses the PACK_CONFIRM and the unit comes back. Without it a
        take would consume three units of real stock for ever and leave a
        packed parcel on the handover bench that nobody narrated.
      */
      if (
        spent.status === 'CONFIRMED' ||
        spent.status === 'PENDING_PICK' ||
        spent.status === 'PICKED' ||
        spent.status === 'PACKED'
      ) {
        await call(`/admin/orders/${spent.id}/cancel`, {
          method: 'POST',
          token: staffToken,
          body: {
            cancellationReason: 'OTHER',
            note: 'Spent by a tutorial take; cancelled so it leaves the printing queues.',
          },
        }).catch((e) => {
          console.log(`  · could not cancel ${spent.orderNumber}, leaving it: ${String(e)}`);
        });
      } else {
        console.log(
          `  · ${spent.orderNumber} is ${spent.status} — past cancelling here, and out of both queues`,
        );
      }
    }

    const items = [];
    for (const l of o.lines) {
      const variant = await prisma.productVariant.findFirst({
        where: { skuCode: l.sku, product: { sellerId } },
        select: { id: true },
      });
      if (variant === null) {
        throw new Error(`No ${l.sku} for this seller — the catalogue seeding runs first.`);
      }
      items.push({ variantId: variant.id, quantity: l.quantity, unitPriceInr: l.unitPriceInr });
    }
    const token = await sellerToken();
    const order = await call('/seller/orders', {
      method: 'POST',
      token,
      body: {
        recipientName: o.recipientName,
        recipientPhoneE164: o.phone,
        recipientAddressLine1: o.line1,
        recipientAddressLine2: o.line2,
        recipientPostalCode: PICK_PIN,
        paymentMode: 'COD',
        codAmountInr: o.codAmountInr,
        sellerOrderRef: o.ref,
        items,
        // The PREVIOUS take's parcel for this customer is retired but
        // still unpacked — it is confirmed or picked, which is exactly
        // what `create` refuses a second order against
        // (`DUPLICATE_ORDER_SUSPECTED`: a repeat for a customer whose
        // last parcel has not left is usually somebody submitting
        // twice). Here it is deliberate, and acknowledging is what the
        // real form makes a person do too. Same trap as I1's seeding.
        acknowledgeDuplicate: true,
      },
    });
    await call(`/seller/orders/${order.id}/submit`, { method: 'POST', token });

    const entry = await waitFor(`${o.ref} to reach the call queue`, () =>
      prisma.callQueueEntry.findFirst({
        where: { orderId: order.id, status: 'PENDING' },
        select: { id: true },
      }),
    );
    await call(`/admin/call-queue/${entry.id}/force-outcome`, {
      method: 'POST',
      token: staffToken,
      body: {
        outcome: 'CONFIRMED',
        startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
        endedAt: new Date(Date.now() - 19 * 60_000).toISOString(),
        outcomeNotes: 'Confirmed on the phone; happy to pay cash at the door.',
      },
    });

    /*
      AND WAIT FOR THE WAYBILL. The AWB is booked by a bus listener
      POST-COMMIT of the confirmation (CUR-2b), so it lands a heartbeat
      later — and the label queue selects on a shipment that HAS one. A
      seed that returned before it arrived would leave the video opening
      on a queue its parcels had not joined yet.
    */
    const booked = await waitFor(
      `${o.ref} to be given a waybill`,
      async () => {
        const link = await prisma.orderShipment.findFirst({
          where: { orderId: order.id, shipment: { deletedAt: null, awbNumber: { not: null } } },
          select: { shipment: { select: { id: true, shipmentNumber: true, awbNumber: true } } },
        });
        return link?.shipment ?? null;
      },
      { tries: 45 },
    );
    await storeStubLabel(booked.id, booked.shipmentNumber, booked.awbNumber);
    toDrive.push(booked.id);
    console.log(
      `  · ${order.orderNumber} (${o.ref}) confirmed, labelled and waiting to be printed — ` +
        `${booked.shipmentNumber} / ${booked.awbNumber}`,
    );
  }

  /*
    ── J4 ONLY: THE LAST FOUR STEPS, DRIVEN BY THE API ──────────────────
    The pack bench selects on `o.status = 'picked'`, so J4's parcels have
    to be through the printing station before a frame can be shot. They
    go through it by the SAME endpoints J3's camera presses — confirm the
    labels, claim a batch, build its list (which is what ALLOCATES
    phase-2, WMS-1), confirm the sheet printed, mark it picked — rather
    than by writing `PICKED` onto the rows, because the phase-2
    reservations the printing station creates are what the pack bench's
    close later FULFILS (CUR-3), and a hand-written status would leave a
    parcel the bench could open and never complete.

    Only the FRESH parcels are driven. A reused one is already PICKED and
    `confirmPrinted` would refuse its labels as already printed.
  */
  if (wantsPicked && toDrive.length > 0) {
    await call('/admin/warehouse/printing/labels/confirm-printed', {
      method: 'POST',
      token: staffToken,
      body: { shipmentIds: toDrive },
    });
    const batch = await call('/admin/warehouse/printing/pick-batches', {
      method: 'POST',
      token: staffToken,
      body: { shipmentIds: toDrive },
    });
    await call(`/admin/warehouse/printing/pick-batches/${batch.id}/build-list`, {
      method: 'POST',
      token: staffToken,
    });
    await call(`/admin/warehouse/printing/pick-batches/${batch.id}/confirm-printed`, {
      method: 'POST',
      token: staffToken,
    });
    const picked = await call(`/admin/warehouse/printing/pick-batches/${batch.id}/mark-picked`, {
      method: 'POST',
      token: staffToken,
    });
    if (picked.skipped.length > 0) {
      /*
        `markPicked` REFUSES a serialised parcel by name (WMS-1) — in
        STRICT mode the scan at pick is what binds units to a parcel, so
        a sheet cannot close one. This catalogue is all NORMAL, so a
        skip here means the mode changed and the bench would open on a
        parcel that never arrived.
      */
      throw new Error(
        `${batch.batchNumber} left ${picked.skipped.length} parcel(s) behind: ` +
          picked.skipped.map((p) => `${p.shipmentNumber} (${p.reason})`).join(', '),
      );
    }
    console.log(
      `  · ${batch.batchNumber} printed and walked — ${picked.picked} parcel(s) are on the bench`,
    );
  }

  /*
    ── J6 ONLY: THROUGH THE PACK BENCH, BY THE REAL RITUAL ─────────────
    The handover bench selects on a PACKED parcel waiting for a van, so
    J6's three have to be boxed before a frame can be shot. They go
    through the box ritual PACK-1 describes and the API e2e harness's
    `packAtBench()` drives — scan the label to open, scan each product in
    by its SKU code (LBL-2: the code is `barcode ?? skuCode` and this
    catalogue has no barcodes), scan the label again to close — rather
    than through `force-complete`, which is J5's subject and which the
    README is explicit about not routing flows through: it would leave
    the only exercised path the one production should not use.

    Every parcel the stage wants, not only the fresh ones: a reused
    parcel here is PACKED already and is skipped by the status read, and
    a parcel J4 left PICKED is exactly the one that needs boxing.
  */
  if (wantsPacked) {
    const toBox = await prisma.order.findMany({
      where: { sellerId, sellerOrderRef: { in: PICK_ORDERS.map((o) => o.ref) }, status: 'PICKED' },
      select: {
        orderNumber: true,
        orderShipments: {
          select: {
            shipment: {
              select: {
                id: true,
                awbNumber: true,
                shipmentNumber: true,
                items: { select: { skuCode: true, quantity: true } },
              },
            },
          },
        },
      },
    });
    for (const o of toBox) {
      const parcel = o.orderShipments[0]?.shipment;
      if (parcel?.awbNumber == null) continue;
      const box = await call('/warehouse/packs/boxes/open', {
        method: 'POST',
        token: staffToken,
        body: { awbNumber: parcel.awbNumber },
      });
      for (const line of parcel.items) {
        for (let i = 0; i < line.quantity; i += 1) {
          await call(`/warehouse/packs/boxes/${box.packBoxId}/scan`, {
            method: 'POST',
            token: staffToken,
            body: { code: line.skuCode },
          });
        }
      }
      await call(`/warehouse/packs/boxes/${box.packBoxId}/close`, {
        method: 'POST',
        token: staffToken,
        body: { awbNumber: parcel.awbNumber },
      });
      console.log(`  · ${o.orderNumber} boxed at the bench — ${parcel.shipmentNumber} is packed`);
    }
  }

  /*
    AND THE WORLD IS ASSERTED AT WHICHEVER STAGE WAS ASKED FOR. J3's flow
    selects the label queue's rows BY THIS PIN, so a fourth parcel
    carrying it would be printed and picked without being narrated; J4's
    reaches for its parcels by recipient name off the pack queue, and a
    stray one would sit in that list being counted by a viewer.
  */
  const want = wantsPacked ? ['PACKED'] : wantsPicked ? ['PICKED'] : ['CONFIRMED', 'PENDING_PICK'];
  const waiting = await prisma.order.count({
    where: {
      sellerId,
      recipientPostalCode: PICK_PIN,
      status: { in: want },
      deletedAt: null,
    },
  });
  if (waiting !== PICK_ORDERS.length) {
    throw new Error(
      `${waiting} parcel(s) are addressed to ${PICK_PIN} and ${want.join('/').toLowerCase()}, ` +
        `expected ${PICK_ORDERS.length} — the flow acts on those rows, so any other parcel ` +
        'carrying that pin would be worked on camera without being narrated.',
    );
  }
}

/**
 * J1's world: the Bangladesh intake warehouse back to the day it was
 * made — one FLOOR bin, no shelving, tracking off.
 *
 * ── WHY THAT WAREHOUSE AND NOT THE ONE THAT SHIPS ────────────────────
 * The video turns location tracking ON, on camera, and that is a real
 * behaviour change for every flow that receives or picks in the building
 * it is switched in (BIN-1: on means the system ASKS for a bin). Doing
 * it to `CCU-01` would quietly change the world every other video in
 * sections C, D, E, J, K and L records against. The Dhaka intake
 * warehouse fulfils no orders (CNS-2) and holds nothing, so the switch
 * is visible and harmless — and an empty building is the honest setting
 * for a video about laying shelving out in the first place.
 *
 * ── THE PAGE ENFORCES THE ORDER, WHICH IS WHY THE VIDEO FOLLOWS IT ───
 * "Turn tracking on" is DISABLED while the warehouse has no real bin,
 * and the note beside it says why: receiving would have nowhere to put
 * anything. So the bin is added first and the switch second, which is
 * the sequence a person is actually forced through rather than one this
 * tutorial invented.
 *
 * ── AND BOTH HALVES ARE PUT BACK ─────────────────────────────────────
 * The take adds A-01-03 and flips the switch, so a second take would
 * open on a warehouse that already has shelving (the add is refused by
 * name — the form says "already exists" and disables itself) and on a
 * switch that is already on, filming a change that changes nothing. The
 * bin is deleted and the flag set back to false. Deleting is safe
 * BECAUSE the bin is empty: `removeBin` on the server refuses one
 * holding stock or a live reservation, and nothing is ever received into
 * this one.
 */
const J1_BIN = { aisle: 'A', rack: '1', shelf: '3', code: 'A-01-03' };

/**
 * J7's world: a pickup day that FAILED, so the sharp edge has a button.
 *
 * ── WHY IT HAS TO BE STAGED ───────────────────────────────────
 * "Free the day" renders on exactly one shape: `status === 'FAILED' &&
 * courierPickupId === null` — an attempt that failed WITHOUT the courier
 * returning an id, which is the only case where freeing the slot is
 * arguably safe. Everything else on that row offers "Collected" and
 * "Call off" instead. The local simulator succeeds, and the day's real
 * request is raised automatically when the first box is packed
 * (CUR-10 amendment #3), so the failure cannot be produced here by
 * asking the courier for one.
 *
 * It is written directly, and that is a deliberate exception rather
 * than a shortcut: nothing else on this box can produce a FAILED
 * attempt, the row is inert (no stock, no money, no courier call), and
 * the alternative is a video about a dangerous button that never shows
 * the button. The message on it is Delhivery's own vocabulary for a
 * timeout.
 *
 * ── AND IT IS TOMORROW'S DAY, NOT TODAY'S ────────────────────────
 * The partial unique covers `(courier, warehouse, date)` for REQUESTED
 * and FAILED together, and today's row is already REQUESTED — raised by
 * the pack bench the seeding above drives. Tomorrow is also the honest
 * date: a box packed after `courier.default_pickup_time` asks for the
 * NEXT day's van, so a failed attempt for tomorrow is the ordinary way
 * this row comes to exist.
 */
async function pickupWorldFor(slug, staffToken) {
  if (slug !== 'book-the-van') return;

  const warehouses = await call('/admin/warehouses', { token: staffToken });
  const wh = warehouses.find((w) => w.fulfilsOrders === true);
  if (wh === undefined) {
    throw new Error('No order-fulfilling warehouse — the pickups screen has nothing to show.');
  }

  /*
    TODAY'S ROW BACK TO REQUESTED. The video presses "Collected" on it,
    which is the ordinary act and the only thing it does press — but
    that leaves it CLOSED, and the next run would then reach for the
    oldest still-open day instead and film a week-old row under a line
    about the van that is here now. The auto-pickup raises exactly this
    row every day the first box is packed (CUR-10 amendment #3), so
    putting it back is restoring what the day would have had rather than
    inventing one.
  */
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const closedToday = await prisma.courierPickupRequest.updateMany({
    where: {
      courierCode: 'delhivery',
      warehouseId: wh.id,
      pickupDate: today,
      status: { in: ['CLOSED', 'CANCELLED'] },
    },
    data: { status: 'REQUESTED' },
  });
  if (closedToday.count > 0) {
    console.log("  · today's pickup put back to REQUESTED — a previous take marked it collected");
  }

  const tomorrow = new Date();
  tomorrow.setUTCHours(0, 0, 0, 0);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const existing = await prisma.courierPickupRequest.findFirst({
    where: { courierCode: 'delhivery', warehouseId: wh.id, pickupDate: tomorrow },
    select: { id: true, status: true, courierPickupId: true },
  });
  if (existing !== null) {
    if (existing.status === 'FAILED' && existing.courierPickupId === null) {
      console.log("  · tomorrow's pickup attempt is already the failed one the video needs");
      return;
    }
    /*
      A take presses nothing on this row, but a CHECK run might have, and
      a released day leaves the row RELEASED rather than FAILED. Put it
      back rather than inventing a second one for the same day, which the
      partial unique would refuse anyway.
    */
    await prisma.courierPickupRequest.update({
      where: { id: existing.id },
      data: { status: 'FAILED', courierPickupId: null },
    });
    console.log(`  · tomorrow's pickup attempt put back to FAILED (was ${existing.status})`);
    return;
  }

  await prisma.courierPickupRequest.create({
    data: {
      courierCode: 'delhivery',
      warehouseId: wh.id,
      pickupLocationName: 'Skydrop',
      pickupDate: tomorrow,
      pickupTime: '18:00:00',
      expectedPackageCount: 14,
      status: 'FAILED',
      courierPickupId: null,
      courierMessage: 'Request timed out before the courier answered. No pickup id was returned.',
    },
  });
  console.log('  · staged a FAILED pickup attempt for tomorrow — the day the video frees');
}

/**
 * P4 — the shelves a collapse would merge, and one backup to restore.
 *
 * `/warehouse/collapse` has two halves and the video films both: the
 * Layout backups list (which needs a snapshot to be anything but an
 * empty state) and step one of the collapse itself, which REPORTS how
 * many bins and units would merge, moves nothing, and emails a code.
 *
 * So two things have to be true at once, and they fight each other: the
 * warehouse needs real shelf bins HOLDING stock for the preview's
 * figures to be real, and it needs a past collapse for the backups list
 * to have a row — and a collapse is precisely what empties the shelves.
 * Hence the order below: stock the shelves, collapse ONCE if nothing
 * has ever been collapsed here, then stock them again.
 *
 * KOLKATA rather than the Dhaka intake, which was the obvious choice
 * and is wrong: J1's seeding warns when BD-DHK-1 holds any bin besides
 * FLOOR, because its narration counts them out loud. Two permanent
 * shelves there would quietly make that video's words false.
 *
 * AISLE G, because `ensureStockedVariant` puts a goods receipt away
 * into `bins.find(b => b.type === 'STORAGE' || b.type === 'FLOOR')` —
 * the FIRST match in whatever order the endpoint returns. A bin whose
 * code sorts before `FLOOR` could therefore start collecting every
 * future receipt in this warehouse. Harmless if it happened (both are
 * pickable) but it would be a change to other videos' worlds made by
 * accident, and `G` costs nothing.
 */
const COLLAPSE_SHELVES = [
  { aisle: 'G', rack: '01', shelf: '01', qty: 4 },
  { aisle: 'G', rack: '01', shelf: '02', qty: 3 },
];

async function collapseWorldFor(slug, staffToken) {
  if (slug !== 'collapse-the-shelves') return;

  const warehouses = await call('/admin/warehouses', { token: staffToken });
  const wh = warehouses.find((w) => w.fulfilsOrders === true && w.countryCode === 'IN');
  if (wh === undefined) {
    throw new Error('No Indian fulfilling warehouse — the whole video is filmed in one.');
  }

  const zone = await prisma.warehouseZone.findFirst({
    where: { warehouseId: wh.id },
    select: { id: true },
  });
  if (zone === null) {
    throw new Error(
      `${wh.code} has no zones, so "Add a bin" cannot be used to build the shelves this needs ` +
        '(every warehouse gets a MAIN zone at creation — BIN-1).',
    );
  }

  // The shelves, through the product's own creator. Find-or-create: a
  // bin is permanent and nothing in the video removes one.
  const existing = await call(`/admin/warehouses/${wh.id}/bins`, { token: staffToken });
  const shelves = [];
  for (const spec of COLLAPSE_SHELVES) {
    const code = `${spec.aisle}-${spec.rack}-${spec.shelf}`;
    const found = existing.find((b) => b.code === code);
    if (found !== undefined) {
      shelves.push({ id: found.id, code, qty: spec.qty });
      continue;
    }
    const made = await call(`/admin/warehouses/${wh.id}/bins`, {
      method: 'POST',
      token: staffToken,
      body: {
        zoneId: zone.id,
        aisle: spec.aisle,
        rack: spec.rack,
        shelf: spec.shelf,
        type: 'STORAGE',
      },
    });
    console.log(`  · built shelf ${code} in ${wh.code}`);
    shelves.push({ id: made.id, code, qty: spec.qty });
  }

  await stockTheShelves(wh, shelves, staffToken);

  const snapshots = await prisma.binLayoutSnapshot.count({ where: { warehouseId: wh.id } });
  if (snapshots === 0) {
    await collapseOnceForTheBackup(wh, staffToken);
    // The collapse swept the shelves into FLOOR, which is the whole
    // point of it — so they are stocked again for the preview.
    await stockTheShelves(wh, shelves, staffToken);
  } else {
    console.log(`  · ${wh.code} already has ${snapshots} layout backup(s) to restore from`);
  }

  /*
    A PREVIOUS TAKE'S CHALLENGE, cleared.

    The video presses "Show me what this would move", which writes a
    `bin_collapse_challenges` row and sends a code — real product state,
    one more of it per take, and none of it ever consumed because the
    video stops there deliberately. Nothing in the app shows them, so
    this is tidiness rather than a visible fix; it is here so that
    "what is outstanding against this warehouse" is a question with an
    honest answer after twenty takes.
  */
  const stale = await prisma.binCollapseChallenge.deleteMany({
    where: { warehouseId: wh.id, consumedAt: null },
  });
  if (stale.count > 0) {
    console.log(`  · removed ${stale.count} unconsumed collapse challenge(s) from previous takes`);
  }
}

/** Move a few units out of FLOOR onto each shelf, if it is bare. */
async function stockTheShelves(wh, shelves, staffToken) {
  const floor = await prisma.warehouseBin.findFirst({
    where: { warehouseId: wh.id, code: 'FLOOR' },
    select: { id: true },
  });
  if (floor === null)
    throw new Error(`${wh.code} has no FLOOR bin (BIN-1 says every warehouse does).`);

  for (const shelf of shelves) {
    const held = await prisma.stockLevel.aggregate({
      where: { binId: shelf.id },
      _sum: { qtyOnHand: true },
    });
    if ((held._sum.qtyOnHand ?? 0) >= shelf.qty) continue;

    // The biggest FLOOR line, so one move is enough and the shelf ends
    // up holding one product rather than a scattering.
    const source = await prisma.stockLevel.findFirst({
      where: { binId: floor.id, qtyOnHand: { gte: shelf.qty } },
      orderBy: { qtyOnHand: 'desc' },
      select: { sellerId: true, variantId: true, batchId: true },
    });
    if (source === null) {
      console.log(`  · nothing in ${wh.code} FLOOR big enough to stock ${shelf.code} — skipped`);
      continue;
    }
    await call(`/admin/warehouses/${wh.id}/bin-ops/bulk-transfer`, {
      method: 'POST',
      token: staffToken,
      body: {
        lines: [
          {
            sellerId: source.sellerId,
            variantId: source.variantId,
            batchId: source.batchId,
            qty: shelf.qty,
            sourceBinId: floor.id,
            destBinId: shelf.id,
          },
        ],
      },
    });
    console.log(`  · put ${shelf.qty} unit(s) on ${shelf.code}`);
  }
}

/**
 * One real collapse, so the backups list has something in it.
 *
 * THROUGH THE PRODUCT'S OWN TWO STEPS, including the six-digit code —
 * only its DELIVERY is faked, which is the same bargain
 * `ensureStoreSession` strikes with an invitation token. `requestCollapse`
 * mints a code, hashes it and emails the plaintext; there is no mail
 * here, so the hash is overwritten with one this knows the preimage of
 * and `confirmCollapse` is then called normally. Everything the service
 * does — the snapshot before the merge, the paired transfers, the audit
 * row — is real.
 *
 * It is NOT what the video does. The video stops at the code, and says
 * that stopping there is the point.
 */
async function collapseOnceForTheBackup(wh, staffToken) {
  const reason =
    'Shelving replaced across this warehouse; the recorded locations no longer match the racking.';
  const asked = await call(`/admin/warehouses/${wh.id}/bin-ops/collapse/request`, {
    method: 'POST',
    token: staffToken,
    body: { reason },
  });
  const code = '424242';
  await prisma.binCollapseChallenge.update({
    where: { id: asked.challengeId },
    data: { codeHash: createHash('sha256').update(code, 'utf8').digest('hex') },
  });
  const done = await call(`/admin/warehouses/${wh.id}/bin-ops/collapse/confirm`, {
    method: 'POST',
    token: staffToken,
    body: { challengeId: asked.challengeId, code, typedWarehouseCode: wh.code },
  });
  console.log(
    `  · collapsed ${wh.code} once for the backup: ${done.binsCollapsed} bin(s), ` +
      `${done.unitsMoved} unit(s) — the video never does this`,
  );
}

async function binsWorldFor(slug, staffToken) {
  if (slug !== 'where-things-live') return;

  const warehouses = await call('/admin/warehouses', { token: staffToken });
  const bd = warehouses.find((w) => w.code === BD_WAREHOUSE.code);
  if (bd === undefined) {
    throw new Error(
      `No ${BD_WAREHOUSE.code} warehouse — \`ensureBdIntakeWarehouse\` runs before this and is ` +
        'what the whole video is filmed in.',
    );
  }

  const gone = await prisma.warehouseBin.deleteMany({
    where: { warehouseId: bd.id, code: J1_BIN.code },
  });
  if (gone.count > 0) {
    console.log(`  · removed the ${J1_BIN.code} bin a previous take built in ${bd.code}`);
  }

  if (bd.binTrackingEnabled === true) {
    await prisma.warehouse.update({
      where: { id: bd.id },
      data: { binTrackingEnabled: false },
    });
    console.log(`  · location tracking in ${bd.code} back OFF — the video turns it on`);
  }

  // A bin lives in a zone, and the form has nothing to offer without
  // one. Every warehouse is created with MAIN (BIN-1), so this is an
  // assertion rather than a step — if it is ever not true the video
  // opens on an empty-state asking for a zone and the narration is
  // about a form that is not there.
  const zones = await prisma.warehouseZone.count({ where: { warehouseId: bd.id } });
  if (zones === 0) {
    throw new Error(
      `${bd.code} has no zones, so "Add a bin" renders its empty state instead of the form the ` +
        'video fills in. Every warehouse is supposed to get a MAIN zone at creation (BIN-1).',
    );
  }

  const real = await prisma.warehouseBin.count({
    where: { warehouseId: bd.id, code: { not: 'FLOOR' } },
  });
  if (real > 0) {
    console.log(
      `  · note: ${bd.code} still has ${real} bin(s) besides FLOOR — the "0 bin(s) plus FLOOR" ` +
        'line will read differently, and "Turn tracking on" will already be enabled',
    );
  }
}

/**
 * K2's world: K1 has already happened.
 *
 * K1 films a return being RECEIVED; K2 films what is decided about it
 * afterwards. So K2 opens on "On the bench" with the parcel already
 * taken in and nothing inspected — which is the state K1 hands over,
 * and is therefore the honest place for the next video to start rather
 * than one it has to spend two scenes reaching.
 *
 * The receive goes through the product's own endpoint, so the units are
 * booked into the returns hold exactly as they would be for a person
 * (WMS-8e) — and the ASSERTION below is the point of doing it that way:
 * K2's narration says the units are waiting in the hold, and a
 * `NO_HOLD_BIN` outcome would make that a sentence about something that
 * did not happen. That is precisely what WAS happening on this box
 * until `ensureReturnsBins` — see its note.
 *
 * `alreadyReceived` is fine and expected on the second `--check` of a
 * run that did not get as far as finalising; the booking is skipped
 * because it already happened, which the gate allows for by name.
 */
async function returnsBenchWorldFor(slug, sellerId, staffToken) {
  if (slug !== 'inspect-and-finalise-a-return') return;

  const order = await prisma.order.findFirst({
    where: { sellerId, sellerOrderRef: 'RSH-LIFE-ATDOOR' },
    select: { id: true, status: true, orderNumber: true },
  });
  if (order === null) {
    throw new Error(
      'No RSH-LIFE-ATDOOR order — D0 runs before this and is the parcel the whole video is about.',
    );
  }

  const link = await prisma.orderShipment.findFirst({
    where: { orderId: order.id, shipment: { deletedAt: null } },
    select: { shipment: { select: { id: true, awbNumber: true } } },
  });
  const awb = link?.shipment.awbNumber ?? null;
  if (awb === null) {
    throw new Error(`${order.orderNumber} has no live shipment carrying a waybill to receive.`);
  }

  /*
    AND NOTHING ELSE ON THE BENCH. The lifecycle pass deliberately
    LEAVES the newest retired return standing, because an empty bench is
    a worse picture for K1 than a used one — but K2 reaches its parcel by
    position and would otherwise open on two.
  */
  await settleRetiredReturns(sellerId, staffToken, (m) => console.log(m), { keep: 0 });

  const res = await call('/warehouse/rto/receive', {
    method: 'POST',
    token: staffToken,
    body: { awbNumber: awb },
  });

  /*
    THE GATE THE NARRATION RESTS ON. "Booked into the returns hold" is
    a claim about a stock movement, and the only outcome that makes it
    true is BOOKED — SKIPPED is the already-received replay, and the
    other three each mean the units are on no ledger at all.
  */
  const outcome = res.holdBooking?.outcome ?? 'MISSING';
  if (outcome !== 'BOOKED' && !(res.alreadyReceived === true && outcome === 'SKIPPED')) {
    throw new Error(
      `Receiving ${awb} booked nothing into the returns hold (${outcome}). K2 narrates the hold, ` +
        'so a run against a warehouse without an RTO_HOLD bin would film a sentence about ' +
        'something that did not happen — check `ensureReturnsBins`.',
    );
  }

  const bench = await prisma.shipment.count({
    where: {
      deletedAt: null,
      rtoReceivedAt: { not: null },
      items: { some: { rtoDisposition: null } },
    },
  });
  if (bench !== 1) {
    throw new Error(
      `${bench} return(s) are on the bench with lines still to inspect, expected exactly 1 — ` +
        'the flow works whichever row is first, so a second would be finalised on camera ' +
        'without being narrated. `settleRetiredReturns` is what clears the pile.',
    );
  }

  console.log(
    `  · ${order.orderNumber} received onto the returns bench ` +
      `(${res.holdBooking?.unitsBooked ?? 0} unit(s) into the hold)`,
  );
}

/**
 * L1's world: an approval queue with something in it, a history behind
 * it, and a unit in the damaged bin to send back.
 *
 * ── WHY IT HAS TO BE STAGED ──────────────────────────────────────────
 * `stock_adjustments` was EMPTY on this box — every screen in the video
 * was an empty state, including the one whose whole subject is the
 * second pair of eyes. INV-8 is the rule being filmed: an adjustment
 * whose absolute value impact meets
 * `ops.stock_adjustment_approval_threshold_inr` (₹50,000) waits for
 * somebody else; below it, it applies in one transaction. Both halves
 * need a row.
 *
 * ── THE TAKE SPENDS BOTH ─────────────────────────────────────────────
 * It APPROVES the pending one, which really moves stock, and raises a
 * small one from the damaged bin, which also really moves stock. So the
 * pass is a top-up rather than a rebuild: nothing is ever rewound, an
 * EXECUTED or REJECTED row is history and is left exactly alone, and
 * only an UNDECIDED row the previous take did not reach is removed —
 * safe precisely because PENDING means nothing has been applied.
 *
 * ── AND THE STOCK PUTS ITSELF BACK ───────────────────────────────────
 * The 25 units the pending adjustment removes are topped back up by
 * `ensureStockedVariant` on the next run (it receives up to the
 * catalogue's figure), so the warehouse does not drain over takes. The
 * damaged bin has no such top-up, so this tops it up itself — as an
 * INCREASE with reason `DAMAGED_IN_WAREHOUSE`, which is what that reason
 * means and is the honest way to put a damaged unit on that shelf.
 */
const L1_PENDING_NOTE =
  'Quarterly count on aisle A found twenty-five fewer than the system says. ' +
  'Recounted twice by two people before raising this.';

async function adjustmentWorldFor(slug, sellerId, staffToken, warehouse) {
  if (slug !== 'correct-a-count') return;

  await clearUndecidedAdjustments(sellerId);

  const line = await biggestPickableLine(sellerId, warehouse.id, staffToken, L1_PENDING_QTY);
  const raise = (body) =>
    call('/admin/stock-adjustments', { method: 'POST', token: staffToken, body });

  // The history behind the queue. Two rows, equal and opposite, so the
  // one-off they cost the warehouse is nothing; created once and never
  // again, because every EXECUTED adjustment moves real stock.
  const executed = await prisma.stockAdjustment.count({
    where: { sellerId, status: { in: ['EXECUTED', 'APPROVED'] } },
  });
  if (executed < 2) {
    await raise({
      sellerId,
      type: 'INCREASE',
      reasonCode: 'FOUND_EXTRA',
      description: 'One more on the shelf than the system had. Put it back on the books.',
      lines: [{ ...line, qtyChange: 1, unitCostInr: L1_UNIT_COST }],
    });
    await raise({
      sellerId,
      type: 'DECREASE',
      reasonCode: 'COUNTING_ERROR',
      description: 'Counted twice on Monday and once again on Tuesday; the first count was wrong.',
      lines: [{ ...line, qtyChange: -1, unitCostInr: L1_UNIT_COST }],
    });
    console.log('  · wrote two settled adjustments so the history is not an empty state');
  }

  const pending = await prisma.stockAdjustment.count({ where: { sellerId, status: 'PENDING' } });
  if (pending === 0) {
    const made = await raise({
      sellerId,
      type: 'DECREASE',
      reasonCode: 'LOST',
      description: L1_PENDING_NOTE,
      lines: [{ ...line, qtyChange: -L1_PENDING_QTY, unitCostInr: L1_UNIT_COST }],
    });
    /*
      THE WHOLE POINT IS THAT IT WAITED. A row that auto-executed would
      leave the queue empty under a line about the second pair of eyes,
      and the arithmetic behind it (quantity × unit cost against the
      threshold setting) is exactly the sort of thing a settings change
      moves without anybody noticing.
    */
    if (made.status !== 'PENDING') {
      throw new Error(
        `The seeded adjustment came back ${made.status}, not PENDING — ` +
          `${L1_PENDING_QTY} × ₹${L1_UNIT_COST} is no longer above ` +
          'ops.stock_adjustment_approval_threshold_inr.',
      );
    }
    console.log(`  · raised one adjustment above the threshold, waiting for approval`);
  } else {
    console.log(`  · ${pending} adjustment(s) already waiting for approval`);
  }

  await ensureDamagedBinStock(sellerId, staffToken, warehouse);
}

const L1_UNIT_COST = 2400;
const L1_PENDING_QTY = 25;
const L1_DAMAGED_MIN = 3;
/** L2 counts one line SHORT by one, so it wants a few units on it rather than one. */
const L2_COUNT_MIN = 5;

/**
 * The stock line the seeded adjustments are raised against: the biggest
 * one this seller has in a pickable bin of the fulfilling warehouse.
 *
 * By SIZE rather than by name, because the batch a top-up receives into
 * is minted per run — and because the pending adjustment removes
 * twenty-five units on approval, which a thin line cannot survive.
 */
/**
 * Remove every UNDECIDED adjustment, which is the only kind that may be
 * removed at all.
 *
 * PENDING means nothing has been applied — the executor runs on
 * approval (INV-8) — so deleting one is not a rewind of anything. An
 * EXECUTED or REJECTED row is history and is never touched.
 *
 * It clears the whole queue rather than only the row this seeding
 * wrote, because L2 fills it too: completing a cycle count raises a
 * PENDING adjustment for every difference, and one left behind by an L2
 * take would be the first row L1's flow reviews — a different
 * correction, with a different description, under narration about this
 * one. The flow would catch it (its gate quotes the description), but
 * catching it means a dead take rather than a clean one.
 */
async function clearUndecidedAdjustments(sellerId) {
  const stale = await prisma.stockAdjustment.findMany({
    where: { sellerId, status: 'PENDING' },
    select: { id: true },
  });
  if (stale.length === 0) return;
  await prisma.cycleCountItem.updateMany({
    where: { adjustmentId: { in: stale.map((a) => a.id) } },
    data: { adjustmentId: null },
  });
  await prisma.stockAdjustmentLine.deleteMany({
    where: { adjustmentId: { in: stale.map((a) => a.id) } },
  });
  await prisma.stockAdjustment.deleteMany({ where: { id: { in: stale.map((a) => a.id) } } });
  console.log(`  · removed ${stale.length} undecided adjustment(s) a previous take left`);
}

async function biggestPickableLine(sellerId, warehouseId, staffToken, min) {
  const pickable = {
    sellerId,
    warehouseId,
    // STORAGE and PICKING, which are the shelves. `FLOOR` is a bin CODE
    // and not a type — BIN-1's default bin is a STORAGE one called
    // FLOOR — and naming it here makes Prisma refuse the query.
    bin: { type: { in: ['STORAGE', 'PICKING'] }, deletedAt: null },
  };
  const biggest = async () =>
    prisma.stockLevel.findFirst({
      where: pickable,
      orderBy: { qtyOnHand: 'desc' },
      select: { variantId: true, binId: true, batchId: true, qtyOnHand: true },
    });

  let line = await biggest();
  if (line === null) {
    throw new Error(
      `${sellerId} has no stock at all in a pickable bin of this warehouse — the catalogue ` +
        'seeding runs first and is what puts it there.',
    );
  }

  /*
    AND IT TOPS THE LINE UP IF IT HAS SHRUNK, which it does on its own.

    L1's take approves an adjustment that removes twenty-five units from
    the biggest line. `ensureStockedVariant` only receives when the
    seller's TOTAL falls under the catalogue figure, and it receives
    into a NEW batch — so the total is fine while the biggest single
    LINE gets smaller every take, and three takes in there was no line
    left that could carry the adjustment at all. It failed loudly, which
    is right, and then needed a person; this makes it self-heal.
  */
  if (line.qtyOnHand < min) {
    await call('/admin/stock-adjustments', {
      method: 'POST',
      token: staffToken,
      body: {
        sellerId,
        type: 'INCREASE',
        reasonCode: 'FOUND_EXTRA',
        description: 'Stock found behind the aisle during a tidy-up and put back on the books.',
        lines: [
          {
            variantId: line.variantId,
            binId: line.binId,
            batchId: line.batchId,
            qtyChange: min - line.qtyOnHand,
            unitCostInr: L1_UNIT_COST,
          },
        ],
      },
    });
    console.log(`  · topped the biggest shelf line up to ${min} units`);
    line = await biggest();
  }
  return { variantId: line.variantId, binId: line.binId, batchId: line.batchId };
}

/**
 * Keep a unit or two in the DAMAGED bin, which is where the second half
 * of L1 happens: a return kept aside (WMS-8d) leaves by a DECREASE with
 * reason "returned to seller", raised from the bin's own "Return or
 * scrap" link.
 *
 * K2's take puts one there and L1's takes one away, so left alone the
 * shelf empties and the link the video is about has no line to sit on.
 */
/**
 * L2's world: a clean slate for a count, and nothing waiting in the
 * queue it is going to fill.
 *
 * ── WHAT IT CLEARS AND WHY THAT IS SAFE ──────────────────────────────
 * A cycle count writes NO STOCK of its own — `CycleCountService.complete`
 * turns each difference into a PENDING adjustment and stops. So a count
 * a previous take left SCHEDULED or IN_PROGRESS carries nothing at all
 * and is deleted; a COMPLETED one is history and is left exactly where
 * it is, which is also what gives the list something to show.
 *
 * The undecided adjustments go too, for the same reason and one more:
 * the last scene of L2 is the queue with the row this count just
 * raised in it, and a leftover from the take before would be the first
 * row there.
 *
 * ── AND IT SCHEDULES NOTHING ─────────────────────────────────────────
 * The video schedules its own count on camera, which is the first act
 * of the lifecycle it is teaching. Seeding one would film a form being
 * filled in and then open a row that already existed.
 */
/**
 * The label M1 adds on camera, and therefore the one its seeding has to
 * clear. Deliberately NOT one of the two accounts the provisioner
 * makes: those two are what the video is about reading, and a take that
 * spent one of them would leave the next take a shorter list.
 */
const M1_ACCOUNT_LABEL = 'Delhivery — second contract';

/**
 * The lead O1 works through. Its email is a `.test` address on purpose:
 * sending the invite really does call the mailer, and in dev that is a
 * `[DEV] Would send email` line — but a video that types a reachable
 * address into a send button is one bad environment variable away from
 * mailing a stranger.
 */
const O1_LEAD_EMAIL = 'farhana@jessorejute.test';

/**
 * O1's world — "Letting a seller in".
 *
 * ── IT SPENDS THE LEAD AND THE INVITATION ────────────────────────────
 * The video moves the lead's status, writes an internal note, and sends
 * an invitation. All three are the point: the lead pipeline is the
 * subject, and the one-shot invitation link cannot be shown without
 * issuing one.
 *
 * So the lead is reset rather than retired — unlike an order, a lead is
 * a record of somebody asking to be let in and there is exactly one of
 * them per company, so a second take has to work the SAME row or the
 * list grows a near-duplicate every run. It goes back to NEW with its
 * notes cleared, and the invitation the last take issued is removed so
 * the drawer offers "Send invite" rather than "Resend" — which is a
 * DIFFERENT scene with different words on it.
 *
 * ── AN UNUSED INVITATION ONLY ────────────────────────────────────────
 * If somebody ever registers against it, the drawer says "They
 * registered" and there is nothing to resend. Deleting that row would
 * throw away the evidence of how a real seller got in, so it is left
 * alone and the seeding says so loudly instead.
 */
async function leadsWorldFor(slug) {
  if (slug !== 'letting-a-seller-in') return;

  const used = await prisma.sellerInvitation.findFirst({
    where: { email: O1_LEAD_EMAIL, usedAt: { not: null } },
    select: { usedAt: true },
  });
  if (used !== null) {
    throw new Error(
      `The invitation to ${O1_LEAD_EMAIL} was accepted on ${used.usedAt.toISOString()}, so the ` +
        'drawer now reads "They registered" and the invite scene has no button. Pick a new ' +
        'lead email for O1 rather than deleting a real registration.',
    );
  }
  const removed = await prisma.sellerInvitation.deleteMany({ where: { email: O1_LEAD_EMAIL } });
  if (removed.count > 0) {
    console.log(`  · removed ${removed.count} unused invitation(s) a previous take issued`);
  }

  /*
    THE LEAD ITSELF, as the marketing form would have written it. There
    is no seeding anywhere else that makes one, so a fresh box opens
    this page empty — and "a lead goes cold fast" is a hard line to
    deliver over nothing.

    Dated two days back rather than now: the Waiting column is the
    column the subtitle is about, and a lead that arrived this second
    reads as `0d`.
  */
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const lead = await prisma.inviteLead.findFirst({
    where: { email: O1_LEAD_EMAIL },
    select: { id: true },
  });
  const fields = {
    fullName: 'Farhana Akter',
    companyName: 'Jessore Jute Co',
    email: O1_LEAD_EMAIL,
    phone: '+8801711000412',
    shippingDirection: 'BD_TO_IN',
    productTypes: 'Jute bags, floor runners, table linen',
    monthlyOrders: '500-1000',
    message:
      'We sell on Facebook and have customers asking from Kolkata and Delhi. ' +
      'We have no way to ship there and no company in India.',
    status: 'NEW',
    notes: null,
    contactedAt: null,
    convertedSellerId: null,
  };
  if (lead === null) {
    await prisma.inviteLead.create({ data: { ...fields, createdAt: twoDaysAgo } });
    console.log(`  · created the lead "${fields.companyName}" (${O1_LEAD_EMAIL})`);
  } else {
    await prisma.inviteLead.update({
      where: { id: lead.id },
      data: { ...fields, createdAt: twoDaysAgo },
    });
    console.log(`  · reset the lead "${fields.companyName}" to NEW with no notes`);
  }
}

/**
 * The seller O2 works on. DELIBERATELY NOT THE DEMO SELLER.
 *
 * Two reasons, and the second is the one that decided it.
 *
 * O2 SUSPENDS an account on camera. `ensureSeller` forces the demo
 * seller back to APPROVED on every seed, so a take that died between
 * the suspend and the reapprove would heal itself on the next run — but
 * only on the next run, and the videos in between would be filmed
 * against a seller whose portal access had been revoked. Nothing in the
 * seller app says "you are suspended" in a way a flow would notice; it
 * simply stops signing in.
 *
 * And the account hold CANNOT BE SHOWN on a seller who is in credit.
 * `SellerRestrictionService.activeFor` lifts a hold in passing the
 * moment the balance reaches the clearing figure — applied by a person,
 * cleared by money — so a hold placed on the demo seller's +₹63,958
 * with the usual threshold of zero is already lifted by the time the
 * card refetches, and the scene after the press would film "No hold.
 * This seller can trade normally." under a line about a hold being
 * placed. The hold exists for a seller who owes us money, so the video
 * needs one.
 *
 * `phone` is what the correction types; `phoneAsRegistered` is what the
 * seeding puts back every run, so the scene has something to correct.
 */
const O2_SELLER_NAME = 'Khulna Handloom';

/** What registration captured, and what the seeding puts back every run. */
const O2_PHONE_AS_REGISTERED = '+8801811556600';

/**
 * What the correction types on camera. The seeding never writes it — it
 * is declared here ONLY so this file can refuse when the two are the
 * same, which the API would answer with IDENTITY_NO_CHANGES three
 * scenes into a take. `test/tutorial-labels.test.mjs` keeps it in step
 * with the number `flows.mjs` actually types.
 */
const O2_PHONE_CORRECTED = '+8801811556622';

const O2_SELLER = {
  email: 'accounts@khulnahandloom.test',
  password: 'Skydrop-Demo-2026',
  companyName: O2_SELLER_NAME,
  contactPersonName: 'Nasrin Sultana',
  initials: 'KHL',
  phoneAsRegistered: O2_PHONE_AS_REGISTERED,
  owesInr: '18400.00',
};

/**
 * One key, for ever. `POST /admin/wallet-transfers` is idempotent on it
 * (IDEM-1), so the debt is posted ONCE and every later seed run returns
 * the original transfer and moves nothing — which is what makes the
 * figure on screen the same in every take.
 */
const O2_DEBT_IDEMPOTENCY_KEY = '0193b2a7-6c10-4f3a-9d21-5f0e4c8a7b31';

/**
 * O2's world — "Managing a seller".
 *
 * ── WHAT THE TAKE SPENDS, AND WHAT PUTS IT BACK ──────────────────────
 * The video corrects the phone, places a hold and lifts it, then
 * suspends the account and reapproves it. Every one of those is the
 * subject, so none of them is faked — and each is undone here rather
 * than on camera:
 *
 *   · the phone goes back to what registration captured, because the
 *     correction scene needs something wrong to correct;
 *   · any hold still standing is lifted, because the API refuses a
 *     second one by name (RESTRICTION_ALREADY_ACTIVE) and the video
 *     opens on a card that says there is no hold;
 *   · the status is forced back to APPROVED, because the suspend scene
 *     only offers "Suspend account" from there — from SUSPENDED the
 *     panel offers the other button and the take films the video
 *     backwards.
 *
 * ── THE DEBT ─────────────────────────────────────────────────────────
 * Posted through the real staff-transfer endpoint rather than a ledger
 * insert: it is the path an operator would actually use (the seller
 * detail page links to it), it writes the reason the seller reads, and
 * TRE-8b means a debit on a seller holding no cash writes NO bank entry
 * at all — the wallet simply goes negative and the shortfall is a
 * receivable. Which is exactly the state the hold is for.
 */
async function sellerAccountWorldFor(slug, staffToken) {
  if (slug !== 'managing-a-seller') return;

  if (O2_PHONE_CORRECTED === O2_PHONE_AS_REGISTERED) {
    throw new Error(
      'The phone O2 corrects TO is the one this seeding puts back, so the correction changes ' +
        'nothing and the API answers IDENTITY_NO_CHANGES three scenes in.',
    );
  }

  let seller = await prisma.seller.findUnique({
    where: { email: O2_SELLER.email },
    select: { id: true, approvedAt: true },
  });
  if (seller === null) {
    const invite = await call('/admin/seller-invitations', {
      method: 'POST',
      token: staffToken,
      body: { email: O2_SELLER.email },
    });
    await call('/auth/seller/register/invite', {
      method: 'POST',
      body: {
        token: invite.token,
        companyName: O2_SELLER.companyName,
        contactPersonName: O2_SELLER.contactPersonName,
        phone: O2_SELLER.phoneAsRegistered,
        password: O2_SELLER.password,
      },
    });
    seller = await prisma.seller.findUniqueOrThrow({
      where: { email: O2_SELLER.email },
      select: { id: true, approvedAt: true },
    });
    console.log(`  · created the seller "${O2_SELLER.companyName}" (${O2_SELLER.email})`);
  }

  /*
    THE IDENTITY, PUT BACK. Both fields, not only the phone: the
    correction dialog opens pre-filled from the current values and
    nothing stops an operator editing the company name on camera by
    accident, and a seller whose name drifted take by take is a page
    the narration stops matching.
  */
  /*
    BACK-DATED. An account that was approved this morning and already
    owes us August's courier charges is a page that argues with itself,
    and the Approved and Created rows are two lines above the hold.
  */
  const joined = new Date('2026-06-12T09:20:00Z');
  await prisma.seller.update({
    where: { id: seller.id },
    data: {
      status: 'APPROVED',
      approvedAt: joined,
      createdAt: joined,
      emailVerifiedAt: joined,
      companyName: O2_SELLER.companyName,
      contactPersonName: O2_SELLER.contactPersonName,
      phone: O2_SELLER.phoneAsRegistered,
      initials: O2_SELLER.initials,
    },
  });
  await prisma.sellerUser.updateMany({
    where: { sellerId: seller.id },
    data: { passwordHash: await hash(O2_SELLER.password), emailVerifiedAt: new Date() },
  });

  const standing = await prisma.sellerRestriction.findFirst({
    where: { sellerId: seller.id, liftedAt: null },
    select: { id: true },
  });
  if (standing !== null) {
    await prisma.sellerRestriction.update({
      where: { id: standing.id },
      data: {
        liftedAt: new Date(),
        liftReason: 'Lifted by the tutorial seeding before a re-take.',
      },
    });
    console.log('  · lifted the hold a previous take left standing');
  }

  /*
    THE DEBT. Checked before it is posted only so the log says something
    useful — the idempotency key is what actually makes this once-only,
    and it is the same key for ever on purpose (see the constant).
  */
  const last = await prisma.sellerWalletEntry.findFirst({
    where: { sellerId: seller.id, currency: 'INR' },
    orderBy: { id: 'desc' },
    select: { runningBalanceAfter: true },
  });
  const balance = Number(last?.runningBalanceAfter ?? 0);
  if (balance >= 0) {
    await call('/admin/wallet-transfers', {
      method: 'POST',
      token: staffToken,
      body: {
        sellerId: seller.id,
        direction: 'DEBIT',
        amountInr: O2_SELLER.owesInr,
        reason:
          'Courier charges and return fees for August that your wallet did not cover. ' +
          'Top up to clear this and your account unblocks itself.',
        internalNote: 'Tutorial world for O2 — the debt the account hold exists for.',
        idempotencyKey: O2_DEBT_IDEMPOTENCY_KEY,
      },
    });
    console.log(`  · ${O2_SELLER.companyName} now owes \u20b9${O2_SELLER.owesInr}`);
  } else {
    console.log(`  · ${O2_SELLER.companyName} already owes \u20b9${(-balance).toFixed(2)}`);
  }

  /*
    NO FIXTURE. The flow finds this seller the way a person does — by
    typing part of its name into the sellers list's own search — which
    is the standing rule: anything a VIEWER is shown is found on screen,
    and a seller's name is the most findable thing about it.
  */
}

/**
 * The second courier contract O3 splits a seller's parcels across.
 *
 * `provision-stack.mjs` makes two accounts and they are a SANDBOX and a
 * PRODUCTION one — a pair that exists to show the difference between
 * test and live, not two contracts to divide real traffic between. A
 * video about weighted routing cannot use them: sending half a seller's
 * parcels to a courier's test API is not something anybody should watch
 * somebody do.
 *
 * So O3 makes two of its own, PRODUCTION and neither the default, which
 * is the shape CACC-1 was built for — one seller, two contracts with
 * the same courier, split by weight. Two rather than one so that
 * NEITHER of the names read on camera is "Simulator account": a
 * tutorial about which contract carries a parcel should not have the
 * viewer reading a dev artefact as the answer.
 *
 * They are NOT deleted between takes: a courier account is a thing
 * somebody signed, and the dropdown the video opens should hold the
 * same rows every time. They carry the simulator's own token, so a
 * parcel booked against either reaches the simulator and nothing else.
 */
const O3_ACCOUNT_LABELS = ['Delhivery — Kolkata lane', 'Delhivery — Bengaluru lane'];

/**
 * The setting O3 overrides on camera. Deliberately a PRICE rather than
 * a behaviour: the whole point of SET-1 is "what was agreed with this
 * seller", and a fee is the thing most often agreed separately. It also
 * has no physical consequence — nothing dispatches a van or holds stock
 * differently because of it — which the NDR cap and the auto-pickup
 * switches cannot say.
 */
const O3_SETTING_KEY = 'pricing.flat_delivery_fee';

/**
 * O3's world — "Per-seller settings and courier routing".
 *
 * BOTH HALVES ARE SECTIONS OF THE PAGE O2 ALREADY FILMS, so this builds
 * on `sellerAccountWorldFor` rather than beside it: the same seller, in
 * the same state, with the two things O3 has to show FIRST put back —
 * every setting on the system default, and no courier links at all.
 * Those are the states the screen's own copy describes ("Everything is
 * on the system default", "No links: this seller's parcels go to each
 * courier's default account"), and a take that opened on the last
 * take's override would film a line about the default over a row that
 * is not on it.
 */
async function sellerRoutingWorldFor(slug, staffToken) {
  if (slug !== 'per-seller-settings') return;

  await sellerAccountWorldFor('managing-a-seller', staffToken);

  const seller = await prisma.seller.findUniqueOrThrow({
    where: { email: O2_SELLER.email },
    select: { id: true },
  });

  const overrides = await prisma.sellerSettingOverride.deleteMany({
    where: { sellerId: seller.id },
  });
  if (overrides.count > 0) {
    console.log(`  \u00b7 cleared ${overrides.count} setting override(s) a previous take set`);
  }
  const links = await prisma.sellerCourierAccountLink.deleteMany({
    where: { sellerId: seller.id },
  });
  if (links.count > 0) {
    console.log(`  \u00b7 removed ${links.count} courier link(s) a previous take added`);
  }

  /*
    THE KEY HAS TO BE OVERRIDABLE AT ALL. `sellerOverridable` is a
    column on `system_settings`, so a seed change elsewhere could take
    the row off the list entirely — and the failure would arrive as a
    scene that cannot find a button, three minutes into a take.
  */
  const key = await prisma.systemSetting.findUnique({
    where: { key: O3_SETTING_KEY },
    select: { sellerOverridable: true },
  });
  if (key === null || !key.sellerOverridable) {
    throw new Error(
      `"${O3_SETTING_KEY}" is ${key === null ? 'not in system_settings' : 'not seller-overridable'}, ` +
        'so the row O3 overrides is not on the page.',
    );
  }

  for (const label of O3_ACCOUNT_LABELS) {
    const existing = await prisma.courierAccount.findFirst({
      where: { label, deletedAt: null },
      select: { id: true },
    });
    if (existing !== null) continue;
    await call('/admin/courier-accounts', {
      method: 'POST',
      token: staffToken,
      body: {
        courierCode: 'delhivery',
        environment: 'PRODUCTION',
        label,
        credentialFields: { apiToken: 'simulator-token-not-a-secret' },
        isDefault: false,
      },
    });
    console.log(`  \u00b7 created the courier account "${label}"`);
  }
}

/**
 * The one system setting O4 edits on camera, and what it goes back to.
 *
 * Chosen because it decides a THRESHOLD and nothing physical: no van is
 * dispatched, no stock is held and no money moves differently because
 * of it. The NDR cap and the auto-pickup switches are on the same page
 * and are exactly the wrong thing to demonstrate on.
 *
 * It is also NOT seller-overridable, so it cannot collide with the key
 * O3 overrides — two videos editing one row is two seedings arguing
 * about what it should be.
 */
const O4_SETTING_KEY = 'tracking.public_lookup_rate_limit_per_min';
const O4_SETTING_VALUE = 30;

/**
 * O4's world \u2014 "Changing how the platform behaves".
 *
 * There is no world to build: `/settings` is 169 rows the seed already
 * provisions. This puts back the ONE row the take edits, and clears the
 * "Last edit" stamp with it \u2014 the stamp APPEARING is what the saved
 * scene is about, so a row that arrives already carrying one films a
 * line about a change that has not happened yet.
 *
 * Through Prisma rather than the admin endpoint on purpose: the
 * endpoint writes an audit row saying a person changed this, and
 * nobody did. The take's own edits are audited exactly as they should
 * be; the tidying up afterwards is not an operator's act.
 */
async function systemSettingsWorldFor(slug) {
  if (slug !== 'change-a-system-setting') return;

  const row = await prisma.systemSetting.findUnique({
    where: { key: O4_SETTING_KEY },
    select: { valueInt: true, valueType: true, isEditableByAdmin: true },
  });
  if (row === null) {
    throw new Error(`"${O4_SETTING_KEY}" is not in system_settings \u2014 run the db seed.`);
  }
  if (row.valueType !== 'INT' || !row.isEditableByAdmin) {
    throw new Error(
      `"${O4_SETTING_KEY}" is ${row.valueType} and ${row.isEditableByAdmin ? '' : 'not '}editable ` +
        'by an admin; O4 types a number into it and presses Save.',
    );
  }
  if (row.valueInt === O4_SETTING_VALUE) {
    console.log(`  \u00b7 ${O4_SETTING_KEY} is already ${O4_SETTING_VALUE}`);
  } else {
    console.log(`  \u00b7 ${O4_SETTING_KEY} put back to ${O4_SETTING_VALUE} (was ${row.valueInt})`);
  }
  await prisma.systemSetting.update({
    where: { key: O4_SETTING_KEY },
    data: { valueInt: O4_SETTING_VALUE, lastEditedAt: null, lastEditedByStaffId: null },
  });
}

/**
 * The colleague O5 changes the role of and then deactivates.
 *
 * DELIBERATELY NOT `tutorial-ops`: that is the account the camera is
 * signed in as, and deactivating it ends the take mid-scene. It is not
 * one of I2's call agents either — those belong to another video's
 * world, and a `deleted_at` left on one would surface there as a
 * roster that is quietly a person short.
 *
 * `role` is the legacy enum and `staffRole` the row RBAC-1 actually
 * enforces; both are set, because a staff user with only the enum holds
 * no permissions at all and would read as a broken account on screen.
 */
const O5_STAFF_EMAIL = 'priya.menon@skydrop.local';
const O5_STAFF_ROLE_KEY = 'finance';

/** The email O5 invites on camera, and whose invitation it then removes. */
const O5_INVITE_EMAIL = 'rafiq.hossain@skydrop.test';

/** The announcement O5 sends, and therefore the handle on what to clear. */
const O5_BROADCAST_TITLE = 'Call centre closing at six on Friday';

/**
 * O5's world \u2014 "Staff, and telling everyone something".
 *
 * ── WHAT THE TAKE SPENDS ─────────────────────────────────────────────
 * An invitation, somebody's role, somebody's login, and one broadcast.
 * Each is the subject, so none is faked, and each is put back here:
 *
 *   \u00b7 the invitation is deleted, so the drawer offers "Invite staff"
 *     against a clean Pending list rather than yesterday's row;
 *   \u00b7 the colleague goes back to their role and has `deletedAt`
 *     cleared, or the second take opens on a deactivated person with no
 *     Deactivate button to press;
 *   \u00b7 the broadcast and its notification rows are removed, because
 *     "What has been sent" is a list the video reads and a take that
 *     added a row every run would film a different page each time.
 *
 * The broadcast is removed by its TITLE rather than by its type: a
 * broadcast somebody else sent is history and not ours to tidy away.
 */
async function staffWorldFor(slug) {
  if (slug !== 'staff-and-broadcasts') return;

  const role = await prisma.staffRoleDefinition.findFirst({
    where: { key: O5_STAFF_ROLE_KEY },
    select: { id: true, name: true },
  });
  if (role === null) {
    throw new Error(
      `There is no staff role with key "${O5_STAFF_ROLE_KEY}" \u2014 O5 puts the colleague back on it ` +
        'after changing it on camera.',
    );
  }
  await prisma.staffUser.upsert({
    where: { email: O5_STAFF_EMAIL },
    update: {
      role: 'FINANCE',
      staffRole: { connect: { id: role.id } },
      deletedAt: null,
    },
    create: {
      email: O5_STAFF_EMAIL,
      emailDisplay: O5_STAFF_EMAIL,
      passwordHash: await hash('Skydrop-Demo-2026'),
      role: 'FINANCE',
      staffRole: { connect: { id: role.id } },
    },
  });
  console.log(`  \u00b7 ${O5_STAFF_EMAIL} is active and back on ${role.name}`);

  const invites = await prisma.staffInvitation.deleteMany({
    where: { email: O5_INVITE_EMAIL, usedAt: null },
  });
  if (invites.count > 0) {
    console.log(
      `  \u00b7 removed ${invites.count} unused staff invitation(s) a previous take issued`,
    );
  }
  const used = await prisma.staffInvitation.count({
    where: { email: O5_INVITE_EMAIL, usedAt: { not: null } },
  });
  if (used > 0) {
    throw new Error(
      `${O5_INVITE_EMAIL} has accepted an invitation, so inviting them again is refused and the ` +
        'scene has no button. Pick a new address for O5 rather than deleting a real registration.',
    );
  }

  const broadcasts = await prisma.notificationBroadcast.findMany({
    where: { title: O5_BROADCAST_TITLE },
    select: { id: true },
  });
  if (broadcasts.length > 0) {
    const ids = broadcasts.map((b) => `broadcast:${b.id}`);
    await prisma.notificationLog.deleteMany({ where: { eventId: { in: ids } } });
    await prisma.notificationBroadcast.deleteMany({
      where: { id: { in: broadcasts.map((b) => b.id) } },
    });
    console.log(`  \u00b7 removed ${broadcasts.length} broadcast(s) a previous take sent`);
  }
}

/**
 * L4's second warehouse, and why it is a SPOKE rather than a hub.
 *
 * ── THE FORM NEEDS TWO BUILDINGS AND THIS BOX HAD ONE USABLE ONE ─────
 * `/inventory/transfers` refuses a move whose source and destination are
 * the same warehouse ("that is a bin move, not a transfer"), and every
 * unit on this box sits at CCU-01. The only other warehouse is the
 * Dhaka INTAKE, and a raw transfer across the border is precisely what
 * a two-leg consignment exists to do — it books stock through a TRANSIT
 * bin so goods in the air are counted in neither building (CNS-1,
 * CNS-4). Filming the raw form on that lane would teach the habit the
 * consignment machinery was written to replace.
 *
 * (The curriculum's note had this the wrong way round: it warned off
 * Kolkata → Dhaka as "a consignment's job". Consignments run Dhaka →
 * India, so the direction it recommended is the one that collides.)
 *
 * So: a second INDIAN warehouse, and `fulfilsOrders: false`, which is
 * the whole of the safety argument. `WarehouseResolverService` is the
 * ONE reader of that flag (CNS-2) and picks only fulfilling ones, so a
 * spoke changes nothing about where orders are picked, where receipts
 * land or which warehouse any other video's seeding resolves. A second
 * FULFILLING warehouse would quietly become a coin toss in all three.
 *
 * It is also the service's own named use — "we may receive the RTO
 * products at any warehouse … then we will send this to the designated
 * warehouse" — with no border in it.
 */
const L4_SLUG = 'moving-stock-between-warehouses';
const L4_SPOKE = Object.freeze({
  code: 'DEL-01',
  name: 'Delhi Spoke',
  countryCode: 'IN',
});

/**
 * What moves, and the cost both ends must agree on.
 *
 * THE SKU IS THE ONE THAT ALREADY CARRIES A COST. Only
 * `RSH-JAMDANI-IVORY` has `costInr` in the CATALOGUE, deliberately — the
 * reseller reports show a coverage figure beside every margin and a
 * world where everything is priced cannot demonstrate a partial. Giving
 * a cost to one of the other three would move a number two already
 * filmed videos narrate; using this one adds another costed batch to a
 * variant that has several, which moves nothing.
 *
 * The transfer ADDS to CCU-01 rather than taking from it, so no take can
 * starve another video's picking.
 */
const L4_SKU = 'RSH-JAMDANI-IVORY';
const L4_UNIT_COST_INR = 1150;
const L4_SPOKE_QTY = 4;
const L4_HUB_QTY = 6;

/**
 * L4's world — "Moving stock between warehouses".
 *
 * ── NINE IDENTIFIERS, AND NONE OF THEM IS ON A SCREEN ────────────────
 * The form asks for a seller, a variant, a quantity and then a
 * warehouse, bin and batch at EACH end. The two warehouses are selects;
 * the other seven are typed UUIDs, and no page in this console prints a
 * variant, a bin and a batch together. So the sheet (`lib/fixture.mjs`)
 * carries them, exactly as it does for L2's cycle count, and the
 * narration says out loud that they are not printed anywhere here.
 *
 * ── WHY THE SEED MAKES BOTH BATCHES ──────────────────────────────────
 * The lesson is that the destination batch is REQUIRED and never
 * invented, because a batch carries expiry, unit cost and the
 * goods-receipt link — so naming the wrong one is as lossy as inventing
 * one. That is only demonstrable if the batch being named is honestly
 * the right one, which means both ends have to be the same goods. The
 * seed therefore receives the SAME consignment at both buildings at the
 * same unit cost: most of it at the hub, a few units at the spoke. The
 * video sends the strays to join the rest, which is a true sentence.
 *
 * ── IT IS FORWARD-ONLY ───────────────────────────────────────────────
 * A transfer is a pair of movements and `stock_movements` is append-only
 * (INV-1), so nothing here is rewound. A second take receives a fresh
 * few units at the spoke and moves those; the units an earlier take
 * moved stay where they went, which is what actually happened.
 */
async function transferWorldFor(slug, sellerId, sellerToken, staffToken) {
  if (slug !== L4_SLUG) return;

  const variant = await prisma.productVariant.findFirst({
    where: { product: { sellerId }, skuCode: L4_SKU, deletedAt: null },
    select: { id: true },
  });
  if (variant === null) {
    throw new Error(`No ${L4_SKU} for this seller — the catalogue seeding runs first.`);
  }

  const spoke = await ensureSpokeWarehouse(staffToken);
  const hub = await prisma.warehouse.findFirst({
    where: { fulfilsOrders: true, deletedAt: null },
    select: { id: true, code: true, name: true },
  });
  if (hub === null) {
    throw new Error('No warehouse fulfils orders, so there is nowhere to send the strays.');
  }
  if (hub.id === spoke.id) {
    throw new Error(
      `${L4_SPOKE.code} resolves as the fulfilling warehouse. The spoke must NOT fulfil orders — ` +
        'the form refuses a same-warehouse move and every other seeding would start resolving ' +
        'to it.',
    );
  }

  const hubBin = await pickableBinAt(hub.id);
  const spokeBin = await pickableBinAt(spoke.id);

  /*
    THE DESTINATION BATCH FIRST, so it already exists when the spoke's
    units arrive — which is the situation the video describes: the rest
    of this consignment is already at the hub.
  */
  const hubBatchId = await receiveInto({
    sellerToken,
    staffToken,
    warehouseId: hub.id,
    binId: hubBin.id,
    variantId: variant.id,
    qty: L4_HUB_QTY,
  });
  const spokeBatchId = await receiveInto({
    sellerToken,
    staffToken,
    warehouseId: spoke.id,
    binId: spokeBin.id,
    variantId: variant.id,
    qty: L4_SPOKE_QTY,
  });

  await writeFixture(L4_SLUG, {
    sellerId,
    variantId: variant.id,
    sku: L4_SKU,
    qty: String(L4_SPOKE_QTY),
    sourceWarehouse: spoke.name,
    sourceBinId: spokeBin.id,
    sourceBinCode: spokeBin.code,
    sourceBatchId: spokeBatchId,
    destWarehouse: hub.name,
    destBinId: hubBin.id,
    destBinCode: hubBin.code,
    destBatchId: hubBatchId,
  });
  console.log(
    `  · ${L4_SPOKE_QTY} × ${L4_SKU} at ${spoke.name} ${spokeBin.code}, ` +
      `${L4_HUB_QTY} waiting at ${hub.name} ${hubBin.code}`,
  );
}

/** The spoke, created once and reused. BIN-1 gives it a MAIN zone and a FLOOR bin. */
async function ensureSpokeWarehouse(staffToken) {
  const found = await prisma.warehouse.findFirst({
    where: { code: L4_SPOKE.code, deletedAt: null },
    select: { id: true, name: true, fulfilsOrders: true },
  });
  if (found !== null) {
    if (found.fulfilsOrders) {
      throw new Error(
        `${L4_SPOKE.code} fulfils orders. It must not — see transferWorldFor for why.`,
      );
    }
    return { id: found.id, name: found.name };
  }
  const made = await call('/admin/warehouses', {
    method: 'POST',
    token: staffToken,
    body: { ...L4_SPOKE, fulfilsOrders: false },
  });
  console.log(`  · created ${L4_SPOKE.code} "${L4_SPOKE.name}" — a spoke, it fulfils nothing`);
  return { id: made.id, name: made.name };
}

/** A bin a transfer may legitimately move stock out of or into. */
async function pickableBinAt(warehouseId) {
  const bin = await prisma.warehouseBin.findFirst({
    where: { warehouseId, deletedAt: null, type: 'STORAGE' },
    select: { id: true, code: true },
    orderBy: { code: 'asc' },
  });
  if (bin === null) {
    throw new Error(`Warehouse ${warehouseId} has no STORAGE bin to move stock through.`);
  }
  return bin;
}

/**
 * One receipt, at a named warehouse, carrying a unit cost.
 *
 * The cost is what makes the lesson visible: a batch holds it, and the
 * form exists so that moving units never silently loses it.
 */
async function receiveInto({ sellerToken, staffToken, warehouseId, binId, variantId, qty }) {
  const gr = await call('/seller/goods-receipts', {
    method: 'POST',
    token: await sellerToken(),
    body: { warehouseId, lines: [{ variantId, expectedQty: qty }] },
  });
  await call(`/admin/goods-receipts/${gr.id}/start-receiving`, {
    method: 'POST',
    token: staffToken,
  });
  await call(`/admin/goods-receipts/${gr.id}/lines`, {
    method: 'POST',
    token: staffToken,
    body: {
      lines: [
        {
          lineId: gr.lines[0].id,
          receivedQty: qty,
          putawayBinId: binId,
          unitCostInr: L4_UNIT_COST_INR,
        },
      ],
    },
  });
  await call(`/admin/goods-receipts/${gr.id}/complete`, { method: 'POST', token: staffToken });

  const line = await prisma.goodsReceiptLine.findFirst({
    where: { receiptId: gr.id },
    select: { batchId: true },
  });
  if (line?.batchId == null) {
    throw new Error(`Goods receipt ${gr.id} produced no batch, so there is nothing to name.`);
  }
  return line.batchId;
}

/**
 * The slug M4 is filmed under.
 *
 * Declared rather than inlined because it is written down in THREE
 * files — here, `flows.mjs` and `narration.mjs` — and only two of those
 * are checked against each other by `record.mjs`. A rename that misses
 * this one makes the seeding a silent no-op: the take opens on an empty
 * worklist and films a page with nothing on it, which is a green run.
 * `test/tutorial-labels.test.mjs` compares all three.
 */
const M4_SLUG = 'when-nobody-will-carry-it';

/** The pin M4's parcel goes to, and the refusal the simulator answers with. */
const M4_PIN = '560087';
const M4_REF = 'RSH-MANUAL-REFUSED';

/**
 * The carrier M4 says has the parcel, and the shape of the docket number.
 *
 * ── THE WAYBILL IS MINTED PER RUN, AND IT HAS TO BE ──────────────────
 * `shipments.awb_number` is UNIQUE (CUR-9: a waybill is issued once and
 * never reassigned), so a FIXED number in the flow can be typed exactly
 * once in the life of a database. The second check run met
 * `[AWB_ALREADY_IN_USE] AWB 77612345678 is already assigned to another
 * shipment` — correct behaviour, and a take lost to it.
 *
 * Minting it here rather than in the flow is also the truer model: the
 * number is a real docket, the operator arrives already holding it off
 * a piece of paper, and two takes are two different parcels booked on
 * two different days. That is exactly what `lib/fixture.mjs` is for.
 *
 * Eleven digits is BLUEDART's shape rather than Delhivery's fourteen —
 * the whole subject of that screen is a parcel somebody booked
 * elsewhere, so a number that looks like ours would read as the
 * integration having done it after all.
 */
const M4_CARRIER = 'Bluedart';
const M4_AWB_PREFIX = '776';
const M4_REFUSAL = Object.freeze({
  errCode: 'ER0005',
  remarks: 'suspicious order/consignee',
});

/**
 * M4's world — "When nobody will carry it".
 *
 * ── THE STATE NOTHING ON THIS BOX REACHED ────────────────────────────
 * `/manual-placement` lists orders in `PENDING_MANUAL_PLACEMENT`, and
 * the two obvious ways in are both closed. `000000` is the stub's
 * non-serviceable pin and CANNOT be put on an order at all —
 * `address-validation.service.ts` enforces `^[1-9][0-9]{5}$` at create
 * and is right to. `999999` is refused, but as a TRANSIENT failure,
 * which by CUR-2b deliberately leaves the order in CONFIRMED rather
 * than routing it here: asking again is the entire fix for a wobble.
 *
 * So the simulator learned to refuse a NOMINATED pin permanently
 * (`/_sim/refuse-pin`), which is the shape production actually meets.
 *
 * ── WHY A CONSIGNEE REFUSAL AND NOT A SERVICEABILITY ONE ─────────────
 * Two reasons, and the first is mechanical. A pre-flight serviceability
 * check runs BEFORE the create (D4), so a pin the simulator calls
 * unserviceable is blocked before Delhivery ever forms an opinion — the
 * create that carries the refusal never happens. The refusal has to be
 * about the PARCEL, on an address that is fine.
 *
 * The second is that it is the more useful half of the screen. The
 * worklist prints a mapped label AND the courier's own sentence, and
 * `/home/.../manual-placement-index.tsx` says why: an unserved pincode
 * needs a courier who covers it, while a refused consignee needs the
 * details checking before anybody is paid to carry it. Those look
 * identical in a bare list. `[ER0005] suspicious order/consignee` is
 * production's own example (SD-2026-26-000003) and maps to
 * `AWB_REJECTED` → "Courier refused it", because `supersedeReason` only
 * says NON_SERVICEABLE for serviceability wording.
 *
 * ── WHAT THE TAKE LEAVES, AND WHY IT IS RE-TAKEABLE ──────────────────
 * Recording the waybill moves the order on, so each take spends its
 * parcel. A spent one is retired FORWARD by name (the `retireSpentParcel`
 * idiom — `<ref>-SPENT-<n>`) rather than rewound: it carries a real
 * manual waybill and a real transition, which is history.
 *
 * ── AND THE REFUSAL IS PUT BACK ──────────────────────────────────────
 * The pin stops being refused as soon as the routing has happened. The
 * simulator is shared by every video on this stack, and a standing
 * refusal is a trap for whoever films next — `PENDING_MANUAL_PLACEMENT`
 * is not in `AWB_EXPECTED_STATUSES`, so the hourly sweep will not
 * re-book this parcel once it is there and nothing needs the refusal to
 * persist.
 */
async function manualPlacementWorldFor(slug, sellerId, sellerToken, staffToken) {
  if (slug !== M4_SLUG) return;

  const sim = process.env.SIM_URL ?? resolveStack().sim.url;

  /*
    THE PREVIOUS TAKE'S PARCEL. It is spent the moment its waybill is
    recorded — the order leaves PENDING_MANUAL_PLACEMENT — so anything
    not still waiting is retired by name. One that IS still waiting is
    reused: a check run that got as far as opening the page costs
    nothing and should not build a second row.
  */
  const existing = await prisma.order.findMany({
    where: { sellerId, sellerOrderRef: { startsWith: M4_REF }, deletedAt: null },
    select: { id: true, orderNumber: true, sellerOrderRef: true, status: true },
    orderBy: { createdAt: 'desc' },
  });
  const waiting = existing.find(
    (o) => o.sellerOrderRef === M4_REF && o.status === 'PENDING_MANUAL_PLACEMENT',
  );
  for (const o of existing) {
    if (o.sellerOrderRef !== M4_REF) continue;
    if (waiting !== undefined && o.id === waiting.id) continue;
    const spentName = `${M4_REF}-SPENT-${existing.length}`;
    await prisma.order.update({ where: { id: o.id }, data: { sellerOrderRef: spentName } });
    console.log(`  · ${o.orderNumber} is ${o.status} — retired to ${spentName}`);
  }

  if (waiting !== undefined) {
    console.log(`  · ${waiting.orderNumber} is still waiting on manual placement — reused`);
    await writeM4Fixture();
    await assertM4Worklist(waiting.id);
    return;
  }

  const variant = await prisma.productVariant.findFirst({
    where: { product: { sellerId }, skuCode: 'RSH-JAMDANI-IVORY', deletedAt: null },
    select: { id: true },
  });
  if (variant === null) {
    throw new Error('No RSH-JAMDANI-IVORY for this seller — the catalogue seeding runs first.');
  }

  await fetch(`${sim}/_sim/refuse-pin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin: M4_PIN, ...M4_REFUSAL }),
  });
  console.log(
    `  · the simulator will refuse ${M4_PIN}: [${M4_REFUSAL.errCode}] ${M4_REFUSAL.remarks}`,
  );

  try {
    const token = await sellerToken();
    const order = await call('/seller/orders', {
      method: 'POST',
      token,
      body: {
        recipientName: 'Nandini Rao',
        recipientPhoneE164: '+919845070055',
        recipientAddressLine1: '44, Sarjapur Road',
        recipientAddressLine2: 'Above the chemist, opposite the water tank',
        recipientPostalCode: M4_PIN,
        paymentMode: 'COD',
        codAmountInr: '2400',
        sellerOrderRef: M4_REF,
        items: [{ variantId: variant.id, quantity: 1 }],
        acknowledgeDuplicate: true,
      },
    });
    await call(`/seller/orders/${order.id}/submit`, { method: 'POST', token });

    const entry = await waitFor(`${M4_REF} to reach the call queue`, () =>
      prisma.callQueueEntry.findFirst({
        where: { orderId: order.id, status: 'PENDING' },
        select: { id: true },
      }),
    );
    await call(`/admin/call-queue/${entry.id}/force-outcome`, {
      method: 'POST',
      token: staffToken,
      body: {
        outcome: 'CONFIRMED',
        startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
        endedAt: new Date(Date.now() - 19 * 60_000).toISOString(),
        outcomeNotes: 'Confirmed on the phone; happy to pay cash at the door.',
      },
    });

    /*
      THE REFUSAL ARRIVES POST-COMMIT OF THE CONFIRMATION. The AWB job
      is a bus listener (CUR-2b), so the order sits in CONFIRMED for a
      heartbeat and is then routed. Waiting on the STATUS rather than on
      a sleep, because the job retries and a fixed wait would sometimes
      return while the order was still confirmed.
    */
    await waitFor(
      `${M4_REF} to be refused and routed to manual placement`,
      async () => {
        const row = await prisma.order.findUnique({
          where: { id: order.id },
          select: { status: true },
        });
        return row?.status === 'PENDING_MANUAL_PLACEMENT' ? row : null;
      },
      { tries: 45 },
    );
    console.log(`  · ${order.orderNumber} (${M4_REF}) was refused and is waiting on a person`);
    await writeM4Fixture();
    await assertM4Worklist(order.id);
  } finally {
    await fetch(`${sim}/_sim/refuse-pin/${M4_PIN}`, { method: 'DELETE' });
    console.log(`  · the simulator is no longer refusing ${M4_PIN}`);
  }
}

/**
 * A docket number nothing in this database has used.
 *
 * Checked rather than assumed: a clock-derived number is unique in
 * practice and `AWB_ALREADY_IN_USE` is a 409 in the middle of a take,
 * which is an expensive way to find out it was not. The loop is here
 * for the case that costs a take, not for the case that is likely.
 */
async function writeM4Fixture() {
  let awbNumber = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = `${M4_AWB_PREFIX}${String(Date.now() + attempt).slice(-8)}`;
    const taken = await prisma.shipment.findFirst({
      where: { awbNumber: candidate },
      select: { id: true },
    });
    if (taken === null) {
      awbNumber = candidate;
      break;
    }
  }
  if (awbNumber === null) {
    throw new Error('Could not mint a free waybill for M4 in 20 tries.');
  }
  await writeFixture(M4_SLUG, { awbNumber, carrier: M4_CARRIER });
  console.log(`  · the docket to type: ${awbNumber} (${M4_CARRIER})`);
}

/**
 * The two columns M4 is ABOUT, asserted rather than hoped for.
 *
 * `reasonCode` is read off the RETIRED shipment's `supersedeReason` and
 * the sentence off an `order.awb_at_confirmation_non_serviceable` audit
 * row's `metadata.error` — two different places, either of which can be
 * absent while the row still renders perfectly with "Reason not
 * recorded" and a blank beside it. That is exactly the frame the
 * narration must not be read over, and a `--check` cannot see it.
 */
async function assertM4Worklist(orderId) {
  /*
    BOTH OF THESE ARRIVE AFTER THE ORDER MOVES, so they are WAITED for
    rather than read once. `AwbGenerationJobService` routes the order
    first — the durable fact, visible-vs-silent — and only then
    supersedes the shipment and writes the audit row. A seeding that
    returns the moment the status flips therefore reads a half-finished
    world, and it passed three times by luck before failing on the
    fourth with `supersedeReason=none, courier sentence=none`. The
    assertion below is what caught it; without the wait it would have
    been a take filmed over "Reason not recorded".
  */
  const retired = await waitFor(`the refused shipment on ${orderId} to be retired`, () =>
    prisma.shipment.findFirst({
      where: {
        orderShipments: { some: { orderId } },
        supersededAt: { not: null },
        supersedeReason: { not: null },
      },
      select: { supersedeReason: true },
      // `shipmentSequence` lives on the JOIN, not here; the retired one
      // is simply the older row, which is what this is asking for.
      orderBy: { createdAt: 'asc' },
    }),
  );
  const audit = await waitFor(`the courier's own words on ${orderId}`, () =>
    prisma.auditLog.findFirst({
      where: {
        entityType: 'order',
        entityId: orderId,
        action: 'order.awb_at_confirmation_non_serviceable',
      },
      select: { metadata: true },
      orderBy: { createdAt: 'desc' },
    }),
  );
  const code = retired?.supersedeReason ?? null;
  const sentence = audit === null ? null : (audit.metadata?.error ?? null);
  /*
    PRISMA HANDS BACK THE ENUM MEMBER, the API hands back the `@map`ped
    value. The page switches on `awb_rejected`; this sees `AWB_REJECTED`.
    Compared against the page's spelling it fails on a row that is
    perfectly correct, which is a seeding that cries wolf.
  */
  if (code !== 'AWB_REJECTED' || typeof sentence !== 'string' || !sentence.includes('ER0005')) {
    throw new Error(
      `The worklist row would read wrong: supersedeReason=${code ?? 'none'}, ` +
        `courier sentence=${sentence ?? 'none'}. M4 is about those two columns, so a row ` +
        'that says "Reason not recorded" is not worth filming.',
    );
  }
  /*
    AND THAT IT IS THE ONLY ONE. The flow reaches for `.first()`,
    because nothing on that page is named after the order's own
    reference — the columns carry the order NUMBER, which is minted per
    run. One row is what makes `.first()` deterministic rather than a
    coin toss, so it is asserted here rather than assumed there. Same
    shape as J2's "exactly one PENDING goods receipt".
  */
  const waitingCount = await prisma.order.count({
    where: { status: 'PENDING_MANUAL_PLACEMENT', deletedAt: null },
  });
  if (waitingCount !== 1) {
    throw new Error(
      `${waitingCount} order(s) are waiting on manual placement. M4's flow takes the FIRST row, ` +
        'so more than one makes which parcel it films a coin toss. Clear the others, or give ' +
        'the flow a handle that names this one.',
    );
  }
  console.log(`  · the worklist will say "Courier refused it" \u00b7 ${sentence}`);
}

/**
 * M2's world — "Is the courier integration healthy".
 *
 * ── IT WRITES NOTHING ────────────────────────────────────────────────
 * The whole video is reads: the poll's own status, one waybill lookup,
 * the write guard, the pool, the rate budget and one serviceability
 * probe. Every one of those is a question rather than an act, which is
 * exactly the half of that page M2 is for — the poller itself is M3 and
 * is dangerous.
 *
 * ── SO WHY A SEED AT ALL ─────────────────────────────────────────────
 * The AWB box is EMPTY with a placeholder, and the two numbers in it
 * are an example rather than a value (`getByText` does not see a
 * placeholder — the trap is already in the README). So the video has to
 * TYPE a waybill, and a waybill is minted per box. It arrives holding
 * one, exactly as an operator does off a label or a customer's email.
 *
 * It picks one the courier has actually SEEN — a parcel still at
 * `CREATED` has a waybill and no scans, and the scene is about reading
 * what came back rather than about an empty answer.
 */
async function delhiveryHealthWorldFor(slug) {
  if (slug !== 'is-the-courier-healthy') return;

  const moved = await prisma.shipment.findFirst({
    where: {
      courierCode: 'delhivery',
      awbNumber: { not: null },
      deletedAt: null,
      status: { notIn: ['CREATED', 'AWB_GENERATED', 'FAILED_AT_CREATION', 'CANCELLED'] },
    },
    select: { awbNumber: true, shipmentNumber: true, status: true },
    orderBy: { createdAt: 'desc' },
  });
  if (moved === null) {
    throw new Error(
      'No Delhivery parcel on this box has left the building with a waybill on it, so the ' +
        'lookup scene has nothing to ask about. Film a dispatch first (J8), or run the ' +
        'lifecycle seeding.',
    );
  }
  await writeFixture('is-the-courier-healthy', {
    awbNumber: moved.awbNumber,
    shipmentNumber: moved.shipmentNumber,
    shipmentStatus: moved.status,
  });
  console.log(
    `  · the waybill to look up: ${moved.awbNumber} (${moved.shipmentNumber}, ${moved.status})`,
  );
}

/**
 * M1's world — "Courier accounts and credentials".
 *
 * ── IT SPENDS ONE ROW AND NOTHING ELSE ───────────────────────────────
 * The video ADDS an account on camera (which is the only way to show
 * that a credential is write-only — the field exists nowhere else) and
 * then DEACTIVATES it, which is the rotation story the page's own
 * notice tells you to follow. So the row survives the take, and this
 * removes it: a second run would otherwise open on last run's leftover
 * and the "Saved" scene would film a duplicate.
 *
 * ── WHY A DELETE AND NOT A RETIRE ────────────────────────────────────
 * Everywhere else in this seeding, a spent thing is retired FORWARD
 * rather than rewound (the D4 / B7 rule), because the spent thing is
 * real history somebody might have to explain. A courier account made
 * by a video sixty seconds ago is not that: nothing shipped on it,
 * nothing was charged to it, and leaving a pile of them is just noise
 * on a page about knowing which account carried what. It is removed
 * only when it carries NO parcels, no settlement and no seller link —
 * which is true by construction for one the take just made, and a loud
 * failure if it ever is not.
 *
 * The account points AT its credential (`credential_id` on the
 * account), so the account goes first and the credential after it.
 */
async function courierAccountWorldFor(slug) {
  if (slug !== 'courier-accounts-and-credentials') return;

  const made = await prisma.courierAccount.findMany({
    where: { label: M1_ACCOUNT_LABEL },
    select: { id: true, credentialId: true, isDefault: true },
  });
  for (const account of made) {
    const [shipments, settlements, links] = await Promise.all([
      prisma.shipment.count({ where: { courierAccountId: account.id } }),
      prisma.courierSettlement.count({ where: { courierAccountId: account.id } }),
      prisma.sellerCourierAccountLink.count({ where: { courierAccountId: account.id } }),
    ]);
    if (shipments > 0 || settlements > 0 || links > 0) {
      throw new Error(
        `Courier account "${M1_ACCOUNT_LABEL}" carries ${shipments} parcel(s), ` +
          `${settlements} settlement(s) and ${links} seller link(s). The video only ever ` +
          'makes an idle one, so something else is using this label — rename it rather ' +
          "than deleting somebody's real account.",
      );
    }
    await prisma.courierAccount.delete({ where: { id: account.id } });
    if (account.credentialId !== null) {
      await prisma.courierCredential.delete({ where: { id: account.credentialId } });
    }
    console.log(`  · removed the "${M1_ACCOUNT_LABEL}" a previous take added`);
  }

  /*
    AND THE TWO THE PAGE IS ABOUT. The video reads the list, the default
    badge and the sandbox/production pair out loud, so a box with one
    account would film a sentence about a distinction that is not on
    screen. The provisioner makes both; this only asserts it, because
    making them here would be a second place that decides what this
    box's courier accounts are.
  */
  const accounts = await prisma.courierAccount.findMany({
    where: { deletedAt: null },
    select: { label: true, environment: true, isDefault: true, isActive: true },
  });
  const sandbox = accounts.filter((a) => a.environment === 'SANDBOX').length;
  const production = accounts.filter((a) => a.environment === 'PRODUCTION').length;
  if (sandbox === 0 || production === 0) {
    throw new Error(
      `The accounts list is ${sandbox} sandbox and ${production} production — the video ` +
        'reads the difference between them off the Environment column. Run ' +
        '`scripts/tutorials/stack.sh up a`, which provisions both.',
    );
  }
  const defaults = accounts.filter((a) => a.isDefault).length;
  console.log(
    `  · ${accounts.length} courier account(s): ${sandbox} sandbox, ${production} production, ` +
      `${defaults} marked default`,
  );
}

async function cycleCountWorldFor(slug, sellerId, staffToken, warehouse) {
  if (slug !== 'count-the-shelves') return;

  const open = await prisma.cycleCount.findMany({
    where: { status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
    select: { id: true },
  });
  if (open.length > 0) {
    await prisma.cycleCountItem.deleteMany({
      where: { cycleCountId: { in: open.map((c) => c.id) } },
    });
    await prisma.cycleCount.deleteMany({ where: { id: { in: open.map((c) => c.id) } } });
    console.log(`  · removed ${open.length} unfinished cycle count(s) a previous take left`);
  }

  await clearUndecidedAdjustments(sellerId);

  const done = await prisma.cycleCount.count({ where: { status: 'COMPLETED' } });
  console.log(`  · ${done} completed cycle count(s) behind it`);

  /*
    THE LINE THE VIDEO COUNTS, written where the flow can read it.

    A cycle count is recorded per (variant, bin, batch) and the console
    prints those three ids NOWHERE together — the movements report
    carries the variant and a bin CODE and no batch at all, which is
    what the record form's own hint points at. So the video does what an
    operator does: it arrives holding the numbers, off the sheet the
    floor walked with. `lib/fixture.mjs` is that sheet, and the
    narration says so out loud rather than pretending the screen offers
    them.
  */
  const line = await biggestPickableLine(sellerId, warehouse.id, staffToken, L2_COUNT_MIN);
  const [variant, bin] = await Promise.all([
    prisma.productVariant.findUniqueOrThrow({
      where: { id: line.variantId },
      select: { skuCode: true },
    }),
    prisma.warehouseBin.findUniqueOrThrow({ where: { id: line.binId }, select: { code: true } }),
  ]);
  const level = await prisma.stockLevel.findFirstOrThrow({
    where: { variantId: line.variantId, binId: line.binId, batchId: line.batchId },
    select: { qtyOnHand: true },
  });
  await writeFixture('count-the-shelves', {
    ...line,
    skuCode: variant.skuCode,
    binCode: bin.code,
    qtyOnHand: level.qtyOnHand,
    warehouseCode: warehouse.code,
  });
  console.log(
    `  · the count sheet says ${variant.skuCode} in ${bin.code}: ${level.qtyOnHand} on hand`,
  );
}

async function ensureDamagedBinStock(sellerId, staffToken, warehouse) {
  const bin = await prisma.warehouseBin.findFirst({
    where: { warehouseId: warehouse.id, type: 'DAMAGED', deletedAt: null },
    select: { id: true, code: true },
  });
  if (bin === null) {
    throw new Error(
      `${warehouse.code} has no DAMAGED bin — \`ensureReturnsBins\` builds one and runs first.`,
    );
  }
  const held = await prisma.stockLevel.findMany({
    where: { sellerId, binId: bin.id },
    orderBy: { qtyOnHand: 'desc' },
    select: { variantId: true, batchId: true, qtyOnHand: true },
  });
  const have = held.reduce((sum, l) => sum + l.qtyOnHand, 0);
  if (have >= L1_DAMAGED_MIN) {
    console.log(`  · ${bin.code} holds ${have} damaged unit(s) — nothing to top up`);
    return;
  }
  const onto = held[0];
  if (onto === undefined) {
    console.log(
      `  · note: ${bin.code} is empty and has never held anything, so there is no batch to ` +
        'top up — run K2 once, or the "Return or scrap" half of L1 has no line.',
    );
    return;
  }
  await call('/admin/stock-adjustments', {
    method: 'POST',
    token: staffToken,
    body: {
      sellerId,
      type: 'INCREASE',
      reasonCode: 'DAMAGED_IN_WAREHOUSE',
      description: 'Found damaged on the floor during a walk-round and put on the damaged shelf.',
      lines: [
        {
          variantId: onto.variantId,
          binId: bin.id,
          batchId: onto.batchId,
          qtyChange: L1_DAMAGED_MIN - have,
          unitCostInr: L1_UNIT_COST,
        },
      ],
    },
  });
  console.log(`  · topped ${bin.code} up to ${L1_DAMAGED_MIN} damaged unit(s)`);
}

/**
 * Remove the consignment a previous take announced, and the bank change
 * it left pending.
 *
 * A consignment is hard-deleted for the same reason the tutorial product
 * is: it is minutes old, nothing was ever received against it, and what
 * is wanted is a register identical to the one the first take filmed. A
 * consignment that HAS been received is left alone and said out loud —
 * on a dev box that means somebody was using this seller for something
 * else, and deleting their work to tidy a video would be worse than a
 * second row on screen.
 *
 * The pending bank change matters for a subtler reason: with one open,
 * the profile video's save dialog asks a DIFFERENT question, so the take
 * would not match its own narration.
 */
async function clearTutorialConsignments(sellerId) {
  const rows = await prisma.consignment.findMany({
    where: { sellerId, sellerReference: TUTORIAL_CONSIGNMENT_REF },
    select: { id: true, consignmentNumber: true },
  });
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    // DECLARING a consignment already creates its legs as PENDING goods
    // receipts, so "has a goods receipt" is not the test — every fresh
    // one has two. What must never be deleted is a leg somebody has
    // started counting, because a receipt past PENDING may have written
    // stock and a batch points back at it.
    const counted = await prisma.goodsReceipt.count({
      where: { consignmentId: { in: ids }, status: { not: 'PENDING' } },
    });
    if (counted > 0) {
      console.log(
        `  · leaving ${rows.length} consignment(s) alone — ${counted} leg(s) have been counted`,
      );
    } else {
      const receipts = await prisma.goodsReceipt.findMany({
        where: { consignmentId: { in: ids } },
        select: { id: true },
      });
      const receiptIds = receipts.map((r) => r.id);
      await prisma.$transaction([
        prisma.goodsReceiptLine.deleteMany({ where: { receiptId: { in: receiptIds } } }),
        prisma.goodsReceipt.deleteMany({ where: { id: { in: receiptIds } } }),
        prisma.consignmentEvent.deleteMany({ where: { consignmentId: { in: ids } } }),
        prisma.consignment.deleteMany({ where: { id: { in: ids } } }),
      ]);
      console.log(
        `  · removed a previous take's ${rows.length} consignment(s) and ${receiptIds.length} leg(s)`,
      );
    }
  }

  const changes = await prisma.sellerBankChangeRequest.deleteMany({
    where: { sellerId, status: 'PENDING' },
  });
  if (changes.count > 0) {
    console.log(`  · removed ${changes.count} pending bank change request(s)`);
  }

  // The bank details the profile video ENTERS on camera. This one is
  // not cosmetic: with an account already on file the form takes the
  // approval branch, and its submit button stops saying "Save details"
  // and starts saying "Send for approval" — so the second take hangs
  // waiting for a button that is no longer there. (It did: a re-take
  // timed out on exactly this while the first take had looked fine.)
  // The video films the FIRST-TIME path, and the narration describes
  // it, so every take has to start from no account.
  await prisma.seller.updateMany({
    where: { id: sellerId, NOT: { bankAccountNumber: null } },
    data: {
      bankName: null,
      bankBranchName: null,
      bankAccountName: null,
      bankAccountNumber: null,
      bankAccountNumberMasked: null,
      bankAccountNumberKeyVersion: null,
      bankRoutingNumber: null,
      bankSwiftCode: null,
    },
  });

  // The logo the profile video uploads ON CAMERA. Left in place, the
  // next take opens on a logo already there and a Remove button beside
  // it — a different picture from the one the narration describes, and
  // the frame the whole scene is about. The object under it goes too,
  // or mock storage accumulates one per take.
  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    select: { logoUrl: true },
  });
  if ((seller?.logoUrl ?? null) !== null) {
    await prisma.seller.update({ where: { id: sellerId }, data: { logoUrl: null } });
    const bucket = process.env.SPACES_BUCKET ?? 'skydrop-storage';
    const dir = path.join(MOCK_ROOT, bucket, 'sellers', sellerId, 'logo');
    await fs.rm(dir, { recursive: true, force: true });
    console.log("  · removed a previous take's company logo");
  }
}

/**
 * Undo what the two SETTINGS videos do on camera.
 *
 * Both of them film a FIRST-TIME path, and both leave the account in a
 * state where the second take would film something else — the same
 * lesson the profile video taught the expensive way, where a saved bank
 * account changed the submit button's label and the re-take hung on a
 * button that was no longer there.
 *
 * The store video adds "Dhaka Boutique" and makes it the default. Left
 * in place, the next take opens on a register that already has it, the
 * add fails on a duplicate name, and the store the narration says is
 * "not the default" is the default. So it goes, and the original store
 * is put back as the default — which also matters to every OTHER video,
 * since an order with no store named on it is filed under whatever the
 * default currently is.
 *
 * The delivery-fee video's whole fourth scene is the badge reading
 * "Skydrop default". That is TRUE only while the seller has no override
 * of their own, and the video's own save is what creates one. Clearing
 * it is what makes the take repeatable.
 *
 * A store with orders against it is left alone and said out loud: on a
 * dev box that means somebody used this seller for something else, and
 * deleting their work to tidy a video would be worse than a second row.
 */
async function clearTutorialSettings(sellerId) {
  const store = await prisma.sellerStore.findFirst({
    where: { sellerId, name: TUTORIAL_STORE_NAME },
    select: { id: true, isDefault: true },
  });
  if (store !== null) {
    const orders = await prisma.order.count({ where: { storeId: store.id } });
    if (orders > 0) {
      console.log(
        `  · leaving the "${TUTORIAL_STORE_NAME}" store alone — ${orders} order(s) are filed under it`,
      );
    } else {
      // The default moves FIRST. A partial unique index allows exactly
      // one default per seller, so promoting the original while the
      // tutorial store still holds the flag would be refused — and
      // deleting the default first would leave order create with
      // nothing to pre-select in between.
      if (store.isDefault) {
        const original = await prisma.sellerStore.findFirst({
          where: { sellerId, kind: 'CHANNEL', deletedAt: null, id: { not: store.id } },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true },
        });
        if (original === null) {
          throw new Error(
            `"${TUTORIAL_STORE_NAME}" is the only store left — refusing to delete the default.`,
          );
        }
        await prisma.$transaction([
          prisma.sellerStore.update({ where: { id: store.id }, data: { isDefault: false } }),
          prisma.sellerStore.update({ where: { id: original.id }, data: { isDefault: true } }),
        ]);
        console.log(`  · put "${original.name}" back as the default store`);
      }
      await prisma.sellerStore.delete({ where: { id: store.id } });
      console.log(`  · removed a previous take's "${TUTORIAL_STORE_NAME}" store`);
    }
  }

  const fee = await prisma.sellerSettingOverride.deleteMany({
    where: { sellerId, key: DELIVERY_FEE_KEY },
  });
  if (fee.count > 0) {
    console.log("  · cleared the seller's own delivery fee, back to the Skydrop default");
  }

  // The stock-alert video's third scene is the badge reading "Off —
  // nothing alerts by default", and its whole lesson is that blank and
  // zero are different. Both are true only from a standing start: the
  // video's own two saves set the account default AND a per-SKU
  // override, and a second take would open on "Warning below 10 units"
  // and on a SKU that already says 25.
  //
  // Cleared to NULL rather than to a number, because null IS the state
  // being filmed — `StockAlertService` resolves `variant.lowStockThreshold
  // ?? seller.defaultLowStockThreshold ?? null` and returns
  // SKIPPED_NO_THRESHOLD on null, which is exactly what "nothing alerts"
  // means and exactly what a new seller has.
  // The top-up video RECORDS a transfer on camera, and its last scene is
  // the Top-ups tab showing exactly one pending row. Left in place, take
  // two shows two rows and take three shows three — and the narration
  // says "it appears under Top-ups", singular, pointing at a list that
  // is mostly previous takes.
  //
  // PENDING only. An ACCEPTED one has a wallet entry behind it and the
  // ledger is append-only, so deleting the claim would leave a credit
  // with nothing explaining it — worse than a second row on screen.
  const topups = await prisma.walletTopupRequest.deleteMany({
    where: { sellerId, status: 'PENDING' },
  });
  if (topups.count > 0) {
    console.log(`  · removed ${topups.count} pending top-up claim(s) from a previous take`);
  }

  // The roles video BUILDS a role on camera, and a second take would
  // fail on the duplicate name — and film a list that already has it
  // while the narration says "let us build one".
  //
  // Only a role NOBODY HOLDS is removed. A role with members is somebody
  // using this account for something else, and taking their access away
  // to tidy a video is worse than a second row on screen.
  const role = await prisma.sellerRoleDefinition.findFirst({
    where: { sellerId, name: TUTORIAL_ROLE_NAME },
    select: { id: true, _count: { select: { users: true } } },
  });
  if (role !== null) {
    if (role._count.users > 0) {
      console.log(
        `  · leaving the "${TUTORIAL_ROLE_NAME}" role alone — ${role._count.users} member(s) hold it`,
      );
    } else {
      await prisma.sellerRolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.sellerRoleDefinition.delete({ where: { id: role.id } });
      console.log(`  · removed a previous take's "${TUTORIAL_ROLE_NAME}" role`);
    }
  }

  const account = await prisma.seller.updateMany({
    where: { id: sellerId, NOT: { defaultLowStockThreshold: null } },
    data: { defaultLowStockThreshold: null },
  });
  const perSku = await prisma.productVariant.updateMany({
    where: { product: { sellerId }, NOT: { lowStockThreshold: null } },
    data: { lowStockThreshold: null },
  });
  if (account.count > 0 || perSku.count > 0) {
    console.log(
      `  · cleared low-stock thresholds — account default${account.count > 0 ? '' : ' (already off)'}` +
        `, ${perSku.count} per-SKU override(s)`,
    );
  }
}

/**
 * Give the ORIENTATION video a dashboard worth looking at.
 *
 * Runs only for that slug. The tour narrates a recent-orders list and a
 * search box that returns something, and an empty dashboard would make
 * both of those sentences false — while every other video wants the
 * seller's order list cleared, which is what `clearPreviousOrders` above
 * has just done. So this is the one place an order is created by the
 * SEED rather than by the camera.
 */
async function placeTourOrders(sellerToken) {
  const variants = await prisma.productVariant.findMany({
    where: { skuCode: { in: CATALOGUE.map((c) => c.sku) }, deletedAt: null },
    select: { id: true, skuCode: true },
  });
  if (variants.length === 0) throw new Error('No catalogue variants to place tour orders against');

  for (const [i, o] of TOUR_ORDERS.entries()) {
    const variant = variants[i % variants.length];
    const order = await call('/seller/orders', {
      method: 'POST',
      token: await sellerToken(),
      body: {
        recipientName: o.name,
        recipientPhoneE164: o.phone,
        recipientAddressLine1: `${12 + i}, Residency Road`,
        // ORD-5: line two is the LANDMARK and is required.
        recipientAddressLine2: 'Near the Bangalore Club, opposite the petrol pump',
        recipientPostalCode: '560025',
        paymentMode: 'COD',
        codAmountInr: String(1800 + i * 450),
        sellerOrderRef: o.ref,
        items: [{ variantId: variant.id, quantity: o.qty }],
      },
    });
    await call(`/seller/orders/${order.id}/submit`, {
      method: 'POST',
      token: await sellerToken(),
    });
  }
  console.log(`  · placed ${TOUR_ORDERS.length} order(s) so the dashboard is not empty`);
}

/**
 * ─── THE MONEY DESK (section N) ──────────────────────────────────────
 *
 * N1–N5 are five videos about ONE desk, and they share a world rather
 * than each building their own: a seller whose wallet has actually been
 * used, a claim waiting, a payout request waiting, a bank change
 * waiting, and delivered COD the courier has not paid us for yet.
 *
 * The important property is that FOUR OF THE FIVE SPEND WHAT THEY FILM.
 * Accepting a claim credits the wallet, approving a withdrawal and
 * recording its remittance debits it, approving a bank change writes the
 * new account through, and recording a payout credits the COD. So every
 * one of those is put back the way the rest of this file does it —
 * forward where the product allows it, and by removing the take's OWN
 * rows where it does not. What is never removed is a row some OTHER
 * video's narration describes.
 */
const MONEY_DESK_SLUGS = new Set([
  'how-seller-money-works',
  'accept-a-top-up',
  'pay-a-seller-out',
  'approve-a-bank-change',
  'record-a-courier-payout',
  'move-money-by-hand',
  'the-bank-book',
]);

/** What a seller types on the claim N2 accepts. Shaped like a bank app's. */
const DESK_TOPUP_INR = 18000;

/**
 * The second claim, which N2 never accepts.
 *
 * A DIFFERENT figure from the first on purpose: the flow reaches each
 * row by the amount printed on it, because the reference is minted per
 * run (two claims sharing one would teach the opposite of what the video
 * says about matching) and there is nothing else on a claim that is both
 * stable and visible.
 */
const DESK_SECOND_TOPUP_INR = 4250;

/** What N3 pays out. Comfortably under the balance, so the floor is not the story. */
const DESK_WITHDRAWAL_INR = 7500;

async function moneyDeskWorldFor(slug, sellerId, sellerToken, staffToken) {
  if (!MONEY_DESK_SLUGS.has(slug ?? '')) return;

  // Somewhere to send a payout. The profile video's clearing takes the
  // bank details off on every run, and a withdrawal is refused outright
  // without them (NO_BANK_ACCOUNT_ON_FILE) — so they go back on first,
  // exactly as `walletWorldFor` does for E3.
  await prisma.seller.update({
    where: { id: sellerId },
    data: {
      bankName: WALLET_PAYOUT_BANK.name,
      bankBranchName: WALLET_PAYOUT_BANK.branch,
      bankAccountName: WALLET_PAYOUT_BANK.holder,
      bankAccountNumber: WALLET_PAYOUT_BANK.account,
      bankAccountNumberMasked: `••••${WALLET_PAYOUT_BANK.account.slice(-4)}`,
      bankRoutingNumber: WALLET_PAYOUT_BANK.routing,
      bankSwiftCode: WALLET_PAYOUT_BANK.swift,
    },
  });

  // A claim that a PREVIOUS take left waiting. Deleting a PENDING one is
  // free — WAL-2's whole point is that it has moved no money — and
  // without this the second take opens on two identical claims and the
  // narration's "one claim" is wrong before it is spoken.
  const stale = await prisma.walletTopupRequest.deleteMany({
    where: { sellerId, status: 'PENDING' },
  });
  if (stale.count > 0) {
    console.log(`  · removed ${stale.count} top-up claim(s) left waiting by a previous take`);
  }

  // Money in the wallet, through the real path: a claim, then an
  // acceptance. That accepted claim is also what the Credited tab shows
  // beside the pending one, so N2's screen has a before and an after on
  // it rather than one row and an empty tab.
  await ensureWalletHasMoney(sellerId, sellerToken, staffToken);

  // The COD credit — the single most-asked-about line in a seller's
  // ledger, and the one N5 is entirely about. N5 RECORDS the payout on
  // camera, so for that video alone it must NOT already be on file.
  if (slug === 'record-a-courier-payout') {
    await unrecordTutorialPayouts(sellerId);
    await writeRemittanceExport(sellerId);
  } else {
    await settleOneCodForLedger(sellerId, staffToken);
  }

  if (slug === 'how-seller-money-works' || slug === 'accept-a-top-up') {
    const { accounts } = await call('/seller/wallet/topups/bank-accounts', {
      token: await sellerToken(),
    });
    // The RUPEE account. A claim's amount is in the account's own
    // currency, and N2's narration quotes the figure the operator is
    // about to credit — against the taka one it would be a different
    // number by the exchange rate, which is a different video (E1).
    const account = (accounts ?? []).find((a) => a.currency === 'INR');
    if (account === undefined) {
      throw new Error('No active rupee platform bank account — run the db seed first.');
    }
    await call('/seller/wallet/topups', {
      method: 'POST',
      token: await sellerToken(),
      body: {
        bankAccountId: account.id,
        amount: DESK_TOPUP_INR,
        // What a seller would copy off their own banking app. Unique per
        // run, because the reference is what an operator matches against
        // the statement and two claims sharing one would teach the
        // opposite of what N2 says.
        transactionRef: `NEFT${Date.now().toString().slice(-10)}`,
      },
    });
    console.log(`  · one top-up claim waiting for review (₹${DESK_TOPUP_INR})`);

    // N2 needs a SECOND claim, and it is not decoration. The video
    // accepts one and then opens the REJECT dialog to read the reason
    // field — and the accept has already spent the first row, so without
    // a second there is nothing left for the refusal to point at. It is
    // also the honest shape: two transfers from one seller in a week is
    // ordinary, and a queue of exactly one makes the screen look like a
    // form rather than a queue.
    if (slug === 'accept-a-top-up') {
      await call('/seller/wallet/topups', {
        method: 'POST',
        token: await sellerToken(),
        body: {
          bankAccountId: account.id,
          amount: DESK_SECOND_TOPUP_INR,
          transactionRef: `NEFT${(Date.now() + 7919).toString().slice(-10)}`,
        },
      });
      console.log(
        `  · a second claim for the refusal scene to point at (₹${DESK_SECOND_TOPUP_INR})`,
      );
    }
  }

  /*
    N4 gets one too, and it is not decoration. Its closing line is that
    the next withdrawal for this seller is typed against the account
    just approved — and after an N3 take there is no request left, so
    that sentence was spoken over an empty page reading "No pending
    requests". One waiting is both the honest picture and the thing the
    sentence is about.
  */
  if (
    slug === 'how-seller-money-works' ||
    slug === 'pay-a-seller-out' ||
    slug === 'approve-a-bank-change'
  ) {
    await call('/seller/wallet/withdrawal-requests', {
      method: 'POST',
      token: await sellerToken(),
      body: {
        currency: 'INR',
        amount: `${DESK_WITHDRAWAL_INR}.00`,
        note: 'Monthly payout to our BRAC account.',
      },
    });
    console.log(`  · one withdrawal request waiting (₹${DESK_WITHDRAWAL_INR})`);
  }

  if (slug === 'move-money-by-hand') {
    await unpostStaffTransfers(sellerId);
  }

  if (slug === 'the-bank-book') {
    await unpostTutorialReconciliations();
  }

  if (slug === 'approve-a-bank-change') {
    // The change this take approves. Approving WRITES THE NEW ACCOUNT
    // THROUGH, so a second take would find the seller already on the new
    // details and `pendingBankChange` would raise nothing — it compares
    // what is on file. Putting the original account back first is what
    // makes the request raisable again.
    await prisma.sellerBankChangeRequest.deleteMany({ where: { sellerId } });
    await pendingBankChange(sellerId, sellerToken);
  }
}

/**
 * A wallet with money in it, reached the way a seller reaches it.
 *
 * Through the two real endpoints rather than a ledger insert: the
 * accepted claim is on camera in N1 and N2 (the Credited tab prints its
 * note and its reference in full), and a TOPUP ledger row whose claim
 * does not exist is a row the screen cannot explain.
 */
async function ensureWalletHasMoney(sellerId, sellerToken, staffToken) {
  const last = await prisma.sellerWalletEntry.findFirst({
    where: { sellerId, currency: 'INR' },
    orderBy: { id: 'desc' },
    select: { runningBalanceAfter: true },
  });
  const balance = Number(last?.runningBalanceAfter ?? 0);
  if (balance >= WALLET_FLOOR_INR) {
    console.log(`  · wallet holds ₹${balance.toLocaleString('en-IN')}`);
    return;
  }
  const { accounts } = await call('/seller/wallet/topups/bank-accounts', {
    token: await sellerToken(),
  });
  const account = (accounts ?? []).find((a) => a.currency === 'INR');
  if (account === undefined) {
    throw new Error('No active rupee platform bank account — run the db seed first.');
  }
  const claim = await call('/seller/wallet/topups', {
    method: 'POST',
    token: await sellerToken(),
    body: {
      bankAccountId: account.id,
      amount: WALLET_FLOOR_INR - balance,
      transactionRef: `NEFT${Date.now().toString().slice(-10)}`,
    },
  });
  await call(`/admin/wallet/topups/${claim.id}/accept`, {
    method: 'POST',
    token: staffToken,
    body: { note: TOPUP_ACCEPT_NOTE },
  });
  console.log(`  · wallet topped up to ₹${WALLET_FLOOR_INR.toLocaleString('en-IN')}`);
}

/**
 * Put back what an N5 take recorded.
 *
 * A settlement is append-mostly in production — the product's own answer
 * to a mistake is an adjusting payout, never an edit (SETL-1) — and that
 * is the right rule and the wrong one for a camera, because the second
 * take would open on a float of zero under a line about money the
 * courier has not paid us yet.
 *
 * So the take's OWN rows go: the payout, its lines, and the wallet
 * entries the credit wrote. The wallet chain survives it because these
 * are the NEWEST entries on the wallet — the take made them minutes ago
 * — so nothing downstream of them has a running balance to be wrong.
 * It refuses rather than guesses if that stops being true.
 */
async function unrecordTutorialPayouts(sellerId) {
  const settlements = await prisma.courierSettlement.findMany({
    where: { reference: { startsWith: DESK_PAYOUT_PREFIX } },
    select: { id: true, reference: true },
  });
  if (settlements.length === 0) return;
  const ids = settlements.map((s) => s.id);
  const lines = await prisma.courierSettlementLine.findMany({
    where: { settlementId: { in: ids } },
    select: { orderId: true },
  });
  const orderIds = [...new Set(lines.map((l) => l.orderId))];

  const touched = await prisma.sellerWalletEntry.findMany({
    where: { sellerId, linkedOrderId: { in: orderIds } },
    select: { id: true, direction: true },
    orderBy: { id: 'desc' },
  });
  const settlementWritten = touched.filter((e) =>
    ['COD_COLLECTION', 'GST_WITHHOLDING', 'COD_COLLECTION_FEE', 'INSTANT_PAY_FEE'].includes(
      e.direction,
    ),
  );
  const newest = await prisma.sellerWalletEntry.findMany({
    where: { sellerId },
    select: { id: true },
    orderBy: { id: 'desc' },
    take: settlementWritten.length,
  });
  const removable = new Set(settlementWritten.map((e) => e.id));
  if (!newest.every((e) => removable.has(e.id))) {
    throw new Error(
      'The COD credit is no longer the newest thing on this wallet — removing it would leave ' +
        'every later running balance wrong. Reseed the box instead of filming N5 on it.',
    );
  }

  await prisma.$transaction([
    prisma.sellerWalletEntry.deleteMany({ where: { id: { in: [...removable] } } }),
    prisma.courierSettlementLine.deleteMany({ where: { settlementId: { in: ids } } }),
    prisma.courierSettlement.deleteMany({ where: { id: { in: ids } } }),
  ]);
  console.log(
    `  · un-recorded ${settlements.length} tutorial payout(s) and the ${removable.size} ` +
      `wallet entr(ies) they wrote`,
  );
}

/** What N5 types as the courier's own payout reference, on camera. */
const DESK_PAYOUT_PREFIX = 'UTR-TUT-';

/**
 * N5's remittance export — the file the video uploads.
 *
 * WRITTEN BY THE SEED, not committed, and the reason is the whole point
 * of the file: a courier's export names WAYBILLS, and the waybills on
 * this box were minted by the local simulator on this run. A committed
 * fixture cannot carry them, and the only other way to allocate a payout
 * is to type an order's uuid into a form on camera, which teaches
 * nothing and is unwatchable.
 *
 * The columns are Delhivery's own (`RemittanceParserService`): `Waybill
 * Number` and `Amount Payable` are required, the rest are read when they
 * are there. One of the two parcels is paid SHORT by fifty rupees,
 * because the short-payment line is a scene of its own — the seller is
 * credited what the ORDER was worth either way (WAL-6) and the
 * difference sits visibly against our money rather than quietly against
 * theirs.
 */
const DESK_PAYOUT_SHORT_INR = 50;

async function writeRemittanceExport(sellerId) {
  const orders = await prisma.order.findMany({
    where: {
      sellerId,
      status: 'DELIVERED',
      codAmountInr: { not: null },
      /*
        NOT ALREADY SETTLED. The demo world carries one COD that an
        earlier payout covers (`settleOneCodForLedger`'s, which every
        other money-desk slug writes and `unrecordTutorialPayouts`
        deliberately leaves alone), and a file naming it made the form
        warn "Already settled on an earlier payout" in the middle of the
        scene about allocating — honest, and about something the
        narration is not saying. Worse, the figure the operator types
        then only matched by luck: it is the total of the rows that WERE
        allocated, which is the file's total minus whatever happened to
        be settled. The file now holds exactly what this payout pays for.
      */
      courierSettlementLines: { none: {} },
    },
    select: { id: true, orderNumber: true, codAmountInr: true },
    orderBy: { createdAt: 'asc' },
  });
  const rows = [];
  for (const [i, o] of orders.entries()) {
    const shipment = await prisma.shipment.findFirst({
      where: {
        orderShipments: { some: { orderId: o.id } },
        supersededAt: null,
        deletedAt: null,
        awbNumber: { not: null },
      },
      select: { awbNumber: true },
      orderBy: { createdAt: 'desc' },
    });
    if (shipment?.awbNumber == null) continue;
    const cod = Number(o.codAmountInr);
    rows.push({ awb: shipment.awbNumber, cod, payable: cod, ref: o.orderNumber });
  }
  /*
    THE LAST ROW IS THE SHORT ONE, and which row it is matters because a
    scene points at it. It used to be the one at index 1 of every
    delivered COD order, which is not the same as index 1 of the lines
    the FORM draws — rows the file names and the form cannot place are
    left out, so the short row moved as soon as anything was skipped,
    and the scene about a short payment haloed a line that had been paid
    in full. Last is the one position the flow can name without counting
    (`.last()`), and that exactly one row is short is what the scene
    needs — a file where everything balances has no short-payment scene
    in it, and a file where nothing does teaches the opposite.
  */
  const short = rows.at(-1);
  if (short !== undefined) short.payable = short.cod - DESK_PAYOUT_SHORT_INR;
  if (rows.length < 2) {
    throw new Error(
      `N5 needs two delivered COD parcels with waybills; found ${rows.length}. ` +
        'Run the lifecycle pass first.',
    );
  }

  const csv = [
    'Waybill Number,Order Number,COD Amount,Amount Payable,Status',
    ...rows.map((r) => `${r.awb},${r.ref},${r.cod}.00,${r.payable}.00,Delivered`),
  ].join('\n');
  await fs.mkdir(GENERATED_DIR, { recursive: true });
  const file = path.join(GENERATED_DIR, REMITTANCE_EXPORT_FILE);
  await fs.writeFile(file, `${csv}\n`, 'utf8');
  const total = rows.reduce((n, r) => n + r.payable, 0);
  /*
    WHAT THE OPERATOR TYPES, written down rather than guessed.

    The amount is typed from the BANK STATEMENT before the file is
    uploaded, so the flow cannot read it off the lines — and a constant
    in `flows.mjs` was only ever right for the set of parcels this box
    happened to have. It is exactly the thing `lib/fixture.mjs` exists
    for: a number the operator arrives already holding.
  */
  await writeFixture('record-a-courier-payout', {
    totalInr: total,
    shortInr: DESK_PAYOUT_SHORT_INR,
    parcels: rows.length,
  });
  console.log(
    `  · remittance export written: ${rows.length} parcel(s), ₹${total} payable ` +
      `(one short by ₹${DESK_PAYOUT_SHORT_INR})`,
  );
  return total;
}

/** The name both the seed and the flow use. One place, so they cannot disagree. */
const REMITTANCE_EXPORT_FILE = 'courier-remittance.csv';

/**
 * Put back what an N6 take posted.
 *
 * A staff transfer is an append-only ledger row AND a pair of bank
 * entries, and the product has no way to withdraw one — a mistake is put
 * right with a transfer the OTHER way, which is the lesson of the video
 * and the wrong thing for a camera, because the second take would open
 * on a history of four transfers under a line describing one.
 *
 * So the take's own rows go: the wallet entry, and every bank entry
 * carrying its id as a reference — which is how `StaffWalletTransferService`
 * links the pair, in both directions. Deleting BOTH halves is what keeps
 * the bank book's "held for a seller equals the positive part of their
 * wallet" invariant true (TRE-8); deleting the wallet row alone would
 * leave cash attributed to somebody who is no longer owed it.
 *
 * Guarded on these being the NEWEST entries on the wallet, for the same
 * reason the settlement one is: a running balance is stamped, not
 * recomputed, so removing an entry with anything after it would leave
 * every later balance wrong.
 */
async function unpostStaffTransfers(sellerId) {
  const staff = await prisma.sellerWalletEntry.findMany({
    where: { sellerId, direction: { in: ['STAFF_DEBIT', 'STAFF_CREDIT'] } },
    select: { id: true },
    orderBy: { id: 'desc' },
  });
  if (staff.length === 0) return;
  const newest = await prisma.sellerWalletEntry.findMany({
    where: { sellerId },
    select: { id: true },
    orderBy: { id: 'desc' },
    take: staff.length,
  });
  const ids = new Set(staff.map((e) => e.id));
  if (!newest.every((e) => ids.has(e.id))) {
    throw new Error(
      'A staff transfer is no longer the newest thing on this wallet — removing it would leave ' +
        'every later running balance wrong. Reseed the box instead of filming N6 on it.',
    );
  }
  const bank = await prisma.bankEntry.deleteMany({ where: { reference: { in: [...ids] } } });
  await prisma.sellerWalletEntry.deleteMany({ where: { id: { in: [...ids] } } });
  console.log(
    `  · un-posted ${ids.size} staff transfer(s) and the ${bank.count} bank entr(ies) they wrote`,
  );
}

/**
 * The reason N7 types into the reconcile dialog, and therefore the
 * handle on the entries it leaves. Kept in step with `flows.mjs` by
 * `test/tutorial-labels.test.mjs` — the M1 pattern.
 */
const N7_RECONCILE_REASON =
  'HDFC charged a wire fee on the September remittance that we had never recorded.';

/**
 * Put back what an N7 take posted.
 *
 * A reconciliation is APPEND-ONLY and the product has no way to withdraw
 * one — which is the lesson of the video, so rewinding it on camera
 * would teach the opposite. But leaving it has a sharper cost than
 * untidiness: the take types a STATEMENT FIGURE and the adjustment moves
 * the book to exactly it, so the SECOND take would open on a book that
 * already agrees, post a difference of zero, and film a scene about
 * correcting a disagreement with nothing to correct.
 *
 * Found by its reason rather than by its type, because a reconciliation
 * somebody else posts is history and not ours to remove. `BankLedgerService`
 * is the only writer of these rows and nothing downstream stores a
 * running total — a balance on this page is the SUM of its entries,
 * which the page says out loud — so removing one is complete.
 */
async function unpostTutorialReconciliations() {
  const rows = await prisma.bankEntry.findMany({
    where: { type: 'RECONCILIATION_ADJUSTMENT', note: { contains: N7_RECONCILE_REASON } },
    select: { id: true, isOpeningBalance: true },
  });
  if (rows.length === 0) return;
  // An entry somebody has since MARKED as the opening balance is a
  // different thing from the one the take posted: there is one per
  // account and the product refuses a second, so deleting it would let
  // the next person mark another and quietly change what the P&L leaves
  // out. Leave it and say so.
  const removable = rows.filter((r) => !r.isOpeningBalance);
  if (removable.length < rows.length) {
    console.log(
      `  · left ${rows.length - removable.length} tutorial reconciliation(s) that have been ` +
        'marked as an opening balance',
    );
  }
  if (removable.length === 0) return;
  await prisma.bankEntry.deleteMany({ where: { id: { in: removable.map((r) => r.id) } } });
  console.log(`  · un-posted ${removable.length} tutorial reconciliation(s)`);
}

/**
 * Put back what an N8 take billed.
 *
 * The take RECORDS a bill and ends by WITHDRAWING it, so on a clean run
 * there is nothing here to do — FRT-7 made the one-live-bill-per-receipt
 * index partial (`WHERE voided_at IS NULL`) exactly so a withdrawn bill
 * blocks nothing. What this is for is the run that did NOT finish: a
 * check that failed after the record leaves a LIVE bill on the only
 * billable arrival, and the next take's form draws that option DISABLED
 * with nothing to say why.
 *
 * Withdrawn through the product's own endpoint rather than deleted,
 * which is the rule the rest of this file follows: a void refunds
 * whatever the bill had charged (`INBOUND_FREIGHT_REFUND`, WAL-1) and a
 * hand-deleted row would leave that debit on the wallet with nothing to
 * explain it. The reason says what it was, because somebody reading the
 * seller's ledger later deserves better than a blank.
 */
async function withdrawTutorialFreightBills(sellerId, staffToken) {
  const bills = await call(`/admin/inbound-freight?sellerId=${sellerId}`, { token: staffToken });
  const live = (bills ?? []).filter((b) => b.voidedAt == null);
  if (live.length === 0) return;
  for (const b of live) {
    await call(`/admin/inbound-freight/${b.id}/void`, {
      method: 'POST',
      token: staffToken,
      body: {
        reason: 'Withdrawn by the tutorial seeding: a take recorded this bill and did not finish.',
      },
    });
  }
  console.log(`  · withdrew ${live.length} freight bill(s) a previous take left live`);
}

async function main() {
  assertStack();
  console.log(`Seeding tutorial demo data against ${API}`);

  const staffToken = await ensureOps();
  const { token: sellerToken, id: sellerId } = await ensureSeller(staffToken);
  console.log(`  · seller "${DEMO_SELLER.companyName}" ready (${DEMO_SELLER.email})`);

  // The one that FULFILS, by name rather than by being first in a list.
  // `ensureBdIntakeWarehouse` adds a Bangladesh warehouse that does not
  // (CNS-2), and `/admin/warehouses` does not promise an order — so
  // `warehouses[0]` was a coin toss between the right answer and a
  // putaway refused as "must be a non-hold bin in the receipt warehouse",
  // which names neither the warehouse nor the cause.
  const warehouses = await call('/admin/warehouses', { token: staffToken });
  const warehouse = warehouses.find((w) => w.fulfilsOrders === true);
  if (warehouse === undefined) {
    throw new Error(
      `No order-fulfilling warehouse in this database (${warehouses.length} found) — ` +
        'run the db seed first.',
    );
  }
  const bins = await call(`/admin/warehouses/${warehouse.id}/bins`, { token: staffToken });
  // A bin is optional when the warehouse is not bin-tracking; BinPolicy
  // self-heals a missing FLOOR bin on first putaway (BIN-1).
  const binId = bins.find((b) => b.type === 'STORAGE' || b.type === 'FLOOR')?.id ?? null;

  await resetCatalogueEdits(sellerId);

  for (const item of CATALOGUE) {
    await ensureStockedVariant(sellerToken, staffToken, binId, item);
  }

  await ensureBdIntakeWarehouse(staffToken);
  await ensureReturnsBins(staffToken, warehouse);

  await clearVariantPhotos(sellerId);
  await clearTutorialProduct(sellerId);
  await clearPreviousOrders(sellerId);
  await clearDeliveryTakeArtefacts(sellerId);
  await clearPreviousImports(sellerId);
  await clearCatalogueImport(sellerId);
  await clearTutorialConsignments(sellerId);
  await clearTutorialSettings(sellerId);

  // Per-video tailoring, AFTER the clearing. The slug is optional: with
  // none, this is the shared world every video that needs nothing extra
  // records against.
  const slug = process.argv[2];
  if (slug === 'find-your-way-around') await placeTourOrders(sellerToken);
  if (slug === 'invite-a-colleague') await ensureTeamColleague(sellerId, sellerToken);
  await editDraftWorldFor(slug, sellerId, sellerToken);
  await cancelWorldFor(slug, sellerId, sellerToken);
  await callWorldFor(slug, sellerId, sellerToken, staffToken);
  await superviseWorldFor(slug, sellerId, sellerToken);
  await reattemptWorldFor(slug, sellerId, sellerToken, staffToken);
  await deliveryAsksWorldFor(slug, sellerId, sellerToken);
  await binsWorldFor(slug, staffToken);
  await collapseWorldFor(slug, staffToken);
  await adjustmentWorldFor(slug, sellerId, staffToken, warehouse);
  await cycleCountWorldFor(slug, sellerId, staffToken, warehouse);
  await courierAccountWorldFor(slug);
  await delhiveryHealthWorldFor(slug);
  await leadsWorldFor(slug);
  await sellerAccountWorldFor(slug, staffToken);
  await sellerRoutingWorldFor(slug, staffToken);
  await systemSettingsWorldFor(slug);
  await staffWorldFor(slug);
  await manualPlacementWorldFor(slug, sellerId, sellerToken, staffToken);
  await transferWorldFor(slug, sellerId, sellerToken, staffToken);
  await pickupWorldFor(slug, staffToken);
  await receiveWorldFor(slug, sellerId, sellerToken, staffToken);
  await pickWorldFor(slug, sellerId, sellerToken, staffToken);
  await pendingRowsWorldFor(slug, sellerId, sellerToken);
  await notificationWorldFor(slug, sellerId);
  await walletWorldFor(slug, sellerId, sellerToken, staffToken);
  await integrationsWorldFor(slug, sellerId);
  await resellingWorldFor(slug, sellerId, sellerToken);
  // G6's world — a SECOND reseller store with orders on it. Expensive
  // (one of its three parcels goes the whole way to out-for-delivery) and
  // so, like D0, only for the videos that need it.
  await storeRequestsWorldFor(slug, sellerId, sellerToken, staffToken);
  // P5's three — a bank change waiting, a month frozen, and (through D0
  // below) a return standing at the door.
  await dangerousActsWorldFor(slug, sellerId, sellerToken, staffToken);
  // H3's board — the real attention sweep, then the simulator's label
  // noise closed so the twelve issues that teach something are visible.
  await systemIssueWorldFor(slug, staffToken);

  // D0 — the parcels sections D, E and K are about. EXPENSIVE (a real
  // courier booking and a warehouse run per parcel) and IDEMPOTENT, so
  // it runs only for the videos that need it, or when asked by name.
  if (LIFECYCLE_SLUGS.has(slug ?? '') || process.argv.includes('--lifecycle')) {
    console.log('\nDriving the lifecycle parcels (this takes a couple of minutes)…');
    await ensureLifecycleParcels({ sellerId, sellerToken, staffToken, log: (m) => console.log(m) });
    const report = await lifecycleReport(sellerId);
    console.log('\nLifecycle parcels:');
    for (const r of report) {
      console.log(`  ${r.ok ? '\u2713' : '\u2717'} ${r.ref.padEnd(22)} ${r.got ?? 'missing'}`);
    }
    const bad = report.filter((r) => !r.ok);
    if (bad.length > 0) {
      throw new Error(`${bad.length} lifecycle parcel(s) are not in the state they should be.`);
    }
  }

  // K2 — AFTER D0, because D0 is what retires a spent parcel and builds
  // the fresh one this receives. Running it before would take in the
  // parcel the next take was about to replace.
  await returnsBenchWorldFor(slug, sellerId, staffToken);

  // C0 — the consignment world sections C and E read (C1, C2, E5).
  // Two consignments: one that has landed with its counts deliberately
  // disagreeing, and one still in the air so `/inventory`'s in-transit
  // column is not zero. BUILD-ONCE and idempotent; neither video writes
  // on a consignment, so a re-take needs no rebuild.
  if (CONSIGNMENT_SLUGS.has(slug ?? '') || process.argv.includes('--consignments')) {
    console.log('\nBuilding the consignment world…');
    await ensureConsignmentWorld({ sellerId, sellerToken, staffToken, log: (m) => console.log(m) });
    const report = await consignmentReport(sellerId);
    console.log('\nConsignments:');
    for (const r of report) {
      console.log(`  ${r.ok ? '\u2713' : '\u2717'} ${r.ref.padEnd(16)} ${r.got ?? 'missing'}`);
    }
    const bad = report.filter((r) => !r.ok);
    if (bad.length > 0) {
      throw new Error(`${bad.length} consignment(s) are not in the state they should be.`);
    }
  }

  // E5 — a freight bill that is genuinely PART-owed. Needs C0's landed
  // consignment (above) and drives a whole parcel out of its batch, so
  // it runs last of the world-builders and only when asked.
  if (FREIGHT_SLUGS.has(slug ?? '') || process.argv.includes('--freight')) {
    console.log('\nBuilding the freight world…');
    await ensureFreightWorld({ sellerId, sellerToken, staffToken, log: (m) => console.log(m) });
    const report = await freightReport(sellerId);
    console.log('\nFreight bills:');
    for (const r of report) {
      console.log(
        `  ${r.ok ? '\u2713' : '\u2717'} ${r.receiptNumber.padEnd(26)} ${r.status.padEnd(18)} ` +
          `\u20b9${r.chargedInr} of \u20b9${r.totalInr} \u00b7 ${r.unitsSettled}/${r.units} units`,
      );
    }
    const bad = report.filter((r) => !r.ok);
    if (bad.length > 0) {
      throw new Error(`${bad.length} freight bill(s) are not part-owed as E5 needs.`);
    }
  }

  // Section N — the money desk, AFTER the parcels have moved for the
  // same reason E2's ledger is: the COD credit it settles needs a
  // DELIVERED order, and `walletWorldFor` above has already removed the
  // previous take's withdrawal requests so this can re-create the one
  // N1 and N3 film.
  await moneyDeskWorldFor(slug, sellerId, sellerToken, staffToken);
  // N8 is NOT a money-desk slug (its world is the consignment pass), so
  // its cleanup hangs here rather than inside `moneyDeskWorldFor` —
  // which would have run for every slug except the one that needs it.
  if (slug === 'bill-the-freight') {
    await withdrawTutorialFreightBills(sellerId, staffToken);
  }

  // E2's ledger, AFTER the parcels have moved — the COD credit needs a
  // delivered order to settle, and the pending rows need a wallet that
  // already has a balance to ask against.
  if (slug === 'read-your-wallet') await ledgerWorldForReading(sellerId, sellerToken, staffToken);

  console.log('\nReady.');
  // THIS stack's seller console, never a literal port: it said
  // `localhost:3003` for every stack, so a stack-B seed finished by
  // telling whoever read it to go and look at stack A.
  const stack = resolveStack();
  console.log(
    `  SELLER  ${stack.seller.url}  ${DEMO_SELLER.email} / ${DEMO_SELLER.password}` +
      `   [stack ${stack.name}]`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(`\n${e.message}`);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
