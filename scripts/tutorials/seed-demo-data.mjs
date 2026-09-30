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
import { prisma, argon2 } from './lib/deps.mjs';
import { MOCK_ROOT, mockObjectPath } from './lib/spaces-shim.mjs';
import { TUTORIALS_DIR } from './lib/paths.mjs';
import { API, call } from './lib/api.mjs';
import {
  driveOrderThrough,
  driveOrderToOutForDelivery,
  ensureLifecycleParcels,
  lifecycleReport,
  LIFECYCLE_PARCELS,
} from './lib/lifecycle.mjs';
import { clearLoginThrottle } from './lib/clear-login-throttle.mjs';
import { ensureConsignmentWorld, consignmentReport } from './lib/consignments.mjs';

/** The staff account the seeding needs — goods receipts are received by ops, not by the seller. */
const OPS = { email: 'tutorial-ops@skydrop.local', password: 'Tutorial-Ops-2026' };

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
const CONSIGNMENT_SLUGS = new Set(['follow-a-consignment', 'read-your-stock']);

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
  // B7 cancels `RSH-LIFE-CONFIRMED` on camera — the second of its two
  // orders, and the one that has stock held and a waybill booked. It is
  // `spendable` for that reason, so this pass retires the spent one and
  // builds a fresh one each run.
  'cancelling-an-order',
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
const PROTECTED_REF_PREFIXES = [LIFECYCLE_REF_PREFIX, 'RSH-STORE-'];

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

function assertLocal() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/(^|@|\/\/)(127\.0\.0\.1|localhost)(:|\/)/.test(url)) {
    throw new Error(
      `Refusing to seed: DATABASE_URL does not look local (${url.replace(/:[^:@/]*@/, ':***@')}).`,
    );
  }
}

function hash(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

/** Ops staff, password force-set so a re-run always authenticates. */
async function ensureOps() {
  const passwordHash = await hash(OPS.password);
  // RBAC is a ROW, not only the legacy `role` enum — a staff user without
  // a `staffRole` cannot be created at all, and one created with the enum
  // alone would hold no permissions.
  const superAdmin = await prisma.staffRoleDefinition.findFirstOrThrow({
    where: { key: 'super_admin' },
    select: { id: true },
  });
  await prisma.staffUser.upsert({
    where: { email: OPS.email },
    update: {
      passwordHash,
      role: 'SUPER_ADMIN',
      staffRole: { connect: { id: superAdmin.id } },
      deletedAt: null,
    },
    create: {
      email: OPS.email,
      emailDisplay: OPS.email,
      passwordHash,
      role: 'SUPER_ADMIN',
      staffRole: { connect: { id: superAdmin.id } },
    },
  });
  const login = await call('/auth/staff/login', { method: 'POST', body: OPS });
  return login.accessToken;
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
          roleKey: 'owner',
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
  if (!STORE_ORDER_SLUGS.has(slug ?? '') && !STORE_REPORT_SLUGS.has(slug ?? '')) return;
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
  await prisma.$transaction([
    prisma.orderCharge.deleteMany({ where: { orderId: { in: ids } } }),
    prisma.callQueueEntry.deleteMany({ where: { orderId: { in: ids } } }),
    prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } }),
    prisma.orderEvent.deleteMany({ where: { orderId: { in: ids } } }),
    prisma.order.deleteMany({ where: { id: { in: ids } } }),
  ]);
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

async function main() {
  assertLocal();
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
  await pendingRowsWorldFor(slug, sellerId, sellerToken);
  await notificationWorldFor(slug, sellerId);
  await walletWorldFor(slug, sellerId, sellerToken, staffToken);
  await integrationsWorldFor(slug, sellerId);
  await resellingWorldFor(slug, sellerId, sellerToken);
  // G6's world — a SECOND reseller store with orders on it. Expensive
  // (one of its three parcels goes the whole way to out-for-delivery) and
  // so, like D0, only for the videos that need it.
  await storeRequestsWorldFor(slug, sellerId, sellerToken, staffToken);

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

  // E2's ledger, AFTER the parcels have moved — the COD credit needs a
  // delivered order to settle, and the pending rows need a wallet that
  // already has a balance to ask against.
  if (slug === 'read-your-wallet') await ledgerWorldForReading(sellerId, sellerToken, staffToken);

  console.log('\nReady.');
  console.log(`  SELLER  http://localhost:3003  ${DEMO_SELLER.email} / ${DEMO_SELLER.password}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(`\n${e.message}`);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
