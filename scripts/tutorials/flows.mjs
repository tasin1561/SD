/**
 * What the camera actually does, per video, one function per narrated
 * step.
 *
 * A step's function only has to PERFORM the action — `record.mjs` holds
 * the scene open for at least as long as its narration clip, so a short
 * action is padded rather than rushed and a long one simply makes the
 * scene longer. That is why nothing here counts seconds: the audio owns
 * the timing, the flow owns the actions.
 *
 * Keys match `narration.mjs` step ids exactly. A mismatch is caught by
 * `record.mjs` before the browser opens, because a step with no action
 * would otherwise record a still frame and nobody would notice until the
 * video was watched.
 */
import path from 'node:path';
import { GENERATED_DIR, TUTORIALS_DIR } from './lib/paths.mjs';
import { readFixture } from './lib/fixture.mjs';

/**
 * The CSV the bulk-import video uploads. A COMMITTED fixture rather than
 * a file written at record time: what the preview says about it — six
 * rows, four orders, one that will not import — is narrated word for
 * word, so the file and the words have to move together or not at all.
 */
const BULK_CSV = path.join(TUTORIALS_DIR, 'fixtures', 'rangpur-bulk-orders.csv');

/** The two rows of that file which share one reference, hence one order. */
const BULK_MULTI_LINE_REF = 'RSH-2026-0501';

/** Who the demo order goes to. Plausible, and nobody real. */
const CUSTOMER = {
  name: 'Ananya Iyer',
  phone: '9845017722',
  line1: '412, Brigade Gateway, Malleshwaram West',
  line2: 'Opposite Orion Mall, next to the HDFC ATM',
  pin: '560055',
  reference: 'RSH-2026-0412',
  note: 'Customer asked for delivery after 5pm on weekdays.',
  collectable: '4400',
};

/** The product the second video creates. Keep in step with seed-demo-data.mjs. */
const NEW_PRODUCT = {
  name: 'Rajshahi Silk Kurti',
  externalRef: 'RSH-KURTI',
  weightGrams: '320',
  declaredValueInr: '1750',
  colours: ['Emerald', 'Indigo'],
  sizes: ['Medium', 'Large'],
  editedSku: 'RSH-KURTI-EMR-M',
};

/**
 * The catalogue the C6 video uploads, and the mapping it teaches.
 *
 * A COMMITTED fixture with the SELLER's OWN HEADERS, which is the whole
 * subject: `Item`, `Style code`, `Net wt (g)`, `MRP` and the three `Box`
 * columns are in no alias list, so auto-detection gets the SKU, the
 * barcode and the options and nothing else — and `productName` is
 * REQUIRED, so the import is blocked until the mapping exists. The
 * preview's figures are narrated word for word.
 */
const CATALOGUE_CSV = path.join(TUTORIALS_DIR, 'fixtures', 'rangpur-catalogue.csv');

const CATALOGUE_MAPPING = {
  name: 'Our stock sheet',
  // Our field name on the left, the sheet's header on the right — the
  // dialog's own description, in that order.
  json: JSON.stringify(
    {
      productName: 'Item',
      productExternalRef: 'Style code',
      weightGrams: 'Net wt (g)',
      lengthCm: 'Box L',
      widthCm: 'Box W',
      heightCm: 'Box H',
      declaredValueInr: 'MRP',
    },
    null,
    2,
  ),
  /** One of the products the file creates, to prove it landed. */
  checkProduct: 'Katan Silk Panjabi',
};

/**
 * D2's parcel and what the seller types on it. `FAILED_CUSTOMER` is D0's
 * `RSH-LIFE-FAILED` recipient — keep in step with `lib/lifecycle.mjs`.
 */
const FAILED_CUSTOMER = 'Vikram Desai';
/**
 * The issue D6 raises on camera, and D0's delivered parcel it is about.
 *
 * The category is chosen BY LABEL: the list is Delhivery's own and is
 * ordered by their id, so the first entry is "Behaviour complaint
 * against staff" — which has nothing to do with a missing saree.
 */
const DELIVERED_CUSTOMER = 'Lakshmi Raghavan';

const ISSUE = {
  category: 'Damage / Missing / Mismatch',
  subcategory: 'Missing shipment delivered/returned',
  description:
    'Customer says the box arrived open and one of the two sarees is missing. They have sent photographs of the packaging, which I can forward.',
};

/**
 * The three tasks G5 works, by the label the page prints.
 *
 * Three of seven, chosen for the argument rather than for coverage: the
 * gentlest set to direct, the most dangerous set to needs-my-approval,
 * and one turned off entirely. A scene per row would be a list.
 */
const CAPABILITY = {
  recall: 'Call the customer again',
  sendBack: 'Send the parcel back',
  cancel: 'Call the order off',
};

/** One row of the what-they-can-do matrix, by its task label. */
async function capabilityRow(page, label) {
  const row = page.getByRole('row').filter({ hasText: label }).first();
  await row.waitFor({ state: 'visible', timeout: 25_000 });
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  return row;
}

/**
 * Get to the standing reseller store's page.
 *
 * Shared by G4 and G5 rather than copied: both open the same store from
 * the same list, and two copies of a navigation is two places to fix
 * when the list's markup moves.
 */
async function openStandingStore(page, stage) {
  await stage.clickIt(page.getByRole('link', { name: 'Reseller stores', exact: true }).first(), {
    after: 1600,
  });
  await page.waitForURL(/\/reseller-stores$/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);
  const row = page.getByRole('row').filter({ hasText: RESELLER.storeName }).first();
  await row.waitFor({ state: 'visible', timeout: 25_000 });
  await stage.clickIt(row.getByRole('link').first(), { after: 1800 });
  await page.waitForURL(/\/reseller-stores\/[0-9a-f-]+$/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);
}

/**
 * What G6's take reaches for, in the store's own words.
 *
 * Each is the text a ROW carries, because that is the only stable way to
 * name one: the queue is oldest-first and the cancel order is REMADE on
 * every take (its own take approves it and ends it), so "the first row"
 * points at a different order every time. Keep in step with
 * `STORE_REQUEST_ORDERS` in seed-demo-data.mjs.
 */
const STORE_REQUEST = {
  cancelAskedTo: 'call the order off',
  issueAskedTo: 'raise an issue with Skydrop',
  deliveryAskedFor: 'Send the parcel back',
  reason:
    'The customer has not said no to us — our call centre is still trying her, and a return costs the fee both ways. Give it two more days.',
};

/** One waiting request, found by what it says rather than where it sits. */
async function storeRequestRow(page, asked) {
  const row = page.getByRole('row').filter({ hasText: asked }).first();
  await row.waitFor({ state: 'visible', timeout: 25_000 });
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  return row;
}

/**
 * The DRAFT order B6 edits on camera, and the landmark it rewrites.
 * Keep in step with `EDIT_DRAFT` in seed-demo-data.mjs.
 */
const EDIT_DRAFT = {
  ref: 'RSH-EDIT-DRAFT',
  sku: 'RSH-KANTHA-BLUE',
  betterLine2: 'The lane beside Holy Ghost church, third gate on the left',
};

/**
 * The order B5 reads, and how it is reached.
 *
 * BY ITS OWN REFERENCE, through the list's search: `RSH-LIFE-DELIVERED`
 * is stable across every rebuild of the demo box and an order id is not.
 * Keep in step with `LIFECYCLE_PARCELS` in lib/lifecycle.mjs.
 */
const ORDER_READ = { ref: 'RSH-LIFE-DELIVERED' };

/**
 * B7's three orders, each teaching a different point in the window.
 *
 * `pending` is placed fresh by `cancelWorldFor` on every seed run and
 * is spent by the take; `confirmed` is D0's `RSH-LIFE-CONFIRMED`,
 * which is `spendable` for the same reason; `past` is only LOOKED at,
 * so nothing on it is written and no artefact needs clearing.
 *
 * Keep in step with `CANCEL_PENDING` in seed-demo-data.mjs and
 * `LIFECYCLE_PARCELS` in lib/lifecycle.mjs.
 */
const CANCEL_ORDERS = {
  pending: { ref: 'RSH-CANCEL-PENDING', reason: 'She found the same throw in a shop near her.' },
  confirmed: { ref: 'RSH-LIFE-CONFIRMED' },
  past: { ref: 'RSH-LIFE-OVERDUE' },
};

/**
 * Open one of this seller's orders by ITS OWN reference, through the
 * list — never by `goto`.
 *
 * The camera records the page and never the browser's address bar, so a
 * URL jump reads as the screen changing for no reason; searching is
 * also the path B4 teaches.
 *
 * THE ROW IS MATCHED ON AN EXACT REF, which is not fussiness. The list
 * searches `contains`, and this library retires a spent order by moving
 * its reference to `<ref>-SPENT-<n>` rather than deleting it — so
 * "RSH-LIFE-CONFIRMED" matches every take's leavings as well as the one
 * that is ready. The reference has its own element in the row
 * (`span.sk-ident`), so an exact text match picks the canonical one and
 * nothing else.
 */
async function openOrderByRef(page, stage, ref) {
  await stage.clickIt(page.getByRole('link', { name: 'Orders', exact: true }).first(), {
    after: 1600,
  });
  await page.waitForURL(/\/orders$/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await stage.typeIn(page.getByLabel('Search orders'), ref, { clear: true, after: 500 });
  await page.keyboard.press('Enter');
  await page.waitForLoadState('networkidle').catch(() => {});
  const row = page
    .getByRole('row')
    .filter({ has: page.getByText(ref, { exact: true }) })
    .first();
  await row.waitFor({ state: 'visible', timeout: 25_000 });
  /*
    SETTLE BEFORE CLICKING. Typing into the search box pushes the filter
    into the URL, and the list re-renders when the query behind it comes
    back — which happens AFTER `networkidle` has already fired once. The
    first run of this flow found the row, began scrolling to its link,
    and the row was replaced underneath it ("Element is not attached to
    the DOM"). The retry is the belt to that brace: a detached element
    is the one failure here that a second attempt genuinely fixes.
  */
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
  try {
    await stage.clickIt(row.getByRole('link').first(), { after: 1800 });
  } catch (err) {
    if (!String(err).includes('not attached')) throw err;
    await page.waitForTimeout(1200);
    await stage.clickIt(row.getByRole('link').first(), { after: 1800 });
  }
  await page.waitForURL(/\/orders\/[0-9a-f-]+$/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  // Its own reference under the number is what proves the RIGHT order
  // opened — the order number changes with every rebuild.
  await page.getByText(`Your ref: ${ref}`).first().waitFor({ state: 'visible', timeout: 25_000 });
  await page.waitForTimeout(900);
}

/**
 * The two SKUs C2 points at on the stock register.
 *
 * `RESERVED_SKU` is the one D0's confirmed parcel has claimed a unit
 * of, so its Reserved column is not a zero; `TRANSIT_SKU` is on C0's
 * flying consignment, so its In-transit column is not a dash. Keep in
 * step with `LIFECYCLE_SKU` in lib/lifecycle.mjs and with
 * `TUTORIAL_CONSIGNMENTS` in lib/consignments.mjs.
 */
const RESERVED_SKU = 'RSH-JAMDANI-IVORY';
const TRANSIT_SKU = 'RSH-SCARF-EMERALD';

/** One SKU's row on the stock register. */
function stockRow(page, sku) {
  return page
    .getByRole('row')
    .filter({ has: page.getByText(sku, { exact: true }) })
    .first();
}

/**
 * One tile on the inventory or freight page, by its label.
 *
 * Both grids are listed rather than a second helper written: `.inv-kpis`
 * is the consignment/stock pages' grid and `.frt-kpis` is `/freight`'s,
 * and a tile is a tile. Only one of the two is ever on screen, so the
 * union cannot match the wrong page's card.
 */
async function kpi(page, label) {
  const card = page.locator('.inv-kpis > *, .frt-kpis > *').filter({ hasText: label }).first();
  await card.waitFor({ state: 'visible', timeout: 25_000 });
  await card.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(600);
  return card;
}

/** What the register says is reserved, across every row. */
async function reservedUnits(page) {
  const cells = await page.locator('table tbody tr td:nth-child(4)').allInnerTexts();
  return cells.reduce((n, t) => n + (Number(t.replace(/[^0-9]/g, '')) || 0), 0);
}

/**
 * C0's two consignments, by the seller's own reference.
 *
 * Keep in step with `TUTORIAL_CONSIGNMENTS` in lib/consignments.mjs.
 */
const CONSIGNMENTS = { landed: 'RSH-CN-LANDED', flying: 'RSH-CN-FLYING' };

/**
 * The one freight bill's row on `/freight`.
 *
 * Found by its TERMS rather than by its receipt number: the number is
 * `CN-…-000061` and changes with every rebuild of the consignment world,
 * while "Pay as it sells" is what the video is about and is wrong on any
 * other kind of bill.
 */
function freightRow(page) {
  return page
    .getByRole('row')
    .filter({ has: page.getByText('Pay as it sells', { exact: true }) })
    .first();
}

/** A consignment's row in the register, by its reference. */
function consignmentRow(page, ref) {
  return page
    .getByRole('row')
    .filter({ has: page.getByText(ref, { exact: true }) })
    .first();
}

/**
 * One titled area of the consignment page, by the words above it.
 *
 * `AreaSection` renders its title as a heading inside its own section,
 * exactly as the order page's does — so this is `ordSection` one domain
 * over, and centred for the same reason.
 */
async function invSection(page, title) {
  /*
    hasText, NOT an exact `getByText`. A leg's heading renders its title
    and its receipt number inside one span, so the element's whole text
    is "Counted at our Bangladesh warehouseGR-2026-09-0027" and an exact
    match finds nothing at all.

    `.last()` is what picks the leg's own section rather than the "Each
    stop" section that CONTAINS it: sections nest here, and a parent
    opens before its child, so the last in document order is the
    innermost one carrying the words.
  */
  const target = page.locator('section').filter({ hasText: title }).last();
  await target.waitFor({ state: 'visible', timeout: 25_000 });
  await target.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(700);
  return target;
}

/**
 * The topic F4 silences on camera, and the message id it carries
 * between two scenes.
 *
 * `order.confirmed.seller` is the noisiest thing in a busy seller's
 * inbox and the easiest to defend switching off — they placed the
 * order, so they know. The LABEL is what the switch is named by
 * (`Notify me about: …`); the KEY is what the message itself prints at
 * its foot, which is the whole reason the scene before it points at
 * that line. Keep in step with `NotificationTopicCatalogService`.
 */
const QUIET_TOPIC = { label: 'Order confirmed', key: 'order.confirmed.seller' };

/**
 * The message F4 opens, remembered so a later scene can prove it left
 * the unread list. Module-scoped because two scenes share it and a
 * flow's steps are given no state of their own.
 */
let openedNotificationId = null;

/**
 * The staged row B3 fixes, and how it is found.
 *
 * BY ITS OWN REFERENCE. It is the only row waiting today, and a
 * `.first()` would work — but the number of rows on that page is the
 * whole subject of the video, so a gate that cannot tell one from two is
 * the wrong gate. Keep in step with `PENDING_IMPORT` in
 * seed-demo-data.mjs and with `fixtures/rangpur-bulk-orders.csv`.
 */
const PENDING_ROW = {
  ref: 'RSH-2026-0505',
  landmark: 'The lane behind the Hoodi circle bus stop',
};

/** That row's band, by the reference in its heading. */
async function pendingRow(page) {
  const row = page.locator('section').filter({ hasText: PENDING_ROW.ref }).last();
  await row.waitFor({ state: 'visible', timeout: 25_000 });
  return row;
}

/** The header's Cancel — exact, so "Cancel this order" is not it. */
function cancelButton(page) {
  return page.getByRole('button', { name: 'Cancel', exact: true });
}

/**
 * The cancel dialog, by the one sentence it always carries.
 *
 * Not `.first()` on every dialog: the order page mounts several at once
 * and which portal renders first is not a promise any component makes.
 */
function cancelDialog(page) {
  return page.getByRole('dialog').filter({ hasText: 'This cannot be undone' }).first();
}

/** Press it, and wait for the dialog to actually go. */
async function pressCancel(page, stage) {
  const d = cancelDialog(page);
  await stage.clickIt(d.getByRole('button', { name: 'Cancel this order' }).first(), {
    after: 1600,
  });
  await d.waitFor({ state: 'hidden', timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(900);
}

/**
 * One titled section of the order page, by the words above it.
 *
 * `OrdSection` renders its title as a heading, so the section is the
 * heading's own section ancestor — which is how a scene points at a
 * block rather than at a line of it.
 */
async function ordSection(page, title) {
  const section = page.locator('section').filter({ has: page.getByText(title, { exact: true }) });
  const target = section.last();
  await target.waitFor({ state: 'visible', timeout: 25_000 });
  // CENTRED, not merely "in view". `scrollIntoViewIfNeeded` stops the
  // moment the top edge is on screen, which on a tall section leaves
  // most of what the narration is about below the fold.
  await target.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(700);
  return target;
}

/**
 * What B4 searches for, and the row it must find.
 *
 * A PHONE, because that is the handle a customer actually has in front
 * of them; PART of one, because the search matches on a fragment and
 * showing that is the point. The recipient is how the found row is
 * recognised — the order number changes with every rebuilt box, the name
 * does not.
 */
const ORDER_SEARCH = { phone: '9845060077', recipient: 'Priyanka Joshi' };

/**
 * The TRADING store, as its rows print it — the display name, because
 * that is what every table on the reports page shows. Keep in step with
 * `REQUEST_STORE` in seed-demo-data.mjs.
 */
const REQUEST_STORE_NAME = { full: 'Pune Silk Studio', display: 'Silk Studio' };

/** What G7 sets on the auto-pause rule. Re-settable, so its own take never spends it. */
const AUTO_PAUSE = { ratePercent: '25', minDecided: '15' };

/** One store's scorecard row, found by name rather than by position. */
async function storeScoreRow(page, name) {
  const row = page.getByRole('row').filter({ hasText: name }).first();
  await row.waitFor({ state: 'visible', timeout: 25_000 });
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  return row;
}

/**
 * The deal G4 publishes.
 *
 * The shares are a real-looking arrangement rather than round numbers
 * for their own sake: the store carries half the delivery and most of a
 * CUSTOMER return (they took the order and chose the customer), a
 * smaller slice of an RTO (a failed first delivery is more often the
 * address than the store), and a share of the COD fees, which follow
 * money they collected.
 *
 * COD_TAX and INSTANT_PAY_FEE are deliberately left at whatever the form
 * opens on — the video types five fields, not six, and a scene per field
 * would be a list rather than an argument.
 */
const TERMS = {
  delivery: '50',
  returnFee: '30',
  customerReturn: '80',
  codFee: '50',
  codTax: '50',
  storeDays: '7',
  note: 'Our opening terms, as we agreed on the call. Returns are the part to watch — the customer-return share is high on purpose, because you choose the customer.',
};

/**
 * What G3 sets on one product, for one store.
 *
 * The SKU is `RSH-KANTHA-BLUE` rather than the scarf G2 uses: G2's take
 * clears the scarf's default price on every run, and a product with no
 * default is exactly the one this video should not open with (the form
 * then says "set one on your price list", which is a different lesson).
 *
 * The figures hang together: the transfer price is below the range, the
 * suggestion sits inside it, and the override is deliberately BELOW the
 * default list's 1400 — the store has earned a better rate, which is
 * what an override is for.
 */
const STORE_CATALOGUE = {
  sku: 'RSH-KANTHA-BLUE',
  transfer: '1250',
  min: '1800',
  max: '2600',
  suggested: '2100',
  setAside: '12',
  hidden: '25',
  title: 'Handwoven Kantha Throw',
};

/**
 * One row of a store's catalogue, found by SKU.
 *
 * The table is every ACTIVE variant the seller has, so a product added
 * upstream moves every row — the same argument as `ledgerRow` and
 * `dwellOnTerms`. Throws rather than returning nothing, because a dwell
 * on an empty locator passes a `--check` exactly as loudly as one that
 * works.
 */
async function storeCatalogueRow(page, sku) {
  const row = page.getByRole('row').filter({ hasText: sku }).first();
  await row.waitFor({ state: 'visible', timeout: 25_000 });
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  return row;
}

/**
 * One ledger row, found by the ENTRY KIND it is about.
 *
 * Never by position. The ledger is newest-first and every seed run can
 * add an entry (a return fee, a charge, the COD credit itself), so a
 * scene aimed at "the third row" would quietly start describing its
 * neighbour — the same class of mistake `dwellOnTerms` avoids on the
 * fees page, and the quietest way a tutorial goes wrong.
 *
 * It THROWS rather than returning nothing when the entry is absent: a
 * missing row means the seeding did not write it, and a scene that
 * dwells on an empty locator passes a `--check` exactly as loudly as one
 * that works.
 */
async function ledgerRow(page, label) {
  // Matched on the CELL STARTING with the label, not on an exact text
  // match: `LedgerEntryLabel` renders the direction's words as a bare
  // text node with the entry's own note in a `<div>` directly after, so
  // the cell's text is "Order chargesOrder charges — base shipping…"
  // and nothing in the row is exactly the label. An exact match finds
  // nothing at all, which is how this first failed.
  //
  // `.first()` is the NEWEST of its kind (the ledger is newest-first),
  // which is deterministic — two delivery charges are two identical
  // rows and either tells the same story.
  const startsWithLabel = new RegExp(`^${label.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell').filter({ hasText: startsWithLabel }) })
    .first();
  await row.waitFor({ state: 'visible', timeout: 25_000 });
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  return row;
}

/**
 * D4's two parcels and what the seller types on each.
 *
 * Their recipients are `RSH-LIFE-SENDBACK` and `RSH-LIFE-RETURNREQ` in
 * `lib/lifecycle.mjs` — keep in step. They are D4's OWN parcels rather
 * than D2's or D0's because this video SPENDS them: both actions are
 * irreversible, and borrowing a parcel four other videos read would take
 * their worlds with it.
 */
const SENDBACK_CUSTOMER = 'Meenakshi Sundaram';
const RETURNREQ_CUSTOMER = 'Kaushik Iyer';

/**
 * Nobody approves a send-back, so this reason is not a request — it is
 * what the returns bench reads when the carton lands. Written to sound
 * like the real thing rather than a form being filled in.
 */
const SENDBACK_REASON =
  'Customer rang me directly and cancelled — they have already bought the same saree locally, so there is no point delivering it.';

/**
 * The delivered half. Names a CONDITION rather than a mood, because the
 * dialog's own hint says this line decides whether the unit can be sold
 * again.
 */
const RETURN_REASON =
  'Customer says the blouse piece is a different shade from the saree. Fabric is unworn and still folded, so it should be resellable.';

/** What D5 types on the review before answering it. */
const HOLD_NOTE =
  'They are travelling until Sunday — please try again early next week rather than this evening.';

/** D0's back-dated parcel, on `/needs-attention`'s overdue list. */
const OVERDUE_CUSTOMER = 'Priyanka Joshi';

const ASK_REASON =
  'Customer rang me after the failed attempt — they were at work when the courier came, and they still want the parcel. Please find out when they are actually in.';

/** The logo the profile video uploads. Committed, like the CSV fixture. */
const LOGO_FILE = path.join(TUTORIALS_DIR, 'fixtures', 'rangpur-silk-logo.png');

/** What the profile video types. Nothing here is a real bank. */
const PROFILE = {
  whatsapp: '+8801711223344',
  bank: {
    name: 'BRAC Bank',
    branch: 'Rangpur Branch',
    holder: 'Rangpur Silk House',
    account: '1501204536789012',
    routing: '060851726',
    // Required, not optional — the form refuses a partial account.
    swift: 'BRAKBDDH',
  },
};

/** What the consignment video declares. Keep in step with seed-demo-data.mjs. */
const CONSIGNMENT = {
  lines: [
    { search: 'Jamdani', qty: '40' },
    { search: 'Nakshi', qty: '25', unitCost: '1150' },
  ],
  reference: 'RSH-CN-2026-07',
};

/** The shopfront the store video adds. Keep in step with seed-demo-data.mjs. */
const NEW_STORE = {
  name: 'Dhaka Boutique',
  note: 'Instagram shop — same stock, different name',
};

/** The role the roles video builds. Keep in step with seed-demo-data.mjs. */
const NEW_ROLE = {
  name: 'Warehouse manager',
  purpose: 'Runs the floor — stock, parcels and returns. No access to money.',
  search: 'stock',
  // Turned ON in this order. Named by their LABEL, because that is what
  // the switch is addressable by and what a viewer reads.
  grant: ['Orders', 'Inventory'],
};

/** What the top-up video records. A real bank account of ours, a reference that is not. */
const TOPUP = {
  bank: 'BRAC Bank',
  amount: '25000',
  reference: 'TXN-BRAC-778120394',
};

/** What the stock-alert video types. Keep in step with seed-demo-data.mjs. */
const STOCK_ALERTS = {
  accountDefault: '10',
  perSku: '25',
  product: 'Jamdani Cotton Saree',
  sku: 'RSH-JAMDANI-IVORY',
};

/** What the product-edit video changes. Keep in step with seed-demo-data.mjs. */
const PRODUCT_EDIT = {
  product: 'Dhaka Muslin Dupatta',
  // Blank in the seed on purpose — filling them in IS the scene about
  // volumetric weight.
  box: { length: '30', width: '22', height: '6' },
  newSku: 'RSH-MUSLIN-INDIGO',
  newLabel: 'Indigo',
  // Heavier than the product default, so the override is visibly an
  // override rather than a value that happens to match.
  variantWeight: '210',
};

/**
 * The pictures the photos video uploads, and where they go.
 *
 * COMMITTED fixtures, like the CSV and the logo: they are drawn rather
 * than photographed (a procedural weave — nobody owns them), and the
 * video narrates the gallery they make, so the files and the words move
 * together or not at all.
 *
 * The good shot goes up ALONE and FIRST. Ordering is `isPrimary desc,
 * displayOrder asc, createdAt asc` and the seller UI sends neither of
 * the first two, so the earliest registered picture is the one shown
 * beside the SKU — and within one drop the uploads race, so "earliest"
 * is only decidable when one is dropped on its own.
 */
const PHOTOS = {
  product: 'Dhaka Muslin Dupatta',
  sku: 'RSH-MUSLIN-ROSE',
  first: path.join(TUTORIALS_DIR, 'fixtures', 'muslin-rose-front.jpg'),
  rest: [
    path.join(TUTORIALS_DIR, 'fixtures', 'muslin-rose-drape.jpg'),
    path.join(TUTORIALS_DIR, 'fixtures', 'muslin-rose-detail.jpg'),
  ],
};

/**
 * Who the team video invites, and whose role it changes.
 *
 * `role` is the invite modal's enum value; `newRoleName` is a role
 * NAME, because the member row's select lists the seller's own
 * `seller_roles` by name and their ids are uuids. Keep both in step with
 * seed-demo-data.mjs, which puts the colleague back afterwards.
 */
const TEAM = {
  fullName: 'Nusrat Jahan',
  email: 'nusrat@rangpursilk.test',
  role: 'FINANCE',
  colleague: 'Shahidul Islam',
  newRoleName: 'Operations',
};

/**
 * What the withdrawal video asks for. Comfortably inside the balance
 * the seed puts in the wallet, so the scene about what is AVAILABLE is
 * about the rule and not about a refusal.
 */
const WITHDRAWAL = {
  amount: '40000',
  note: 'September payout — please send to the BRAC account.',
  /** The `<option>` value, which is the hour as a number. */
  hour: '9',
  keep: '5000',
};

/**
 * What the integrations video issues. Keep in step with
 * seed-demo-data.mjs, which clears both and seeds the broken endpoint.
 */
const INTEGRATIONS = {
  keyName: 'Rangpur order sync',
  keyDays: '90',
  endpointUrl: 'https://example.com/skydrop/orders',
  endpointName: 'Order sync',
  brokenName: 'Warehouse screen (old)',
};

/**
 * The reseller store the G1 video opens. Keep in step with
 * seed-demo-data.mjs, which removes it before every take.
 *
 * Nothing here is a real business or a real address.
 */
const RESELLER = {
  storeName: 'Kolkata Silk Room',
  displayName: 'Silk Room',
  contactEmail: 'hello@kolkatasilkroom.test',
  contactPhone: '+919833014477',
  inviteEmail: 'priya@kolkatasilkroom.test',
  inviteName: 'Priya Bose',
};

/**
 * The reseller price the G2 video sets, on one SKU. Keep in step with
 * seed-demo-data.mjs, which clears it before every take.
 *
 * The figures hang together on purpose: the transfer price is what the
 * store pays, and the suggested retail sits inside the range — the
 * server refuses a suggestion outside it (`SUGGESTED_OUTSIDE_RANGE`)
 * and an inverted range (`RETAIL_RANGE_INVERTED`).
 */
const RESELLER_PRICE = {
  sku: 'RSH-SCARF-EMERALD',
  transfer: '620',
  min: '850',
  max: '1100',
  suggested: '950',
};

/**
 * The price list's row for that SKU.
 *
 * Found by the SKU rather than the product name: the list is one row per
 * VARIANT, and a product with several would put the name on all of them.
 */
function priceRow(page) {
  return page.getByRole('row').filter({ hasText: RESELLER_PRICE.sku }).first();
}

/** What the delivery-fee video types. Anything but the seeded default. */
const CUSTOMER_DELIVERY_FEE = '90';

/**
 * Open the Settings hub from the sidebar.
 *
 * Shared by the two settings videos. The hub is the only way in to
 * either page — neither has a sidebar link of its own — so this is the
 * step both of them have to take and the one place it is written.
 */
async function openSettingsHub({ page, stage }) {
  await stage.clickIt(page.getByRole('link', { name: 'Settings', exact: true }).first(), {
    after: 1400,
  });
  await page.waitForURL(/\/settings$/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
}

/**
 * Outline one or more wallet rules by their LABEL.
 *
 * `/wallet/limits` renders whatever `GET /seller/wallet/settings`
 * returns, so the list is server-driven and its order is not ours. A
 * scene pointing at "the fourth row" would keep working and start
 * describing a different rule the day one is added — which is the
 * quietest way a tutorial goes wrong. A rule that has been removed
 * upstream is SKIPPED rather than failing the take: the narration would
 * be wrong either way, and a missing row is visible in the frame check
 * while a hard failure costs the whole recording.
 */
async function dwellOnTerms(page, stage, labels, ms = 1800) {
  for (const label of labels) {
    const row = page.locator('.wal-term').filter({ hasText: label }).first();
    if ((await row.count()) === 0) continue;
    await stage.dwellOn(row, ms);
  }
}

/**
 * Sign in off camera.
 *
 * Shared by both videos, and it reports a REFUSAL rather than a timeout:
 * seller login is throttled at 5 attempts per 15 minutes per email+IP,
 * so a re-take taken too soon after a run of probes fails here — and
 * "waitForURL timed out" reads as a broken selector, which is half an
 * hour of looking in the wrong place. The page's own verdict is on
 * screen; this puts it in the error.
 */
/**
 * One attention tile on the admin dashboard, by its AREA word.
 *
 * Scoped to `.db-attn` because every one of those words is also a
 * sidebar link — "Call centre", "Warehouse", "Tickets" — and a bare
 * text match takes the nav item, which is on screen the whole time and
 * would film the left-hand rail for thirteen seconds.
 */
/**
 * One card on the admin order page, by the title of its own heading.
 *
 * NOT `filter({ hasText })`: "Payment", "Charges" and "Shipments" all
 * appear inside OTHER cards' bodies on this page, so a text filter picks
 * whichever card mentions the word first — which is a card the narration
 * is not talking about, and a check that passes.
 */
/**
 * One row of the roles table, by the role's name.
 *
 * Every row carries an "Edit" and a "Delete", so a bare
 * `getByRole('button', { name: 'Edit' })` opens whichever role happens
 * to be first — which on this box is Super admin, the one row that
 * cannot be edited at all.
 */
function roleRow(page, name) {
  return page.locator('tr').filter({ hasText: name }).first();
}

function ooSection(page, title) {
  return page
    .locator('section.oo-section')
    .filter({ has: page.getByRole('heading', { level: 2, name: title }) })
    .first();
}

/**
 * One card on the system-issue board, by words that are IN it.
 *
 * Never by position. The board is sorted by severity and then by when
 * each was last seen, and the sweep the seeding runs immediately before
 * a take bumps several of them to the same second — so which High card
 * is third is a coin toss between runs, and an index would film a
 * different problem each time while passing perfectly.
 */
function issueCard(page, re) {
  return page.locator('li.af-qcard').filter({ hasText: re }).first();
}

/** The dialog's own footer. Its X carries `aria-label="Close"` and every
 *  card carries a "Close" button, so an unscoped name matches several. */
function dialogFoot(page) {
  return page.locator('.sk-dialog__foot').first();
}

function attnCard(page, area) {
  return page.locator('.db-attn').filter({ hasText: area }).first();
}

async function signIn({ page, stage, baseUrl, seller }) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/email/i).first().fill(seller.email);
  await page
    .getByLabel(/password/i)
    .first()
    .fill(seller.password);
  await page
    .getByRole('button', { name: /sign in|log in/i })
    .first()
    .click();

  try {
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  } catch (e) {
    const verdict =
      (await page
        .locator('body')
        .innerText()
        .catch(() => '')) ?? '';
    const line = verdict
      .split('\n')
      .map((l) => l.trim())
      .find((l) => /\[[A-Z_]+\]|too many|invalid|incorrect/i.test(l));
    throw new Error(
      line === undefined
        ? `Sign-in did not reach the dashboard: ${e.message}`
        : `Sign-in refused: ${line}\n(seller login is throttled 5 per 15 minutes per email+IP)`,
    );
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  await stage.clearHalo();
  await page.waitForTimeout(1200);
}

/** One value chip of the SIZE option, under a named colour. */
function sizeChip(page, colour, index) {
  return page.getByRole('textbox', { name: `Size for ${colour} value ${index}`, exact: true });
}

/**
 * The "Add value" button belonging to one colour's list. It carries no
 * name of its own — every list has one — so it is found through a chip
 * that DOES name its colour.
 */
function addSizeValue(page, colour) {
  return page
    .locator('.prd-parent')
    .filter({ has: sizeChip(page, colour, 1) })
    .getByRole('button', { name: 'Add value' });
}

/**
 * One collapsible group of the nav rail, found through its own heading.
 *
 * The heading is a BUTTON (it folds the group), so haloing the button
 * alone outlines a word and not the thing the viewer is being shown. The
 * group's container is what carries the links, and the only stable way
 * to it is "the group that contains this heading".
 */
function navGroup(page, heading) {
  return page
    .locator('.sk-nav__group')
    .filter({ has: page.getByRole('button', { name: heading, exact: true }) })
    .first();
}

/**
 * One card of a `ChoiceCards` group, by the value its radio carries.
 *
 * The visible card is a <label> wrapping a visually-hidden radio, and
 * clicking the label's TEXT is refused — the card's own decoration sits
 * over it and Playwright waits for the interception to clear, which it
 * never does. So the halo goes on the card, which is what a viewer is
 * being shown, and the radio is checked directly.
 */
function choiceCard(page, value) {
  return page.locator(`label.sk-choice:has(input[id$="-${value}"])`).first();
}

async function chooseCard({ page, stage }, value, { after = 900 } = {}) {
  const card = choiceCard(page, value);
  await stage.point(card, { settle: 600 });
  const box = await card.boundingBox();
  if (box !== null) {
    await page.evaluate(
      ([x, y]) => window.__tut.ripple(x, y),
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    await page.waitForTimeout(160);
  }
  await page.locator(`input[id$="-${value}"]`).first().check();
  await page.waitForTimeout(after);
  await stage.clearHalo();
}

/** Close a popover without clicking anything inside it. */
async function dismiss(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

/**
 * Set a native `<input type="date">`.
 *
 * NOT `typeIn`: a date input is a row of SEGMENTS, so typing
 * "2026-10-20" a character at a time feeds the digits into whichever
 * segment has focus and produces a date like 02/02/61020 — which the
 * server then refuses, several seconds after the mistake was made. The
 * halo still goes on first, so the viewer sees which field is being
 * filled; only the keystrokes are given up.
 */
async function setDate({ page, stage }, locator, iso) {
  await stage.point(locator, { settle: 400 });
  await locator.fill(iso);
  await page.waitForTimeout(500);
  await stage.clearHalo();
}

/** Pick a catalogue variant in the consignment form's combobox. */
async function pickVariant({ page, stage }, query) {
  await stage.typeIn(page.locator('#cn-variant'), query, { clear: true, after: 900 });
  const option = page.getByRole('option').first();
  await option.waitFor({ state: 'visible', timeout: 15_000 });
  await stage.clickIt(option, { after: 700 });
}

/**
 * The stock ledger's rows, once they are REAL ones.
 *
 * `MovementsIndex` renders `SkeletonRows` INSTEAD of the table while a
 * query is in flight, and every filter change mints a new query key —
 * so a gate on "a row exists" is satisfied by the placeholder on every
 * single one of them. The table itself is the honest question: it only
 * exists once there is data behind it.
 */
async function ledgerRows(page) {
  const table = page.getByRole('table').first();
  await table.waitFor({ state: 'visible', timeout: 25_000 });
  const rows = page.locator('.sk-tbody .sk-tr');
  await rows.first().waitFor({ state: 'visible', timeout: 25_000 });
  await page.waitForTimeout(400);
  return rows;
}

/** One ledger row's cells, by the column names the header carries. */
const LEDGER_COL = {
  when: 0,
  type: 1,
  variant: 2,
  bin: 3,
  change: 4,
  after: 5,
  reason: 6,
  cause: 7,
};

function ledgerCell(row, name) {
  return row.locator('td').nth(LEDGER_COL[name]);
}

/** Change a filter and wait for the rows it asked for, not the ones on screen. */
async function applyLedgerFilter({ page, stage }, locator, choose) {
  await stage.point(locator, { settle: 300 });
  await choose();
  await page.waitForTimeout(600);
  await stage.clearHalo();
  return ledgerRows(page);
}

/**
 * M1 adds an account with this label and the seeding removes it by the
 * same one. Restated here rather than imported, because `flows.mjs`
 * must not import the seed — but a drift means the take films a row the
 * next seed will not clear, so `test/tutorial-labels.test.mjs` reads
 * both files and fails if the two strings stop matching.
 */
const M1_ACCOUNT_LABEL = 'Delhivery — second contract';

export const FLOWS = {
  'place-an-order': {
    /** Everything before scene one: sign in and land where the intro expects. */
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        // Let the dashboard breathe, then show there is more below it.
        await page.waitForTimeout(1600);
        await stage.glide(320);
        await page.waitForTimeout(900);
        await stage.glide(-320);
      },

      async 'open-form'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Orders', exact: true }).first(), {
          after: 1400,
        });
        await page.waitForURL(/\/orders(\?|$)/, { timeout: 30_000 });
        await page.waitForTimeout(1400);
        await stage.clickIt(page.getByRole('link', { name: /^New order$/ }).first(), {
          after: 1500,
        });
        await page.waitForURL(/\/orders\/new/, { timeout: 30_000 });
        await page.waitForTimeout(700);
      },

      async recipient({ page, stage }) {
        await stage.typeIn(page.getByLabel('Full name'), CUSTOMER.name);
        await stage.typeIn(page.getByLabel(/^Phone number,/), CUSTOMER.phone, { delay: 70 });
        await stage.typeIn(page.getByLabel('Address line 1'), CUSTOMER.line1, { delay: 34 });
      },

      async landmark({ page, stage }) {
        await stage.typeIn(page.getByLabel('Address line 2 (the landmark)'), CUSTOMER.line2, {
          delay: 36,
          after: 900,
        });
      },

      async pincode({ page, stage }) {
        await stage.typeIn(page.getByLabel('PIN code'), CUSTOMER.pin, { delay: 130, after: 1500 });
        // The serviceability chip resolves a beat after the sixth digit.
        await page.waitForTimeout(1200);
      },

      async reference({ page, stage }) {
        await stage.typeIn(page.getByLabel('Your reference'), CUSTOMER.reference, { delay: 60 });
        await stage.typeIn(page.getByLabel('Notes for the call agent'), CUSTOMER.note, {
          delay: 32,
          after: 800,
        });
      },

      async products({ page, stage }) {
        const catalogue = page.getByRole('button', { name: 'Add RSH-JAMDANI-IVORY' });
        await stage.point(catalogue, { settle: 900 });
        await stage.clickIt(catalogue, { settle: 260, after: 1100 });
      },

      async quantity({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Add RSH-SCARF-EMERALD' }), {
          after: 1000,
        });
        const qty = page.getByRole('button', { name: 'Increase Quantity of RSH-SCARF-EMERALD' });
        await stage.point(qty, { settle: 500 });
        await qty.click();
        await page.waitForTimeout(1400);
        await stage.clearHalo();
      },

      async payment({ page, stage }) {
        const field = page.getByLabel('Collectable amount (INR)');
        await stage.typeIn(field, CUSTOMER.collectable, { delay: 150, clear: true, after: 1200 });
      },

      async submit({ page, stage }) {
        await page.waitForTimeout(700);
        // The sticky bar's button OPENS a confirmation dialog; the dialog
        // carries a button of the same name, so both halves are needed and
        // the second must be scoped to the dialog or it re-finds the first.
        const bar = page.getByRole('button', { name: /^Submit for confirmation$/ }).last();
        await stage.clickIt(bar, { settle: 900, after: 900 });

        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 15_000 });
        await page.waitForTimeout(1600);
        await stage.clickIt(dialog.getByRole('button', { name: /^Submit for confirmation$/ }), {
          settle: 500,
          after: 2200,
        });
        await page.waitForURL(/\/orders\/[0-9a-f-]{20,}/, { timeout: 45_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
      },

      async detail({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.glide(420);
        await page.waitForTimeout(1000);
      },
    },
  },

  'add-a-product-with-variations': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1500);
        await stage.glide(300);
        await page.waitForTimeout(900);
        await stage.glide(-300);
      },

      async 'open-form'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Products', exact: true }).first(), {
          after: 1500,
        });
        await page.waitForURL(/\/products(\?|$)/, { timeout: 30_000 });
        await page.waitForTimeout(1600);
        await stage.clickIt(page.getByRole('link', { name: /^New product$/ }).first(), {
          after: 1500,
        });
        await page.waitForURL(/\/products\/new/, { timeout: 30_000 });
      },

      async name({ page, stage }) {
        await stage.typeIn(page.getByLabel('Product name'), NEW_PRODUCT.name, { delay: 58 });
        await stage.typeIn(page.getByLabel('Your product ID'), NEW_PRODUCT.externalRef, {
          delay: 80,
        });
      },

      async shared({ page, stage }) {
        await stage.typeIn(page.getByLabel('Weight (g)'), NEW_PRODUCT.weightGrams, { delay: 130 });
        await stage.typeIn(page.getByLabel('Declared value (₹)'), NEW_PRODUCT.declaredValueInr, {
          delay: 110,
          after: 900,
        });
      },

      async 'option-colour'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Add an option' }), { after: 800 });
        await stage.typeIn(page.locator('#option-0-name'), 'Colour', { delay: 90 });
        await stage.typeIn(
          page.getByRole('textbox', { name: 'Colour value 1', exact: true }),
          NEW_PRODUCT.colours[0],
          { delay: 70 },
        );
        // "Add value" appears once per option, so it is scoped to this
        // one's <section aria-label>, which carries the option's name.
        await stage.clickIt(
          page.getByRole('region', { name: 'Colour' }).getByRole('button', { name: 'Add value' }),
          { settle: 240, after: 500 },
        );
        await stage.typeIn(
          page.getByRole('textbox', { name: 'Colour value 2', exact: true }),
          NEW_PRODUCT.colours[1],
          {
            delay: 70,
            after: 800,
          },
        );
      },

      async 'option-size'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Add an option' }), { after: 800 });
        await stage.typeIn(page.locator('#option-1-name'), 'Size', { delay: 110, after: 900 });
        // The SECOND option is always per-parent (`perParent: {}` in the
        // form), so it draws one value list per colour. That is the thing
        // worth showing here, and it is why the values get a step of
        // their own below.
        await stage.dwellOn(page.getByRole('region', { name: 'Size' }), 1600);
      },

      async 'size-values'({ page, stage }) {
        for (const colour of NEW_PRODUCT.colours) {
          await stage.typeIn(sizeChip(page, colour, 1), NEW_PRODUCT.sizes[0], { delay: 75 });
          await stage.clickIt(addSizeValue(page, colour), { settle: 220, after: 420 });
          await stage.typeIn(sizeChip(page, colour, 2), NEW_PRODUCT.sizes[1], {
            delay: 75,
            after: 700,
          });
        }
      },

      async variants({ page, stage }) {
        await stage.glide(560);
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('table').last(), 2400);
      },

      async sku({ page, stage }) {
        // Row labels are the option values joined with " / " — see the
        // form's own `parts.join(' / ')`.
        const label = `SKU for ${NEW_PRODUCT.colours[0]} / ${NEW_PRODUCT.sizes[0]}`;
        const byLabel = page.getByLabel(label);
        const target =
          (await byLabel.count()) > 0
            ? byLabel
            : page.locator('table').last().locator('input').first();
        await stage.typeIn(target, NEW_PRODUCT.editedSku, { delay: 70, clear: true, after: 1400 });
      },

      async save({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Create product$/ }), {
          settle: 900,
          after: 3000,
        });
        await page.waitForURL(/\/products\/[0-9a-f-]{20,}/, { timeout: 60_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
      },

      async done({ page, stage }) {
        await page.waitForTimeout(1500);
        await stage.glide(380);
        await page.waitForTimeout(1200);
      },
    },
  },

  'upload-bulk-orders': {
    /**
     * The `mock://` PUT shim. Local object storage is a stub, so the
     * panel's own upload cannot complete in a browser without it — see
     * `lib/spaces-shim.mjs`. The flag is read by `record.mjs`, so the
     * other two videos keep a stock `fetch`.
     */
    needsSpacesShim: true,

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1200);
        await stage.clickIt(page.getByRole('link', { name: 'Orders', exact: true }).first(), {
          after: 1400,
        });
        await page.waitForURL(/\/orders(\?|$)/, { timeout: 30_000 });
        await page.waitForTimeout(1800);
      },

      async 'open-import'({ page, stage }) {
        const link = page.getByRole('link', { name: /^CSV import$/ }).first();
        await stage.point(link, { settle: 900 });
        await stage.clickIt(link, { settle: 260, after: 1500 });
        await page.waitForURL(/\/orders\/import/, { timeout: 30_000 });
        await page.waitForTimeout(1200);
      },

      async template({ page, stage }) {
        // A rolling-label button: Download template → Downloading… →
        // Downloaded, which is the only sign on screen that a file came
        // down, so the dwell after the press is the point of the scene.
        //
        // WHY THIS IS WORTH A NOTE. It could not be pressed until
        // 2026-09-29: `downloadTemplate` fetched the endpoint with a raw
        // `fetch` and `credentials: 'include'` and no Authorization
        // header, while `SellerJwtGuard` is bearer-only — FE-1 keeps the
        // access token in memory and never in a cookie, so `credentials`
        // had nothing to send. It answered 401 for every seller, every
        // time, on both importers (the panel is shared with the
        // catalogue one), and the panel painted a red "Template download
        // failed: 401" that stayed up until the next upload cleared it.
        // An early take of this video filmed exactly that, under a line
        // about starting from the template — which is how it was found.
        // `downloadErrorReport` was the same shape and the same 401; both
        // go through the ApiClient now. **A screen existing is not
        // evidence its endpoint does**, and a recording is a surprisingly
        // good way to find out which.
        await stage.clickIt(page.getByRole('button', { name: /^Download template$/ }).first(), {
          settle: 800,
          after: 2600,
        });
      },

      async 'choose-file'({ page, stage }) {
        const zone = page.locator('.sk-drop__zone');
        await stage.point(zone, { settle: 900 });
        // `stage.clickIt` CANNOT drive this one: the real <input type=file>
        // is `opacity: 0; pointer-events: none` inside the zone, and a
        // native picker cannot be opened from a script anyway. Setting the
        // files on the input fires its own change event, which is the same
        // path a person's picker takes.
        await page.locator('input.sk-drop__input').setInputFiles(BULK_CSV);
        await page.waitForTimeout(900);
        // The zone's label becomes the file name once one is chosen.
        await stage.dwellOn(zone, 2000);
      },

      async preview({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Upload and check$/ }), {
          settle: 700,
          after: 900,
        });
        await page.getByText('Check before importing').waitFor({ timeout: 45_000 });
        await page.waitForTimeout(1400);
        // "<file> · 6 rows · 4 orders" — the sentence the narration reads.
        await stage.dwellOn(page.locator('.ord-mapping'), 7000);
      },

      async 'problem-row'({ page, stage }) {
        // Held for most of the scene: this and the scene before it sit on
        // the same unscrolled page, so the moving highlight is the only
        // thing telling a viewer which half is being talked about.
        await stage.dwellOn(page.locator('.ord-notice').first(), 9000);
      },

      async import({ page, stage }) {
        const button = page.getByRole('button', { name: /^Import \d+ orders?$/ });
        await stage.point(button, { settle: 1100 });
        await stage.clickIt(button, { settle: 300, after: 1600 });
      },

      async processing({ page, stage }) {
        // The table polls every 5s, so PROCESSING → terminal is not
        // instant. Wait for the run to land rather than timing it: a
        // scene that ends mid-poll shows a spinner over a line about
        // four orders having been created.
        const row = page.locator('table tbody tr').first();
        await row.waitFor({ state: 'visible', timeout: 30_000 });
        await page
          .waitForFunction(
            () => {
              const cell = document.querySelector('table tbody tr');
              return cell !== null && /done|failed|completed/i.test(cell.textContent ?? '');
            },
            undefined,
            { timeout: 60_000 },
          )
          .catch(() => {});
        await page.waitForTimeout(900);
        await stage.dwellOn(row, 2600);
        // And press the errors file the narration is naming. A download
        // shows nothing on camera, so what this actually films is the
        // ABSENCE of a red notice — which is the whole of the second half
        // of the 401 described on the `template` scene. It goes here
        // rather than in a scene of its own because the link is already
        // on screen and the line already names the file.
        await stage.clickIt(page.getByRole('button', { name: /Errors CSV/i }).first(), {
          settle: 500,
          after: 1400,
        });
      },

      async 'orders-list'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Orders', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/orders(\?|$)/, { timeout: 30_000 });
        const row = page.locator('table tbody tr').filter({ hasText: BULK_MULTI_LINE_REF }).first();
        try {
          await row.waitFor({ state: 'visible', timeout: 8_000 });
        } catch {
          // The list is a 30s-stale TanStack query and the import page
          // does not invalidate it, so a fast take can arrive back here
          // on the cached empty list. Every scene between is held open
          // for its narration, so in practice the cache has long
          // expired; this is the belt for the day it has not.
          await page.reload({ waitUntil: 'domcontentloaded' });
          await row.waitFor({ state: 'visible', timeout: 30_000 });
        }
        await page.waitForTimeout(1200);
        await stage.dwellOn(row, 2400);
      },

      async 'multi-line'({ page, stage }) {
        await stage.clickIt(
          page
            .locator('table tbody tr')
            .filter({ hasText: BULK_MULTI_LINE_REF })
            .first()
            .locator('a.ord-order-link')
            .first(),
          { settle: 500, after: 2000 },
        );
        await page.waitForURL(/\/orders\/[0-9a-f-]{20,}/, { timeout: 45_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // The Items section is below the fold and says "2 lines" over a
        // row per product — which is the whole claim of this video, on
        // screen rather than only in the narration.
        const items = page.getByRole('table', { name: 'Items on this order' });
        await items.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(800);
        await stage.dwellOn(items, 3000);
      },
    },
  },

  'find-your-way-around': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1500);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async dashboard({ page, stage }) {
        await stage.dwellOn(page.getByRole('heading', { name: /Treasury/i }).first(), 2400);
        await stage.glide(260);
        await page.waitForTimeout(900);
        await stage.glide(-260);
      },

      async sidebar({ page, stage }) {
        await stage.dwellOn(page.locator('[data-slot="nav-rail"]').first(), 3000);
      },

      async selling({ page, stage }) {
        await stage.dwellOn(navGroup(page, 'Selling'), 3200);
      },

      async stock({ page, stage }) {
        await stage.dwellOn(navGroup(page, 'Stock'), 3200);
      },

      async money({ page, stage }) {
        await stage.dwellOn(navGroup(page, 'Money'), 1800);
        await stage.dwellOn(navGroup(page, 'Reselling'), 2200);
      },

      async account({ page, stage }) {
        await stage.dwellOn(navGroup(page, 'Account'), 3200);
      },

      async search({ page, stage }) {
        // `type="search"`, so its implicit role is SEARCHBOX and not
        // textbox — asking for a textbox waits thirty seconds and finds
        // nothing.
        const box = page.getByLabel('Find an order or ticket').first();
        // A partial order number, so the suggestions the viewer is being
        // told about are actually on screen. The A1 seed places orders
        // for exactly this reason.
        await stage.typeIn(box, 'SD-2026', { after: 1800 });
        await page.waitForTimeout(1200);
        await dismiss(page);
        await box.fill('');
      },

      async 'quick-actions'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /Quick actions/i }).first(), {
          after: 1600,
        });
        await page.waitForTimeout(1400);
        await dismiss(page);
      },

      async bell({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Notifications/i }).first(), {
          after: 1600,
        });
        await page.waitForTimeout(1600);
        await dismiss(page);
      },

      async strip({ page, stage }) {
        await stage.dwellOn(page.locator('[data-slot="status-strip"]').first(), 3000);
      },

      async outro({ page, stage }) {
        await stage.glide(-400);
        await page.waitForTimeout(600);
        await stage.dwellOn(navGroup(page, 'Account'), 1600);
        await stage.dwellOn(navGroup(page, 'Stock'), 1600);
      },
    },
  },

  'set-up-your-profile': {
    // The logo goes through presign → PUT, and local object storage is a
    // stub. See lib/spaces-shim.mjs — it also serves the `mock://` GET
    // back as a data URL, so the logo the viewer just uploaded actually
    // APPEARS rather than rendering as a broken frame.
    needsSpacesShim: true,

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-profile'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Profile', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/profile/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1600);
      },

      async 'edit-company'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Edit', exact: true }).first(), {
          after: 1400,
        });
        await stage.typeIn(page.getByLabel('WhatsApp'), PROFILE.whatsapp, {
          clear: true,
          after: 600,
        });
      },

      async fixed({ page, stage }) {
        await stage.dwellOn(page.getByLabel('Company name'), 2000);
        await stage.dwellOn(page.getByLabel(/^Phone/), 2000);
      },

      async 'save-company'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /Save changes/i }).first(), {
          after: 2200,
        });
        await page.waitForTimeout(1200);
      },

      async 'logo-pick'({ page, stage }) {
        const heading = page.getByRole('heading', { name: 'Company logo' }).first();
        await heading.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await stage.dwellOn(heading, 1600);
        // The control is a styled <label> wrapping a hidden input, so the
        // file goes to the INPUT while the halo sits on what a viewer can
        // actually see.
        await stage.point(page.locator('.set-file').first(), { settle: 700 });
        await page.locator('.set-file input[type="file"]').first().setInputFiles(LOGO_FILE);
        await page.waitForTimeout(1600);
        await stage.clearHalo();
      },

      async 'logo-done'({ page, stage }) {
        const frame = page.locator('.set-logo__frame').first();
        await frame.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(1200);
        await stage.dwellOn(frame, 2600);
      },

      async 'bank-open'({ page, stage }) {
        const heading = page.getByRole('heading', { name: 'Bank details' }).first();
        await heading.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await stage.clickIt(page.getByRole('button', { name: 'Edit', exact: true }).last(), {
          after: 1200,
        });
        // All six fields are filled inside THIS scene. There was a
        // narrated scene of its own for them, and its line said "a SWIFT
        // code if you have one" — which the form contradicts on screen,
        // in the same shot: "All six fields are needed together". The
        // line went rather than ship a tutorial the page argues with.
        // The picture still shows every field being typed.
        //
        // Typed FASTER than the default 55 ms. Six fields at a careful
        // human rate is about eighteen seconds, and the narration for
        // this scene is eight — the rest would be silence over a form
        // filling itself. The scene is still held for the whole clip;
        // this only stops it running far past it.
        const bank = { delay: 26, after: 200, clear: true };
        await stage.typeIn(page.getByLabel('Bank name'), PROFILE.bank.name, bank);
        await stage.typeIn(page.getByLabel('Branch name'), PROFILE.bank.branch, bank);
        await stage.typeIn(page.getByLabel('Account holder name'), PROFILE.bank.holder, bank);
        await stage.typeIn(page.getByLabel('Account number'), PROFILE.bank.account, bank);
        await stage.typeIn(page.getByLabel('Routing number'), PROFILE.bank.routing, bank);
        await stage.typeIn(page.getByLabel('SWIFT code'), PROFILE.bank.swift, bank);
      },

      async 'bank-approval'({ page, stage }) {
        // BOTH labels. The submit button says "Save details" for a first
        // account and "Send for approval" once one is on file, and
        // matching only the first is how a re-take hangs on a button
        // that is no longer there. The seed clears the account so the
        // take films the first-time path; this is the backstop, and the
        // narration for this scene describes both outcomes anyway.
        await stage.clickIt(
          page.getByRole('button', { name: /Save details|Send for approval/i }).first(),
          { after: 1400 },
        );
        // Saving asks first, and WHICH question it asks is the lesson:
        // a first set of details is stored, a change to an account
        // already on file goes to Skydrop for approval.
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 15_000 });
        await page.waitForTimeout(2000);
        await stage.clickIt(
          dialog.getByRole('button', { name: /Send for approval|Save details/i }).first(),
          { after: 2000 },
        );
        // The closing shot. This is the last scene, so it runs on past
        // its narration and ends on the whole page rather than on a
        // dialog that has just closed.
        await page.waitForTimeout(1200);
        await stage.glide(-900);
        await page.waitForTimeout(700);
        await stage.dwellOn(page.getByRole('heading', { name: 'Company info' }).first(), 1800);
      },
    },
  },

  'announce-a-consignment': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-inbound'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Add stock', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/inbound/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1800);
      },

      async 'open-form'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Announce a consignment' }).first(), {
          after: 1600,
        });
        await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(1200);
      },

      async route({ page, stage }) {
        await stage.dwellOn(page.locator('#cn-route-h'), 2800);
      },

      async 'route-info'({ page, stage }) {
        await stage.clickIt(
          page.getByRole('button', { name: /What do the routes mean/i }).first(),
          { after: 1600 },
        );
        await page.waitForTimeout(2400);
      },

      async 'route-pick'(ctx) {
        await chooseCard(ctx, 'VIA_BD', { after: 1800 });
      },

      async 'first-line'({ page, stage }) {
        const line = CONSIGNMENT.lines[0];
        await pickVariant({ page, stage }, line.search);
        await stage.typeIn(page.locator('#cn-qty'), line.qty, { clear: true, after: 500 });
        await stage.clickIt(
          page.getByRole('button', { name: 'Add this product to the consignment' }),
          { after: 1400 },
        );
      },

      async 'unit-cost'({ page, stage }) {
        const line = CONSIGNMENT.lines[1];
        await pickVariant({ page, stage }, line.search);
        await stage.typeIn(page.locator('#cn-qty'), line.qty, { clear: true, after: 400 });
        await stage.typeIn(page.locator('#cn-cost'), line.unitCost, { clear: true, after: 1400 });
      },

      async 'second-line'({ page, stage }) {
        await stage.clickIt(
          page.getByRole('button', { name: 'Add this product to the consignment' }),
          { after: 1800 },
        );
      },

      async details(ctx) {
        const { page, stage } = ctx;
        // Three weeks out: far enough to read as a real crossing rather
        // than as whatever today happens to be.
        const eta = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
        await setDate(ctx, page.locator('#cn-eta'), eta.toISOString().slice(0, 10));
        await stage.typeIn(page.locator('#cn-ref'), CONSIGNMENT.reference, {
          clear: true,
          after: 700,
        });
      },

      async announce({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Announce \d+ product/ }).first(), {
          after: 2400,
        });
        await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1600);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(
          page.getByRole('heading', { name: 'Consignment register' }).first(),
          1800,
        );
        await stage.glide(220);
        await page.waitForTimeout(1600);
      },
    },
  },

  'add-a-shopfront': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-settings'(ctx) {
        await openSettingsHub(ctx);
      },

      async 'open-stores'({ page, stage }) {
        // The tile by HREF, not by accessible name. A ListRow puts the
        // title AND the description inside one <a>, so a name match is
        // matching a paragraph — and the paragraph is the thing most
        // likely to be reworded.
        const tile = page.locator('a[href="/settings/stores"]').first();
        await stage.dwellOn(tile, 2200);
        await stage.clickIt(tile, { after: 1400 });
        await page.waitForURL(/\/settings\/stores/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
      },

      async shared({ page, stage }) {
        // The sentence the whole video exists to say, in the app's own
        // words. Filming the page saying it is worth more than the
        // narration saying it alone.
        await stage.dwellOn(page.locator('.set-card__lead').first(), 2600);
      },

      async tiles({ page, stage }) {
        await stage.dwellOn(page.locator('.set-kpis').first(), 3000);
      },

      async add({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Add a store' }).first(), {
          after: 1400,
        });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        // The dialog's own description makes the promise the narration
        // is about — a new store never becomes the default.
        await stage.dwellOn(dialog.locator('p').first(), 2200);
      },

      async name({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await stage.typeIn(dialog.getByLabel('Name'), NEW_STORE.name, { after: 500 });
        await stage.typeIn(dialog.getByLabel('Note'), NEW_STORE.note, {
          delay: 34,
          after: 500,
        });
      },

      async saved({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Add store' }).first(), {
          after: 1800,
        });
        await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 30_000 });
        const row = page.getByRole('row').filter({ hasText: NEW_STORE.name });
        await row.first().waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(row.first(), 2400);
      },

      async close({ page, stage }) {
        // Close and REOPEN in one scene: the narration says both in one
        // breath ("you can reopen it whenever you like"), and splitting
        // them would leave a scene whose only content is undoing the
        // previous one.
        const row = () => page.getByRole('row').filter({ hasText: NEW_STORE.name }).first();
        await stage.clickIt(row().getByRole('button', { name: 'Close' }), { after: 900 });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm__consequence').first(), 2200);
        await stage.clickIt(page.getByRole('button', { name: 'Close store' }).first(), {
          after: 1600,
        });
        await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
        await page.waitForTimeout(900);

        await stage.clickIt(row().getByRole('button', { name: 'Reopen' }), { after: 900 });
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.clickIt(page.getByRole('button', { name: 'Reopen store' }).first(), {
          after: 1400,
        });
        await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
        await page.waitForTimeout(900);
      },

      async 'make-default'({ page, stage }) {
        const row = page.getByRole('row').filter({ hasText: NEW_STORE.name }).first();
        await stage.clickIt(row.getByRole('button', { name: 'Make default' }), { after: 900 });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm__consequence').first(), 2600);
        await stage.clickIt(page.getByRole('button', { name: 'Make default' }).last(), {
          after: 1800,
        });
        await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
        await page.waitForTimeout(1200);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.locator('.set-kpis').first(), 2600);
        await stage.dwellOn(page.getByRole('table').first(), 2200);
      },
    },
  },

  'set-your-delivery-fee': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-settings'(ctx) {
        await openSettingsHub(ctx);
      },

      async 'open-defaults'({ page, stage }) {
        const tile = page.locator('a[href="/settings/orders"]').first();
        await stage.dwellOn(tile, 2000);
        await stage.clickIt(tile, { after: 1400 });
        await page.waitForURL(/\/settings\/orders/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1400);
      },

      async 'whose-figure'({ page, stage }) {
        // The badge, not the field. It is the one thing about this page
        // a glance cannot tell you, and the seed clears the seller's
        // override precisely so this take opens on "Skydrop default".
        await stage.dwellOn(page.locator('.sk-sh__note .set-fact').first(), 3000);
      },

      async 'not-ours'({ page, stage }) {
        await stage.dwellOn(page.locator('.set-form-grid p.set-muted').first(), 3000);
      },

      async type({ page, stage }) {
        await stage.typeIn(page.getByLabel(/Delivery fee charged/i), CUSTOMER_DELIVERY_FEE, {
          clear: true,
          after: 800,
        });
      },

      async save({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Save/ }).first(), { after: 2000 });
        // The badge FLIPS on success, which is the proof the save landed
        // and the thing the narration points at. Waited for by text
        // rather than by a fixed pause.
        await page
          .locator('.sk-sh__note .set-fact')
          .filter({ hasText: 'Your own figure' })
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(page.locator('.sk-sh__note .set-fact').first(), 2400);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2400);
        await stage.dwellOn(page.getByLabel(/Delivery fee charged/i), 2000);
      },
    },
  },

  'be-told-before-you-run-out': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-settings'(ctx) {
        const { page, stage } = ctx;
        await openSettingsHub(ctx);
        const tile = page.locator('a[href="/settings/stock"]').first();
        await stage.clickIt(tile, { after: 1400 });
        await page.waitForURL(/\/settings\/stock/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
      },

      async state({ page, stage }) {
        // The seed clears the seller's default precisely so this opens
        // on "Off — nothing alerts by default", which is the state the
        // narration describes and the one a new seller is actually in.
        await stage.dwellOn(page.locator('.sk-sh__note .set-fact').first(), 3000);
      },

      async 'blank-vs-zero'({ page, stage }) {
        await stage.dwellOn(page.locator('form.set-form-grid p.set-muted').first(), 3200);
      },

      async 'set-default'({ page, stage }) {
        await stage.typeIn(page.getByLabel('Default threshold'), STOCK_ALERTS.accountDefault, {
          clear: true,
          after: 800,
        });
      },

      async saved({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Save/ }).first(), { after: 1800 });
        // The badge flipping is the proof the save landed, and it is
        // what the narration points at. Waited for by its text.
        await page
          .locator('.sk-sh__note .set-fact')
          .filter({ hasText: /Warning below/ })
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(page.locator('.sk-sh__note .set-fact').first(), 2400);
      },

      async 'open-variant'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Products', exact: true }).first(), {
          after: 1400,
        });
        await page.waitForURL(/\/products/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await stage.clickIt(
          page.getByRole('link', { name: STOCK_ALERTS.product, exact: true }).first(),
          { after: 1600 },
        );
        await page.waitForLoadState('networkidle').catch(() => {});
        // The SKU code IS the link to the variant — there is no other
        // control on the row that opens it.
        await stage.clickIt(page.getByRole('link', { name: STOCK_ALERTS.sku }).first(), {
          after: 1800,
        });
        await page.waitForURL(/\/variants\//, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
      },

      async 'per-sku'({ page, stage }) {
        const field = page.getByLabel('Low-stock alert at');
        await field.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await stage.dwellOn(field, 2800);
      },

      async override({ page, stage }) {
        await stage.typeIn(page.getByLabel('Low-stock alert at'), STOCK_ALERTS.perSku, {
          clear: true,
          after: 700,
        });
        // The Save beside the field, not the page's other buttons —
        // scoped to the panel that owns it.
        await stage.clickIt(
          page
            .locator('.inv-lookup')
            .filter({ has: page.getByLabel('Low-stock alert at') })
            .getByRole('button', { name: /^Save/ })
            .first(),
          { after: 2000 },
        );
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.getByLabel('Low-stock alert at'), 2400);
        await stage.glide(-240);
        await page.waitForTimeout(1400);
      },
    },
  },

  'keep-a-product-up-to-date': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-product'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Products', exact: true }).first(), {
          after: 1400,
        });
        await page.waitForURL(/\/products$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await stage.clickIt(
          page.getByRole('link', { name: PRODUCT_EDIT.product, exact: true }).first(),
          { after: 1800 },
        );
        await page.waitForURL(/\/products\/[0-9a-f-]+$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
      },

      async defaults({ page, stage }) {
        // The tiles, not the fields: this scene is about what a variant
        // inherits, and the tiles are where those four values are
        // stated as facts rather than as inputs.
        await stage.dwellOn(page.locator('.inv-kpis').first(), 3200);
      },

      async edit({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Edit product' }).first(), {
          after: 1200,
        });
        await page.getByLabel('Default length (cm)').waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(800);
      },

      async 'box-size'(ctx) {
        const { page, stage } = ctx;
        await stage.typeIn(page.getByLabel('Default length (cm)'), PRODUCT_EDIT.box.length, {
          clear: true,
          after: 300,
        });
        await stage.typeIn(page.getByLabel('Default width (cm)'), PRODUCT_EDIT.box.width, {
          clear: true,
          after: 300,
        });
        await stage.typeIn(page.getByLabel('Default height (cm)'), PRODUCT_EDIT.box.height, {
          clear: true,
          after: 600,
        });
      },

      async saved({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Save changes/ }).first(), {
          after: 1600,
        });
        // The form closing is what proves the save landed; waiting on
        // the tile's text alone would pass on the stale render.
        await page
          .getByRole('button', { name: 'Edit product' })
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(page.locator('.inv-kpis').first(), 2600);
      },

      async 'add-variant'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Add variant' }).first(), {
          after: 1200,
        });
        // Not `exact`: the field is required, so its accessible name
        // carries the asterisk and reads "SKU *".
        await page
          .getByLabel(/^SKU\b/)
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(800);
      },

      async sku({ page, stage }) {
        await stage.typeIn(page.getByLabel(/^SKU\b/).first(), PRODUCT_EDIT.newSku, {
          after: 400,
        });
        await stage.typeIn(page.getByLabel('Variant label'), PRODUCT_EDIT.newLabel, { after: 800 });
      },

      async added({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Add variant/ }).last(), {
          after: 1800,
        });
        // The new row, waited for by its own code — it is what the
        // narration points at, and the list refetches after the POST.
        const row = page.getByRole('link', { name: PRODUCT_EDIT.newSku }).first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.dwellOn(page.locator('tr').filter({ has: row }).first(), 2600);
      },

      async 'open-variant'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: PRODUCT_EDIT.newSku }).first(), {
          after: 1800,
        });
        await page.waitForURL(/\/variants\//, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
      },

      async 'sku-immutable'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Edit variant' }).first(), {
          after: 1200,
        });
        const sku = page.locator('#sku');
        await sku.waitFor({ state: 'visible', timeout: 20_000 });
        await sku.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await stage.dwellOn(sku, 3000);
      },

      async inherit({ page, stage }) {
        await stage.typeIn(page.getByLabel('Weight (g)'), PRODUCT_EDIT.variantWeight, {
          clear: true,
          after: 600,
        });
        await stage.clickIt(page.getByRole('button', { name: /^Save changes/ }).first(), {
          after: 1800,
        });
        await page
          .getByRole('button', { name: 'Edit variant' })
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(600);
      },

      async archive({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: PRODUCT_EDIT.product }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/products\/[0-9a-f-]+$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await stage.clickIt(page.getByRole('button', { name: 'Archive product' }).first(), {
          after: 1200,
        });
        // The dialog RESTATES what follows, which is what the narration
        // reads out — so it is held open here and confirmed in the next
        // scene rather than dismissed on the same breath.
        const dialog = page.locator('.sk-dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm__consequence').first(), 3000);
      },

      async restore({ page, stage }) {
        const dialog = page.locator('.sk-dialog').first();
        await stage.clickIt(dialog.getByRole('button', { name: 'Archive product' }).first(), {
          after: 1800,
        });
        // Archived, and the chip says so. Waited for by the RESTORE
        // button appearing — the same control, relabelled.
        await page
          .getByRole('button', { name: 'Restore product' })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(1200);
        await stage.clickIt(page.getByRole('button', { name: 'Restore product' }).first(), {
          after: 1000,
        });
        const back = page.locator('.sk-dialog').first();
        await back.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(back.locator('.sk-confirm__consequence').first(), 2600);
        await stage.clickIt(back.getByRole('button', { name: 'Restore product' }).first(), {
          after: 2000,
        });
        await page
          .getByRole('button', { name: 'Archive product' })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(1600);
      },
    },
  },

  'add-product-photos': {
    // The upload is a real `fetch` to a `mock://` URL, and the gallery
    // puts another one straight into an <img src>. Neither works in a
    // browser without the rig — see lib/spaces-shim.mjs.
    needsSpacesShim: true,

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-variant'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Products', exact: true }).first(), {
          after: 1400,
        });
        await page.waitForURL(/\/products$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await stage.clickIt(page.getByRole('link', { name: PHOTOS.product, exact: true }).first(), {
          after: 1600,
        });
        await page.waitForLoadState('networkidle').catch(() => {});
        await stage.clickIt(page.getByRole('link', { name: PHOTOS.sku }).first(), { after: 1600 });
        await page.waitForURL(/\/variants\//, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
      },

      async empty({ page, stage }) {
        const zone = page.locator('.sk-drop').first();
        await zone.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await stage.dwellOn(zone, 3000);
      },

      async first({ page, stage }) {
        // The <input> is visually hidden inside the zone, so the file
        // goes to the INPUT while the halo sits on what a viewer can
        // see — the same split the profile video's logo upload makes.
        await stage.point(page.locator('.sk-drop').first(), { settle: 600 });
        await page.locator('.sk-drop input[type="file"]').first().setInputFiles(PHOTOS.first);
        // The gallery is the proof, not the queue badge: a "done" badge
        // is set before the refetch lands, so waiting on it would film
        // an empty gallery under a narration saying otherwise.
        await page
          .locator('.prd-gallery__item')
          .first()
          .waitFor({ state: 'visible', timeout: 30_000 });
        await page.waitForTimeout(1200);
        await stage.clearHalo();
      },

      async 'upload-steps'({ page, stage }) {
        await stage.dwellOn(page.locator('.prd-uploads').first(), 3000);
      },

      async more({ page, stage }) {
        await stage.point(page.locator('.sk-drop').first(), { settle: 600 });
        await page.locator('.sk-drop input[type="file"]').first().setInputFiles(PHOTOS.rest);
        await page
          .locator('.prd-gallery__item')
          .nth(PHOTOS.rest.length)
          .waitFor({ state: 'visible', timeout: 40_000 });
        await page.waitForTimeout(1200);
        await stage.clearHalo();
      },

      async gallery({ page, stage }) {
        const gallery = page.locator('.prd-gallery').first();
        await gallery.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await stage.dwellOn(gallery, 3200);
      },

      async order({ page, stage }) {
        await stage.dwellOn(page.locator('.prd-gallery__item').first(), 3000);
      },

      async delete({ page, stage }) {
        // The LAST one, so the picture the previous scene just called
        // the one that stands for the rest is still there afterwards.
        const last = page.locator('.prd-gallery__item').last();
        await stage.clickIt(last.getByRole('button', { name: 'Delete image' }), { after: 1200 });
        const dialog = page.locator('.sk-dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm__subject').first(), 3000);
      },

      async gone({ page, stage }) {
        const dialog = page.locator('.sk-dialog').first();
        await stage.clickIt(dialog.getByRole('button', { name: 'Delete picture' }).first(), {
          after: 1600,
        });
        await dialog.waitFor({ state: 'hidden', timeout: 25_000 });
        // The picture actually LEAVING, not just the dialog closing —
        // a refusal surfaces inside the dialog, so a dialog that closed
        // is not evidence the gallery is one shorter.
        await page
          .locator('.prd-gallery__item')
          .nth(PHOTOS.rest.length)
          .waitFor({ state: 'detached', timeout: 25_000 });
        await page.waitForTimeout(1200);
        await stage.dwellOn(page.locator('.prd-gallery').first(), 2600);
      },

      async outro({ page, stage }) {
        await stage.glide(-360);
        await page.waitForTimeout(1200);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2400);
      },
    },
  },

  'invite-a-colleague': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-team'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Team', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/team$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        await stage.dwellOn(page.locator('.set-kpis').first(), 2600);
      },

      async invite({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Invite member' }).first(), {
          after: 1200,
        });
        const dialog = page.locator('.sk-dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.typeIn(dialog.getByLabel(/^Full name/), TEAM.fullName, { after: 400 });
        await stage.typeIn(dialog.getByLabel(/^Email/), TEAM.email, { after: 700 });
      },

      async role({ page, stage }) {
        const dialog = page.locator('.sk-dialog').first();
        const select = dialog.getByLabel(/^Role/);
        await stage.point(select, { settle: 700 });
        await select.selectOption(TEAM.role);
        await page.waitForTimeout(900);
        await stage.clearHalo();
      },

      async create({ page, stage }) {
        const dialog = page.locator('.sk-dialog').first();
        await stage.clickIt(dialog.getByRole('button', { name: /^Create invitation/ }).first(), {
          after: 1600,
        });
        // The reveal card IS the proof the invitation was written — the
        // dialog closes either way, and a refusal stays inside it.
        await page.locator('.set-reveal').first().waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
      },

      async 'link-once'({ page, stage }) {
        const reveal = page.locator('.set-reveal').first();
        await reveal.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await stage.dwellOn(reveal, 3400);
      },

      async outstanding({ page, stage }) {
        const row = page.getByRole('row').filter({ hasText: TEAM.email }).first();
        await row.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await stage.dwellOn(row, 3000);
      },

      async resend({ page, stage }) {
        const row = page.getByRole('row').filter({ hasText: TEAM.email }).first();
        await stage.clickIt(row.getByRole('button', { name: /Resend/ }).first(), { after: 1600 });
        // A NEW link, which is the whole lesson — waited for by the
        // reveal card coming back, since the take dismissed nothing.
        const reveal = page.locator('.set-reveal').first();
        await reveal.waitFor({ state: 'visible', timeout: 25_000 });
        await reveal.scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await stage.dwellOn(reveal, 2400);
      },

      async revoke({ page, stage }) {
        const row = page.getByRole('row').filter({ hasText: TEAM.email }).first();
        await row.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await stage.clickIt(row.getByRole('button', { name: 'Revoke', exact: true }).first(), {
          after: 1200,
        });
        const dialog = page.locator('.sk-dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm__consequence').first(), 2200);
        await stage.clickIt(dialog.getByRole('button', { name: 'Revoke invitation' }).first(), {
          after: 1800,
        });
        // Revoked, not gone: the row stays and its chip changes. Waited
        // for by the Revoke button leaving, which only a real revoke does.
        await page
          .getByRole('row')
          .filter({ hasText: TEAM.email })
          .first()
          .getByRole('button', { name: 'Revoke', exact: true })
          .waitFor({ state: 'detached', timeout: 25_000 });
        await page.waitForTimeout(900);
      },

      async 'role-change'({ page, stage }) {
        const member = page.locator('.team-member').filter({ hasText: TEAM.colleague }).first();
        await member.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        const select = member.locator('select').first();
        await stage.point(select, { settle: 700 });
        await select.selectOption({ label: TEAM.newRoleName });
        await page.waitForTimeout(700);
        await stage.clearHalo();
        const dialog = page.locator('.sk-dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm__consequence').first(), 2600);
        await stage.clickIt(dialog.getByRole('button', { name: 'Change role' }).first(), {
          after: 2000,
        });
        await dialog.waitFor({ state: 'hidden', timeout: 25_000 });
        await page.waitForTimeout(1000);
      },

      async yourself({ page, stage }) {
        const you = page.locator('.team-member').filter({ hasText: 'You' }).first();
        await you.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await stage.dwellOn(you, 3200);
      },

      async outro({ page, stage }) {
        const member = page.locator('.team-member').filter({ hasText: TEAM.colleague }).first();
        await stage.dwellOn(member.getByRole('button', { name: 'Deactivate' }).first(), 2800);
        await stage.glide(-320);
        await page.waitForTimeout(1200);
      },
    },
  },

  'take-money-out': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-wallet'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Wallet', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/wallet$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        await stage.dwellOn(page.locator('.wal-strip').first(), 2600);
      },

      async request({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Request a withdrawal' }).first(), {
          after: 1400,
        });
        // The availability panel, not the dialog: it is what the
        // narration points at, and it only renders once the eligibility
        // call has answered — so waiting on the dialog alone would open
        // the scene on a form with a hole in it.
        const avail = page.locator('.wal-avail').first();
        await avail.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.dwellOn(avail, 3000);
      },

      async amount({ page, stage }) {
        await stage.typeIn(page.locator('#wd-amount'), WITHDRAWAL.amount, {
          clear: true,
          after: 500,
        });
        await stage.typeIn(page.locator('#wd-note'), WITHDRAWAL.note, { after: 800 });
      },

      async confirm({ page, stage }) {
        await stage.clickIt(
          page.locator('.sk-dialog').getByRole('button', { name: 'Request withdrawal' }).first(),
          { after: 1200 },
        );
        // The CONFIRM dialog, told from the form it replaced by the
        // sentence only it carries.
        const confirmed = page
          .locator('.sk-dialog')
          .filter({ hasText: 'Request this withdrawal?' })
          .first();
        await confirmed.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(confirmed.locator('.sk-confirm__consequence').first(), 3000);
      },

      async requested({ page, stage }) {
        const confirmed = page
          .locator('.sk-dialog')
          .filter({ hasText: 'Request this withdrawal?' })
          .first();
        await stage.clickIt(confirmed.getByRole('button', { name: 'Request withdrawal' }).first(), {
          after: 1800,
        });
        // The ROW is the proof, not the dialog closing: a refusal stays
        // inside the dialog, and the table is what the narration reads.
        const table = page.getByRole('table').first();
        await table.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(1000);
        await stage.dwellOn(table, 3000);
      },

      async ledger({ page, stage }) {
        await stage.clickIt(page.getByRole('tab', { name: 'Ledger' }).first(), { after: 1600 });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.locator('.wal-panel').first(), 3000);
      },

      async 'open-limits'({ page, stage }) {
        await stage.clickIt(page.locator('a[href="/wallet/limits"]').first(), { after: 1600 });
        await page.waitForURL(/\/wallet\/limits/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
        const settings = page.locator('.wal-settings').first();
        await settings.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await stage.dwellOn(settings, 2200);
      },

      async auto({ page, stage }) {
        const row = page
          .locator('.wal-setting')
          .filter({ hasText: 'Automatic withdrawals' })
          .first();
        await stage.clickIt(row.locator('button[role="switch"]').first(), { after: 1200 });
        const dialog = page.locator('.sk-dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm__consequence').first(), 3000);
        await stage.clickIt(dialog.getByRole('button', { name: /^(Turn on|Save)/ }).first(), {
          after: 1800,
        });
        await dialog.waitFor({ state: 'hidden', timeout: 25_000 });
        // The switch actually FLIPPING, not just the dialog closing — a
        // refusal stays in the dialog, and this scene is the claim that
        // it is now on.
        await page
          .locator('.wal-setting')
          .filter({ hasText: 'Automatic withdrawals' })
          .first()
          .locator('button[role="switch"][aria-checked="true"]')
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
      },

      async hour({ page, stage }) {
        const row = page
          .locator('.wal-setting')
          .filter({ hasText: 'Automatic withdrawal hour' })
          .first();
        await row.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        const select = row.locator('select').first();
        await stage.point(select, { settle: 700 });
        await select.selectOption(WITHDRAWAL.hour);
        await page.waitForTimeout(700);
        await stage.clearHalo();
        await stage.clickIt(row.getByRole('button', { name: 'Save' }).first(), { after: 1200 });
        const dialog = page.locator('.sk-dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.clickIt(dialog.getByRole('button', { name: /^(Change|Save)/ }).first(), {
          after: 1800,
        });
        await dialog.waitFor({ state: 'hidden', timeout: 25_000 });
        await page.waitForTimeout(800);
      },

      async keep({ page, stage }) {
        const row = page
          .locator('.wal-setting')
          .filter({ hasText: 'Keep this much in the wallet' })
          .first();
        await row.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await stage.typeIn(row.getByLabel('Balance to keep'), WITHDRAWAL.keep, {
          clear: true,
          after: 600,
        });
        await stage.clickIt(row.getByRole('button', { name: 'Save' }).first(), { after: 1200 });
        const dialog = page.locator('.sk-dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm__consequence').first(), 2200);
        await stage.clickIt(dialog.getByRole('button', { name: /^(Change|Save)/ }).first(), {
          after: 1800,
        });
        await dialog.waitFor({ state: 'hidden', timeout: 25_000 });
        await page.waitForTimeout(900);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.locator('.wal-settings').first(), 2800);
        await stage.glide(-280);
        await page.waitForTimeout(1200);
      },
    },
  },

  'keys-and-webhooks': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-keys'(ctx) {
        const { page, stage } = ctx;
        await openSettingsHub(ctx);
        // By href, not by name: a settings tile's accessible name is its
        // title AND its description run together, so an exact-name
        // lookup finds nothing and a loose one is a paragraph.
        await stage.clickIt(page.locator('a[href="/settings/api-keys"]').first(), { after: 1600 });
        await page.waitForURL(/\/settings\/api-keys/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
      },

      async issue({ page, stage }) {
        await stage.typeIn(page.getByLabel('Key name'), INTEGRATIONS.keyName, { after: 500 });
        await stage.typeIn(page.getByLabel('Expires in days'), INTEGRATIONS.keyDays, {
          after: 900,
        });
      },

      async 'confirm-create'({ page, stage }) {
        // The FORM's button, scoped away from the dialog's — the confirm
        // carries the same accessible name, and both are in the DOM
        // together the moment it opens.
        await stage.clickIt(
          page.locator('form').getByRole('button', { name: 'Create key' }).first(),
          { after: 1200 },
        );
        const dialog = page.locator('.sk-dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm__consequence').first(), 3000);
      },

      async once({ page, stage }) {
        await stage.clickIt(
          page.locator('.sk-dialog').getByRole('button', { name: 'Create key' }).first(),
          { after: 1600 },
        );
        const reveal = page.locator('.set-reveal').first();
        await reveal.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(reveal, 3200);
      },

      async list({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: "I've copied it" }).first(), {
          after: 1400,
        });
        const row = page.getByRole('row').filter({ hasText: INTEGRATIONS.keyName }).first();
        await row.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await stage.dwellOn(row, 3000);
      },

      async revoke({ page, stage }) {
        const row = page.getByRole('row').filter({ hasText: INTEGRATIONS.keyName }).first();
        await stage.clickIt(row.getByRole('button', { name: 'Revoke', exact: true }).first(), {
          after: 1200,
        });
        const dialog = page.locator('.sk-dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm__consequence').first(), 3000);
      },

      async revoked({ page, stage }) {
        await stage.clickIt(
          page.locator('.sk-dialog').getByRole('button', { name: 'Revoke key' }).first(),
          { after: 1800 },
        );
        // The Revoke button LEAVING is the proof. This dialog closes on a
        // refusal too (the verdict goes to the page-level callout), so
        // waiting for it to hide would pass on a failed revoke.
        const row = page.getByRole('row').filter({ hasText: INTEGRATIONS.keyName }).first();
        await row
          .getByRole('button', { name: 'Revoke', exact: true })
          .waitFor({ state: 'detached', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(row, 2600);
      },

      async 'open-webhooks'(ctx) {
        const { page, stage } = ctx;
        await openSettingsHub(ctx);
        await stage.clickIt(page.locator('a[href="/settings/webhooks"]').first(), { after: 1600 });
        await page.waitForURL(/\/settings\/webhooks/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
      },

      async endpoint({ page, stage }) {
        // `.first()`: the empty state carries a second button of the same
        // name, and this seller has one endpoint already so it does not —
        // but a take against an empty account would otherwise be strict.
        await stage.clickIt(page.getByRole('button', { name: 'New endpoint' }).first(), {
          after: 1200,
        });
        const dialog = page.locator('.sk-dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        // `clear`: the field is pre-seeded with the literal "https://",
        // so typing would append to it and save a malformed URL.
        await stage.typeIn(dialog.getByLabel('URL'), INTEGRATIONS.endpointUrl, {
          clear: true,
          after: 400,
        });
        await stage.typeIn(dialog.getByLabel('Display name'), INTEGRATIONS.endpointName, {
          after: 400,
        });
        await stage.dwellOn(dialog.getByLabel(/^Subscribed events/), 1600);
      },

      async secret({ page, stage }) {
        await stage.clickIt(
          page.locator('.sk-dialog').getByRole('button', { name: 'Create endpoint' }).first(),
          { after: 1600 },
        );
        const reveal = page.locator('.set-reveal').first();
        await reveal.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(reveal, 3200);
      },

      async rotate({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: "I've copied it" }).first(), {
          after: 1200,
        });
        const row = page
          .locator('.set-endpoint')
          .filter({ hasText: INTEGRATIONS.endpointName })
          .first();
        await row.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await stage.clickIt(row.getByRole('button', { name: 'Rotate secret' }).first(), {
          after: 1200,
        });
        const dialog = page.locator('.sk-dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm__consequence').first(), 2600);
        await stage.clickIt(dialog.getByRole('button', { name: 'Rotate secret' }).first(), {
          after: 1800,
        });
        await page.locator('.set-reveal').first().waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
      },

      async 'auto-disabled'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: "I've copied it" }).first(), {
          after: 1200,
        });
        const broken = page
          .locator('.set-endpoint')
          .filter({ hasText: INTEGRATIONS.brokenName })
          .first();
        await broken.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await stage.dwellOn(broken, 2400);
        await stage.dwellOn(broken.locator('.set-endpoint__facts').first(), 2600);
      },

      async 'back-on'({ page, stage }) {
        const broken = page
          .locator('.set-endpoint')
          .filter({ hasText: INTEGRATIONS.brokenName })
          .first();
        await stage.clickIt(broken.locator('button[role="switch"]').first(), { after: 1800 });
        // The CHIP clearing is the whole point of the scene, and until
        // the 2026-09-30 fix it never did: re-enabling wrote `isActive`
        // alone, so the stamp stayed and delivery never resumed. Waiting
        // on the switch's own state would have passed either way.
        await broken
          .locator('.sk-chip')
          .filter({ hasText: 'Active' })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(1000);
        await stage.dwellOn(broken, 2400);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.locator('.set-endpoints').first(), 2600);
        await stage.glide(-300);
        await page.waitForTimeout(1200);
      },
    },
  },

  'open-a-reseller-store': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-stores'({ page, stage }) {
        await stage.clickIt(
          page.getByRole('link', { name: 'Reseller stores', exact: true }).first(),
          { after: 1600 },
        );
        await page.waitForURL(/\/reseller-stores$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        await stage.dwellOn(page.locator('.rs-kpis').first(), 3000);
      },

      async 'open-form'({ page, stage }) {
        // `.first()`: with no stores the empty state carries a second
        // button of the same name, and the header's is the one on screen.
        await stage.clickIt(page.getByRole('button', { name: 'Open a reseller store' }).first(), {
          after: 1200,
        });
        const dialog = page.locator('.sk-dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-dialog__desc').first(), 2600);
      },

      async names({ page, stage }) {
        const dialog = page.locator('.sk-dialog').first();
        await stage.typeIn(dialog.getByLabel('Store name'), RESELLER.storeName, { after: 500 });
        await stage.typeIn(dialog.getByLabel('Name customers see'), RESELLER.displayName, {
          after: 800,
        });
      },

      async contact({ page, stage }) {
        const dialog = page.locator('.sk-dialog').first();
        await stage.typeIn(dialog.getByLabel('Contact email'), RESELLER.contactEmail, {
          after: 400,
        });
        await stage.typeIn(dialog.getByLabel('Contact phone'), RESELLER.contactPhone, {
          after: 800,
        });
      },

      async wallet({ page, stage }) {
        const dialog = page.locator('.sk-dialog').first();
        await stage.dwellOn(dialog.getByLabel(/wallet/i).first(), 3000);
      },

      async invite({ page, stage }) {
        const dialog = page.locator('.sk-dialog').first();
        await stage.typeIn(dialog.getByLabel('Their email'), RESELLER.inviteEmail, { after: 400 });
        await stage.typeIn(dialog.getByLabel('Their name'), RESELLER.inviteName, { after: 800 });
      },

      async created({ page, stage }) {
        await stage.clickIt(
          page.locator('.sk-dialog').getByRole('button', { name: 'Open the store' }).first(),
          { after: 1800 },
        );
        // The ROW, not the dialog closing: a refusal (a name already
        // taken, an address already registered) stays in the form.
        const link = page.getByRole('link', { name: RESELLER.storeName }).first();
        await link.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(1000);
        await stage.dwellOn(page.locator('.rs-kpis').first(), 2400);
      },

      async detail({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: RESELLER.storeName }).first(), {
          after: 1800,
        });
        await page.waitForURL(/\/reseller-stores\/[0-9a-f-]+$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        await stage.dwellOn(page.getByRole('tablist').first(), 2600);
      },

      async details({ page, stage }) {
        const facts = page.locator('.rs-facts-list').first();
        await facts.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await stage.dwellOn(facts, 3200);
      },

      async pause({ page, stage }) {
        await stage.glide(-600);
        await page.waitForTimeout(600);
        await stage.clickIt(page.getByRole('button', { name: 'Pause', exact: true }).first(), {
          after: 1200,
        });
        const dialog = page.locator('.sk-dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm__consequence').first(), 2600);
        await stage.clickIt(dialog.getByRole('button', { name: 'Pause', exact: true }).first(), {
          after: 1800,
        });
        // Resume appearing is the proof it paused. The dialog closes on
        // a refusal too, and the card only offers Resume when it did.
        await page
          .getByRole('button', { name: 'Resume', exact: true })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
      },

      async outro({ page, stage }) {
        // Named and NOT clicked: closing is final, and the video says so
        // rather than demonstrating it.
        await stage.dwellOn(page.getByRole('button', { name: 'Close for good' }).first(), 3000);
        await stage.dwellOn(page.locator('.rs-card[data-tone="open"]').first(), 2400);
      },
    },
  },

  'set-a-reseller-price': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-list'({ page, stage }) {
        await stage.clickIt(
          page.getByRole('link', { name: 'Reseller price list', exact: true }).first(),
          { after: 1600 },
        );
        await page.waitForURL(/\/reseller-stores\/price-list/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
        await stage.dwellOn(page.locator('.rs-kpis').first(), 2800);
      },

      async table({ page, stage }) {
        const row = priceRow(page);
        await row.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await stage.dwellOn(row, 3000);
      },

      async 'open-form'({ page, stage }) {
        await stage.clickIt(priceRow(page).getByRole('button', { name: 'Set price' }).first(), {
          after: 1200,
        });
        const dialog = page.locator('.sk-dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        // The four fields, which is what the narration is about — the
        // dialog's own description is about overrides, and that is the
        // `override` scene two further on.
        await stage.dwellOn(dialog.locator('.rs-grid-2').first(), 2400);
      },

      async transfer({ page, stage }) {
        const dialog = page.locator('.sk-dialog').first();
        await stage.typeIn(dialog.getByLabel('Transfer price (₹)'), RESELLER_PRICE.transfer, {
          clear: true,
          after: 900,
        });
      },

      async range({ page, stage }) {
        const dialog = page.locator('.sk-dialog').first();
        await stage.typeIn(dialog.getByLabel('Lowest retail (₹)'), RESELLER_PRICE.min, {
          clear: true,
          after: 400,
        });
        await stage.typeIn(dialog.getByLabel('Highest retail (₹)'), RESELLER_PRICE.max, {
          clear: true,
          after: 800,
        });
      },

      async suggested({ page, stage }) {
        const dialog = page.locator('.sk-dialog').first();
        await stage.typeIn(dialog.getByLabel('Suggested retail (₹)'), RESELLER_PRICE.suggested, {
          clear: true,
          after: 900,
        });
      },

      async saved({ page, stage }) {
        await stage.clickIt(
          page.locator('.sk-dialog').getByRole('button', { name: 'Save price' }).first(),
          { after: 1800 },
        );
        // The button's LABEL flipping is the proof: an unpriced row says
        // "Set price" and a priced one says "Edit". The dialog closes on
        // a refusal too, and the row is what the narration reads.
        const row = priceRow(page);
        await row
          .getByRole('button', { name: 'Edit', exact: true })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(row, 3000);
      },

      async override({ page, stage }) {
        await stage.glide(-500);
        await page.waitForTimeout(600);
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 3200);
      },

      async remove({ page, stage }) {
        const row = priceRow(page);
        await row.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await stage.clickIt(row.getByRole('button', { name: 'Remove', exact: true }).first(), {
          after: 1200,
        });
        const dialog = page.locator('.sk-dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm__consequence').first(), 3000);
      },

      async outro({ page, stage }) {
        await stage.clickIt(
          page.locator('.sk-dialog').getByRole('button', { name: 'Remove', exact: true }).first(),
          { after: 1800 },
        );
        // Back to unpriced, proved by the button's label going back.
        const row = priceRow(page);
        await row
          .getByRole('button', { name: 'Set price' })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(1000);
        await stage.dwellOn(page.locator('.rs-strip').first(), 2400);
      },
    },
  },

  'upload-a-catalogue': {
    // The CSV goes up by a real `fetch` to a `mock://` presigned URL,
    // exactly as the order import's does.
    needsSpacesShim: true,

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-import'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Products', exact: true }).first(), {
          after: 1400,
        });
        await page.waitForURL(/\/products$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await stage.clickIt(page.locator('a[href="/products/import"]').first(), { after: 1600 });
        await page.waitForURL(/\/products\/import$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 2800);
      },

      async template({ page, stage }) {
        await stage.dwellOn(page.getByRole('button', { name: 'Download template' }).first(), 3000);
      },

      async upload({ page, stage }) {
        await stage.point(page.locator('.sk-drop').first(), { settle: 600 });
        await page.locator('.sk-drop input[type="file"]').first().setInputFiles(CATALOGUE_CSV);
        await page.waitForTimeout(900);
        await stage.clearHalo();
        await stage.clickIt(page.getByRole('button', { name: 'Upload and check' }).first(), {
          after: 1400,
        });
        // The preview section, which is the whole point of this step —
        // and the step that would have CRASHED before the 2026-09-30 fix
        // (the panel read four fields the catalogue preview does not
        // return, so `ignoredHeaders.length` threw during render).
        const check = page.locator('.ord-mapping').first();
        await check.waitFor({ state: 'visible', timeout: 30_000 });
        await page.waitForTimeout(800);
      },

      async matched({ page, stage }) {
        await stage.dwellOn(page.locator('.ord-mapping').first(), 3200);
      },

      async missing({ page, stage }) {
        const notice = page
          .locator('.sk-notice, .ord-notice')
          .filter({ hasText: 'Missing' })
          .first();
        await notice.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await stage.dwellOn(notice, 3400);
      },

      async mapping({ page, stage }) {
        await stage.glide(600);
        await page.waitForTimeout(600);
        await stage.clickIt(page.getByRole('button', { name: 'Save a mapping' }).first(), {
          after: 1200,
        });
        const dialog = page.locator('.sk-dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.typeIn(dialog.locator('#cm-name'), CATALOGUE_MAPPING.name, { after: 600 });
        // FILLED, not typed: the JSON is ~250 characters and human-rate
        // typing would put fourteen seconds of keystrokes under a
        // fourteen-second line. The halo still goes on first, so a
        // viewer sees which box is being filled.
        const json = dialog.locator('#cm-json');
        await stage.point(json, { settle: 500 });
        await json.fill(CATALOGUE_MAPPING.json);
        await page.waitForTimeout(1200);
        await stage.clearHalo();
        await stage.clickIt(dialog.getByRole('button', { name: 'Save mapping' }).first(), {
          after: 1600,
        });
        await page
          .getByRole('row')
          .filter({ hasText: CATALOGUE_MAPPING.name })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
      },

      async default({ page, stage }) {
        const row = page.getByRole('row').filter({ hasText: CATALOGUE_MAPPING.name }).first();
        await row.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await stage.clickIt(row.getByRole('button', { name: 'Make default' }).first(), {
          after: 1600,
        });
        // The CHIP, not the button going away: this is what makes the
        // mapping apply to an import that names no mapping at all, and
        // until the 2026-09-30 fix it applied to nothing.
        await row
          .locator('.sk-chip')
          .filter({ hasText: 'default' })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(row, 2200);
      },

      async 're-upload'({ page, stage }) {
        await stage.glide(-900);
        await page.waitForTimeout(600);
        await stage.point(page.locator('.sk-drop').first(), { settle: 600 });
        await page.locator('.sk-drop input[type="file"]').first().setInputFiles(CATALOGUE_CSV);
        await page.waitForTimeout(900);
        await stage.clearHalo();
        await stage.clickIt(page.getByRole('button', { name: 'Upload and check' }).first(), {
          after: 1400,
        });
        // The IMPORT button being enabled is the proof the mapping took —
        // it is disabled while anything required is missing.
        await page
          .getByRole('button', { name: /^Import \d+ row/ })
          .first()
          .waitFor({ state: 'visible', timeout: 30_000 });
        await page.waitForTimeout(900);
      },

      async import({ page, stage }) {
        await stage.dwellOn(page.locator('.ord-mapping').first(), 2600);
        await stage.dwellOn(page.getByRole('button', { name: /^Import \d+ row/ }).first(), 2200);
      },

      async running({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Import \d+ row/ }).first(), {
          after: 2000,
        });
        // The run's own row reaching a terminal state. The worker is
        // in-process, so this is seconds — but waiting on the TEXT is
        // what stops the scene filming a spinner.
        await page
          .getByRole('row')
          .filter({ hasText: /Completed|Failed|Partial/i })
          .first()
          .waitFor({ state: 'visible', timeout: 60_000 });
        await page.waitForTimeout(1200);
        await stage.dwellOn(page.getByRole('table').first(), 2800);
      },

      async catalogue({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Products', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/products$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        await stage.dwellOn(
          page.getByRole('row').filter({ hasText: CATALOGUE_MAPPING.checkProduct }).first(),
          3000,
        );
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.getByRole('table').first(), 2800);
        await stage.glide(-240);
        await page.waitForTimeout(1200);
      },
    },
  },

  'where-is-my-parcel': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-tracking'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Tracking', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/tracking$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 2400);
      },

      async tiles({ page, stage }) {
        // The tiles render only on the UNFILTERED view and only with
        // rows — see the component's own note about why they say "of the
        // parcels shown". A take against a seller with no dispatched
        // parcel would open on nothing at all, which is why this video
        // is in LIFECYCLE_SLUGS.
        const kpis = page.locator('.ord-kpis').first();
        await kpis.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(kpis, 3200);
      },

      async register({ page, stage }) {
        const row = page.getByRole('row').filter({ hasText: 'Lakshmi Raghavan' }).first();
        await row.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await stage.dwellOn(row, 3200);
      },

      async failed({ page, stage }) {
        await stage.clickIt(page.getByRole('tab', { name: 'Delivery failed' }).first(), {
          after: 1600,
        });
        // The parcel D0 drove to NDR. Waiting on the ROW rather than the
        // tab's own state is what proves the filter did something.
        await page
          .getByRole('row')
          .filter({ hasText: 'Vikram Desai' })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.getByRole('table').first(), 2600);
      },

      async 'coming-back'({ page, stage }) {
        await stage.clickIt(page.getByRole('tab', { name: 'Coming back' }).first(), {
          after: 1600,
        });
        await page
          .getByRole('row')
          .filter({ hasText: 'Sneha Pillai' })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.getByRole('table').first(), 2600);
      },

      async history({ page, stage }) {
        const row = page.getByRole('row').filter({ hasText: 'Sneha Pillai' }).first();
        await stage.clickIt(row.getByRole('button', { name: /History/ }).first(), { after: 1600 });
        // The timeline is fetched only when asked for, so the scene must
        // wait for it rather than for the button's label to flip.
        const timeline = page.locator('.ord-section').filter({ hasText: 'Parcel history' }).first();
        await timeline.waitFor({ state: 'visible', timeout: 25_000 });
        await timeline.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1200);
        await stage.dwellOn(timeline, 3400);
      },

      async search({ page, stage }) {
        await stage.glide(-700);
        await page.waitForTimeout(500);
        await stage.clickIt(page.getByRole('tab', { name: 'All parcels' }).first(), {
          after: 1200,
        });
        await stage.typeIn(page.getByLabel('Search parcels'), 'Anil', { after: 1400 });
        await page
          .getByRole('row')
          .filter({ hasText: 'Anil Varma' })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(page.getByRole('table').first(), 2400);
      },

      async 'read-only'({ page, stage }) {
        await stage.typeIn(page.getByLabel('Search parcels'), '', { clear: true, after: 1200 });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.getByRole('table').first(), 3000);
      },

      async outro({ page, stage }) {
        const row = page.getByRole('row').filter({ hasText: 'Lakshmi Raghavan' }).first();
        await row.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await stage.dwellOn(row.locator('a.ord-link').first(), 3000);
      },
    },
  },

  /**
   * D2 — what a seller does after a failed delivery.
   *
   * The parcel is D0's `RSH-LIFE-FAILED` (Vikram Desai), driven to
   * DELIVERY_FAILED by a real NDR scan from the simulator. The dialog is
   * OPENED on all three choices and SENT on one — a re-attempt, which is
   * a request an operator reads. The send-back is deliberately only
   * described: it reaches the courier on the click (CUR-10's seller
   * amendment), and performing it here would turn D0's failed parcel
   * into a returning one and take the world with it. D4 owns that.
   */
  'the-customer-was-not-there': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-order'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Orders', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/orders$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        // The status TAB, not a search box: it is how a seller finds this
        // in real life, and it proves the order is where the video says.
        await stage.clickIt(page.getByRole('tab', { name: /^Delivery failed/ }).first(), {
          after: 1600,
        });
        const row = page.getByRole('row').filter({ hasText: FAILED_CUSTOMER }).first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.clickIt(row.getByRole('link').first(), { after: 1800 });
        await page.waitForURL(/\/orders\/[0-9a-f-]+$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 1800);
      },

      async tracker({ page, stage }) {
        const tracker = page.locator('.ord-section').filter({ hasText: 'Order tracker' }).first();
        await tracker.waitFor({ state: 'visible', timeout: 25_000 });
        await tracker.scrollIntoViewIfNeeded();
        await page.waitForTimeout(900);
        await stage.dwellOn(tracker, 3600);
      },

      async panel({ page, stage }) {
        const panel = page
          .locator('.ord-section')
          .filter({ hasText: 'Delivery did not succeed' })
          .first();
        // The panel renders only while the parcel is in trouble, so its
        // absence means the seeding did not leave this order failed —
        // which a dwell on a missing element reports as a timeout rather
        // than filming a page that quietly does not say this.
        await panel.waitFor({ state: 'visible', timeout: 25_000 });
        await panel.scrollIntoViewIfNeeded();
        await page.waitForTimeout(900);
        await stage.dwellOn(panel.locator('.ord-notice, [class*="notice"]').first(), 3000);
      },

      async history({ page, stage }) {
        const panel = page
          .locator('.ord-section')
          .filter({ hasText: 'Delivery did not succeed' })
          .first();
        const calls = panel.locator('.ord-callcard').first();
        await calls.waitFor({ state: 'visible', timeout: 25_000 });
        await calls.scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await stage.dwellOn(calls, 3400);
      },

      async 'ask-open'({ page, stage }) {
        await stage.glide(-2400);
        await page.waitForTimeout(700);
        await stage.clickIt(page.getByRole('button', { name: 'Ask admin to act' }).first(), {
          after: 1600,
        });
        const dialog = page.getByRole('dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(dialog, 2600);
      },

      // Each choice is SELECTED so its own hint is on screen while the
      // narration describes it — the hint is the component's own words,
      // and reading them out over a different option's text would be a
      // video of the wrong sentence.
      async reattempt({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        await dialog.getByLabel('What would you like').selectOption('REATTEMPT');
        await page.waitForTimeout(900);
        await stage.dwellOn(dialog.getByLabel('What would you like'), 3000);
      },

      async sendback({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        await dialog.getByLabel('What would you like').selectOption('RTO');
        await page.waitForTimeout(900);
        // The dialog's DESCRIPTION changes on this choice — "returning
        // your own parcel is your decision, so this reaches the courier
        // immediately" — and the button goes destructive. That change is
        // the scene. It is NOT pressed: it would reach the simulator on
        // the click and turn D0's failed parcel into a returning one.
        await stage.dwellOn(dialog, 3400);
      },

      // A RECALL is what the video actually sends — the cheapest of the
      // three and the honest first move, and the one that leaves least
      // behind: a seller issue and a queued call, both cleared by the
      // seeding. A re-attempt would open a COURIER thread instead.
      async recall({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        await dialog.getByLabel('What would you like').selectOption('RECALL');
        await page.waitForTimeout(900);
        await stage.dwellOn(dialog, 3000);
      },

      async reason({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        await stage.typeIn(dialog.getByLabel('What do you know'), ASK_REASON, { after: 1600 });
        await stage.dwellOn(dialog.getByLabel('What do you know'), 2200);
      },

      async sent({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        await stage.clickIt(dialog.getByRole('button', { name: 'Send request' }).first(), {
          after: 1400,
        });
        await dialog.waitFor({ state: 'hidden', timeout: 25_000 });
        const panel = page
          .locator('.ord-section')
          .filter({ hasText: 'Delivery did not succeed' })
          .first();
        // The CARD, not the dialog closing: the request is only real once
        // it is on the order, and a closed dialog says nothing about that.
        await panel
          .getByRole('heading', { name: 'What you asked for' })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        const asked = panel.locator('.ord-callcard').last();
        await asked.waitFor({ state: 'visible', timeout: 25_000 });
        await asked.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1200);
        await stage.dwellOn(asked, 3400);
      },

      async outro({ page, stage }) {
        const panel = page
          .locator('.ord-section')
          .filter({ hasText: 'Delivery did not succeed' })
          .first();
        await panel.scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await stage.dwellOn(panel, 3200);
      },
    },
  },

  /**
   * D3 — the morning screen.
   *
   * Both lists come from D0: `RSH-LIFE-REVIEW` is the order the call
   * centre could not confirm (AWAITING_SELLER_DECISION), and
   * `RSH-LIFE-OVERDUE` is the seventh parcel, out for delivery on a
   * back-dated scan and flagged by the real NSA sweep. Nothing is
   * pressed — the page has no buttons, which is the eighth scene.
   */
  'what-needs-you-today': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async open({ page, stage }) {
        await stage.clickIt(
          page.getByRole('link', { name: 'Needs attention', exact: true }).first(),
          {
            after: 1600,
          },
        );
        await page.waitForURL(/\/needs-attention$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2600);
      },

      async tiles({ page, stage }) {
        // The tiles read "—" until BOTH order queries and the NSA list
        // have answered (the page says so itself), so waiting on the
        // figure rather than the element is what stops this filming a
        // dash where the narration says "two figures".
        const kpis = page.locator('.nat-kpis').first();
        await kpis.waitFor({ state: 'visible', timeout: 20_000 });
        await kpis
          .getByText('Out three nights or more')
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(kpis, 3400);
      },

      async 'could-not-reach'({ page, stage }) {
        const section = page.locator('.nat-section').filter({ hasText: 'Could not reach' }).first();
        await section.waitFor({ state: 'visible', timeout: 25_000 });
        await section.scrollIntoViewIfNeeded();
        await page.waitForTimeout(900);
        await stage.dwellOn(section.locator('.sk-sh, h2, h3').first(), 3000);
      },

      async 'waiting-row'({ page, stage }) {
        const row = page.getByText('Waiting on your decision').first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        const card = page.locator('a').filter({ has: row }).first();
        await card.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await stage.dwellOn(card, 3600);
      },

      async overdue({ page, stage }) {
        const section = page.locator('.nat-section').filter({ hasText: 'Overdue parcels' }).first();
        await section.waitFor({ state: 'visible', timeout: 25_000 });
        await section.scrollIntoViewIfNeeded();
        await page.waitForTimeout(900);
        // The parcel D0 back-dated. Waiting on the ROW rather than the
        // heading is what proves the sweep flagged it — an unflagged one
        // simply is not here, and the section would still render.
        await page
          .getByText(OVERDUE_CUSTOMER, { exact: false })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await stage.dwellOn(section, 3400);
      },

      async chasing({ page, stage }) {
        const note = page.locator('.nat-next').last();
        await note.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await stage.dwellOn(note, 3200);
      },

      async 'no-buttons'({ page, stage }) {
        await stage.glide(-500);
        await page.waitForTimeout(800);
        await stage.dwellOn(page.locator('.nat-page').first(), 3400);
      },

      // Through the WAITING row, not the overdue one. Both link to their
      // order and the narration says "every row", but the overdue
      // parcel's scans are BACK-DATED by the seeding (D0's seventh
      // parcel) while its warehouse leg happened minutes ago, so its
      // tracker reads "handed to courier" after "in transit" — true of
      // this box and confusing on camera. The waiting order has no
      // courier scans at all, and its page is where D5 goes next.
      async 'through-to-order'({ page, stage }) {
        const row = page.getByText('Waiting on your decision').first();
        await row.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await stage.clickIt(page.locator('a').filter({ has: row }).first(), { after: 1800 });
        await page.waitForURL(/\/orders\/[0-9a-f-]+$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2600);
      },

      async outro({ page, stage }) {
        await stage.clickIt(
          page.getByRole('link', { name: 'Needs attention', exact: true }).first(),
          {
            after: 1600,
          },
        );
        await page.waitForURL(/\/needs-attention$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
        await stage.dwellOn(page.locator('.nat-kpis').first(), 3200);
      },
    },
  },

  /**
   * D5 — the call cap.
   *
   * D0's `RSH-LIFE-REVIEW`: rung to the cap with NO_ANSWER, and paused
   * at AWAITING_SELLER_DECISION rather than rejected, because
   * `inventory.early_reservation_ndr_action` is MANUAL_REVIEW.
   *
   * The video PRESSES KEEP TRYING, which is the reversible half: the
   * order goes back to PENDING_CONFIRMATION and the seeding rings it to
   * the cap again on the next take (`noAnswerToCap` stops as soon as the
   * order stops being callable, so a resumed one takes one ring rather
   * than three). "Let it go" is SELECTED and its confirm is opened so it
   * can be read — and then cancelled: it is a terminal reject, and D0
   * cannot rebuild a rejected order.
   */
  'the-customer-would-not-answer': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async open({ page, stage }) {
        await stage.clickIt(
          page.getByRole('link', { name: 'Unreachable customers', exact: true }).first(),
          { after: 1600 },
        );
        await page.waitForURL(/\/holds$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 3000);
      },

      async tiles({ page, stage }) {
        const kpis = page.locator('.inv-kpis').first();
        await kpis.waitFor({ state: 'visible', timeout: 20_000 });
        // The FIGURE, not the card: both tiles read a dash until the
        // list has answered, and a scene about "two figures" opening on
        // two dashes is the thing check mode cannot see.
        await page
          .getByText('Calls already made')
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(kpis, 3200);
      },

      async units({ page, stage }) {
        // There is no third tile — that is the scene. Dwelling on the
        // pair is what shows the gap where it would be.
        await stage.dwellOn(page.locator('.inv-kpis').first(), 3400);
      },

      async register({ page, stage }) {
        const table = page.getByRole('table').first();
        await table.waitFor({ state: 'visible', timeout: 20_000 });
        await table.scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await stage.dwellOn(table, 3400);
      },

      async 'decide-open'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Decide' }).first(), { after: 1600 });
        const dialog = page.getByRole('dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(dialog, 3000);
      },

      // `chooseCard`, not a click on the words: ChoiceCards wraps a
      // visually-hidden real radio in a <label>, and clicking the card's
      // TITLE is refused as "intercepts pointer events". The helper puts
      // the halo on the card and checks the radio.
      async 'let-it-go'(ctx) {
        const { page, stage } = ctx;
        await chooseCard(ctx, 'RELEASE', { after: 1200 });
        await page.waitForTimeout(600);
        await stage.dwellOn(page.getByRole('dialog').first(), 3000);
      },

      async confirm({ page, stage }) {
        // The button's label follows the choice: on RELEASE it reads
        // "Let it go" and is destructive.
        await stage.clickIt(
          page.getByRole('dialog').first().getByRole('button', { name: 'Let it go' }).first(),
          { after: 1600 },
        );
        // The SECOND dialog, which names the order. Matched on its own
        // title rather than on `.last()` — a confirm that never opened
        // would otherwise pass by dwelling on the first one again.
        const confirmDialog = page
          .getByRole('dialog')
          .filter({ hasText: 'Let this order go?' })
          .first();
        await confirmDialog.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(confirmDialog, 3200);
        // Backed out IN THIS SCENE, so the next one opens on the choice
        // rather than on a closing modal.
        await stage.clickIt(confirmDialog.getByRole('button', { name: 'Cancel' }).first(), {
          after: 1400,
        });
        await confirmDialog.waitFor({ state: 'hidden', timeout: 20_000 });
        await page.waitForTimeout(600);
      },

      async 'keep-trying'(ctx) {
        const { page, stage } = ctx;
        await chooseCard(ctx, 'REQUEST_MORE_ATTEMPTS', { after: 1200 });
        await page.waitForTimeout(600);
        await stage.dwellOn(page.getByRole('dialog').first(), 3000);
      },

      async note({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        await stage.typeIn(dialog.getByLabel('Note'), HOLD_NOTE, { after: 1600 });
        await stage.dwellOn(dialog.getByLabel('Note'), 2400);
      },

      async send({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        await stage.clickIt(dialog.getByRole('button', { name: 'Keep trying' }).first(), {
          after: 1400,
        });
        await dialog.waitFor({ state: 'hidden', timeout: 25_000 });
        // The EMPTY state, which is what proves the decision landed: the
        // list is filtered to OPEN and the review has left it.
        await page
          .getByText('Nothing waiting on you')
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(1000);
        await stage.dwellOn(page.locator('.inv-card').first(), 3200);
      },

      async decided({ page, stage }) {
        await stage.clickIt(page.getByRole('tab', { name: 'All' }).first(), { after: 1600 });
        const table = page.getByRole('table').first();
        await table.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(table, 3600);
      },
    },
  },

  /**
   * D6 — a damage claim, from the bench to the wallet.
   *
   * D0's `RSH-LIFE-RESTOCKED`: two units came back, one good and one
   * ruined (WMS-8d inspects BY QUANTITY, which is what lets one order be
   * both restocked and carrying a scrap ticket). The lifecycle pass then
   * replies on the ticket and settles it with a refund, so the video has
   * the whole arc rather than an open claim.
   *
   * The second half is the seller's own: an issue raised on camera,
   * which the seeding clears before the next take.
   */
  'something-arrived-damaged': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async open({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Tickets', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/tickets$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 2800);
      },

      async tiles({ page, stage }) {
        const kpis = page.locator('.tkt-kpis').first();
        await kpis.waitFor({ state: 'visible', timeout: 20_000 });
        // The REFUND figure, not the card: the tile reads a dash until
        // the list has answered, and this scene is about the number.
        await page
          .getByText('already in your wallet', { exact: false })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(kpis, 3200);
      },

      async register({ page, stage }) {
        const table = page.getByRole('table').first();
        await table.waitFor({ state: 'visible', timeout: 20_000 });
        await table.scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await stage.dwellOn(table, 3400);
      },

      async 'our-ticket'({ page, stage }) {
        /*
          THE REFUNDED ONE, not the newest.

          "The newest damage ticket" stopped being a handle on
          2026-10-01: K2's take marks a returned unit damaged and keeps
          it aside, which opens a scrap ticket of its own and puts it at
          the top of this list. `settleScrapTicket` refunds only
          `RSH-LIFE-RESTOCKED`'s and leaves every other claim OPEN, so
          the status is what tells this one from the rest — and the next
          scene waits for a refund banner that an open ticket does not
          have, which is how a selector miss here would have presented.
        */
        const row = page
          .getByRole('row')
          .filter({ hasText: 'RTO DAMAGED' })
          .filter({ hasText: 'Closed · refunded' })
          .first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.clickIt(row.getByRole('link').first(), { after: 1800 });
        await page.waitForURL(/\/tickets\/[0-9a-f-]+$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2400);
      },

      async 'refund-banner'({ page, stage }) {
        // The banner renders only when a refund actually landed, so its
        // absence means the seeding did not settle the claim — which a
        // wait reports rather than filming the page without it.
        const banner = page.locator('.tkt-refund').first();
        await banner.waitFor({ state: 'visible', timeout: 25_000 });
        await banner.scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await stage.dwellOn(banner, 3400);
      },

      async facts({ page, stage }) {
        const facts = page.locator('.tkt-facts').first();
        await facts.scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await stage.dwellOn(facts, 3400);
      },

      async conversation({ page, stage }) {
        const thread = page.locator('.tkt-section').filter({ hasText: 'Conversation' }).first();
        await thread.waitFor({ state: 'visible', timeout: 20_000 });
        await thread.scrollIntoViewIfNeeded();
        await page.waitForTimeout(900);
        await stage.dwellOn(thread, 3600);
      },

      async 'wallet-link'({ page, stage }) {
        await stage.glide(-1200);
        await page.waitForTimeout(600);
        await stage.clickIt(page.locator('a.tkt-refund__link').first(), { after: 1800 });
        await page.waitForURL(/\/wallet$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
        // The CREDIT, by its own label — proof the money is where the
        // ticket said it went.
        const entry = page.getByText('Damage settlement', { exact: false }).first();
        await entry.waitFor({ state: 'visible', timeout: 25_000 });
        await entry.scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await stage.dwellOn(entry, 3400);
      },

      // Raised FROM THE ORDER, which is the path a seller actually
      // uses and the one that works: the modal's own order field is a
      // paste box for a uuid, and the order page shows a NUMBER (see
      // CURRICULUM.md D6 for the finding). From here the field is not
      // asked for at all — the order is already known.
      async raise({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Orders', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/orders$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        const row = page.getByRole('row').filter({ hasText: DELIVERED_CUSTOMER }).first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.clickIt(row.getByRole('link').first(), { after: 1800 });
        await page.waitForURL(/\/orders\/[0-9a-f-]+$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        await stage.clickIt(page.getByRole('button', { name: 'Raise an issue' }).first(), {
          after: 1600,
        });
        const dialog = page.getByRole('dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        // The categories come from the courier, over the network, so the
        // select is empty for a beat after the dialog opens.
        await dialog
          .getByLabel('What is the problem')
          .locator('option')
          .nth(1)
          .waitFor({ state: 'attached', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(dialog.getByLabel('What is the problem'), 2800);
      },

      async describe({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        // BY LABEL, never by index. The list is Delhivery's own and is
        // alphabetical, so index 1 is "Behaviour complaint against
        // staff" — narrating a missing saree over that would be a video
        // of the wrong sentence.
        await dialog.getByLabel('What is the problem').selectOption({ label: ISSUE.category });
        await page.waitForTimeout(800);
        await dialog.getByLabel('Which one').selectOption({ label: ISSUE.subcategory });
        await page.waitForTimeout(700);
        await stage.typeIn(dialog.getByLabel('What happened'), ISSUE.description, { after: 1400 });
        await stage.dwellOn(dialog, 2600);
      },

      async raised({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        await stage.clickIt(dialog.getByRole('button', { name: 'Raise issue' }).first(), {
          after: 1600,
        });
        await dialog.waitFor({ state: 'hidden', timeout: 25_000 });
        await stage.clickIt(page.getByRole('link', { name: 'Tickets', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/tickets$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // The ROW, by the subject the chosen subcategory DERIVED — the
        // register is the proof, and a closed dialog says nothing.
        await page
          .getByRole('row')
          .filter({ hasText: ISSUE.subcategory })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(1000);
        await stage.dwellOn(page.getByRole('table').first(), 3400);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.locator('.tkt-kpis').first(), 3200);
      },
    },
  },

  'what-skydrop-charges': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-limits'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Wallet', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/wallet$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(900);
        await stage.clickIt(page.locator('a[href="/wallet/limits"]').first(), { after: 1600 });
        await page.waitForURL(/\/wallet\/limits/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
      },

      async framing({ page, stage }) {
        // The page's own subtitle says who sets these and invites the
        // question the last scene answers.
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 1400);
        await stage.dwellOn(page.locator('.wal-terms').first(), 2600);
      },

      // Each of the next four dwells on the RULES it is about, found by
      // their labels rather than by position: the list is server-driven
      // (`GET /seller/wallet/settings`), so a rule added or reordered
      // upstream must not silently make a scene point at a different row.
      async withdrawals({ page, stage }) {
        await dwellOnTerms(page, stage, ['Minimum balance', 'Smallest withdrawal']);
        await dwellOnTerms(page, stage, ['Withdrawals per day', 'Withdrawals per month']);
      },

      async 'cod-timing'({ page, stage }) {
        await dwellOnTerms(page, stage, ['COD credited'], 2600);
        await dwellOnTerms(page, stage, ['Instant-pay fee'], 2000);
      },

      async deductions({ page, stage }) {
        await dwellOnTerms(page, stage, ['GST withheld on COD'], 2600);
        await dwellOnTerms(page, stage, ['COD collection fee'], 2200);
      },

      async charges({ page, stage }) {
        await dwellOnTerms(page, stage, ['Delivery fee charged'], 2400);
        await dwellOnTerms(page, stage, ['Inbound freight terms', 'Pay-later service charge']);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.locator('.wal-setting__desc').first(), 2400);
        await stage.glide(-320);
        await page.waitForTimeout(1400);
      },
    },
  },

  'pay-money-in': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-wallet'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Wallet', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/wallet$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1400);
      },

      async 'choose-account'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /Top-up wallet/i }).first(), {
          after: 1600,
        });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await page.locator('.wal-bank').first().waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(page.locator('.wal-banks').first(), 2600);
      },

      async 'pick-bd'({ page, stage }) {
        // The TAKA account on purpose. It is the one that makes the next
        // scene mean anything — an INR account shows no conversion, so
        // the "rupee equivalent underneath" the narration points at
        // would be the same number twice.
        await stage.clickIt(page.locator('.wal-bank').filter({ hasText: TOPUP.bank }).first(), {
          after: 1800,
        });
        await page.waitForTimeout(900);
      },

      async amount({ page, stage }) {
        await stage.typeIn(page.getByLabel(/Amount you paid/i), TOPUP.amount, { after: 1200 });
      },

      async evidence({ page, stage }) {
        await stage.typeIn(page.getByLabel(/Transaction ID/i), TOPUP.reference, { after: 800 });
        // The receipt drop zone is POINTED AT, not used. Either one
        // satisfies the requirement, and uploading would mean inventing
        // a bank document to put on camera — a fabricated record is not
        // something to put in a tutorial, and the narration says the two
        // are alternatives anyway.
        await stage.dwellOn(page.locator('.sk-dropzone, [class*="drop"]').first(), 1800);
      },

      async submit({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /Record|Submit/i }).last(), {
          after: 2400,
        });
      },

      async claim({ page, stage }) {
        await page
          .getByRole('heading', { name: /We have your top-up/i })
          .waitFor({ state: 'visible', timeout: 30_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(page.locator('.wal-done__body').first(), 2600);
        await stage.dwellOn(page.locator('.wal-done__aside').first(), 2200);
      },

      async outro({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Done|^Close/i }).last(), {
          after: 1800,
        });
        await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
        await stage.dwellOn(page.getByRole('table').first(), 2600);
      },
    },
  },

  'build-a-role': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-roles'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Roles', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/team\/roles/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 1600);
      },

      async 'the-list'({ page, stage }) {
        await stage.dwellOn(page.getByRole('table').first(), 2200);
        await stage.dwellOn(page.getByRole('row').filter({ hasText: 'Owner' }).first(), 2200);
      },

      async 'new-role'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'New role' }).first(), {
          after: 1400,
        });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.typeIn(dialog.getByLabel('Name'), NEW_ROLE.name, { after: 700 });
      },

      async purpose({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await stage.typeIn(dialog.getByLabel(/What this role is for/i), NEW_ROLE.purpose, {
          delay: 30,
          after: 700,
        });
      },

      async groups({ page, stage }) {
        await stage.dwellOn(page.locator('.role-perms__list').first(), 3000);
      },

      async search({ page, stage }) {
        // Typed into the search to show it matching the KEY, then
        // cleared — the next scene needs the full list back.
        await stage.typeIn(page.getByLabel('Search permissions'), NEW_ROLE.search, { after: 1800 });
        await page.getByLabel('Search permissions').fill('');
        await page.waitForTimeout(800);
      },

      async pick({ page, stage }) {
        // Scoped to the GROUP's own accordion item, so a switch from
        // another area can never be the one that gets ticked.
        //
        // And it THROWS when it ticks nothing. The first version skipped
        // quietly on a selector miss, which passed `--check` twice while
        // saving a role with zero permissions — a video whose whole
        // middle is choosing permissions, filming a form where none were
        // chosen. A step that cannot do its job must say so; that is the
        // entire reason check mode exists.
        let ticked = 0;
        for (const group of NEW_ROLE.grant) {
          const item = page
            .locator('.sk-acc__item')
            .filter({ has: page.locator('.sk-acc__title', { hasText: group }) })
            .first();
          await item.waitFor({ state: 'visible', timeout: 20_000 });
          await stage.clickIt(item.locator('.sk-acc__trigger').first(), { after: 800 });

          const switches = item.locator('[role="switch"]');
          const n = Math.min(2, await switches.count());
          if (n === 0) throw new Error(`No permission switches inside the "${group}" group`);
          for (let i = 0; i < n; i += 1) {
            await stage.clickIt(switches.nth(i), { settle: 300, after: 450 });
            ticked += 1;
          }
        }
        if (ticked === 0) throw new Error('The role would save with no permissions at all');
      },

      async sensitive({ page, stage }) {
        await stage.dwellOn(page.locator('.role-perms__summary').first(), 3000);
      },

      async save({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Create role|^Save/ }).last(), {
          after: 2200,
        });
        await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        await stage.dwellOn(page.getByRole('row').filter({ hasText: NEW_ROLE.name }).first(), 2000);
      },

      async remove({ page, stage }) {
        await stage.clickIt(
          page
            .getByRole('row')
            .filter({ hasText: NEW_ROLE.name })
            .first()
            .getByRole('button', { name: 'Edit' }),
          { after: 1400 },
        );
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        // Turn OFF the first permission that is on, whichever it is.
        // Re-opening the editor draws every group CLOSED, so the switch
        // that is on sits inside a collapsed panel — Playwright found it,
        // scrolled to it, and clicked the accordion header that was
        // covering it, for thirty seconds. Open the group first.
        const item = page
          .locator('.sk-acc__item')
          .filter({ has: page.locator('.sk-acc__title', { hasText: NEW_ROLE.grant[0] }) })
          .first();
        await item.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.clickIt(item.locator('.sk-acc__trigger').first(), { after: 800 });

        // `aria-checked`, which is what the Switch actually sets — it
        // carries no `data-state`, and asking for one waited 30 s and
        // timed out.
        const on = item.locator('[role="switch"][aria-checked="true"]').first();
        await on.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.clickIt(on, { after: 900 });
        await stage.clickIt(page.getByRole('button', { name: /^Save/ }).last(), { after: 1400 });
        // The confirmation naming what goes — the scene's whole point.
        await page
          .getByRole('heading', { name: /Remove permissions from this role/i })
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(page.locator('.sk-confirm__consequence').first(), 2600);

        // Backed out HERE rather than at the top of the next scene.
        // The lesson was the question, and going through with it would
        // leave the role in a different shape than the one just built on
        // camera — but the dismissal belongs to THIS scene's tail: a
        // scene should open on the thing it is about, and the first take
        // spent its first two seconds watching this editor close while
        // the narration was already talking about the Owner row.
        await stage.clickIt(page.getByRole('button', { name: 'Cancel' }).last(), { after: 800 });
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 20_000 });
        await page.waitForTimeout(600);
      },

      async owner({ page, stage }) {
        await stage.dwellOn(page.getByRole('row').filter({ hasText: 'Owner' }).first(), 3200);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.getByRole('table').first(), 2600);
      },
    },
  },

  'sign-out-everywhere': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-security'(ctx) {
        const { page, stage } = ctx;
        await openSettingsHub(ctx);
        await stage.clickIt(page.locator('a[href="/settings/security"]').first(), { after: 1400 });
        await page.waitForURL(/\/settings\/security/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
      },

      async 'this-session'({ page, stage }) {
        await stage.dwellOn(page.locator('.set-dl').first(), 3000);
      },

      async 'no-list'({ page, stage }) {
        // An ABSENCE, so there is nothing to point at. The page header
        // is what the narration is really talking about — "who this
        // browser is signed in as", singular.
        await stage.dwellOn(page.getByRole('heading', { name: 'This session' }).first(), 2600);
      },

      async 'what-it-does'({ page, stage }) {
        const heading = page.getByRole('heading', { name: 'Sign out everywhere' }).first();
        await heading.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await stage.dwellOn(page.locator('.set-card[data-tone="danger"] p').first(), 3000);
      },

      async 'not-touched'({ page, stage }) {
        await stage.dwellOn(page.locator('.set-card[data-tone="danger"] .set-muted').first(), 3000);
      },

      async confirm({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Sign out everywhere' }).last(), {
          after: 1200,
        });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm__consequence').first(), 2600);

        // Answered HERE, in this scene's tail, so the next one opens on
        // the RESULT rather than on this dialog dismissing — the same
        // correction the roles video needed. A scene should open on the
        // thing it is about.
        await stage.clickIt(page.getByRole('button', { name: 'Sign out everywhere' }).last(), {
          after: 1200,
        });
        await page
          .getByText(/Sessions ended/i)
          .first()
          .waitFor({ state: 'visible', timeout: 30_000 });
        await page.waitForTimeout(600);
      },

      async done({ page, stage }) {
        // THE LAST SCENE, and it has to be: the click in the scene above
        // ended the session this recording is running in. Anything after
        // it would be filmed signed out.
        await stage.dwellOn(page.locator('.set-card[aria-live="polite"]').first(), 3400);
      },
    },
  },

  /**
   * D4 — asking for a parcel back.
   *
   * THE ONE VIDEO THAT SPENDS WHAT IT FILMS. Both halves press a button
   * that cannot be un-pressed: the send-back reaches the courier on the
   * click (CUR-10's seller amendment, with no operator anywhere in the
   * loop), and the return request books a real collection and moves the
   * order onto the RTO path.
   *
   * So it has its OWN two parcels — `RSH-LIFE-SENDBACK` and
   * `RSH-LIFE-RETURNREQ` — rather than borrowing D2's failed one or
   * D0's delivered one, both of which four other videos read. The
   * seeding retires a spent parcel and builds a fresh one under the same
   * reference (`retireSpentParcel`), which is what makes this
   * re-takeable; a `--check` pass spends one too, because check mode
   * drives the real app.
   *
   * CURRICULUM.md's D4 entry asked for "D0's CONFIRMED-with-waybill"
   * order and that was wrong: `DeliveryTroublePanel` renders only while
   * the order is DELIVERY_FAILED or OUT_FOR_DELIVERY, so on a CONFIRMED
   * order there is no panel and no button at all.
   *
   * THE FIGURES ARE NOT NARRATED. Both fees are now read from the server
   * and printed on screen (the hard-coded `₹200` in the return dialog's
   * copy was this video's first finding), and they are per seller and
   * per currency — so the narration points at where the number is rather
   * than saying it, which also survives a price change.
   */
  'ask-for-a-parcel-back': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-live'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Orders', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/orders$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        // The status tab, as D2 does: it is how a seller finds this in
        // real life, and it proves the seeding left the parcel moving.
        await stage.clickIt(page.getByRole('tab', { name: /^Out for delivery/ }).first(), {
          after: 1600,
        });
        const row = page.getByRole('row').filter({ hasText: SENDBACK_CUSTOMER }).first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(row, 2400);
      },

      async 'on-order'({ page, stage }) {
        const row = page.getByRole('row').filter({ hasText: SENDBACK_CUSTOMER }).first();
        await stage.clickIt(row.getByRole('link').first(), { after: 1800 });
        await page.waitForURL(/\/orders\/[0-9a-f-]+$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1400);
        // THE BUTTON IS THE GATE, not a section title. The panel renders
        // only while the parcel is in trouble, so no button means the
        // seeding did not leave this one out for delivery — and a
        // `.ord-section` filtered on "Out for delivery" would ALSO match
        // the order tracker, which carries the same words as a rung on
        // its own timeline. A gate that passes on the wrong element is a
        // gate that films a page which does not say this.
        const ask = page.getByRole('button', { name: 'Ask admin to act' }).first();
        await ask.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.dwellOn(ask, 2800);
      },

      async 'ask-open'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Ask admin to act' }).first(), {
          after: 1600,
        });
        const dialog = page.getByRole('dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(dialog, 2800);
      },

      async 'pick-sendback'({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        // BY VALUE on a labelled select, never by index: the three
        // choices are ordered by us today and a fourth would land this
        // scene on whatever happened to be third.
        await dialog.getByLabel('What would you like').selectOption('RTO');
        await page.waitForTimeout(1000);
        await stage.dwellOn(dialog, 3000);
      },

      async 'the-fee'({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        // ANCHORED ON THE FEE ITSELF, not on the hint's class. This
        // scene's whole claim is that the figure is printed here, and
        // that figure is read from `GET /seller/pricing/fees` — so if
        // the endpoint is down, unresolvable or gated wrong, the hint
        // falls back to "a return fee applies" and the check FAILS here
        // rather than filming a sentence the narration contradicts.
        //
        // `sk-field__msg[data-kind="hint"]` is the element (FieldShell's
        // own markup); the text is the assertion.
        const hint = dialog.locator('p[data-kind="hint"]').filter({ hasText: /return fee is/ });
        await hint.first().waitFor({ state: 'visible', timeout: 15_000 });
        await stage.dwellOn(hint.first(), 3600);
      },

      async reason({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        await stage.typeIn(dialog.getByLabel('What do you know'), SENDBACK_REASON, { after: 1600 });
        await stage.dwellOn(dialog.getByLabel('What do you know'), 2200);
      },

      async confirm({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        await stage.clickIt(dialog.getByRole('button', { name: 'Send it back now' }).first(), {
          after: 1400,
        });
        // BY ITS OWN TITLE, never `.last()`. Both dialogs are mounted at
        // once and both carry a button reading "Send it back now", so DOM
        // order is the only thing separating them — and which of two
        // portals renders last is not a promise any component makes.
        const confirm = page
          .getByRole('dialog')
          .filter({ hasText: 'Send this parcel back now?' })
          .first();
        await confirm.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(confirm, 3400);
      },

      async sent({ page, stage }) {
        const confirm = page
          .getByRole('dialog')
          .filter({ hasText: 'Send this parcel back now?' })
          .first();
        await stage.clickIt(confirm.getByRole('button', { name: 'Send it back now' }).first(), {
          after: 1600,
        });
        // THE REQUEST CARD, carrying "Executed" — not the order's status.
        //
        // A first cut waited for the status chip to read Rto initiated,
        // and it PASSED while the order plainly still said Out for
        // delivery: the regex matched somewhere else on a long page, and
        // check mode only proves a step was reached. The frame is what
        // caught it.
        //
        // The status was never going to move, and that is CUR-11 rather
        // than a bug: the courier accepting a cancellation is not a
        // scan, and our order status follows their scans and nothing
        // else. What IS true the moment this returns is that the request
        // was carried out — so that is what the scene shows and what the
        // narration says.
        const panel = page
          .locator('.ord-section')
          .filter({ hasText: 'What you asked for' })
          .first();
        await panel.waitFor({ state: 'visible', timeout: 40_000 });
        const asked = panel.locator('.ord-callcard').last();
        await asked
          .getByText(/Executed/i)
          .first()
          .waitFor({ state: 'visible', timeout: 40_000 });
        await asked.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1200);
        await stage.dwellOn(asked, 3400);
      },

      async 'open-delivered'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Orders', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/orders$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        await stage.clickIt(page.getByRole('tab', { name: /^Delivered/ }).first(), { after: 1600 });
        const row = page.getByRole('row').filter({ hasText: RETURNREQ_CUSTOMER }).first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.clickIt(row.getByRole('link').first(), { after: 1800 });
        await page.waitForURL(/\/orders\/[0-9a-f-]+$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.locator('.ord-kpis').first(), 2600);
      },

      async 'request-return'({ page, stage }) {
        const button = page.getByRole('button', { name: 'Request return' }).first();
        await button.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.dwellOn(button, 3200);
      },

      async 'return-dialog'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Request return' }).first(), {
          after: 1600,
        });
        const dialog = page.getByRole('dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        // The paragraph carrying the fee, which is read from the server
        // rather than typed into the copy — the whole point of the
        // change this video's filming produced.
        const said = dialog.locator('.ord-p').first();
        await said.waitFor({ state: 'visible', timeout: 15_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(said, 3600);
      },

      async 'return-reason'({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        await stage.typeIn(dialog.getByLabel('Why is it coming back?'), RETURN_REASON, {
          after: 1600,
        });
        await stage.dwellOn(dialog.getByLabel('Why is it coming back?'), 2400);
      },

      async booked({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        await stage.clickIt(dialog.getByRole('button', { name: 'Request return' }).first(), {
          after: 1600,
        });
        await dialog.waitFor({ state: 'hidden', timeout: 40_000 });
        // TWO dwells, because the first subject does not survive the
        // scene. The toast is the only place the reverse waybill appears
        // and a success toast lives 4500 ms; this scene's line runs about
        // ten seconds, so a single dwell on it would spend most of the
        // scene haloing an element that had gone. It is emphasised while
        // it is there, and the order's own tiles carry the rest.
        const toast = page.getByText(/Collection booked/i).first();
        await toast.waitFor({ state: 'visible', timeout: 30_000 });
        await page.waitForTimeout(500);
        await stage.dwellOn(toast, 2400);
        await stage.dwellOn(page.locator('.ord-kpis').first(), 2600);
      },

      async outro({ page, stage }) {
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        await stage.dwellOn(page.locator('.ord-kpis').first(), 3400);
      },
    },
  },

  /**
   * E2 — reading the wallet.
   *
   * The only money video whose subject is the LEDGER rather than an
   * action, so it presses nothing that moves anything: three tabs, an
   * export, and a row-by-row read of what each kind of entry means. The
   * scenes point at rows BY THEIR LABEL (`ledgerRow`), never by
   * position — the ledger is newest-first and a seed run that adds one
   * entry would otherwise re-aim every scene at its neighbour.
   *
   * Its world comes from D0 plus `ledgerWorldForReading`: the COD credit
   * is the one entry a parcel cannot produce on its own (WAL-5 — on the
   * default SETTLEMENT mode it is written when the COURIER PAYS US), so
   * the seeding records a real courier payout for it, which also writes
   * the tax deduction beside it. That pair is what the video's middle
   * third is about.
   */
  'read-your-wallet': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async open({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Wallet', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/wallet$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 3000);
      },

      async balance({ page, stage }) {
        const tiles = page.locator('.wal-kpis, [class*="kpi"]').first();
        await tiles.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(tiles, 3600);
      },

      async rate({ page, stage }) {
        // The CONVERTED tile's own hint, which carries the rate. Anchored
        // on the text rather than "the second tile": an account with no
        // FX rate on file renders one tile, and the narration would then
        // be pointing at the rupee balance while saying "the rate".
        const hint = page.getByText(/₹1 = ৳/).first();
        await hint.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(hint, 3000);
      },

      async 'three-tabs'({ page, stage }) {
        const tabs = page.getByRole('tablist', { name: 'Wallet views' }).first();
        await tabs.scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await stage.dwellOn(tabs, 2600);
      },

      async 'ledger-is-truth'({ page, stage }) {
        const heading = page.locator('.wal-section').first();
        await heading.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        // The section's NOTE — "Every movement, oldest last" — which is
        // the page saying in its own words what this scene claims.
        await stage.dwellOn(page.getByText('Every movement, oldest last.').first(), 2800);
      },

      async columns({ page, stage }) {
        const head = page.locator('thead').first();
        await head.waitFor({ state: 'visible', timeout: 20_000 });
        await head.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await stage.dwellOn(head, 3000);
      },

      async charges({ page, stage }) {
        await stage.dwellOn(await ledgerRow(page, 'Order charges'), 3400);
      },

      async cod({ page, stage }) {
        await stage.dwellOn(await ledgerRow(page, 'COD collected'), 3000);
      },

      async 'cod-timing'({ page, stage }) {
        // Held on the same row: the claim is about WHEN that row was
        // written, so moving the eye somewhere else would drop the
        // subject half way through the sentence.
        await stage.dwellOn(await ledgerRow(page, 'COD collected'), 3600);
      },

      async gst({ page, stage }) {
        await stage.dwellOn(await ledgerRow(page, 'COD tax deduction'), 3200);
      },

      async refund({ page, stage }) {
        await stage.dwellOn(await ledgerRow(page, 'Damage settlement'), 3200);
      },

      async topups({ page, stage }) {
        await stage.clickIt(page.getByRole('tab', { name: 'Top-ups' }).first(), { after: 1600 });
        await page
          .getByText('Money you have told us you sent.')
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.locator('.wal-panel').first(), 3800);
      },

      async withdrawals({ page, stage }) {
        await stage.clickIt(page.getByRole('tab', { name: 'Withdrawal requests' }).first(), {
          after: 1600,
        });
        await page
          .getByText('Money you have asked us to pay out.')
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.locator('.wal-panel').first(), 3800);
      },

      async export({ page, stage }) {
        // Back to the Ledger first: the Export button is rendered only
        // on that tab, so pointing at it from the withdrawals view would
        // be pointing at nothing.
        await stage.clickIt(page.getByRole('tab', { name: 'Ledger' }).first(), { after: 1400 });
        const button = page.getByRole('button', { name: /Export CSV/ }).first();
        await button.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(button, 3200);
      },

      async outro({ page, stage }) {
        const tabs = page.getByRole('tablist', { name: 'Wallet views' }).first();
        await tabs.scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await stage.dwellOn(tabs, 3400);
      },
    },
  },

  /**
   * G3 — what one store sells.
   *
   * The store is SEEDED, not opened on camera (`standingStoreFor`), and
   * so are the default prices behind it: a video about choosing what a
   * store may sell should not spend its first scene on a product with no
   * price, which the tab itself refuses to make sellable.
   *
   * What the seeding deliberately does NOT leave is any per-variant term
   * — `reseller_store_variants` is wiped on every run. The take enables
   * a product, overrides its price and sets a set-aside, all on camera,
   * and a second take starting from a row already enabled would film the
   * switch going the other way over a form pre-filled with the first
   * take's figures.
   *
   * The product is chosen BY SKU, never by row position: the table is
   * every active variant the seller has, so a product added upstream
   * moves every row.
   */
  'what-one-store-sells': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-store'({ page, stage }) {
        await stage.clickIt(
          page.getByRole('link', { name: 'Reseller stores', exact: true }).first(),
          { after: 1600 },
        );
        await page.waitForURL(/\/reseller-stores$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        const row = page.getByRole('row').filter({ hasText: RESELLER.storeName }).first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.clickIt(row.getByRole('link').first(), { after: 1800 });
        await page.waitForURL(/\/reseller-stores\/[0-9a-f-]+$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        await stage.clickIt(page.getByRole('tab', { name: 'Catalogue & stock' }).first(), {
          after: 1800,
        });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 1800);
      },

      async table({ page, stage }) {
        const table = page.locator('table').first();
        await table.waitFor({ state: 'visible', timeout: 25_000 });
        await table.scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await stage.dwellOn(table.locator('thead').first(), 3400);
      },

      async 'sold-here'({ page, stage }) {
        // THE WHOLE BODY, not one row: the line is "every one of them is
        // off", and haloing a single row while saying "all of them" is
        // the frame arguing with the voice.
        const body = page.locator('table tbody').first();
        await body.waitFor({ state: 'visible', timeout: 25_000 });
        await body.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await stage.dwellOn(body, 3000);
      },

      async 'price-source'({ page, stage }) {
        // The page's own subtitle, which says where a price with no
        // override comes from and links to the list it comes from.
        await stage.dwellOn(
          page.getByText('A price with no override comes from your price list.').first(),
          3200,
        );
      },

      async 'edit-open'({ page, stage }) {
        const row = await storeCatalogueRow(page, STORE_CATALOGUE.sku);
        await stage.clickIt(row.getByRole('button', { name: 'Edit' }).first(), { after: 1600 });
        const dialog = page.getByRole('dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(800);
        // The DESCRIPTION line, which carries the two numbers the rest of
        // this form is spent deciding between.
        await stage.dwellOn(dialog.getByText(/available now;/).first(), 3400);
      },

      async enable({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        await stage.clickIt(dialog.getByLabel('This store may sell it').first(), { after: 1200 });
        await stage.dwellOn(dialog.getByLabel('This store may sell it').first(), 2600);
      },

      async 'own-price'({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        await stage.clickIt(dialog.getByLabel('Give this store its own price').first(), {
          after: 1400,
        });
        await stage.dwellOn(dialog.getByLabel('Give this store its own price').first(), 2600);
      },

      async 'price-fields'({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        await stage.typeIn(dialog.getByLabel('Transfer price (₹)'), STORE_CATALOGUE.transfer, {
          after: 500,
          clear: true,
        });
        await stage.typeIn(dialog.getByLabel('Lowest retail (₹)'), STORE_CATALOGUE.min, {
          after: 500,
          clear: true,
        });
        await stage.typeIn(dialog.getByLabel('Highest retail (₹)'), STORE_CATALOGUE.max, {
          after: 500,
          clear: true,
        });
        await stage.typeIn(dialog.getByLabel('Suggested retail (₹)'), STORE_CATALOGUE.suggested, {
          after: 900,
          clear: true,
        });
        await stage.dwellOn(dialog.getByLabel('Transfer price (₹)'), 1800);
      },

      async 'stock-shared'({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        // BY VALUE on the labelled select, never by index.
        await dialog.getByLabel('Stock').selectOption('SHARED');
        await page.waitForTimeout(900);
        await stage.dwellOn(dialog.getByLabel('Stock'), 3000);
      },

      async 'stock-setaside'({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        await dialog.getByLabel('Stock').selectOption('SET_ASIDE');
        await page.waitForTimeout(900);
        // The qty field appears only on this choice, and its HINT is the
        // scene: how many are free to commit right now.
        await stage.typeIn(dialog.getByLabel('Units set aside'), STORE_CATALOGUE.setAside, {
          after: 900,
          clear: true,
        });
        await stage.dwellOn(dialog.getByLabel('Units set aside'), 2600);
      },

      async hidden({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        await stage.typeIn(dialog.getByLabel('Hidden share (%)'), STORE_CATALOGUE.hidden, {
          after: 900,
          clear: true,
        });
        await stage.dwellOn(dialog.getByLabel('Hidden share (%)'), 3000);
      },

      async overlay({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        await stage.typeIn(dialog.getByLabel('What the store calls it'), STORE_CATALOGUE.title, {
          after: 900,
        });
        await stage.dwellOn(dialog.getByLabel('Description for the store'), 2800);
      },

      async confirm({ page, stage }) {
        const dialog = page.getByRole('dialog').first();
        await stage.clickIt(dialog.getByRole('button', { name: 'Save' }).first(), { after: 1400 });
        const confirm = page
          .getByRole('dialog')
          .filter({ hasText: 'Save these terms for the store?' })
          .first();
        await confirm.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(confirm, 3200);
      },

      async result({ page, stage }) {
        const confirm = page
          .getByRole('dialog')
          .filter({ hasText: 'Save these terms for the store?' })
          .first();
        await stage.clickIt(confirm.getByRole('button', { name: /^Save/ }).first(), {
          after: 1600,
        });
        await page.waitForLoadState('networkidle').catch(() => {});
        // The ROW, now disagreeing with itself across its last two
        // columns — which is the claim the narration makes. Waiting for
        // the set-aside to appear in its Stock cell is what proves the
        // save landed rather than the dialog merely closing.
        const row = await storeCatalogueRow(page, STORE_CATALOGUE.sku);
        await row
          .getByText(new RegExp(`Set aside ${STORE_CATALOGUE.setAside}`))
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(row, 3400);
      },

      async outro({ page, stage }) {
        const table = page.locator('table').first();
        await table.scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await stage.dwellOn(table, 3200);
      },
    },
  },

  /**
   * G4 — the deal.
   *
   * The store is seeded by `standingStoreFor`, which ALSO clears any
   * terms version a previous take published: versions are append-only
   * and numbered (RS-4), so a second take would open on "Publish version
   * 2" over a card already holding the first take's percentages, and
   * every sentence about "the first terms" would be wrong.
   *
   * Fee fields are reached BY LABEL, and the labels are built from
   * `FEE_FIELDS` — a seventh fee added upstream appends a field rather
   * than moving these, so the scenes stay aimed at what they name.
   *
   * The scene that earns the video is `live-example`: the split is
   * computed BY THE API against the seller's real delivery fee as the
   * percentage is typed, so what is on screen is rupees rather than the
   * number just entered. It is anchored on that sentence's own wording,
   * which means a preview that failed to load fails the check instead of
   * filming "Working out an example…".
   */
  'the-deal': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-terms'({ page, stage }) {
        await stage.clickIt(
          page.getByRole('link', { name: 'Reseller stores', exact: true }).first(),
          { after: 1600 },
        );
        await page.waitForURL(/\/reseller-stores$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        const row = page.getByRole('row').filter({ hasText: RESELLER.storeName }).first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.clickIt(row.getByRole('link').first(), { after: 1800 });
        await page.waitForURL(/\/reseller-stores\/[0-9a-f-]+$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        await stage.clickIt(page.getByRole('tab', { name: 'Terms' }).first(), { after: 1800 });
        // "Publish the first terms" is the heading ONLY while the store
        // has no version — so this is the gate that proves the seeding
        // cleared the last take's, not merely that the tab opened.
        await page
          .getByText('Publish the first terms')
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(page.getByText('Publish the first terms').first(), 2400);
      },

      async 'fees-intro'({ page, stage }) {
        await stage.dwellOn(page.getByText(/Inbound freight is always yours/).first(), 3400);
      },

      async 'delivery-share'({ page, stage }) {
        await stage.typeIn(
          page.getByLabel('Delivery fee — store pays (%)', { exact: true }),
          TERMS.delivery,
          {
            after: 1400,
            clear: true,
          },
        );
        await stage.dwellOn(
          page.getByLabel('Delivery fee — store pays (%)', { exact: true }),
          2200,
        );
      },

      async 'live-example'({ page, stage }) {
        // ANCHORED ON THE COMPUTED SENTENCE, not on the element. Its
        // placeholder while the request is in flight is "Working out an
        // example…", so waiting for the real wording is what stops this
        // scene filming the placeholder and calling it a worked example.
        const line = page.locator('.rs-preview').filter({ hasText: /pays/ }).first();
        await line.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(line, 3400);
      },

      async returns({ page, stage }) {
        // EXACT, because "Return fee" is a substring of "Customer return
        // fee" and Playwright's default label match is a substring — it
        // resolved to two inputs and refused under strict mode. Every fee
        // field here is exact for the same reason, whether or not it
        // collides today: a seventh fee could make any of them ambiguous.
        await stage.typeIn(
          page.getByLabel('Return fee — store pays (%)', { exact: true }),
          TERMS.returnFee,
          {
            after: 900,
            clear: true,
          },
        );
        await stage.typeIn(
          page.getByLabel('Customer return fee — store pays (%)', { exact: true }),
          TERMS.customerReturn,
          { after: 1200, clear: true },
        );
        await stage.dwellOn(page.getByLabel('Return fee — store pays (%)', { exact: true }), 2200);
      },

      async cod({ page, stage }) {
        await stage.typeIn(
          page.getByLabel('COD fee — store pays (%)', { exact: true }),
          TERMS.codFee,
          {
            after: 900,
            clear: true,
          },
        );
        await stage.typeIn(
          page.getByLabel('COD tax — store pays (%)', { exact: true }),
          TERMS.codTax,
          {
            after: 1200,
            clear: true,
          },
        );
        await stage.dwellOn(page.getByLabel('COD tax — store pays (%)', { exact: true }), 2400);
      },

      async 'example-table'({ page, stage }) {
        const table = page
          .locator('table')
          .filter({ hasText: 'Who pays each fee, worked through' })
          .first();
        await table.waitFor({ state: 'visible', timeout: 25_000 });
        await table.scrollIntoViewIfNeeded();
        await page.waitForTimeout(900);
        await stage.dwellOn(table, 3600);
      },

      async 'store-credit'({ page, stage }) {
        const box = page.locator('fieldset').filter({ hasText: 'is credited' }).first();
        await box.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        // BY VALUE, never by index — a fifth trigger added upstream would
        // otherwise move this scene onto whatever landed second.
        await box.getByLabel('Credited').selectOption('AFTER_DELIVERY');
        await page.waitForTimeout(700);
        await stage.typeIn(box.getByLabel('Days'), TERMS.storeDays, { after: 1000, clear: true });
        await stage.dwellOn(box, 2800);
      },

      async 'seller-credit'({ page, stage }) {
        const box = page.locator('fieldset').filter({ hasText: 'When you are credited' }).first();
        await box.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await box.getByLabel('Credited').selectOption('ON_PAYOUT');
        await page.waitForTimeout(900);
        await stage.dwellOn(box, 2800);
      },

      async note({ page, stage }) {
        await stage.typeIn(page.getByLabel(/^Note to the store/), TERMS.note, { after: 1200 });
        await stage.dwellOn(page.getByLabel(/^Note to the store/), 2400);
      },

      async publish({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Publish version/ }).first(), {
          after: 1400,
        });
        const confirm = page
          .getByRole('dialog')
          .filter({ hasText: /^Publish version/ })
          .first();
        await confirm.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(confirm, 3400);
      },

      async 'in-force'({ page, stage }) {
        const confirm = page
          .getByRole('dialog')
          .filter({ hasText: /^Publish version/ })
          .first();
        await stage.clickIt(confirm.getByRole('button', { name: 'Publish' }).first(), {
          after: 1600,
        });
        await confirm.waitFor({ state: 'hidden', timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // "Waiting for … to accept it" is the fact the scene claims, and
        // it only appears once the version really exists.
        const panel = page.getByText(/Waiting for .* to accept it/).first();
        await panel.waitFor({ state: 'visible', timeout: 30_000 });
        await panel.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1000);
        await stage.dwellOn(panel, 3200);
      },

      async versions({ page, stage }) {
        const table = page.locator('table').filter({ hasText: 'Published' }).last();
        await table.scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await stage.dwellOn(table, 3200);
      },

      async outro({ page, stage }) {
        await stage.glide(-1800);
        await page.waitForTimeout(800);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 3000);
      },
    },
  },

  /**
   * G5 — what a store may do without asking.
   *
   * The whole page is the matrix, and the scenes work THREE of its seven
   * rows rather than all of them: the gentlest task set to direct, the
   * most dangerous one set to needs-my-approval, and one turned off
   * entirely. Seven rows narrated one at a time would be a list; three
   * chosen for the argument they make is a tutorial.
   *
   * `standingStoreFor` DELETES the policy row between takes, and that is
   * exactly right rather than merely convenient: a missing row IS the
   * defaults, so the page opens on "Running on the defaults — you have
   * not set this store yet", which is the sentence the second scene
   * argues from and which never appears again once a take has saved.
   *
   * Rows are found by their TASK LABEL and the controls by their
   * aria-label, never by position — a task added upstream would
   * otherwise move every scene onto its neighbour.
   */
  'what-a-store-may-do': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-tab'({ page, stage }) {
        await openStandingStore(page, stage);
        await stage.clickIt(page.getByRole('tab', { name: 'What they can do' }).first(), {
          after: 1800,
        });
        // "Running on the defaults" appears ONLY while the store has no
        // policy row — so this is the gate that proves the seeding put it
        // back, not merely that the tab opened.
        const note = page.getByText(/Running on the defaults/).first();
        await note.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(note, 2600);
      },

      async 'two-questions'({ page, stage }) {
        const head = page.locator('table thead').first();
        await head.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await stage.dwellOn(head, 3200);
      },

      async 'row-anatomy'({ page, stage }) {
        await stage.dwellOn(await capabilityRow(page, CAPABILITY.recall), 3400);
      },

      async recall({ page, stage }) {
        await stage.dwellOn(await capabilityRow(page, CAPABILITY.recall), 3000);
      },

      async 'recall-direct'({ page, stage }) {
        // READ, not set. `DEFAULT_POLICY` already has recall at DIRECT,
        // so selecting it would be a click that changes nothing — and
        // narration claiming to choose what was already chosen is a
        // frame arguing with its voice. The scene dwells on the row's
        // own note, which is the sentence being read out.
        const row = await capabilityRow(page, CAPABILITY.recall);
        await stage.dwellOn(row.locator('.rs-task__note').first(), 3200);
      },

      async 'sendback-on'({ page, stage }) {
        await stage.dwellOn(await capabilityRow(page, CAPABILITY.sendBack), 3400);
      },

      async 'sendback-direct'({ page, stage }) {
        const row = await capabilityRow(page, CAPABILITY.sendBack);
        await row.getByLabel('How?').selectOption('DIRECT');
        await page.waitForTimeout(1000);
        // The row's own NOTE, which is the sentence the narration is
        // about — "nobody checks it first".
        await stage.dwellOn(row.locator('.rs-task__note').first(), 3400);
      },

      async 'sendback-ask'({ page, stage }) {
        // Back to ASK_SELLER, which is where `DEFAULT_POLICY` had it —
        // the scene before put it on DIRECT to show what that would
        // mean. Net change for this row: none, deliberately. The only
        // row this take really changes is `cancel`, which is what the
        // confirm then lists.
        const row = await capabilityRow(page, CAPABILITY.sendBack);
        await row.getByLabel('How?').selectOption('ASK_SELLER');
        await page.waitForTimeout(1000);
        await stage.dwellOn(row.locator('.rs-task__note').first(), 3400);
      },

      async 'cancel-off'({ page, stage }) {
        const row = await capabilityRow(page, CAPABILITY.cancel);
        await stage.clickIt(row.getByLabel('Can the Reseller store do this?').first(), {
          after: 1200,
        });
        await stage.dwellOn(row, 3200);
      },

      async save({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Save', exact: true }).first(), {
          after: 1400,
        });
        const confirm = page
          .getByRole('dialog')
          .filter({ hasText: 'Save what this store can do?' })
          .first();
        await confirm.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(confirm, 3400);
      },

      async saved({ page, stage }) {
        const confirm = page
          .getByRole('dialog')
          .filter({ hasText: 'Save what this store can do?' })
          .first();
        await stage.clickIt(confirm.getByRole('button', { name: 'Save', exact: true }).first(), {
          after: 1600,
        });
        await confirm.waitFor({ state: 'hidden', timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // The NOTE flipping is the proof the save landed; a closed dialog
        // says nothing about that.
        const note = page.getByText('Your settings for this store.').first();
        await note.waitFor({ state: 'visible', timeout: 30_000 });
        await note.scrollIntoViewIfNeeded();
        await page.waitForTimeout(900);
        await stage.dwellOn(note, 3000);
      },

      async told({ page, stage }) {
        await stage.dwellOn(page.getByText(/the store is emailed what/).first(), 3400);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.getByRole('link', { name: /^Waiting on you/ }).first(), 3200);
      },
    },
  },

  /**
   * G6 — the queue of things reseller stores are waiting on.
   *
   * The take SPENDS one of its four rows: approving the cancel ends that
   * order, so the seeding places a new one (numbered) on the next run.
   * The delivery ask is TURNED DOWN rather than approved, and that is a
   * seeding decision as much as a teaching one — rejecting changes
   * nothing about the parcel, so the expensive one (a real waybill, a
   * warehouse run and two scans on the road) is re-used for ever.
   *
   * Rows are found BY ORDER NUMBER, never by position: the queue is
   * ordered oldest-first and a re-take's cancel order is a NEW order,
   * so "the first row" is not a stable way to name anything here.
   */
  'answer-what-a-store-asked': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-queue'({ page, stage }) {
        const link = page.getByRole('link', { name: /^Waiting on you/ }).first();
        await stage.dwellOn(link, 1600);
        await stage.clickIt(link, { after: 1800 });
        await page.waitForURL(/\/reseller-stores\/requests$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // The HEADER's own count, which only renders once all three
        // queues have answered — so this is the gate that proves the
        // page has its rows, not merely that the route resolved.
        const waiting = page.getByText(/\d+ waiting/).first();
        await waiting.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(waiting, 2400);
      },

      async 'three-queues'({ page, stage }) {
        await stage.dwellOn(page.locator('.rs-kpis').first(), 3400);
      },

      async 'only-held'({ page, stage }) {
        await stage.dwellOn(page.getByText(/What your Reseller stores have asked/).first(), 3400);
      },

      async 'cancel-row'({ page, stage }) {
        const row = await storeRequestRow(page, STORE_REQUEST.cancelAskedTo);
        await stage.dwellOn(row, 3600);
      },

      async 'approve-open'({ page, stage }) {
        const row = await storeRequestRow(page, STORE_REQUEST.cancelAskedTo);
        await stage.clickIt(row.getByRole('button', { name: 'Approve' }).first(), { after: 1400 });
        const dialog = page.getByRole('dialog').filter({ hasText: 'Approve' }).first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        // The CONSEQUENCE sentence, which is what the narration is
        // about — a dialog that is merely open says nothing about it.
        await page
          .getByText(/Approving runs it exactly as if the store had done it itself/)
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(dialog, 3400);
      },

      async approved({ page, stage }) {
        const dialog = page.getByRole('dialog').filter({ hasText: 'Approve' }).first();
        await stage.clickIt(dialog.getByRole('button', { name: 'Approve', exact: true }).first(), {
          after: 1600,
        });
        await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
        // The toast first, while it is still up — it carries the
        // sentence about the store having been told. It fades, so it
        // cannot be what the scene RESTS on.
        await stage
          .dwellOn(page.getByText(/Approved and carried out/).first(), 2200)
          .catch(() => {});
        // The row LEAVING is the proof it was carried out. A toast fades
        // and a closed dialog says nothing.
        await page
          .getByRole('row')
          .filter({ hasText: STORE_REQUEST.cancelAskedTo })
          .first()
          .waitFor({ state: 'detached', timeout: 30_000 })
          .catch(() => {});
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(900);
        await stage.dwellOn(page.locator('.rs-kpis').first(), 3000);
      },

      async 'issue-row'({ page, stage }) {
        const row = await storeRequestRow(page, STORE_REQUEST.issueAskedTo);
        await stage.dwellOn(row, 3400);
      },

      async 'delivery-row'({ page, stage }) {
        const row = await storeRequestRow(page, STORE_REQUEST.deliveryAskedFor);
        await stage.dwellOn(row, 3600);
      },

      async 'reject-open'({ page, stage }) {
        const row = await storeRequestRow(page, STORE_REQUEST.deliveryAskedFor);
        await stage.clickIt(row.getByRole('button', { name: 'Reject' }).first(), { after: 1400 });
        const dialog = page.getByRole('dialog').filter({ hasText: 'Turn down' }).first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(dialog, 3000);
      },

      async 'reject-type'({ page, stage }) {
        const dialog = page.getByRole('dialog').filter({ hasText: 'Turn down' }).first();
        // BY ROLE AND NAME, not `getByLabel(..., { exact: true })`: the
        // field carries a required mark, so its accessible name is not
        // the label text and an exact match finds nothing at all.
        await stage.typeIn(
          dialog.getByRole('textbox', { name: /Your reason/ }).first(),
          STORE_REQUEST.reason,
          { after: 900 },
        );
        await stage.dwellOn(dialog, 2600);
      },

      async rejected({ page, stage }) {
        const dialog = page.getByRole('dialog').filter({ hasText: 'Turn down' }).first();
        await stage.clickIt(dialog.getByRole('button', { name: 'Turn it down' }).first(), {
          after: 1600,
        });
        await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // "Nothing to answer here" is what that queue says once its only
        // ask has gone, and it is the sentence the narration claims.
        const done = page.getByText('Nothing to answer here').first();
        await done.waitFor({ state: 'visible', timeout: 30_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(done, 2800);
      },

      async 'change-row'({ page, stage }) {
        const row = page.getByRole('row').filter({ hasText: 'Landmark line' }).first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await row.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await stage.dwellOn(row.locator('.rs-changes').first(), 4000);
      },

      async outro({ page, stage }) {
        // The BADGE, which is the first thing the line is about and the
        // one thing on this page that follows a person to every other.
        await stage.dwellOn(page.getByRole('link', { name: /^Waiting on you/ }).first(), 3400);
      },
    },
  },

  /**
   * G7 — how the reseller stores are doing.
   *
   * It READS almost everything and writes exactly one thing: the
   * auto-pause rule, which is the only control on a reports page. That
   * write is idempotent and re-settable, so nothing here is spent by its
   * own take and the world stands from one to the next.
   *
   * Rows are found by STORE NAME rather than by position. The scorecard
   * lists every reseller store the seller has, in the service's own
   * order, and the standing store G3–G5 configure sits in that table too
   * — with nothing against it, which is the empty half this video is
   * also about.
   */
  'how-your-stores-are-doing': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-reports'({ page, stage }) {
        await stage.clickIt(
          page.getByRole('link', { name: 'Reseller reports', exact: true }).first(),
          { after: 1800 },
        );
        await page.waitForURL(/\/reseller-stores\/reports$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // The header's own facts only render once the scorecards have
        // answered — so this is the gate that proves the page has its
        // numbers rather than that the route resolved.
        const facts = page.locator('.rs-facts').first();
        await facts.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(facts, 2600);
      },

      async cards({ page, stage }) {
        await stage.dwellOn(page.locator('.rs-kpis').first(), 3600);
      },

      async coverage({ page, stage }) {
        // The MARGIN card's own footer, which is the sentence being read
        // out — "Lines we could price". A card that is merely present
        // says nothing about whether the coverage rendered.
        const foot = page.getByText('Lines we could price').first();
        await foot.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(foot, 3400);
      },

      async window({ page, stage }) {
        const dates = page.locator('.rs-dates').first();
        await dates.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await stage.dwellOn(dates, 3000);
      },

      async 'scorecard-rates'({ page, stage }) {
        // The WHOLE table, not one row: half the sentence is about the
        // store with nothing settled, whose rates are dashes, and that is
        // a different row from the one with the numbers.
        const table = page.getByRole('table', { name: 'Scorecards' });
        await table.waitFor({ state: 'visible', timeout: 25_000 });
        await table.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await stage.dwellOn(table, 3800);
      },

      async 'margin-column'({ page, stage }) {
        const row = await storeScoreRow(page, REQUEST_STORE_NAME.display);
        // The coverage line under the margin — the one cell this scene
        // is about, rather than the whole row again.
        await stage.dwellOn(row.getByText(/cost known/).first(), 3400);
      },

      async ranking({ page, stage }) {
        const note = page
          .getByText(/Wallet credits less charges, less the cost of the goods delivered/)
          .first();
        await note.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await stage.dwellOn(note, 3400);
      },

      async timing({ page, stage }) {
        const table = page.getByRole('table', { name: 'Stores ranked by what they made you' });
        await table.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await stage.dwellOn(table, 3800);
      },

      async 'transfer-revenue'({ page, stage }) {
        const table = page.getByRole('table', { name: 'Transfer revenue by store' });
        await table.waitFor({ state: 'visible', timeout: 25_000 });
        await table.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await stage.dwellOn(table, 3800);
      },

      async 'auto-pause-open'({ page, stage }) {
        const row = await storeScoreRow(page, REQUEST_STORE_NAME.display);
        await stage.clickIt(row.getByRole('button', { name: 'Change' }).first(), { after: 1400 });
        const dialog = page.getByRole('dialog').filter({ hasText: 'Auto-pause' }).first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(dialog, 3200);
      },

      async 'auto-pause-fields'({ page, stage }) {
        const dialog = page.getByRole('dialog').filter({ hasText: 'Auto-pause' }).first();
        await stage.typeIn(
          dialog.getByRole('textbox', { name: /Return rate above/ }).first(),
          AUTO_PAUSE.ratePercent,
          { clear: true, after: 600 },
        );
        await stage.typeIn(
          dialog
            .getByRole('textbox', { name: /parcels must have an outcome|Once at least/ })
            .first(),
          AUTO_PAUSE.minDecided,
          { clear: true, after: 600 },
        );
        await stage.clickIt(dialog.getByRole('button', { name: 'Save', exact: true }).first(), {
          after: 1600,
        });
        await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // The rule LANDING is the proof, and the row prints it in its own
        // words — "> 25% over 30d" where it read "Off".
        const row = await storeScoreRow(page, REQUEST_STORE_NAME.display);
        // The rate is printed to two decimals (`toFixed(2)` on the
        // server), so "25% over" matches nothing at all — and a gate that
        // matches nothing is a gate that fails on a save that worked.
        const rule = row.getByText(`> ${AUTO_PAUSE.ratePercent}.00% over`).first();
        await rule.waitFor({ state: 'visible', timeout: 30_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(rule, 3000);
      },

      async forecast({ page, stage }) {
        await stage.clickIt(
          page.getByRole('link', { name: 'Stock forecast', exact: true }).first(),
          {
            after: 1800,
          },
        );
        await page.waitForURL(/\/reseller-stores\/stock-forecast$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        const table = page.getByRole('table', { name: 'Stock forecast' });
        await table.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(table, 3800);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.locator('.rs-kpis').first(), 3400);
      },
    },
  },

  /**
   * B4 — finding an order.
   *
   * Entirely READ-ONLY: it types into a filter and clears it again, and
   * writes nothing at all. So there is no seeding beyond D0, and its own
   * take leaves the world exactly as it found it.
   *
   * THE PAGE'S BEST IDEA CANNOT BE FILMED DIRECTLY. Its filters live in
   * the URL, which is what makes a filtered list a link somebody can be
   * sent — and Playwright records the PAGE, never the browser's own
   * chrome, so there is no address bar to point at. The scene reloads
   * instead: the filter survives, which is the same fact seen from the
   * only side the camera has.
   */
  'finding-an-order': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-orders'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Orders', exact: true }).first(), {
          after: 1800,
        });
        await page.waitForURL(/\/orders$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // The header's own facts render only once the status summary has
        // answered, so this proves the page has its numbers.
        const meta = page.locator('.ord-meta').first();
        await meta.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(meta, 2600);
      },

      async tiles({ page, stage }) {
        await stage.dwellOn(page.locator('.ord-kpis').first(), 3600);
      },

      async 'search-what'({ page, stage }) {
        const box = page.getByLabel('Search orders');
        await box.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await stage.dwellOn(box, 3400);
      },

      async 'search-do'({ page, stage }) {
        await stage.typeIn(page.getByLabel('Search orders'), ORDER_SEARCH.phone, { after: 700 });
        await page.keyboard.press('Enter');
        await page.waitForLoadState('networkidle').catch(() => {});
        // The RESULT, not the box: one row, and it is the order that
        // number belongs to. A search that found nothing would still
        // leave a filled box.
        const row = page.getByRole('row').filter({ hasText: ORDER_SEARCH.recipient }).first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(row, 3000);
      },

      async reload({ page, stage }) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        // The same single row after a reload IS the claim: the filter was
        // in the address, not in the browser's memory of the page.
        const row = page.getByRole('row').filter({ hasText: ORDER_SEARCH.recipient }).first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(row, 3200);
      },

      async reset({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Reset' }).first(), { after: 1600 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // "None active" comes back only when every filter is off.
        const none = page.getByText('None active').first();
        await none.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(none, 2800);
      },

      async chips({ page, stage }) {
        const tabs = page.getByRole('tablist', { name: 'Filter by status' }).first();
        await tabs.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await stage.dwellOn(tabs, 3400);
      },

      async 'chip-click'({ page, stage }) {
        const tabs = page.getByRole('tablist', { name: 'Filter by status' }).first();
        await stage.clickIt(tabs.getByRole('tab', { name: /^Out for delivery/ }).first(), {
          after: 1600,
        });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(900);
        await stage.dwellOn(page.locator('.ord-card').first(), 3200);
      },

      async 'placed-when'({ page, stage }) {
        const field = page.getByLabel('Placed when');
        await field.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await stage.dwellOn(field, 3200);
      },

      async store({ page, stage }) {
        // Back to every status first, or the store filter would be shown
        // over a list already narrowed to one — two filters at once, and
        // the narration is about this one.
        const tabs = page.getByRole('tablist', { name: 'Filter by status' }).first();
        await tabs.getByRole('tab', { name: /^All/ }).first().click();
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        const field = page.getByLabel('Filter by store');
        await field.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await stage.dwellOn(field, 3200);
      },

      async columns({ page, stage }) {
        const head = page.locator('table thead').first();
        await head.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await stage.dwellOn(head, 3400);
      },

      async paging({ page, stage }) {
        const showing = page.getByText(/Showing/).first();
        await showing.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await stage.dwellOn(showing, 3000);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.getByLabel('Find an order or ticket').first(), 3200);
      },
    },
  },

  /**
   * B5 — reading an order.
   *
   * PRESSES NOTHING. It opens one delivered order and reads it top to
   * bottom, which is the point: every button on this page has a tutorial
   * of its own, and a seller needs the map before any of them. So the
   * take leaves the world byte-identical and needs no seeding beyond D0's
   * delivered parcel.
   *
   * The order is found BY ITS OWN REFERENCE through the list's search,
   * never by a stored id: `RSH-LIFE-DELIVERED` is stable across every
   * rebuild of the demo box and an order id is not.
   */
  'reading-an-order': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-order'({ page, stage }) {
        // Through the UI, not a `goto`: the camera records the PAGE and
        // never the address bar, so a URL jump reads as the screen
        // changing for no reason. This is also the path B4 just taught.
        await stage.clickIt(page.getByRole('link', { name: 'Orders', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/orders$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await stage.typeIn(page.getByLabel('Search orders'), ORDER_READ.ref, { after: 500 });
        await page.keyboard.press('Enter');
        await page.waitForLoadState('networkidle').catch(() => {});
        const row = page.getByRole('row').filter({ hasText: ORDER_READ.ref }).first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.clickIt(row.getByRole('link').first(), { after: 1800 });
        await page.waitForURL(/\/orders\/[0-9a-f-]+$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // Its OWN reference under the number is what proves the right
        // order opened — the number itself changes with every rebuild.
        const ref = page.getByText(`Your ref: ${ORDER_READ.ref}`).first();
        await ref.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(ref, 2800);
      },

      async 'four-facts'({ page, stage }) {
        await stage.dwellOn(page.locator('.ord-kpis').first(), 3600);
      },

      async tracker({ page, stage }) {
        await stage.dwellOn(await ordSection(page, 'Order tracker'), 3600);
      },

      async 'tracker-detail'({ page, stage }) {
        // The HANDOVER step, which is the line the sentence turns on:
        // everything above it is ours, everything below is the courier's.
        const step = page.getByText('Handed to courier').first();
        await step.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await stage.dwellOn(step, 3400);
      },

      async recipient({ page, stage }) {
        await stage.dwellOn(await ordSection(page, 'Recipient'), 3600);
      },

      async payment({ page, stage }) {
        await stage.dwellOn(await ordSection(page, 'Payment & parcel'), 3600);
      },

      async items({ page, stage }) {
        await stage.dwellOn(await ordSection(page, 'Items'), 3400);
      },

      async charges({ page, stage }) {
        await stage.dwellOn(await ordSection(page, 'Charges'), 3600);
      },

      async invoice({ page, stage }) {
        await stage.dwellOn(await ordSection(page, 'Invoice'), 3200);
      },

      async parcel({ page, stage }) {
        await stage.dwellOn(await ordSection(page, 'Parcel'), 3400);
      },

      async 'parcel-figures'({ page, stage }) {
        const line = page.getByText('Chargeable weight').first();
        await line.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await stage.dwellOn(line, 3400);
      },

      async history({ page, stage }) {
        await stage.dwellOn(await ordSection(page, 'Full history'), 3800);
      },

      async outro({ page, stage }) {
        const actions = page.getByRole('button', { name: 'Raise an issue' }).first();
        await actions.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await stage.dwellOn(actions, 3200);
      },
    },
  },

  /**
   * B6 — changing an order before it is confirmed.
   *
   * It SPENDS its order: the take submits the draft, which is the point
   * of the video and cannot be undone from the seller's side. That costs
   * nothing to remake, because nothing is reserved before confirmation
   * (ORD-10) and the shared clearing removes every pre-dispatch order
   * that is not under a protected prefix — so `editDraftWorldFor` simply
   * creates a fresh draft after it, every run.
   *
   * IT NEEDS A DRAFT AND NOT A PENDING ORDER. `EditOrderForm` computes
   * `canEdit = isDraft || isPending` and then renders "Save + submit" and
   * "Discard draft" only for a draft; on a pending order its own notice
   * says the server allows the recipient and the notes alone. The video
   * is about the window while everything is still changeable.
   */
  'changing-an-order': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-draft'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Orders', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/orders$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await stage.typeIn(page.getByLabel('Search orders'), EDIT_DRAFT.ref, { after: 500 });
        await page.keyboard.press('Enter');
        await page.waitForLoadState('networkidle').catch(() => {});
        const row = page.getByRole('row').filter({ hasText: EDIT_DRAFT.ref }).first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(row, 3000);
      },

      async edit({ page, stage }) {
        const row = page.getByRole('row').filter({ hasText: EDIT_DRAFT.ref }).first();
        await stage.clickIt(row.getByRole('link').first(), { after: 1600 });
        await page.waitForURL(/\/orders\/[0-9a-f-]+$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await stage.clickIt(page.getByRole('link', { name: 'Edit', exact: true }).first(), {
          after: 1800,
        });
        await page.waitForURL(/\/orders\/[0-9a-f-]+\/edit$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // The page's OWN sentence about what may be changed when — which
        // is the line the narration reads, and which renders only once the
        // order has loaded and been found editable.
        const rule = page.getByText(/A draft can be changed in full/).first();
        await rule.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(rule, 3200);
      },

      async rail({ page, stage }) {
        await stage.dwellOn(page.getByRole('navigation').last(), 3200);
      },

      async items({ page, stage }) {
        await stage.dwellOn(page.locator('#eo-items'), 3600);
      },

      async quantity({ page, stage }) {
        const plus = page.getByRole('button', {
          name: `Increase Quantity of ${EDIT_DRAFT.sku}`,
        });
        await stage.clickIt(plus, { after: 900 });
        await stage.clickIt(plus, { after: 1200 });
        // The line's own quantity box, which now reads what was clicked.
        // BY ROLE: `getByLabel` is substring by default, so "Quantity of
        // X" also matches the Increase and Decrease buttons either side
        // of it and Playwright refuses all three under strict mode.
        await stage.dwellOn(
          page.getByRole('spinbutton', { name: `Quantity of ${EDIT_DRAFT.sku}` }),
          2800,
        );
      },

      async 'cod-warning'({ page, stage }) {
        // The arithmetic line, which appears ONLY while the components
        // and the COD amount disagree — so waiting for it is what proves
        // the quantity change actually landed.
        const notice = page.getByText(/Items \+ delivery − advance − discount =/).first();
        await notice.scrollIntoViewIfNeeded();
        await notice.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(notice, 3400);
      },

      async 'use-figure'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Use ₹/ }).first(), { after: 1400 });
        // Gone, because the two now agree. A button that is still there
        // is a click that did nothing.
        await page
          .getByText(/Items \+ delivery − advance − discount =/)
          .first()
          .waitFor({ state: 'hidden', timeout: 20_000 })
          .catch(() => {});
        await page.waitForTimeout(700);
        await stage.dwellOn(page.getByLabel('COD amount (INR)'), 3000);
      },

      async recipient({ page, stage }) {
        const help = page.getByText(/The address only, in this order/).first();
        await help.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await stage.dwellOn(help, 3400);
      },

      async landmark({ page, stage }) {
        await stage.typeIn(page.getByLabel('Address line 2'), EDIT_DRAFT.betterLine2, {
          clear: true,
          after: 900,
        });
        await stage.dwellOn(page.getByText(/The landmark only/).first(), 3200);
      },

      async notes({ page, stage }) {
        const notes = page.locator('#eo-notes');
        await notes.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(notes, 3000);
      },

      async bar({ page, stage }) {
        await stage.dwellOn(page.locator('.ord-bar').first(), 3600);
      },

      async submit({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Save + submit' }).first(), {
          after: 1400,
        });
        const dialog = page
          .getByRole('dialog')
          .filter({ hasText: 'Save and submit for confirmation?' })
          .first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(dialog, 3200);
      },

      async outro({ page, stage }) {
        const dialog = page
          .getByRole('dialog')
          .filter({ hasText: 'Save and submit for confirmation?' })
          .first();
        await stage.clickIt(dialog.getByRole('button', { name: 'Save + submit' }).first(), {
          after: 1800,
        });
        await page.waitForURL(/\/orders\/[0-9a-f-]+$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // The STATUS is the proof the window shut: a closed dialog says
        // nothing about whether the order was submitted.
        const chip = page.getByText('Pending confirmation').first();
        await chip.waitFor({ state: 'visible', timeout: 30_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(chip, 3200);
      },
    },
  },
  /**
   * B7 — cancelling an order, at two different points in its life.
   *
   * IT SPENDS BOTH OF ITS ORDERS, which is why each has its own: the
   * pending one is placed fresh by `cancelWorldFor` on every seed run,
   * and the confirmed one is D0's `RSH-LIFE-CONFIRMED`, marked
   * `spendable` so the lifecycle pass retires the cancelled one and
   * builds another. A `--check` pass spends them too — check mode
   * drives the real app and really presses the button — so seed, check,
   * seed, check, seed, take is three of each.
   *
   * The third order is only READ. Its whole job is to show the absence
   * of a button, so the scene ASSERTS the absence rather than trusting
   * the frame: a locator that finds nothing is indistinguishable from a
   * page that failed to load.
   */
  'cancelling-an-order': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-pending'({ page, stage }) {
        await openOrderByRef(page, stage, CANCEL_ORDERS.pending.ref);
        await stage.dwellOn(page.getByText('Pending confirmation').first(), 2800);
      },

      async buttons({ page, stage }) {
        await stage.dwellOn(cancelButton(page), 2800);
      },

      async dialog({ page, stage }) {
        await stage.clickIt(cancelButton(page), { after: 1400 });
        const d = cancelDialog(page);
        await d.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(d, 3000);
      },

      async 'consequence-pending'({ page, stage }) {
        // THE SENTENCE THE NARRATION READS, not the dialog. The dialog
        // says something different at every stage of an order's life and
        // that is the whole point of the video — so a gate on the dialog
        // would pass on the wrong one of them.
        const notice = cancelDialog(page).getByText(/It leaves the call queue/);
        await notice.first().waitFor({ state: 'visible', timeout: 15_000 });
        await stage.dwellOn(notice.first(), 3600);
      },

      async reason({ page, stage }) {
        const field = cancelDialog(page).getByLabel('Reason (optional)');
        await stage.typeIn(field, CANCEL_ORDERS.pending.reason, { after: 1200 });
        await stage.dwellOn(field, 2400);
      },

      async confirm({ page, stage }) {
        await pressCancel(page, stage);
        await stage.dwellOn(page.getByText('Cancelled', { exact: true }).first(), 3000);
      },

      async history({ page, stage }) {
        await stage.dwellOn(await ordSection(page, 'Full history'), 3600);
      },

      async 'open-confirmed'({ page, stage }) {
        await openOrderByRef(page, stage, CANCEL_ORDERS.confirmed.ref);
        await stage.dwellOn(page.getByText('Confirmed', { exact: true }).first(), 2800);
      },

      async tracker({ page, stage }) {
        const tracker = await ordSection(page, 'Order tracker');
        // The claim is "the warehouse steps are still to come". Before
        // 2026-09-30 they were not: the rung below them fell back to
        // `shipments.awbGeneratedAt`, which CUR-2b sets at CONFIRMATION,
        // so this tracker said "Picked from shelf — Skipped · not
        // needed" on a parcel nobody had been near. Gate on the words
        // the narration is about.
        const notNeeded = await tracker.getByText('not needed').count();
        if (notNeeded !== 0) {
          throw new Error(
            'The tracker calls a warehouse step "not needed" on a confirmed order — ' +
              'this scene says they are still to come. Has the ready-to-dispatch rung ' +
              'regained a fallback onto the waybill?',
          );
        }
        await stage.dwellOn(tracker, 3800);
      },

      async 'cancel-confirmed'({ page, stage }) {
        await stage.clickIt(cancelButton(page), { after: 1400 });
        const d = cancelDialog(page);
        await d.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(d, 2800);
      },

      async 'consequence-confirmed'({ page, stage }) {
        const notice = cancelDialog(page).getByText(/stock held for this order goes back/);
        await notice.first().waitFor({ state: 'visible', timeout: 15_000 });
        await stage.dwellOn(notice.first(), 3800);
      },

      async 'confirm-confirmed'({ page, stage }) {
        await pressCancel(page, stage);
        await stage.dwellOn(page.getByText('Cancelled', { exact: true }).first(), 3200);
      },

      async window({ page, stage }) {
        await openOrderByRef(page, stage, CANCEL_ORDERS.past.ref);
        // THE ABSENCE IS THE CLAIM, so it is asserted rather than left
        // to the frame — and asserted against a page that has plainly
        // loaded, which is what the `Raise an issue` wait is for. A
        // selector that matches nothing on a blank page would otherwise
        // "prove" this scene.
        const raise = page.getByRole('button', { name: 'Raise an issue' }).first();
        await raise.waitFor({ state: 'visible', timeout: 25_000 });
        const offered = await cancelButton(page).count();
        if (offered !== 0) {
          throw new Error(
            `${CANCEL_ORDERS.past.ref} still offers Cancel — this scene says it does not. ` +
              'Is the parcel still out for delivery?',
          );
        }
        // The whole action row, which is where Cancel would have been.
        await stage.dwellOn(raise.locator('..'), 3200);
      },

      async outro({ page, stage }) {
        // The one button the seller DOES get here. It sits in the same
        // header row the last scene pointed at, so the only thing that
        // changes is which of them is outlined — which is the point:
        // Cancel has gone and this has taken its place.
        await stage.dwellOn(page.getByRole('button', { name: 'Ask admin to act' }).first(), 4000);
      },
    },
  },
  /**
   * B3 — the rows a CSV upload could not turn into orders.
   *
   * Its world is B2's import RUN AND STOPPED (`pendingRowsWorldFor`),
   * which leaves exactly one row waiting: Kavya Reddy's, which carries
   * no landmark. The take SPENDS it — the row becomes an order — and
   * the next seed run re-imports the file from scratch, so there is
   * nothing to unwind.
   *
   * THE ROW IS FOUND BY ITS REFERENCE, never by position. It is the only
   * one today, but a `.first()` on a list whose length is the whole point
   * of the video is the kind of gate that passes on the wrong row the
   * day the fixture grows.
   */
  'fix-the-rows-that-failed': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'pending-button'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Orders', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/orders$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // The button renders ONLY while the count is above zero, so
        // waiting for it is what proves the seeding left a row waiting.
        const pending = page.getByRole('link', { name: /pending$/ }).first();
        await pending.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(pending, 3000);
      },

      async open({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: /pending$/ }).first(), { after: 1800 });
        await page.waitForURL(/\/orders\/pending$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        const sub = page.getByText(/need a decision before they can become orders/).first();
        await sub.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(sub, 3200);
      },

      async tiles({ page, stage }) {
        await stage.dwellOn(page.locator('.ord-kpis').first(), 3800);
      },

      async band({ page, stage }) {
        await stage.dwellOn(await pendingRow(page), 3400);
      },

      async problem({ page, stage }) {
        // THE MESSAGE THE NARRATION READS, not the field. The row is
        // here because a value is missing, and which value is the whole
        // scene — a gate on the input would pass on a row refused for
        // something else entirely.
        const msg = page.getByText(/is required — it is the landmark/).first();
        await msg.waitFor({ state: 'visible', timeout: 25_000 });
        await msg.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(msg, 3600);
      },

      async fix({ page, stage }) {
        const field = (await pendingRow(page)).getByLabel('Address line 2');
        await stage.typeIn(field, PENDING_ROW.landmark, { after: 1000 });
        await stage.dwellOn(field, 2400);
      },

      async buttons({ page, stage }) {
        await stage.dwellOn((await pendingRow(page)).locator('.ord-row').first(), 3400);
      },

      async discard({ page, stage }) {
        await stage.clickIt((await pendingRow(page)).getByRole('button', { name: 'Discard' }), {
          after: 1400,
        });
        const d = page.getByRole('dialog').filter({ hasText: 'Discard this row?' }).first();
        await d.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(d, 3400);
      },

      async keep({ page, stage }) {
        const d = page.getByRole('dialog').filter({ hasText: 'Discard this row?' }).first();
        await stage.clickIt(d.getByRole('button', { name: 'Cancel', exact: true }).first(), {
          after: 1200,
        });
        await d.waitFor({ state: 'hidden', timeout: 20_000 });
        // The row is still here — which is the claim, and a dialog that
        // closed says nothing about whether it took the row with it.
        const row = await pendingRow(page);
        await row.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(row.getByRole('button', { name: 'Import as order' }), 2600);
      },

      async confirm({ page, stage }) {
        await stage.clickIt(
          (await pendingRow(page)).getByRole('button', { name: 'Import as order' }),
          { after: 1400 },
        );
        const d = page
          .getByRole('dialog')
          .filter({ hasText: 'Import this row as an order?' })
          .first();
        await d.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(d, 3200);
      },

      async empty({ page, stage }) {
        const d = page
          .getByRole('dialog')
          .filter({ hasText: 'Import this row as an order?' })
          .first();
        await stage.clickIt(d.getByRole('button', { name: 'Import as order' }).first(), {
          after: 1800,
        });
        // The EMPTY STATE, by its own words: a list that merely no longer
        // holds the row could equally be one that failed to load.
        const done = page.getByText('Nothing waiting').first();
        await done.waitFor({ state: 'visible', timeout: 30_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(done, 3200);
      },

      async outro({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Orders', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/orders$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await stage.typeIn(page.getByLabel('Search orders'), PENDING_ROW.ref, {
          clear: true,
          after: 500,
        });
        await page.keyboard.press('Enter');
        await page.waitForLoadState('networkidle').catch(() => {});
        const row = page
          .getByRole('row')
          .filter({ has: page.getByText(PENDING_ROW.ref, { exact: true }) })
          .first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(1000);
        await stage.dwellOn(row, 3400);
      },
    },
  },
  /**
   * F4 — the inbox, and the two grains of quieting it.
   *
   * IT PRESSES, and everything it presses is durable: a message read, a
   * message dismissed, a topic silenced. `notificationWorldFor` puts all
   * three back — the messages are UN-marked rather than deleted
   * (NOTIF-21: a dismiss is not a delete, because the row is the NOTIF-2
   * dedup ledger), and the two preference tables are row-absence
   * defaults so removing a row IS the reset.
   *
   * IT NAMES NO COUNT. The inbox is filled by D0's parcels and by the
   * nightly sweeps, so how many are in it changes between takes and even
   * between the check and the take. Every scene acts on "the first
   * message" and the narration describes what a message carries.
   */
  'quieten-your-notifications': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async inbox({ page, stage }) {
        // Through the BELL, which is how a person gets here — and the
        // only notification control that survives on a phone (FE-7).
        await stage.clickIt(page.getByRole('button', { name: /^Notifications/ }).first(), {
          after: 1400,
        });
        await stage.clickIt(page.getByRole('link', { name: /See everything/ }).first(), {
          after: 1800,
        });
        await page.waitForURL(/\/notifications$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        const intro = page.getByText(/what a courier did, what the warehouse checked in/).first();
        await intro.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(intro, 3200);
      },

      async counts({ page, stage }) {
        await stage.dwellOn(page.locator('.set-meta, .ord-meta').first(), 3400);
      },

      async filters({ page, stage }) {
        await stage.dwellOn(page.locator('.ntf-filters').first(), 3600);
      },

      async message({ page, stage }) {
        const first = page.locator('li.ntf-item').first();
        await first.waitFor({ state: 'visible', timeout: 25_000 });
        await first.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(first, 3600);
      },

      async open({ page, stage }) {
        const first = page.locator('li.ntf-item').first();
        // Remembered so the UNREAD scene can prove this one left that
        // list — the feed reorders nothing, but "the first item changed"
        // is a weaker claim than "this exact message is not here".
        openedNotificationId = await first.getAttribute('id');
        if (openedNotificationId === null) {
          throw new Error('The first notification has no id — the unread scene needs one.');
        }
        await stage.clickIt(first.locator('.ntf-item__open'), { after: 1400 });
        // Read is the claim: the button flips to "Mark unread" only once
        // the server has said so.
        await first
          .getByRole('button', { name: /Mark unread|^Unread$/ })
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(first, 3200);
      },

      async unread({ page, stage }) {
        await stage.clickIt(page.getByRole('tab', { name: /^Unread/ }).first(), { after: 1600 });
        await page.waitForTimeout(900);
        // THE MESSAGE JUST READ IS GONE. A tab that merely highlighted
        // would pass a gate on the tab itself.
        // ATTRIBUTE SELECTOR, not `#id`: these ids are uuidv7 and start
        // with a digit, which is not a valid CSS identifier — Chromium
        // throws rather than matching nothing.
        const still = await page.locator(`li.ntf-item[id="${openedNotificationId}"]`).count();
        if (still !== 0) {
          throw new Error('The message just read is still on the unread list.');
        }
        await stage.dwellOn(page.locator('.ntf-list').first(), 3400);
      },

      async dismiss({ page, stage }) {
        await stage.clickIt(page.getByRole('tab', { name: /^All$/ }).first(), { after: 1200 });
        const first = page.locator('li.ntf-item').first();
        await first.waitFor({ state: 'visible', timeout: 25_000 });
        const id = await first.getAttribute('id');
        await stage.clickIt(first.getByRole('button', { name: 'Dismiss' }), { after: 1200 });
        const d = page
          .getByRole('dialog')
          .filter({ hasText: 'Dismiss this notification?' })
          .first();
        await d.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(d, 2600);
        await stage.clickIt(d.getByRole('button', { name: 'Dismiss', exact: true }).last(), {
          after: 1600,
        });
        await page
          .locator(`li.ntf-item[id="${id}"]`)
          .waitFor({ state: 'detached', timeout: 25_000 });
        await page.waitForTimeout(700);
      },

      async settings({ page, stage }) {
        // BY ITS HREF, not by its name. The page header's action and the
        // sidebar's Account → Settings are both a link called "Settings",
        // and `.first()` took the nav one — which navigates perfectly, to
        // the wrong page, so the failure was a URL wait timing out thirty
        // seconds later rather than a selector miss.
        await stage.clickIt(page.locator('a[href="/notifications/settings"]').first(), {
          after: 1800,
        });
        await page.waitForURL(/\/notifications\/settings$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        const rule = page.getByText(/Both only ever remove a message/).first();
        await rule.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(rule, 3200);
      },

      async tiles({ page, stage }) {
        await stage.dwellOn(page.locator('.set-kpis').first(), 3800);
      },

      async yours({ page, stage }) {
        const heading = page.getByText('What reaches you', { exact: true }).first();
        await heading.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(page.getByText(QUIET_TOPIC.key, { exact: true }).first(), 3600);
      },

      async off({ page, stage }) {
        const sw = page.getByRole('switch', { name: `Notify me about: ${QUIET_TOPIC.label}` });
        await stage.clickIt(sw, { after: 1400 });
        // OFF is the claim, and it is the SERVER's answer: the switch
        // re-renders from the subscription list once the write lands.
        await page
          .locator(`[role="switch"][aria-label="Notify me about: ${QUIET_TOPIC.label}"]`)
          .and(page.locator('[aria-checked="false"]'))
          .waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(sw, 3000);
      },

      async company({ page, stage }) {
        const heading = page.getByText("The company's email", { exact: true }).first();
        await heading.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(heading, 3600);
      },

      async outro({ page, stage }) {
        const never = page.getByText('Cannot be switched off', { exact: true }).first();
        await never.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(never, 3600);
      },
    },
  },
  /**
   * C1 — following a consignment from Dhaka to the shelf.
   *
   * It READS and presses nothing, so its take leaves the world
   * byte-identical and C0's consignments never need rebuilding. Both
   * counts on `RSH-CN-LANDED` disagree, and for two different reasons —
   * which is the whole video, and why the seeding puts them there.
   */
  'follow-a-consignment': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async register({ page, stage }) {
        // "Add stock" is what the sidebar calls `/inbound`, and it is
        // the only way in that a seller has.
        await stage.clickIt(page.getByRole('link', { name: 'Add stock', exact: true }).first(), {
          after: 1800,
        });
        await page.waitForURL(/\/inbound$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        const row = consignmentRow(page, CONSIGNMENTS.landed);
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(page.locator('table').first(), 3400);
      },

      async tiles({ page, stage }) {
        await stage.dwellOn(page.locator('.inv-kpis, .set-kpis, .ord-kpis').first(), 3600);
      },

      async open({ page, stage }) {
        await stage.clickIt(consignmentRow(page, CONSIGNMENTS.landed).getByRole('link').first(), {
          after: 1800,
        });
        await page.waitForURL(/\/inbound\/[0-9a-f-]+$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // Its own reference is what proves the RIGHT one opened; the
        // consignment number changes with every rebuild.
        const ref = page.getByText(CONSIGNMENTS.landed, { exact: true }).first();
        await ref.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(ref, 2800);
      },

      async route({ page, stage }) {
        await stage.dwellOn(page.getByText(/we move it to India for you/).first(), 3400);
      },

      async 'detail-tiles'({ page, stage }) {
        await stage.dwellOn(page.locator('.inv-kpis, .set-kpis, .ord-kpis').first(), 3800);
      },

      async timeline({ page, stage }) {
        await stage.dwellOn(await invSection(page, 'What has happened'), 3800);
      },

      async dhaka({ page, stage }) {
        await stage.dwellOn(await invSection(page, 'Counted at our Bangladesh warehouse'), 3400);
      },

      async 'dhaka-lines'({ page, stage }) {
        // THE DIFFERENCE, on the Bangladesh table. The whole scene is
        // about a line being short, so a gate on the section would pass
        // on a consignment that matched all the way through.
        const bd = await invSection(page, 'Counted at our Bangladesh warehouse');
        const short = bd.locator('[data-tone="bad"]').first();
        await short.waitFor({ state: 'visible', timeout: 20_000 });
        await short.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(bd.locator('table').first(), 3600);
      },

      async india({ page, stage }) {
        await stage.dwellOn(await invSection(page, 'Arrival in India'), 3400);
      },

      async 'india-lines'({ page, stage }) {
        const arrival = await invSection(page, 'Arrival in India');
        const short = arrival.locator('[data-tone="bad"]').first();
        await short.waitFor({ state: 'visible', timeout: 20_000 });
        await short.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(arrival.locator('table').first(), 3600);
      },

      async 'why-two'({ page, stage }) {
        // Back up to the two headline figures, which is where the
        // comparison the narration is making actually lives.
        const arrival = await invSection(page, 'Arrival in India');
        await stage.dwellOn(arrival.locator('.inv-stack').first(), 3800);
      },

      async freight({ page, stage }) {
        /*
          GATED ON THE BILL, not on the section. Until E5 existed this
          scene's line was "nothing has been billed against this one
          yet", and the section renders a "Nothing billed yet" note just
          as happily as it renders a bill — so a world without the
          freight pass would film the empty panel under the new words
          and nothing would fail. `follow-a-consignment` is in
          `FREIGHT_SLUGS` for the same reason.
        */
        const freight = await invSection(page, 'Inbound freight');
        const charged = freight.getByText('Charged so far', { exact: true }).first();
        await charged.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(freight, 3600);
      },

      async outro({ page, stage }) {
        /*
          THE LOST UNIT, NAMED. Until 2026-09-30 this tile read
          "Still to come: 1 — in Dhaka or in the air", on a consignment
          whose every leg had been counted and whose transit bin held
          nothing. Gating on the sentence rather than on the tile means
          a regression fails this check instead of filming the promise
          again under a line about saying it out loud.
        */
        const named = page.getByText(/left Bangladesh and did not arrive/).first();
        await named.waitFor({ state: 'visible', timeout: 20_000 });
        await named.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(named, 3800);
      },
    },
  },
  /**
   * C2 — reading your stock.
   *
   * It READS and presses nothing. Its world is C0's `RSH-CN-FLYING`
   * (the only thing on this box that makes the in-transit column
   * non-zero) plus D0's `RSH-LIFE-CONFIRMED`, which is the one parcel
   * at rest holding a reservation — without it "held for orders" is a
   * zero, and the difference between owning stock and being able to
   * sell it is the whole video.
   */
  'read-your-stock': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async open({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Inventory', exact: true }).first(), {
          after: 1800,
        });
        await page.waitForURL(/\/inventory$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        const sub = page.getByText(/Receiving happens at the warehouse/).first();
        await sub.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(sub, 3200);
      },

      async india({ page, stage }) {
        await stage.dwellOn(await kpi(page, 'India stock'), 3400);
      },

      async held({ page, stage }) {
        // THE SPLIT IS THE CLAIM, and it is only interesting when
        // something is genuinely reserved — a zero here would put the
        // narration on a number that proves nothing. Gating on it means
        // a seeding that lost the confirmed parcel fails the check.
        const card = await kpi(page, 'India stock');
        const held = card.getByText('Held for orders').first();
        await held.waitFor({ state: 'visible', timeout: 20_000 });
        const reserved = await reservedUnits(page);
        if (reserved <= 0) {
          throw new Error(
            'Nothing is held for orders — this scene is about the difference between ' +
              'owning stock and being able to sell it. Is `RSH-LIFE-CONFIRMED` confirmed?',
          );
        }
        await stage.dwellOn(held, 3200);
      },

      async transit({ page, stage }) {
        await stage.dwellOn(await kpi(page, 'In transit'), 3600);
      },

      async value({ page, stage }) {
        await stage.dwellOn(await kpi(page, 'Stock value at cost'), 3400);
      },

      async uncovered({ page, stage }) {
        const line = page.getByText(/Units with no cost/).first();
        await line.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(line, 3600);
      },

      async register({ page, stage }) {
        const table = page.locator('table').first();
        await table.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(table, 3400);
      },

      async row({ page, stage }) {
        await stage.dwellOn(stockRow(page, RESERVED_SKU), 3600);
      },

      async 'transit-column'({ page, stage }) {
        // A row whose goods are on the flying consignment, so the
        // column it is about is not a dash.
        await stage.dwellOn(stockRow(page, TRANSIT_SKU), 3600);
      },

      async low({ page, stage }) {
        await stage.dwellOn(page.getByRole('columnheader', { name: /Low-stock/ }).first(), 3000);
      },

      async outro({ page, stage }) {
        const tiles = page.locator('.inv-kpis').first();
        await tiles.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(tiles, 3600);
      },
    },
  },

  /**
   * E5 — what the freight cost.
   *
   * READ-ONLY: it presses one link and nothing else, so its take leaves
   * the world byte-identical and `lib/freight.mjs` never needs rebuilding
   * for a re-take.
   *
   * Its world is that library's whole job — a PAY_LATER bill on
   * `RSH-CN-LANDED`'s Indian arrival with five of its thirty-eight units
   * already delivered. Every gate below is anchored on the thing the
   * narration CLAIMS rather than on the panel that would contain it: a
   * bill at nought or at a hundred per cent renders the same layout, the
   * same tiles and the same table, so a scene gated on "the tile is
   * visible" would film the exact failure this video exists to explain
   * under a line saying the opposite.
   */
  'what-the-freight-cost': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async open({ page, stage }) {
        await stage.clickIt(
          page.getByRole('link', { name: 'Inbound freight', exact: true }).first(),
          { after: 1800 },
        );
        await page.waitForURL(/\/freight$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        /*
          THE GATE FOR THE WHOLE VIDEO. "Partially settled" is the state
          the entire script describes, and it is the one thing the
          seeding can silently fail to produce: a parcel that picked the
          seller's older stock delivers perfectly and leaves this bill
          PENDING, with every tile, tab and row still on screen.
        */
        const chip = page.getByText('Partially settled', { exact: true }).first();
        await chip.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.locator('.frt-page').first(), 1800);
      },

      async owed({ page, stage }) {
        await stage.dwellOn(await kpi(page, 'Still owed'), 3400);
      },

      async billed({ page, stage }) {
        // One tile carrying BOTH figures — the total and, in its foot,
        // what has actually been charged. The gap between them is the
        // sentence, so the scene has to hold the two together.
        const card = await kpi(page, 'Billed to you');
        await stage.dwellOn(card, 2200);
        await stage.dwellOn(card.locator('.sk-kpi__foot').first(), 2000);
      },

      async units({ page, stage }) {
        await stage.dwellOn(await kpi(page, 'Units charged'), 3400);
      },

      async terms({ page, stage }) {
        const row = freightRow(page);
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await row.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(row.locator('.frt-terms').first(), 3200);
      },

      async total({ page, stage }) {
        // The cell carrying the AGREED figure, not the row: the point of
        // the line is the taka underneath the rupees, and a bill raised
        // in rupees would have no second line at all.
        const agreed = freightRow(page).locator('td').filter({ hasText: 'agreed' }).first();
        await agreed.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(agreed, 3400);
      },

      async progress({ page, stage }) {
        await stage.dwellOn(freightRow(page), 3600);
      },

      async tabs({ page, stage }) {
        await stage.dwellOn(page.getByRole('tablist', { name: 'Filter by status' }).first(), 3600);
      },

      async note({ page, stage }) {
        // The page's own paragraph, which says what the narration says.
        // It renders ONLY while a PAY_LATER bill is on screen, so it is
        // a second, independent gate on the world being right.
        const note = page.locator('.frt-note').first();
        await note.waitFor({ state: 'visible', timeout: 20_000 });
        await note.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(note, 3800);
      },

      async consignment({ page, stage }) {
        await stage.clickIt(freightRow(page).locator('.frt-cons__link').first(), { after: 1800 });
        await page.waitForURL(/\/inbound\/[0-9a-f-]+$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        const ref = page.getByText(CONSIGNMENTS.landed, { exact: true }).first();
        await ref.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(ref, 2400);
      },

      async panel({ page, stage }) {
        const freight = await invSection(page, 'Inbound freight');
        await stage.dwellOn(freight.locator('.inv-dl').first(), 3600);
      },

      async service({ page, stage }) {
        const freight = await invSection(page, 'Inbound freight');
        await stage.dwellOn(
          freight.locator('.inv-dl__row').filter({ hasText: 'Service charge' }).first(),
          3400,
        );
      },

      async invoice({ page, stage }) {
        // The bill's own note. Gated on the forwarder's name rather than
        // on the panel: a bill recorded without one renders the panel
        // perfectly and simply omits this paragraph.
        const freight = await invSection(page, 'Inbound freight');
        const note = freight.getByText(/Meghna Forwarders/).first();
        await note.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(note, 3600);
      },

      async timeline({ page, stage }) {
        const history = await invSection(page, 'What has happened');
        const billed = history.getByText(/^Freight billed/).first();
        await billed.waitFor({ state: 'visible', timeout: 20_000 });
        await billed.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(billed, 3600);
      },

      async outro({ page, stage }) {
        const tile = await kpi(page, 'Inbound freight');
        await stage.dwellOn(tile, 3600);
      },
    },
  },
  /*
    P5 — THE FIRST ADMIN FLOW, and a TOUR: it presses nothing that
    changes anything. Ten screens, each one visited so the narration can
    read that screen's own warning copy out loud beside it.

    Every scene GATES ON THE THING THE NARRATION CLAIMS rather than on
    the container that would hold it — three of these screens render an
    identical page when their world is missing, so waiting for the panel
    would film an empty state under a line about a waiting parcel.
  */
  'what-we-cannot-undo': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2400);
      },

      /*
        The stuck order D0 leaves behind. Reached through the list's own
        search on the SELLER's reference rather than by a hard-coded id:
        these rows carry uuidv7 ids, which differ on every database.
      */
      async 'god-mode'({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/orders?search=RSH-LIFE-REVIEW`, {
          waitUntil: 'domcontentloaded',
        });
        await page.waitForLoadState('networkidle').catch(() => {});
        const row = page.getByRole('link', { name: /^SD-\d{4}-\d{2}-\d{6}$/ }).first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.clickIt(row, { after: 1400 });
        await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // The sentence the narration quotes, not the card that holds it.
        const warning = page.getByText(/set once and never cleared/i).first();
        await warning.waitFor({ state: 'visible', timeout: 25_000 });
        await warning.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(800);
        await stage.dwellOn(warning, 3400);
      },

      async 'god-mode-stock'({ page, stage }) {
        const release = page.getByRole('button', { name: /^Release reservations/ }).first();
        await release.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(release, 1800);
        const restore = page.getByRole('button', { name: /^Restore stock claim/ }).first();
        await restore.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(restore, 2600);
      },

      /*
        The one PENDING goods receipt. Its detail page carries the
        Complete button; the consequence sentence lives inside the
        confirm dialog, which this video does not open.
      */
      async receive({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/warehouse/receive`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        // The list OPENS on PENDING, and a receipt somebody has started
        // counting is ARRIVING — which is the only state where the
        // Complete button exists at all. Selected by its label; the
        // option order is not a promise.
        await page.getByLabel('Status', { exact: true }).first().selectOption('ARRIVING');
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(600);
        const receipt = page.getByRole('link', { name: /^GR-\d{4}-\d{2}-\d{4}$/ }).first();
        await receipt.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.clickIt(receipt, { after: 1400 });
        await page.waitForURL(/\/warehouse\/receive\/[0-9a-f-]{36}$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        const complete = page.getByRole('button', { name: /^Complete$/ }).first();
        await complete.waitFor({ state: 'visible', timeout: 25_000 });
        await complete.evaluate((el) =>
          el.scrollIntoView({ block: 'center', behavior: 'instant' }),
        );
        await page.waitForTimeout(800);
        await stage.dwellOn(complete, 3400);
      },

      async 'force-outcome'({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/call-center/queue`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        const force = page.getByRole('button', { name: 'Force outcome' }).first();
        await force.waitFor({ state: 'visible', timeout: 25_000 });
        await force.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(800);
        await stage.dwellOn(force, 3600);
      },

      async pack({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/warehouse/pack`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        // The bench's own sentence about the box being opened by a scan.
        const scan = page.getByText(/a box is opened by scanning one/i).first();
        await scan.waitFor({ state: 'visible', timeout: 25_000 });
        await scan.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(800);
        await stage.dwellOn(scan, 3600);
      },

      async pickups({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/warehouse/pickups`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        const note = page.getByText(/is how two vans arrive/i).first();
        await note.waitFor({ state: 'visible', timeout: 25_000 });
        await note.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(800);
        await stage.dwellOn(note, 3800);
      },

      /*
        `RSH-LIFE-ATDOOR` is the only parcel that ever puts a row in this
        list — a return the courier has handed back that nobody has
        received. Gate on the SENTENCE, because the empty state renders
        the same page just as happily.
      */
      async rto({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/warehouse/rto`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        const line = page.getByText(/nothing does it automatically, on purpose/i).first();
        await line.waitFor({ state: 'visible', timeout: 25_000 });
        await page.getByText('handed back', { exact: false }).first().waitFor({
          state: 'visible',
          timeout: 25_000,
        });
        await page.waitForTimeout(700);
        await stage.dwellOn(line, 3800);
      },

      async bins({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/warehouse/bins`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        const heading = page.getByText('Location tracking', { exact: true }).first();
        await heading.waitFor({ state: 'visible', timeout: 25_000 });
        await heading.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(900);
        await stage.dwellOn(heading, 3600);
      },

      async topups({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/topups`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        const accept = page.getByRole('button', { name: /^Accept$/ }).first();
        await accept.waitFor({ state: 'visible', timeout: 25_000 });
        await accept.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(800);
        await stage.dwellOn(accept, 3400);
      },

      async 'bank-change'({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/bank-changes`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        // The guard the narration names, not the Approve button — with
        // nothing waiting this sentence is still on the page, so the row
        // itself is what proves the world was seeded.
        const row = page.getByText(/fields changed/i).first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(row, 3800);
      },

      /*
        The page opens on the OPEN month. August is the one that has
        ended and is not closed, which is where the amber warning and the
        Close button live; July, already frozen, is the row above it in
        the same dropdown.
      */
      async month({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/pnl/carry-forward`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        const picker = page.getByLabel('Month', { exact: true }).first();
        await picker.waitFor({ state: 'visible', timeout: 25_000 });
        await picker.selectOption({ label: 'August 2026 — not closed yet' });
        await page.waitForLoadState('networkidle').catch(() => {});
        const notice = page.getByText(/has ended and is not closed yet/i).first();
        await notice.waitFor({ state: 'visible', timeout: 25_000 });
        await notice.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(800);
        await stage.dwellOn(notice, 3800);
      },

      async outro({ page, stage }) {
        const close = page.getByRole('button', { name: /^Close August 2026$/ }).first();
        await close.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(close, 3600);
      },
    },
  },
  /*
    H1 — the admin dashboard. ONE screen, read-only, and every scene is
    a different part of it.

    Each attention tile is picked by its AREA word inside `.db-attn`,
    never by position: the grid is permission-filtered (a role without
    money sees five tiles, not seven), so an index would film whichever
    tile happened to be fourth for whoever last edited the guards. The
    area words are also in the sidebar, which is why the filter is
    scoped to the card class rather than to the page.
  */
  'the-ops-dashboard': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        // NOT `networkidle`. This page polls, so that state never
        // arrives and the wait burns its whole 30s timeout — which does
        // not fail anything, it just makes the opening scene thirty
        // seconds of picture against an eleven-second line. Gate on the
        // thing that says the page has drawn instead.
        await page
          .getByText('What is waiting on someone right now', { exact: false })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(1200);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2600);
      },

      async attention({ page, stage }) {
        const head = page.getByText('Operations attention queue', { exact: true }).first();
        await head.waitFor({ state: 'visible', timeout: 25_000 });
        // The note under the heading counts the LIT ones, and it only
        // appears once every tile's query has answered — so waiting for
        // it is what stops this filming a row of skeletons.
        await page
          .getByText(/queues? needs? staff attention|Nothing is waiting on a person/)
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.db-attn-grid').first(), 3400);
      },

      async 'call-centre'({ page, stage }) {
        await stage.dwellOn(attnCard(page, 'Call centre'), 3600);
      },

      async merchant({ page, stage }) {
        await stage.dwellOn(attnCard(page, 'Merchant'), 3600);
      },

      async warehouse({ page, stage }) {
        await stage.dwellOn(attnCard(page, 'Warehouse'), 3400);
      },

      async quiet({ page, stage }) {
        // BOTH of the quiet ones, so the scene shows the contrast the
        // narration describes rather than one dark card.
        await stage.dwellOn(attnCard(page, 'Dispatch'), 1700);
        await stage.dwellOn(attnCard(page, 'Stock'), 2600);
      },

      async support({ page, stage }) {
        await stage.dwellOn(attnCard(page, 'Support'), 3400);
      },

      async settlements({ page, stage }) {
        await stage.dwellOn(attnCard(page, 'Settlements'), 3400);
      },

      async performance({ page, stage }) {
        const head = page.getByText(/^Performance & fulfilment/).first();
        await head.waitFor({ state: 'visible', timeout: 25_000 });
        await head.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(800);
        await stage.dwellOn(head, 3400);
      },

      async rates({ page, stage }) {
        // Gate on a FIGURE rather than on the card: these read "—" until
        // the summary answers, and a dash under a line about rates and
        // denominators is exactly the frame this check exists to catch.
        const confirmed = page.getByText('Confirmed on call', { exact: true }).first();
        await confirmed.waitFor({ state: 'visible', timeout: 25_000 });
        await page
          .locator('.db-chip')
          .filter({ hasText: /^\d+\/\d+$/ })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(confirmed, 1700);
        await stage.dwellOn(page.getByText('Returned (RTO)', { exact: true }).first(), 2400);
      },

      async money({ page, stage }) {
        const head = page.getByText('Financial treasury & settlements', { exact: true }).first();
        await head.waitFor({ state: 'visible', timeout: 25_000 });
        await head.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(800);
        await stage.dwellOn(page.getByText('COD collected', { exact: true }).first(), 3400);
      },

      async outstanding({ page, stage }) {
        const owed = page.getByText('Outstanding owed', { exact: true }).first();
        await owed.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.dwellOn(owed, 2200);
        await stage.dwellOn(page.getByRole('link', { name: 'View ledger' }).first(), 2600);
      },

      async outro({ page, stage }) {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await page.waitForTimeout(900);
        await stage.dwellOn(page.locator('.db-attn-grid').first(), 3400);
      },
    },
  },
  /*
    H2 — reading ONE order. Read-only: the only gestures are a search, a
    click through to the detail, and scrolling.

    Every band is reached through `ooSection`, which matches the card by
    its own `<h2>` rather than by any text inside it — "Payment",
    "Charges" and "Shipments" all appear in other cards' bodies on this
    page, so a `hasText` filter would pick whichever card happened to
    mention the word first.
  */
  'find-an-order': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/orders`, { waitUntil: 'domcontentloaded' });
        // The row count in the subtitle only lands once the list has
        // answered; waiting for it is what stops this filming a page of
        // skeletons under a line about every order on the platform.
        await page
          .getByText(/^\d+ orders?$/)
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2600);
      },

      async filters({ page, stage }) {
        const status = page.getByLabel('Status', { exact: true }).first();
        await status.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(status, 1500);
        await stage.dwellOn(page.getByLabel('Seller', { exact: true }).first(), 1300);
        await stage.dwellOn(page.getByLabel('Placed from', { exact: true }).first(), 2200);
      },

      async search({ page, stage }) {
        // Typed, not navigated: the point of the scene is that one box
        // takes whichever handle the person on the phone happens to
        // have, and a URL would show none of that.
        /*
          "Search orders", not "Search".

          The field carries `aria-label="Search orders"`, which OVERRIDES
          its visible label — and the submit magnifier sitting inside it
          is labelled "Search". So `getByLabel('Search')` resolves to the
          BUTTON, the click focused it, and `pressSequentially` typed
          eighteen characters into a `<button>`: nothing appeared, the
          list stayed unfiltered, and the step passed. Playwright only
          said so when something asked the node for its value.
        */
        await stage.typeIn(
          page.getByLabel('Search orders', { exact: true }).first(),
          'RSH-LIFE-RESTOCKED',
        );
        // The box is a FORM, not a debounce — nothing happens until it
        // is submitted, which is what a person does with the keyboard.
        await page.keyboard.press('Enter');
        /*
          WAIT FOR THE COUNT, NOT FOR "A ROW".

          The box is debounced, so for a beat after the last keystroke
          the UNFILTERED list is still on screen — and it is full of
          rows matching `SD-…`, sorted newest first. The first check
          waited for one of those, found the NEWEST order on the box,
          clicked it, and filmed nine scenes about somebody else's
          parcel while passing every single step. The subtitle's count
          is the one thing that cannot be true until the filter has
          applied.
        */
        await page
          .getByText(/^1 orders?$/)
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
      },

      async open({ page, stage }) {
        // …and the link INSIDE that row, so a second match cannot be
        // the one that opens.
        const row = page.locator('tr').filter({ hasText: 'RSH-LIFE-RESTOCKED' }).first();
        await row.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.clickIt(row.getByRole('link', { name: /^SD-\d{4}-\d{2}-\d{6}$/ }).first(), {
          after: 1500,
        });
        await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2400);
      },

      async snapshot({ page, stage }) {
        await stage.dwellOn(ooSection(page, 'Recipient'), 3400);
      },

      async reputation({ page, stage }) {
        // The reputation line lives in the Recipient card's NOTE, and it
        // is the one thing on this page that is not a snapshot — it is
        // counted live. Gate on the words so an endpoint that is down
        // fails the check rather than filming a blank.
        const note = page.getByText(/previous order/).first();
        await note.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(note, 3400);
      },

      async payment({ page, stage }) {
        await stage.dwellOn(ooSection(page, 'Payment'), 3400);
      },

      async items({ page, stage }) {
        await stage.dwellOn(ooSection(page, /^Items \(\d+\)$/), 3400);
      },

      async charges({ page, stage }) {
        const section = ooSection(page, 'Charges');
        // A charge LINE, not the card: an order with none renders the
        // same heading over an empty state.
        await section
          .getByText(/Base shipping/)
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(section, 3400);
      },

      async parcel({ page, stage }) {
        const section = ooSection(page, 'Shipments');
        await section.getByText(/^AWB /).first().waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(section, 3400);
      },

      async tracker({ page, stage }) {
        const section = ooSection(page, 'Order tracker');
        // The rung this order ends on, which is the whole point of the
        // line — and which did not exist until the ladder learned that
        // a parcel can come back (2026-09-30).
        // NOT `{ exact: true }`. On `getByText` that means the element's
        // WHOLE text, and a timeline rung's label is a text node inside
        // a node that also carries the state word, the owner and the
        // time — so the exact form matched ZERO elements while the words
        // were plainly on the page. (`getByLabel` is the other way
        // round, which is the trap: there, substring is the default.)
        await section
          .getByText('Back in your stock')
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(section, 3600);
      },

      async history({ page, stage }) {
        const section = ooSection(page, 'Full history');
        await section.scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await stage.dwellOn(section.locator('h2').first(), 3400);
      },

      async attempt({ page, stage }) {
        const line = page.getByText(/Delivery attempt \d/).first();
        await line.waitFor({ state: 'visible', timeout: 20_000 });
        await line.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(800);
        await stage.dwellOn(line, 3600);
      },

      async outro({ page, stage }) {
        const actions = page.getByRole('heading', { name: 'Actions', exact: true }).first();
        await actions.waitFor({ state: 'visible', timeout: 20_000 });
        await actions.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(800);
        await stage.dwellOn(actions, 3400);
      },
    },
  },
  /*
    H4 — the permission model. `ready`: no seeding at all.

    IT SAVES NOTHING. The editor is opened on a REAL role and closed with
    Cancel, because what is being taught is how to read the catalogue —
    and a role saved on camera is a role somebody has to unpick.
  */
  'the-permission-model': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/roles`, { waitUntil: 'domcontentloaded' });
        await page
          .getByText(/^\d+ roles?$/)
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2600);
      },

      async roles({ page, stage }) {
        // The page's own sentence about what is yours to change and what
        // is not — which is the line the narration is quoting.
        const note = page.getByText(/permissions themselves are fixed by the system/).first();
        await note.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(note, 3400);
      },

      async list({ page, stage }) {
        await stage.dwellOn(roleRow(page, 'Warehouse supervisor'), 3400);
      },

      async superadmin({ page, stage }) {
        await stage.dwellOn(roleRow(page, 'Super admin'), 3600);
      },

      async open({ page, stage }) {
        // Edit on a REAL role, by its row — every row has an "Edit", so
        // a bare name match opens whichever is first.
        await stage.clickIt(
          roleRow(page, 'Warehouse supervisor').getByRole('button', { name: 'Edit' }).first(),
          { after: 1400 },
        );
        await page
          .getByRole('heading', { name: /^Edit Warehouse supervisor$/ })
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(900);
        // The catalogue itself, not the search box — "Search permissions"
        // is a PLACEHOLDER, and `getByText` does not see one. (It waited
        // thirty seconds for words that are on screen and in no text
        // node.)
        await stage.dwellOn(page.locator('.ac-perms').first(), 2400);
      },

      async counts({ page, stage }) {
        // Gate on the DANGER count, which only renders when the role
        // holds at least one — an empty role would show the left half of
        // this line and none of what the narration is about.
        const danger = page.getByText(/can move money or stock$/).first();
        await danger.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(page.locator('.ac-counts').first(), 3400);
      },

      async groups({ page, stage }) {
        const group = page.locator('fieldset.ac-fieldset').first();
        await group.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(group, 3400);
      },

      async dangerous({ page, stage }) {
        const marked = page.locator('.ac-perm-danger').first();
        await marked.waitFor({ state: 'visible', timeout: 20_000 });
        await marked.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(marked, 3400);
      },

      async search({ page, stage }) {
        await stage.typeIn(
          page.getByLabel('Search permissions', { exact: true }).first(),
          'return',
        );
        // The count line names the matches, and it is the thing that
        // cannot be true until the filter has run.
        await page
          .getByText(/\d+ match(es)?/)
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.locator('.ac-perms').first(), 2800);
      },

      async lookalike({ page, stage }) {
        // The PAIR the narration names. Gated on the words, because the
        // point of the scene is what their descriptions say and an
        // empty result renders the same panel.
        const finalise = page.getByText('Finalise a return').first();
        await finalise.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(finalise, 1800);
        /*
          THE PAIR THE SEARCH ACTUALLY RETURNS, which is not the pair
          the curriculum illustrated with. "Hand parcels to the courier"
          does not contain the word "return" and never appears here;
          "Act on a parcel at the courier" does, because its own
          description says a cancel turns a moving parcel into one — and
          it makes the point better, since the two differ in what they
          reach rather than in where they sit.
        */
        const hand = page.getByText('Act on a parcel at the courier').first();
        await hand.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(hand, 2600);
      },

      async cancel({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Cancel', exact: true }).first(), {
          after: 1400,
        });
        await page
          .getByRole('heading', { name: /^Edit Warehouse supervisor$/ })
          .waitFor({ state: 'detached', timeout: 20_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async boundary({ page, stage }) {
        await stage.dwellOn(roleRow(page, 'Call agent'), 3400);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.locator('table').first(), 3400);
      },
    },
  },

  'things-the-system-has-raised': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/system-issues`, { waitUntil: 'domcontentloaded' });
        /*
          GATED ON A CARD, NOT ON THE HEADER. The header, the loading
          skeleton and the "Nothing needs you" empty state all render
          within a frame of each other, so waiting for the heading proves
          only that the route resolved — and an empty board is a page
          this video has nothing to say about. `networkidle` is not the
          answer either: it is what cost H1 a thirty-second wait.
        */
        await issueCard(page, /is still live/).waitFor({ state: 'visible', timeout: 25_000 });
        /*
          AND THE BOARD IS THE CURATED ONE. The hourly sweep raises a
          fresh issue per pre-dispatch waybill with no label — twenty-five
          on this box — and the seeding closes them so the twelve that
          teach something are readable. If a tick has landed since, the
          take would film a board three times the size with cards moving
          under the camera, and pass. `refuseNearTheSweep` in the seeding
          keeps a run out of that window; this is the half that notices
          when it happened anyway.
        */
        await issueCard(page, /no shipping label stored/).waitFor({
          state: 'detached',
          timeout: 5_000,
        });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2600);
      },

      async why({ page, stage }) {
        const line = page.getByText(/could not fix by itself/).first();
        await line.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(line, 3400);
      },

      async counts({ page, stage }) {
        await stage.dwellOn(page.locator('.af-kpis').first(), 3400);
      },

      async severity({ page, stage }) {
        // The LIVE WAYBILL card is the one the next five scenes are
        // about, and it is High by construction (checkLiveWaybills
        // raises nothing else), so the narration's "high means money or
        // parcels are affected now" cannot be filmed over a Medium chip.
        await stage.dwellOn(
          issueCard(page, /is still live/)
            .locator('.si-head')
            .first(),
          3200,
        );
      },

      async detail({ page, stage }) {
        const body = issueCard(page, /is still live/)
          .locator('.si-detail')
          .first();
        // The MONEY sentence, which is what the narration claims. An
        // issue whose detail were ever reworded should fail the check
        // rather than film prose that no longer says it.
        await body
          .filter({ hasText: /credits it back/ })
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(body, 4000);
      },

      async link({ page, stage }) {
        await stage.dwellOn(
          issueCard(page, /is still live/)
            .getByRole('link', { name: 'Open the order' })
            .first(),
          3200,
        );
      },

      async meta({ page, stage }) {
        await stage.dwellOn(
          issueCard(page, /is still live/)
            .locator('.si-meta')
            .first(),
          3600,
        );
      },

      async acknowledge({ page, stage }) {
        const card = issueCard(page, /is still live/);
        // The accessible name is the IDLE label — AsyncButton's rolling
        // strip is aria-hidden, so the other three words never reach a
        // role query.
        await stage.clickIt(card.getByRole('button', { name: /I.m on it/ }).first(), {
          after: 1200,
        });
        /*
          GATED ON THE CARD SAYING SOMEBODY HAS IT, never on the button.
          An AsyncButton rolls to "Noted" on its own timer, so a gate on
          the control passes whether or not the write landed — and this
          scene's whole claim is that the board now records a person.
        */
        await card.getByText(/being looked at/).waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(card.locator('.si-actions').first(), 3400);
      },

      async medium({ page, stage }) {
        const card = issueCard(page, /stale exchange rate/);
        await card.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(card.locator('.si-detail').first(), 3800);
      },

      async closedialog({ page, stage }) {
        await stage.clickIt(
          issueCard(page, /stale exchange rate/)
            .getByRole('button', { name: 'Close', exact: true })
            .first(),
          { after: 1200 },
        );
        await page
          .locator('.sk-dialog__title')
          .filter({ hasText: 'Close this issue' })
          .waitFor({ state: 'visible', timeout: 20_000 });
        // The hint under the box is the line the narration quotes.
        const hint = page.getByText(/it is the record/).first();
        await hint.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.sk-dialog__body').first(), 3600);
      },

      async cancelclose({ page, stage }) {
        await stage.clickIt(dialogFoot(page).getByRole('button', { name: 'Cancel' }).first(), {
          after: 1200,
        });
        await page
          .locator('.sk-dialog__title')
          .filter({ hasText: 'Close this issue' })
          .waitFor({ state: 'detached', timeout: 20_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(issueCard(page, /stale exchange rate/).locator('.si-detail'), 3000);
      },

      async history({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Show closed too' }).first(), {
          after: 1400,
        });
        // A CLOSED row, not merely the button flipping — the toggle is
        // client state and would read as done against an empty history.
        const closed = page
          .locator('.si-actions')
          .filter({ hasText: /^closed / })
          .first();
        await closed.waitFor({ state: 'visible', timeout: 20_000 });
        await closed.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(800);
        await stage.dwellOn(closed, 3600);
      },

      async notify({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Notify unannounced' }).first(), {
          after: 1400,
        });
        const consequence = page.locator('.sk-confirm__consequence').first();
        await consequence.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(consequence, 3800);
        // CANCELLED, never confirmed: it fans out a real notification per
        // unannounced issue, to everybody the issue's audience names.
        await stage.clickIt(dialogFoot(page).getByRole('button', { name: 'Cancel' }).first(), {
          after: 1200,
        });
      },

      async outro({ page, stage }) {
        await page
          .locator('.sk-confirm__consequence')
          .waitFor({ state: 'detached', timeout: 20_000 });
        /*
          BACK TO THE OPEN BOARD before the closing line. The history
          toggle is still on from two scenes ago, so the first take ended
          on a screen of CLOSED rows under a sentence about an empty page
          being the good outcome — true, and the wrong picture. Only the
          frame said so; every step had passed.
        */
        await stage.clickIt(page.getByRole('button', { name: 'Open only' }).first(), {
          after: 1200,
        });
        await page
          .getByRole('button', { name: 'Show closed too' })
          .waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.af-kpis').first(), 3400);
      },
    },
  },

  'taking-calls': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/call-center`, { waitUntil: 'domcontentloaded' });
        /*
          GATED ON THE UNAVAILABLE EMPTY STATE, which is what the seeding
          guarantees and what the next scene acts on. The availability
          card renders a SKELETON until its query settles and then, for a
          staff user who is not a call agent, renders NOTHING at all —
          so a gate on the card would pass on a station with no switch.
        */
        await page
          .getByText('You are marked unavailable')
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2600);
      },

      async availability({ page, stage }) {
        await stage.dwellOn(page.locator('.cc-avail').first(), 3600);
      },

      async start({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Start taking calls' }).first(), {
          after: 1400,
        });
        /*
          THE SENTENCE BESIDE THE CHIP, not the chip and not the button.
          The button's label flips from local state the moment it is
          pressed, so it says nothing about the write; the chip's own
          text is title-cased by CSS but lower-cased in the DOM, which is
          how `getByText('available', { exact: true })` spent twenty
          seconds waiting for a word plainly on the screen. This line
          exists only in the available state and comes from the settings
          query the auto-advance is gated on.
        */
        await page
          .getByText('Orders will be assigned to you.')
          .waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.cc-avail').first(), 2600);
      },

      async arrives({ page, stage }) {
        /*
          NOTHING IS PRESSED HERE. The station auto-advances: it pulls
          the moment availability turns on and again every fifteen
          seconds, so "pull next" is not a button the video presses —
          availability IS the control. The wait is generous because the
          first look happens on its own schedule.
        */
        await page.locator('.cc-purpose').first().waitFor({ state: 'visible', timeout: 40_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.locator('.cc-call-head').first(), 3200);
      },

      async purpose({ page, stage }) {
        // The HEADLINE, which is what the narration is about — an empty
        // banner renders the kicker just as happily.
        const head = page.locator('.cc-purpose__headline').first();
        await head.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(page.locator('.cc-purpose').first(), 3600);
      },

      async risk({ page, stage }) {
        /*
          `CustomerRiskStrip` renders NOTHING for a first-time customer,
          by design — so this scene is the seeding's assertion made
          visible. The order is placed for a phone whose parcels have
          come back before; if that history ever goes, this fails here
          rather than filming an empty space under a line about it.
        */
        const strip = page.locator('.cc-risk').first();
        /*
          GATED ON THE WORDS THE NARRATION CLAIMS, never on the strip
          itself. A first-time customer gets no strip at all — but a
          customer with ONE clean previous order gets a perfectly good
          one reading "1 previous order · 0 delivered · 0 returned",
          which is not what this scene says. That is what a released
          entry jumping the queue filmed once, passing every step on the
          way there.
        */
        await strip.getByText(/came back/).waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(strip, 3600);
      },

      async recipient({ page, stage }) {
        await stage.dwellOn(page.locator('.cc-recipient').first(), 4000);
      },

      async outcome({ page, stage }) {
        /*
          By LABEL, never by index — the nine options are reordered on a
          follow-up call, where the confirmation pair sinks to the
          bottom. And NOT `{ exact: true }`: `requiredMark` puts a
          character in the label, so the accessible name is not the word
          on its own and the exact form waited thirty seconds for a
          field that was right there. But the plain form is worse: it is
          a CASE-INSENSITIVE SUBSTRING, so `getByLabel('Outcome')` also
          matched the "Record outcome" BUTTON and failed on strict mode.
          A regex is matched against the WHOLE accessible name, which is
          the only form that says "this field and nothing else".
        */
        await page.getByLabel(/^Outcome\*?$/).selectOption({ label: 'Confirmed' });
        await page.waitForTimeout(600);
        await stage.dwellOn(page.locator('.cc-form').first(), 3000);
      },

      async permanent({ page, stage }) {
        // The helper line only exists once an outcome is chosen, and it
        // is the sentence the narration is quoting.
        const helper = page.locator('.cc-form__helper').first();
        await helper.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(helper, 3600);
      },

      async note({ page, stage }) {
        await stage.typeIn(
          page.getByLabel(/^Notes\*?$/).first(),
          'Confirmed on the phone — happy to pay cash at the door.',
        );
        await page.waitForTimeout(600);
        await stage.dwellOn(page.locator('.cc-form').first(), 2600);
      },

      async record({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Record outcome' }).first(), {
          after: 1400,
        });
        // The ORDER moved, said by the toast the service itself writes.
        // Gating on the form disappearing would pass on a refusal that
        // reset the card.
        await page
          .getByText(/Recorded CONFIRMED/i)
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(page.locator('.cc-actions').first(), 2600);
      },

      async next({ page, stage }) {
        // Recording triggers an immediate advance, so a second call
        // arrives with nobody asking for it. That is the scene.
        await page.locator('.cc-purpose').first().waitFor({ state: 'visible', timeout: 40_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.locator('.cc-call-head').first(), 3200);
      },

      async release({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Release without attempt' }).first(), {
          after: 1400,
        });
        // Back to waiting. Gated on the empty state rather than on the
        // toast, because the toast fades and the next auto-advance may
        // hand another call straight back.
        await page
          .getByText(/Waiting for the next call|You are marked unavailable/)
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.cc-actions').first(), 2600);
      },

      async stop({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Stop taking calls' }).first(), {
          after: 1400,
        });
        /*
          THE AVAILABILITY CARD'S OWN SENTENCE, not the empty state.
          "You are marked unavailable" belongs to the panel that renders
          only when the agent is holding NOTHING — and the auto-advance
          runs every fifteen seconds, so a call landing between the
          release and this click leaves that text unreachable for ever
          while the screen is perfectly correct. This line is in the
          availability card and does not care what is in hand.
        */
        await page
          .getByText('Nothing new will be assigned until you turn this back on.')
          .waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.cc-avail').first(), 3400);
      },
    },
  },

  'supervising-the-queue': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/call-center/queue`, { waitUntil: 'domcontentloaded' });
        /*
          GATED ON THE ASSIGNED ROW, which is the whole subject of the
          video and the one thing the seeding guarantees. The table
          renders just as happily with five pending rows and no name on
          any of them, and the empty state renders a perfectly good card
          too — so a gate on the table or on the card would pass on a box
          where the world had not been built.
        */
        await page
          .locator('.sk-tr', { hasText: 'asha.pillai' })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2800);
      },

      async tiles({ page, stage }) {
        await stage.dwellOn(page.locator('.oo-kpis').first(), 3600);
      },

      async filter({ page, stage }) {
        // Nothing is pressed: the narration is about what the page OPENS
        // on, and changing it to say so would film the opposite.
        await stage.dwellOn(page.locator('.cc-filters').first(), 3400);
      },

      async row({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-table').first(), 3800);
      },

      async stuck({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-tr', { hasText: 'asha.pillai' }).first(), 3800);
      },

      async reassign({ page, stage }) {
        /*
          "Reassign" renders ONLY on an ASSIGNED row, and the seeding
          asserts there is exactly one — so this reaches for the button
          by name rather than by position. Once the dialog is open its
          SUBMIT button carries the same word, which is why every later
          reach is scoped to the dialog.
        */
        await stage.clickIt(page.getByRole('button', { name: 'Reassign' }).first(), {
          after: 1200,
        });
        const dialog = page.getByRole('dialog');
        await dialog
          .getByText('only who is holding it changes')
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-dialog__head').first(), 3200);
      },

      async pick({ page, stage }) {
        /*
          By the OPTION'S OWN value, read off the option whose text names
          the agent. `selectOption({ label })` would have to restate the
          capacity the option prints beside the email ("… — holding 0 of
          1"), so a seed that changed the cap would break this with a
          message about a missing option rather than about a cap.
        */
        const option = page.locator('#q-to option', { hasText: 'imran.shaikh' }).first();
        await option.waitFor({ state: 'attached', timeout: 20_000 });
        const value = await option.getAttribute('value');
        if (value === null || value === '') {
          throw new Error(
            'The reassign dropdown has no agent to offer — nobody is marked available.',
          );
        }
        await page.selectOption('#q-to', value);
        await page.waitForTimeout(600);
        await stage.dwellOn(page.getByRole('dialog').locator('.oo-stack').first(), 3200);
      },

      async moved({ page, stage }) {
        await stage.clickIt(
          page.getByRole('dialog').getByRole('button', { name: 'Reassign' }).first(),
          { after: 1400 },
        );
        // The ROW carrying the new name — not the dialog closing, which
        // a cancel does just as well.
        const row = page.locator('.sk-tr', { hasText: 'imran.shaikh' }).first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(row, 3200);
      },

      async reschedule({ page, stage }) {
        /*
          The TOP row, which is the most recently queued one: the table
          is ordered `createdAt DESC` and the seeding gives its three
          entries distinct ages, so this is deterministic. Every pending
          row would serve the scene equally, which is what makes
          `.first()` honest here rather than a coin toss (P5's lesson is
          about a seed staging ONE row and a flow taking whichever came
          first).
        */
        await stage.clickIt(
          page.locator('.sk-tbody .sk-tr').first().getByRole('button', { name: 'Reschedule' }),
          { after: 1200 },
        );
        const dialog = page.getByRole('dialog');
        await dialog
          .getByText('the attempt count and the order are untouched')
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-dialog__head').first(), 3200);
      },

      async when({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await stage.clickIt(dialog.getByRole('button', { name: 'Tomorrow' }), { after: 800 });
        await stage.typeIn(dialog.locator('#q-why'), 'Customer asked to be rung tomorrow instead.');
        await page.waitForTimeout(500);
        await stage.dwellOn(dialog.locator('.oo-stack').first(), 2800);
      },

      async rescheduled({ page, stage }) {
        await stage.clickIt(
          page.getByRole('dialog').getByRole('button', { name: 'Reschedule' }).first(),
          { after: 1400 },
        );
        /*
          THE CALLABLE COLUMN, which is the thing the narration claims
          moved. Every other row reads "now", so this is unique — and
          "Tomorrow" rather than "In 1 hour" on purpose: the column
          rounds to whole minutes below an hour, so a preset of exactly
          sixty minutes lands on "59m" or "1h" depending on where in the
          minute the click fell.
        */
        await page
          .getByText(/^in 24h$/)
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.sk-table').first(), 3000);
      },

      async force({ page, stage }) {
        /*
          THE ASSIGNED ROW'S actions, where there really are three
          buttons. Every other row carries two — "Reassign" renders only
          on an assigned entry — so a halo round the first row would put
          "the third button" over a pair of them.
        */
        await stage.dwellOn(
          page.locator('.sk-tr', { hasText: 'imran.shaikh' }).first().locator('.cc-row-actions'),
          3600,
        );
      },

      async agents({ page, stage, baseUrl }) {
        await stage.clickIt(page.getByRole('link', { name: 'Call agents' }).first(), {
          after: 1200,
        });
        await page.waitForURL(`${baseUrl}/call-center/agents`, { timeout: 20_000 });
        await page
          .locator('.sk-tr', { hasText: 'imran.shaikh' })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.sk-table').first(), 3200);
      },

      async holding({ page, stage }) {
        // BOTH ROWS: the line is about the pairing of the two columns —
        // an agent marked off who is holding nothing, beside one at
        // their cap in amber — and a halo round one row would be
        // pointing at half of it.
        await stage.dwellOn(page.locator('.sk-table').first(), 3600);
      },

      async capacity({ page, stage }) {
        const row = page.locator('.sk-tr', { hasText: 'imran.shaikh' }).first();
        await stage.clickIt(row.getByRole('button', { name: 'Details' }), { after: 1000 });
        const dialog = page.getByRole('dialog');
        await dialog.locator('#ag-max').waitFor({ state: 'visible', timeout: 20_000 });
        await stage.typeIn(dialog.locator('#ag-max'), '3', { clear: true });
        await stage.clickIt(dialog.getByRole('button', { name: 'Save capacity' }), { after: 1200 });
        /*
          THE FOOTER'S Close, not `getByRole('button', { name: 'Close' })`
          — every dialog's header carries an X with `aria-label="Close"`,
          so the unscoped form matches two and dies on strict mode.
        */
        await stage.clickIt(
          dialog.locator('.sk-dialog__foot').getByRole('button', { name: 'Close' }),
          { after: 1200 },
        );
        /*
          AND THE GATE IS OUTSIDE THE DIALOG, because it has to be: the
          detail panel holds the agent row it was OPENED with in local
          state and nothing refreshes it, so the cap inside it still
          reads the old number after a perfectly successful save. The
          list behind it is the only place the write becomes visible.
        */
        await page
          .locator('.sk-tr', { hasText: 'imran.shaikh' })
          .getByText('1 of 3')
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.sk-tr', { hasText: 'imran.shaikh' }).first(), 3000);
      },

      async outro({ page, stage, baseUrl }) {
        // BACK TO THE QUEUE, because that is what the closing line is
        // about. Left on the agents page it would be summarising the
        // queue's columns over a table of people.
        await stage.clickIt(page.getByRole('link', { name: 'Call queue' }).first(), {
          after: 1200,
        });
        await page.waitForURL(`${baseUrl}/call-center/queue`, { timeout: 20_000 });
        await page
          .locator('.sk-tr', { hasText: 'imran.shaikh' })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(page.locator('.sk-table').first(), 3400);
      },
    },
  },

  'forcing-an-outcome': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/call-center/queue`, { waitUntil: 'domcontentloaded' });
        // The ASSIGNED row, which the seeding guarantees is exactly one
        // and holds it in the name of an agent who is marked off.
        const row = page.locator('.sk-tr', { hasText: 'asha.pillai' }).first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(row, 3400);
      },

      async why({ page, stage }) {
        await stage.dwellOn(
          page.locator('.sk-tr', { hasText: 'asha.pillai' }).first().locator('.cc-row-actions'),
          3600,
        );
      },

      async open({ page, stage }) {
        /*
          SCOPED TO THE ROW. "Force outcome" renders on every open entry
          — five of them here — so the unscoped reach is a strict-mode
          failure, and `.first()` would be the top of the list rather
          than the parcel this video is about.
        */
        await stage.clickIt(
          page
            .locator('.sk-tr', { hasText: 'asha.pillai' })
            .first()
            .getByRole('button', { name: 'Force outcome' }),
          { after: 1400 },
        );
        const dialog = page.getByRole('dialog');
        await dialog
          .getByRole('heading', { name: /Overrule this call/ })
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-dialog__head').first(), 3000);
      },

      async same({ page, stage }) {
        await stage.dwellOn(page.getByRole('dialog').locator('.sk-dialog__desc').first(), 3400);
      },

      async permanent({ page, stage }) {
        // The paragraph inside the body, which is the one that names all
        // three consequences. The description above it names only one.
        const para = page.getByRole('dialog').locator('.oo-p').first();
        await para.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(para, 3600);
      },

      async outcomes({ page, stage }) {
        await stage.dwellOn(page.locator('#fo-outcome'), 3400);
      },

      async confirmed({ page, stage }) {
        /*
          CHOSEN AND THEN CHANGED, on purpose: the helper line only
          exists once an outcome is picked, and the most expensive one
          is worth reading BEFORE the one we actually mean. Nothing is
          written until the button at the bottom.
        */
        await page.selectOption('#fo-outcome', 'CONFIRMED');
        await page
          .getByText(/reserves stock and advances the order/)
          .waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(500);
        await stage.dwellOn(page.getByText(/reserves stock and advances the order/), 3200);
      },

      async declined({ page, stage }) {
        await page.selectOption('#fo-outcome', 'CUSTOMER_DECLINED');
        // GATED ON THE WORD THE NARRATION QUOTES. The select itself
        // changes just as happily on a value that means something else.
        await page
          .getByText(/the order is rejected\. Terminal\./)
          .waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(500);
        await stage.dwellOn(page.getByText(/the order is rejected\. Terminal\./), 3200);
      },

      async when({ page, stage }) {
        await stage.dwellOn(page.getByRole('dialog').locator('#fo-started'), 3600);
      },

      async notes({ page, stage }) {
        await stage.typeIn(
          page.locator('#fo-notes'),
          'Seller emailed: their customer cancelled before we could ring.',
        );
        await page.waitForTimeout(500);
        await stage.dwellOn(page.locator('#fo-notes'), 2600);
      },

      async record({ page, stage }) {
        await stage.clickIt(
          page.getByRole('dialog').getByRole('button', { name: 'Record this outcome' }),
          { after: 1400 },
        );
        /*
          THE TOAST, which is the service's own report and the thing the
          next scene reads out. Gating on the dialog closing would pass
          on a cancel just as well.
        */
        await page
          .getByText(/Forced CUSTOMER_DECLINED/i)
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(600);
        /*
          AND THE MOUSE STAYS ON THE TOAST, which is what lets the NEXT
          scene read it. A success toast lives 4.5 s of UNPAUSED time and
          `point` moves the pointer onto whatever it outlines, so hovering
          it stops the clock (`usePausableTimer` — a designed behaviour,
          so that somebody reading a message is not cut off mid-sentence).
          Both scenes therefore outline the toast itself; the first thing
          to point somewhere else lets it fade, which is why `gone` comes
          after rather than between.
        */
        await stage.dwellOn(page.getByText(/Forced CUSTOMER_DECLINED/i).first(), 2400);
      },

      async landed({ page, stage }) {
        await stage.dwellOn(page.getByText(/Forced CUSTOMER_DECLINED/i).first(), 3600);
      },

      async gone({ page, stage }) {
        /*
          THE ROW IS GONE, which is what the narration claims — the entry
          is COMPLETED and the list opens on OPEN. Waiting for it to
          DETACH rather than reading a count, because the list refetches
          and a count taken mid-flight is whichever render won.
        */
        await page
          .locator('.sk-tr', { hasText: 'asha.pillai' })
          .first()
          .waitFor({ state: 'detached', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.sk-table').first(), 3400);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.locator('.oo-kpis').first(), 3600);
      },
    },
  },

  'sellers-asking-to-call-again': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/reattempt-requests`, { waitUntil: 'domcontentloaded' });
        /*
          GATED ON A CARD THE SEEDING WROTE, by the words in its reason
          rather than by position — the order numbers are minted per run
          and the empty state renders a perfectly good card-shaped panel
          of its own.
        */
        await firstAsk(page).waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2800);
      },

      async why({ page, stage }) {
        // The page's own subtitle, which states the rule the narration
        // is explaining.
        await stage.dwellOn(page.locator('.sk-ph').first(), 3400);
      },

      async card({ page, stage }) {
        await stage.dwellOn(firstAsk(page), 3600);
      },

      async read({ page, stage }) {
        await stage.dwellOn(firstAsk(page).locator('.oo-body').first(), 3800);
      },

      async approve({ page, stage }) {
        await stage.clickIt(firstAsk(page).getByRole('button', { name: 'Approve — call again' }), {
          after: 1400,
        });
        const dialog = page.getByRole('dialog');
        await dialog
          .getByText(/returns to PENDING_CONFIRMATION and is queued for calling/)
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-dialog__head').first(), 3200);
      },

      async extra({ page, stage }) {
        // The hint under the select is the sentence the narration is
        // quoting, and it only exists on the APPROVE side of the dialog.
        await page
          .getByText(/puts the order back already out of chances/)
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(page.getByRole('dialog').locator('#ra-extra'), 3600);
      },

      async note({ page, stage }) {
        await stage.typeIn(
          page.getByRole('dialog').locator('#ra-note'),
          'Seller called the shop; customer confirmed she still wants it.',
        );
        await page.waitForTimeout(500);
        await stage.dwellOn(page.getByRole('dialog').locator('#ra-note'), 2400);
      },

      async approved({ page, stage }) {
        /*
          SCOPED TO THE DIALOG. Its footer button is "Approve" while the
          card behind it says "Approve — call again", and `getByRole`
          matches a name as a SUBSTRING by default — so the unscoped
          reach finds both and dies on strict mode.
        */
        await stage.clickIt(page.getByRole('dialog').getByRole('button', { name: 'Approve' }), {
          after: 1400,
        });
        // The card LEAVES the waiting list, which is what the narration
        // claims. The dialog closing would be true of a cancel too.
        await firstAsk(page).waitFor({ state: 'detached', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.oo-queue').first(), 3000);
      },

      async second({ page, stage }) {
        await stage.dwellOn(secondAsk(page).locator('.oo-body').first(), 3600);
      },

      async decline({ page, stage }) {
        await stage.clickIt(secondAsk(page).getByRole('button', { name: 'Decline' }), {
          after: 1400,
        });
        const dialog = page.getByRole('dialog');
        await dialog
          .getByText(/The order stays rejected/)
          .waitFor({ state: 'visible', timeout: 20_000 });
        // A DECLINE NEEDS ITS NOTE TOO. The field is optional on both
        // sides, and a rejected card with nothing written on it is the
        // one shape the history scene cannot teach anything from.
        await stage.typeIn(
          dialog.locator('#ra-note'),
          'Nothing has changed — the customer declined on price and has not been spoken to since.',
        );
        await page.waitForTimeout(400);
        await stage.dwellOn(dialog.locator('.oo-stack').first(), 2600);
      },

      async declined({ page, stage }) {
        await stage.clickIt(
          page.getByRole('dialog').getByRole('button', { name: 'Decline request' }),
          { after: 1400 },
        );
        // The EMPTY STATE by its own words, not the absence of a card —
        // a list still loading has no cards either.
        await page.getByText('Nothing waiting').waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.sk-empty').first(), 3000);
      },

      async history({ page, stage }) {
        await page.selectOption('#ra-status', '');
        /*
          GATED ON WHAT THE APPROVAL GRANTED, which is the half of the
          card that only exists after a decision. A gate on the cards
          coming back would pass on a filter that had shown them all
          along.
        */
        await page
          .getByText(/Granted:/)
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.oo-queue').first(), 3600);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-ph').first(), 3400);
      },
    },
  },

  'where-things-live': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/warehouse/bins`, { waitUntil: 'domcontentloaded' });
        await page
          .getByRole('heading', { level: 1, name: 'Bins' })
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.sk-ph').first(), 3000);
      },

      async overview({ page, stage }) {
        const section = overviewSection(page);
        // Gated on a REAL LINE, not on the section: the overview renders
        // a perfectly good "Nothing matches" card with the same heading
        // above it.
        await section
          .locator('.bin-product')
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        /*
          THE FILTER ROW, which is what the narration lists. The section
          itself is thousands of pixels tall — a halo round it is a halo
          round the whole screen — and `Panel` draws no head when it is
          given no title, so there is no card header here to point at.
        */
        await stage.dwellOn(section.locator('.stk-toolbar').first(), 3600);
      },

      async holds({ page, stage }) {
        /*
          THE TRANSIT BIN, which only exists because C0 built a
          consignment that is still in the air (CNS-1: in-transit is a
          PLACE, in the DESTINATION warehouse, and non-pickable). If that
          world is ever gone this fails here rather than filming a line
          about stock nobody can see.
        */
        const transit = page.locator('.stk-card', { hasText: 'not pickable' }).first();
        await transit.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.dwellOn(transit, 3800);
      },

      async building({ page, stage }) {
        /*
          SCOPED TO THE PAGE HEADER. The overview above has a "Warehouse"
          filter of its own, so the unscoped `getByLabel('Warehouse')`
          matches two and dies on strict mode — and the one it would
          otherwise find filters a TABLE rather than choosing the
          building every panel below belongs to.
        */
        const picker = page.locator('.sk-ph').getByLabel('Warehouse');
        await picker.selectOption({ label: 'BD-DHK-1 — Dhaka Intake' });
        await page.waitForTimeout(800);
        await stage.dwellOn(picker, 3200);
      },

      async tracking({ page, stage }) {
        const panel = trackingPanel(page);
        // The note that only exists with NO real bin, which is what the
        // narration is about and what the seeding guarantees.
        await panel
          .getByText(/Create at least one bin below before turning this on/)
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(panel, 3800);
      },

      async compose({ page, stage }) {
        /*
          THE ZONE IS REQUIRED, and it is why "Add bin" stays disabled —
          the three coordinates alone are not enough (`binForm.zoneId ===
          ''` is in its disabled expression, and a disabled button under
          a filled form is a slow thirty-second timeout rather than a
          selector miss). The option's VALUE is read off the option whose
          text names the zone, rather than restating its label, which is
          `<code> — <name>` and would break on a rename with a message
          about a missing option.
        */
        const section = addBinSection(page);
        const zone = section.locator('option', { hasText: 'MAIN' }).first();
        await zone.waitFor({ state: 'attached', timeout: 20_000 });
        const zoneId = await zone.getAttribute('value');
        if (zoneId === null || zoneId === '') {
          throw new Error('No MAIN zone to put a bin in — the seeding asserts one exists.');
        }
        await section.getByLabel(/^Zone$/).selectOption(zoneId);
        await page.waitForTimeout(600);
        await stage.dwellOn(section.locator('.stk-card').first(), 3200);
      },

      async preview({ page, stage }) {
        const section = addBinSection(page);
        // By a REGEX against the whole accessible name: "Type" is a
        // case-insensitive substring of the overview's "Bin type"
        // filter, and `getByLabel` is substring by default.
        await stage.typeIn(section.getByLabel(/^Aisle$/), 'A');
        await stage.typeIn(section.getByLabel(/^Rack$/), '1');
        await stage.typeIn(section.getByLabel(/^Shelf$/), '3');
        await page.getByText(/Will be created as/).waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(500);
        await stage.dwellOn(page.getByText(/Will be created as/).first(), 3000);
      },

      async added({ page, stage }) {
        await stage.clickIt(addBinSection(page).getByRole('button', { name: 'Add bin' }), {
          after: 1400,
        });
        const layout = layoutSection(page);
        await layout
          .getByText('A-01-03', { exact: true })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(layout, 3200);
      },

      async on({ page, stage }) {
        await stage.clickIt(trackingPanel(page).getByRole('button', { name: 'Turn tracking on' }), {
          after: 1200,
        });
        const dialog = page.getByRole('dialog');
        await dialog
          .getByText(/Receiving will start asking which bin goods went into/)
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-dialog__body').first(), 3200);
      },

      async notcollapse({ page, stage }) {
        await stage.clickIt(page.getByRole('dialog').getByRole('button', { name: 'Confirm' }), {
          after: 1400,
        });
        /*
          THE ON-STATE NOTE, which is the sentence this whole tutorial
          exists to teach and which can only be read while tracking is
          ON. Gating on the button's label flipping would pass on local
          state that never reached the server.
        */
        const said = page.getByText(/It does NOT collapse the bins you have built/);
        await said.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(said, 3800);
      },

      async off({ page, stage }) {
        /*
          PUT BACK ON CAMERA. The seeding resets it too — a take that
          fails after this scene must not leave the intake warehouse
          asking for bins — but doing it here is the scene: the video's
          claim is that the switch is reversible and changes nothing
          physical, and saying so while leaving it on would be asking to
          be taken on trust.
        */
        await stage.clickIt(
          trackingPanel(page).getByRole('button', { name: 'Turn tracking off' }),
          {
            after: 1200,
          },
        );
        const dialog = page.getByRole('dialog');
        await dialog
          .getByText(/Nothing moves — every bin and everything in it stays exactly as recorded/)
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.clickIt(dialog.getByRole('button', { name: 'Confirm' }), { after: 1400 });
        await trackingPanel(page)
          .getByRole('button', { name: 'Turn tracking on' })
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(trackingPanel(page), 2600);
      },

      async move({ page, stage }) {
        const section = page
          .locator('.stk-section', { hasText: 'Move stock between bins' })
          .first();
        await section.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.dwellOn(section, 3800);
      },

      async collapse({ page, stage }) {
        const line = page.getByRole('link', { name: 'Collapse its bins into FLOOR' });
        await line.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.dwellOn(line, 3600);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(trackingPanel(page), 3400);
      },
    },
  },

  'receive-a-consignment': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/warehouse/receive`, { waitUntil: 'domcontentloaded' });
        /*
          THE LIST OPENS ON PENDING and the seeding guarantees exactly
          one such row — ours. Gated on the row rather than on the table,
          which the "No goods receipts match" empty state renders just as
          convincingly (and did, on a box where nothing was waiting).
        */
        await receiveRow(page).waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.sk-ph').first(), 2800);
      },

      async queue({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-table').first(), 3600);
      },

      async open({ page, stage }) {
        await stage.clickIt(receiveRow(page).getByRole('link').first(), { after: 1400 });
        await page
          .getByRole('heading', { level: 1 })
          .filter({ hasText: /GR-/ })
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.wh-facts').first(), 3200);
      },

      async declared({ page, stage }) {
        await stage.dwellOn(page.locator('.wh-item').first(), 3600);
      },

      async start({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Start receiving' }), { after: 1400 });
        // The COUNT FIELDS, which only exist once the receipt is
        // ARRIVING — and which are what the next scene is about. The
        // status chip flips from local state too readily to be a gate.
        await page
          .getByLabel(/^Received qty$/)
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.sk-ph').first(), 2600);
      },

      async fields({ page, stage }) {
        await stage.dwellOn(kanthaLine(page).locator('.wh-fields').first(), 3600);
      },

      async exact({ page, stage }) {
        const line = kanthaLine(page);
        await stage.typeIn(line.getByLabel(/^Received qty$/), '10', { clear: true });
        await stage.typeIn(line.getByLabel(/^Damaged$/), '0', { clear: true });
        await putIntoFloor(page, line);
        await page.waitForTimeout(400);
        await stage.dwellOn(line.locator('.wh-fields').first(), 2600);
      },

      async short({ page, stage }) {
        const line = jamdaniLine(page);
        await stage.typeIn(line.getByLabel(/^Received qty$/), '18', { clear: true });
        await stage.typeIn(line.getByLabel(/^Damaged$/), '1', { clear: true });
        await putIntoFloor(page, line);
        await page.waitForTimeout(400);
        await stage.dwellOn(line.locator('.wh-fields').first(), 2600);
      },

      async recorded({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Record all products' }), {
          after: 1400,
        });
        /*
          THE SECOND LINE'S OWN TAG, which is the one the narration is
          about — "recorded: 18 (1 dmg)". Gating on the first would pass
          on a save that only landed one of them, which is exactly what
          a per-line submit can do.
        */
        await jamdaniLine(page)
          .getByText(/recorded:\s*18/)
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(jamdaniLine(page), 3000);
      },

      async confirm({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Complete', exact: true }), {
          after: 1400,
        });
        const dialog = page.getByRole('dialog');
        await dialog
          .getByText(/It cannot be cancelled afterwards/)
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-dialog__body').first(), 3400);
      },

      async variance({ page, stage }) {
        await stage.dwellOn(page.getByRole('dialog').getByText(/A variance does not block/), 3600);
      },

      async written({ page, stage }) {
        await stage.clickIt(
          page.getByRole('dialog').getByRole('button', { name: 'Complete and write stock' }),
          { after: 1600 },
        );
        /*
          THE DISCREPANCY FACT, which is what the narration claims and
          which only a COMPLETED receipt that was counted short can show.
          The status chip would flip on any completion at all.
        */
        await page.getByText('Counted differently').waitFor({ state: 'visible', timeout: 30_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.wh-facts').first(), 3200);
      },

      async labels({ page, stage }) {
        await stage.dwellOn(page.getByRole('button', { name: 'Print product labels' }), 3600);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.locator('.wh-item').first(), 3400);
      },
    },
  },

  'print-and-pick': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/warehouse/printing`, { waitUntil: 'domcontentloaded' });
        // Gated on OUR three rows, by the destination pin nothing else on
        // the box uses — the queue is two dozen parcels deep and the
        // video must touch only the three the seeding placed.
        await ourParcels(page).first().waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2600);
      },

      async order({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-ph').first(), 3200);
      },

      async queue({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-thead').first(), 3400);
      },

      async select({ page, stage }) {
        /*
          THREE ROWS, EACH BY ITS OWN CHECKBOX. The header checkbox would
          select all two dozen — including `RSH-LIFE-CONFIRMED`, which is
          D0's parcel for B7 and whose whole value is sitting at
          CONFIRMED, and `RSH-CALL-1`, which is I1's. Printing and
          picking either moves it and the next seed run fails naming it.
        */
        const rows = ourParcels(page);
        const n = await rows.count();
        if (n !== 3) {
          throw new Error(`${n} parcels are addressed to the seeded pin, expected 3.`);
        }
        for (let i = 0; i < n; i += 1) {
          await stage.clickIt(rows.nth(i).locator('input.wh-check'), { settle: 220, after: 260 });
        }
        await page.getByText('3 selected').waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(page.getByText('3 selected'), 2600);
      },

      async printed({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Print labels' }), { after: 1600 });
        /*
          THE SHEET DIALOG, by its own count line. `printPdf` prints from
          a HIDDEN IFRAME rather than a new window — headless Chromium
          treats `window.print()` as a no-op — so nothing blocks here,
          but the dialog is the thing the narration is about either way.
        */
        const dialog = page.getByRole('dialog');
        await dialog.getByText(/3 labels across/).waitFor({ state: 'visible', timeout: 30_000 });
        await stage.dwellOn(dialog.locator('.sk-dialog__body').first(), 3200);
      },

      async confirm({ page, stage }) {
        await stage.dwellOn(
          page.getByRole('dialog').getByText(/Only confirm what is actually on paper/),
          3600,
        );
      },

      async picking({ page, stage }) {
        await stage.clickIt(
          page.getByRole('dialog').getByRole('button', { name: 'Yes, they printed' }),
          { after: 1600 },
        );
        await page
          .getByText(/labels? confirmed/i)
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await stage.clickIt(page.getByRole('button', { name: 'Picking list' }), { after: 1400 });
        // The same three parcels, now on the SECOND tab — which is what
        // the narration claims and what confirming the labels caused.
        await ourParcels(page).first().waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(page.locator('.sk-table').first(), 3000);
      },

      async list({ page, stage }) {
        const rows = ourParcels(page);
        const n = await rows.count();
        if (n !== 3) {
          throw new Error(`${n} labelled parcels are ready to pick, expected 3.`);
        }
        for (let i = 0; i < n; i += 1) {
          await rows.nth(i).locator('input.wh-check').click();
        }
        await stage.clickIt(page.getByRole('button', { name: 'Print picking list' }), {
          after: 1600,
        });
        const dialog = page.getByRole('dialog');
        await dialog.getByText(/lines? to walk/).waitFor({ state: 'visible', timeout: 30_000 });
        await stage.dwellOn(dialog.locator('.sk-dialog__body').first(), 3200);
      },

      async allocates({ page, stage }) {
        await stage.clickIt(
          page.getByRole('dialog').getByRole('button', { name: 'Yes, it printed' }),
          { after: 1800 },
        );
        /*
          THE SERVICE'S OWN REPORT — "<batch> is on the floor — N orders
          sent to be picked". Confirming the PICKING sheet is what
          allocates phase-2 (WMS-1), so this toast is the only place the
          write announces itself.
        */
        await page
          .getByText(/is on the floor/)
          .first()
          .waitFor({ state: 'visible', timeout: 30_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(page.getByText(/is on the floor/).first(), 3200);
      },

      async batches({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Past batches' }), { after: 1400 });
        await page
          .locator('.sk-tbody .sk-tr')
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(page.locator('.sk-table').first(), 3400);
      },

      async walk({ page, stage }) {
        /*
          THE FIRST PRINTED BATCH, which is ours: the list is newest
          first and only a PRINTED batch offers "Picked" at all (a DRAFT
          offers "It printed" and "Abandon"). Reaching for the BUTTON
          rather than the row is therefore already specific.
        */
        await stage.clickIt(page.getByRole('button', { name: /^Mark .* picked$/ }).first(), {
          after: 1400,
        });
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button').first().waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-dialog__body').first(), 3000);
      },

      async strict({ page, stage }) {
        await stage.clickIt(
          page
            .getByRole('dialog')
            .getByRole('button', { name: /picked|confirm/i })
            .last(),
          { after: 1800 },
        );
        await page
          .getByText(/at the packing bench|still need scanning/i)
          .first()
          .waitFor({ state: 'visible', timeout: 30_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.sk-table').first(), 3200);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-ph').first(), 3400);
      },
    },
  },

  'pack-a-parcel': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/warehouse/pack`, { waitUntil: 'domcontentloaded' });
        // Gated on OUR row rather than on "a row": the bench also holds
        // a simulator parcel with no label, and a gate on the list would
        // be satisfied by that one while ours had not arrived.
        await packRow(page, PACK.first).waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(page.locator('.wh-scan').first(), 3000);
      },

      async queue({ page, stage }) {
        /*
          THE NOTE, not the list. The unlabelled-parcel callout is the
          one thing on this screen somebody has to go and DO something
          about, and it is the sentence the narration is reading.

          IT IS NOT SEEDED, and that is a known gap. The row behind it
          when this was filmed was a stray `SIM-` parcel an older
          lifecycle run had driven to PICKED through the per-parcel pick
          station — which is the only route to PICKED that does not
          print a label, since the printing station's pick batch is
          gated on labels being confirmed. A later debugging pass packed
          that parcel, so a RE-TAKE needs one placed on purpose: drive a
          fourth parcel to PICKED through `PickExecutionService` rather
          than through a batch. Named rather than left to time out,
          because a missing `.wh-card__note` is otherwise thirty seconds
          of silence and a failure screenshot of a page that looks fine.
        */
        const note = page.locator('.wh-card__note').first();
        if ((await note.count()) === 0) {
          throw new Error(
            'No unlabelled parcel in the pack queue, so the callout this scene is about does ' +
              'not render — see the comment here: one parcel has to reach PICKED without its ' +
              'label being printed, which means the per-parcel pick station, not a batch.',
          );
        }
        await stage.dwellOn(note, 3400);
      },

      async open({ page, stage }) {
        /*
          THE WAYBILL IS READ OFF THE SCREEN, which is also what a packer
          does. It is minted per run, so there is nothing to hard-code;
          the recipient's name is the stable handle, and the row's TITLE
          is the waybill (`.sk-lrow__title` — the description carries the
          order number in an `.sk-ident` too, so an unscoped reach for
          the identifier class would take the wrong one).
        */
        const awb = (await packRow(page, PACK.first).locator('.sk-lrow__title').innerText()).trim();
        if (!/^\d{6,}$/.test(awb)) {
          throw new Error(`Read "${awb}" as ${PACK.first}'s waybill, which is not a waybill.`);
        }
        await scanIn(page, stage, awb);
        await page.locator('.wh-scan__meta').waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(page.locator('.wh-scan__meta'), 2600);
      },

      async lines({ page, stage }) {
        const lines = page.locator('.wh-line');
        const n = await lines.count();
        if (n !== 2) {
          throw new Error(
            `${n} line(s) in this box, expected 2 — the set-versus-count scene needs a parcel ` +
              'with two products on it (see PICK_ORDERS in seed-demo-data.mjs).',
          );
        }
        await stage.dwellOn(page.locator('[aria-label="What goes in this box"]'), 3200);
      },

      async first({ page, stage }) {
        await scanIn(page, stage, PACK.twice);
        await expectCount(page, PACK.twice, '1 / 2');
        await stage.dwellOn(packLine(page, PACK.twice), 2600);
      },

      async set({ page, stage }) {
        await scanIn(page, stage, PACK.twice);
        await expectCount(page, PACK.twice, '2 / 2');
        // Both lines at once: "two of one thing and none of the other"
        // is a statement about the PAIR, so haloing one of them would
        // show half the sentence.
        await stage.dwellOn(page.locator('.wh-lines'), 3200);
      },

      async toomany({ page, stage }) {
        await scanIn(page, stage, PACK.twice);
        const dialog = page.getByRole('dialog');
        await dialog.getByText(/one too many/).waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.wh-alert'), 3000);
      },

      async fixed({ page, stage }) {
        // The dialog's second paragraph — "Nothing was added to the
        // box" — which is the half of the refusal that tells a packer
        // what to do with the item in their hand.
        await stage.dwellOn(page.getByRole('dialog').getByText(/Nothing was added/), 3200);
      },

      async third({ page, stage }) {
        await stage.clickIt(
          page.getByRole('dialog').getByRole('button', { name: 'I have fixed it' }),
          { after: 900 },
        );
        await scanIn(page, stage, PACK.once);
        await expectCount(page, PACK.once, '1 / 1');
        await page.locator('.wh-good').waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(page.locator('.wh-good'), 2800);
      },

      async close({ page, stage }) {
        /*
          THE SAME LABEL AGAIN, read from where the bench itself is
          showing it: once a box is open the queue list is gone, and
          "Box open on <waybill>" is the only copy on screen.
        */
        const awb = (await page.locator('.wh-scan__meta .sk-ident').innerText()).trim();
        await scanIn(page, stage, awb);
        const packed = page.getByText(/^Packed —/).first();
        await packed.waitFor({ state: 'visible', timeout: 25_000 });
        // Let the toast finish sliding in before pointing at it. Its
        // bounding box mid-animation is somewhere it has already left,
        // so the pointer lands beside it, `onPointerEnter` never fires,
        // and the 4.5-second life runs out under a halo that looks
        // exactly as though it were paused.
        await page.waitForTimeout(700);
        await stage.dwellOn(packed, 2400);
      },

      async manifest({ page, stage, baseUrl }) {
        /*
          THE MANIFEST ON ITS OWN SCREEN rather than in the toast.

          The toast carries the number and is the only place the
          auto-attach announces itself — but it lives 4.5 seconds of
          UNPAUSED time, and reading it across two scenes means trusting
          a hover to hold for the whole of the second one. It did not:
          the first take of this scene found it gone (`scrollIntoView`
          timing out on an element that had been there a moment before).
          The manifests list says the same thing with a row that cannot
          fade, and it is where J8 picks up.
        */
        await page.goto(`${baseUrl}/warehouse/manifests`, { waitUntil: 'domcontentloaded' });
        const draft = page.locator('.sk-tbody .sk-tr', { hasText: 'Draft' }).first();
        await draft.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(500);
        await stage.dwellOn(draft, 3400);
      },

      async second({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/warehouse/pack`, { waitUntil: 'domcontentloaded' });
        await packRow(page, PACK.other).waitFor({ state: 'visible', timeout: 25_000 });
        const awb = (await packRow(page, PACK.other).locator('.sk-lrow__title').innerText()).trim();
        await scanIn(page, stage, awb);
        await page.locator('.wh-scan__meta').waitFor({ state: 'visible', timeout: 20_000 });
        await scanIn(page, stage, PACK.once);
        await expectCount(page, PACK.once, '1 / 1');
        await stage.clickIt(page.getByRole('button', { name: 'Cancel this box' }), { after: 900 });
        await stage.dwellOn(page.locator('.wh-note').first(), 2400);
      },

      async cancel({ page, stage }) {
        await stage.typeIn(page.getByLabel(/^Reason for cancelling$/), PACK.cancelReason, {
          after: 500,
        });
        await stage.dwellOn(page.locator('.wh-note').first(), 3200);
      },

      async cancelled({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Cancel the box' }), { after: 1200 });
        // The toast is the PROOF the cancel landed; the ROW coming back
        // is the picture. Dwelling on the toast would be a race against
        // its 4.5-second life for the whole of a 13-second scene (see
        // `close`), and "back in the queue" is the sentence anyway.
        await page
          .getByText(/Box cancelled/)
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await packRow(page, PACK.other).waitFor({ state: 'visible', timeout: 25_000 });
        await stage.dwellOn(packRow(page, PACK.other), 3000);
      },

      async outro({ page, stage }) {
        // Back to the label field, which is where the bench always ends
        // up and is the one thing on the page that does not depend on
        // what is in hand.
        await packRow(page, PACK.other).waitFor({ state: 'visible', timeout: 25_000 });
        await stage.dwellOn(page.locator('.wh-scan').first(), 3400);
      },
    },
  },

  'pack-without-scanning': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/warehouse/pack`, { waitUntil: 'domcontentloaded' });
        await packRow(page, PACK.first).waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(page.locator('.wh-scan').first(), 3000);
      },

      async open({ page, stage }) {
        const awb = (await packRow(page, PACK.first).locator('.sk-lrow__title').innerText()).trim();
        if (!/^\d{6,}$/.test(awb)) {
          throw new Error(`Read "${awb}" as ${PACK.first}'s waybill, which is not a waybill.`);
        }
        await scanIn(page, stage, awb);
        await page.locator('.wh-scan__meta').waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(page.locator('.wh-scan__meta'), 2600);
      },

      async stuck({ page, stage }) {
        // NOTHING IS SCANNED IN, on purpose: the whole premise is goods
        // with no code on them, and a box with a line already ticked
        // would be a video about convenience rather than about a parcel
        // that cannot otherwise move.
        await stage.dwellOn(page.locator('[aria-label="What goes in this box"]'), 3200);
      },

      async hatch({ page, stage }) {
        await forceOpener(page).waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(forceOpener(page), 3200);
      },

      async who({ page, stage }) {
        await stage.clickIt(forceOpener(page), { after: 900 });
        await forcePanel(page).waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(forcePanel(page), 3000);
      },

      async cost({ page, stage }) {
        // The panel's OWN sentence about what this does, which is the
        // one the narration reads rather than restates.
        await stage.dwellOn(forcePanel(page).locator('.wh-note').first(), 3400);
      },

      async short({ page, stage }) {
        /*
          THE HALF-WRITTEN REASON, and the button still dead.

          `disabled` is `forceReason.trim().length < 20 ||
          forceComplete.isPending` \u2014 read it BEFORE writing the scene
          that presses it, or a disabled submit under a filled-in form
          arrives as a thirty-second CLICK timeout rather than as a
          selector miss. Typed in two halves rather than cleared and
          retyped: a controlled field that treats the empty string as
          "not edited" puts its default straight back and
          `pressSequentially` then appends to it (see the gotcha).
        */
        await stage.typeIn(reasonField(page), FORCE.half, { after: 500 });
        const submit = forceSubmit(page);
        if (await submit.isEnabled()) {
          throw new Error(
            `"${FORCE.half}" is ${FORCE.half.length} characters and the button is ENABLED \u2014 ` +
              'the twenty-character floor the narration describes has moved.',
          );
        }
        await stage.dwellOn(submit, 2800);
      },

      async reason({ page, stage }) {
        await stage.typeIn(reasonField(page), FORCE.rest, { after: 500 });
        const submit = forceSubmit(page);
        if (!(await submit.isEnabled())) {
          const got = await reasonField(page).inputValue();
          throw new Error(`The button is still disabled on a ${got.length}-character reason.`);
        }
        await stage.dwellOn(submit, 2600);
      },

      async press({ page, stage }) {
        await stage.clickIt(forceSubmit(page), { after: 1200 });
        const done = page.getByText(/^Packed without scanning/).first();
        await done.waitFor({ state: 'visible', timeout: 25_000 });
        // Settle before pointing: the toast slides in, and its box read
        // mid-animation is somewhere it has already left (see J4).
        await page.waitForTimeout(700);
        await stage.dwellOn(done, 2400);
      },

      async recorded({ page, stage }) {
        // The parcel has left the bench \u2014 which is the picture, and is
        // what makes the narration's point bite: it looks exactly like
        // an ordinary pack from here, and only the audit row differs.
        await page.locator('.wh-list li').first().waitFor({ state: 'visible', timeout: 25_000 });
        await stage.dwellOn(page.locator('.wh-card').first(), 3200);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.locator('.wh-scan').first(), 3400);
      },
    },
  },

  'hand-over-to-the-courier': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/warehouse/handover`, { waitUntil: 'domcontentloaded' });
        await handoverRow(page, HANDOVER.first).waitFor({ state: 'visible', timeout: 25_000 });
        /*
          AND NOT BLOCKED. SCAN-1's stop is per OPERATOR and survives a
          reload, a sign-out and the end of a take — which is the whole
          of this video's last act, so a run that ends on the stop leaves
          the next one unable to scan anything. The seeding lifts it; this
          is the gate that says so rather than letting the first scan fail
          thirty seconds later with the bench apparently working.
        */
        if ((await page.locator('.wh-stop').count()) > 0) {
          throw new Error(
            'The ops user is still blocked from scanning — a previous take raised the duplicate ' +
              'stop and it was not lifted. Re-run the seeding, which clears it.',
          );
        }
        await page.waitForTimeout(600);
        await stage.dwellOn(page.locator('.sk-ph').first(), 3000);
      },

      async waiting({ page, stage }) {
        const rows = waitingCard(page).locator('.wh-list li');
        const n = await rows.count();
        if (n < 3) {
          throw new Error(`${n} parcel(s) waiting for a van, expected at least 3.`);
        }
        await stage.dwellOn(waitingCard(page), 3200);
      },

      async first({ page, stage }) {
        const awb = (
          await handoverRow(page, HANDOVER.first).locator('.sk-lrow__title').innerText()
        ).trim();
        if (!/^\d{6,}$/.test(awb)) {
          throw new Error(`Read "${awb}" as ${HANDOVER.first}'s waybill, which is not a waybill.`);
        }
        await handoverScan(page, stage, awb);
        await sessionList(page).waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(sessionList(page), 2600);
      },

      async why({ page, stage }) {
        // The session row's own chip \u2014 "dispatched", not "scanned" \u2014
        // which is the sentence this scene is about stated by the screen.
        await stage.dwellOn(sessionList(page).locator('.wh-list li').first(), 3000);
      },

      async second({ page, stage }) {
        const awb = (
          await handoverRow(page, HANDOVER.second).locator('.sk-lrow__title').innerText()
        ).trim();
        await handoverScan(page, stage, awb);
        const rows = sessionList(page).locator('.wh-list li');
        await rows.nth(1).waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(sessionList(page), 3000);
      },

      async manifest({ page, stage }) {
        await stage.dwellOn(page.getByRole('link', { name: 'Manifest history' }), 3200);
      },

      async again({ page, stage }) {
        /*
          THE FIRST PARCEL AGAIN. Its waybill is no longer in the waiting
          list — the scan dispatched it — so it is read back off the
          session list, which is where the operator would be looking too.
        */
        const awb = (
          await sessionList(page).locator('.wh-list li').last().locator('.sk-ident').innerText()
        ).trim();
        await handoverScan(page, stage, awb, { settle: 1600 });
        const dialog = page.getByRole('dialog');
        await dialog
          .getByText(/DUPLICATE_SCAN|already/i)
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.wh-alert').first(), 3000);
      },

      async stop({ page, stage }) {
        await stage.clickIt(
          page.getByRole('dialog').locator('.sk-dialog__foot').getByRole('button').first(),
          { after: 1200 },
        );
        // The BANNER, which is the durable half \u2014 the dialog is dismissed
        // and this stays until an admin resolves the issue.
        await page.locator('.wh-stop').waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(page.locator('.wh-stop'), 3200);
      },

      async operator({ page, stage }) {
        await stage.dwellOn(page.locator('.wh-stop .wh-pre').first(), 3400);
      },

      async clear({ page, stage }) {
        await stage.dwellOn(page.getByRole('link', { name: 'system issues' }), 3200);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.locator('.wh-stop').first(), 3400);
      },
    },
  },

  'book-the-van': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/warehouse/pickups`, { waitUntil: 'domcontentloaded' });
        await failedPickupRow(page).waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(page.locator('.sk-ph').first(), 3000);
      },

      async grain({ page, stage }) {
        // The page's OWN sentence about the grain, which is the thing
        // this video is correcting rather than asserting.
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 3200);
      },

      async row({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-thead').first(), 3200);
      },

      async close({ page, stage }) {
        /*
          "Collected" renders on a REQUESTED row only, and the day's row
          is raised for us when the first box is packed (CUR-10 amendment
          #3) — so this is the ordinary act, not a staged one. Pressed,
          because it is harmless: it records that the driver has been and
          the courier is never told.
        */
        const open = openPickupRow(page);
        await open.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.clickIt(open.getByRole('button', { name: 'Collected' }), { after: 1400 });
        await page
          .getByText(/Marked collected/i)
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(page.locator('.sk-table').first(), 2800);
      },

      async failed({ page, stage }) {
        await stage.dwellOn(failedPickupRow(page), 3200);
      },

      async danger({ page, stage }) {
        await stage.clickIt(failedPickupRow(page).getByRole('button', { name: 'Free the day' }), {
          after: 1200,
        });
        const dialog = page.getByRole('dialog');
        await dialog.getByText(/books a second van/).waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.getByText(/books a second van/), 3200);
      },

      async probably({ page, stage }) {
        await stage.dwellOn(page.getByRole('dialog').locator('.pku-callout'), 3400);
      },

      async check({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await stage.typeIn(dialog.getByLabel(/^Reason/), PICKUP.reason, { after: 600 });
        // NOT PRESSED. Freeing a day is the one act on this screen that
        // can put a second van at the door, and a tutorial that performs
        // it teaches the press rather than the check. Backed out instead
        // — which is also what the narration tells somebody to do.
        await stage.dwellOn(dialog.getByRole('button', { name: 'Free the day' }), 2800);
      },

      async raise({ page, stage }) {
        await stage.clickIt(
          page.getByRole('dialog').locator('.sk-dialog__foot').getByRole('button').first(),
          { after: 900 },
        );
        await stage.clickIt(page.getByRole('button', { name: 'Request a pickup' }).first(), {
          after: 1200,
        });
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel(/^Courier/).waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-dialog__body').first(), 3200);
      },

      async outro({ page, stage }) {
        // Closed without raising: there is no sandbox behind this button
        // and a tutorial must not book a van.
        await stage.clickIt(
          page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).first(),
          { after: 1200 },
        );
        await stage.dwellOn(page.locator('.sk-table').first(), 3400);
      },
    },
  },

  'what-went-out-together': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/warehouse/manifests`, { waitUntil: 'domcontentloaded' });
        await draftManifestRow(page).waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 3000);
      },

      async columns({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-thead').first(), 3200);
      },

      async filter({ page, stage }) {
        await stage.dwellOn(page.getByLabel('Status', { exact: true }), 3000);
      },

      async draft({ page, stage }) {
        await stage.dwellOn(draftManifestRow(page), 3200);
      },

      async open({ page, stage }) {
        /*
          THE ROW'S OWN LINK, which carries the manifest number — minted
          per month, so it is reached through the row rather than named.
        */
        await stage.clickIt(draftManifestRow(page).locator('a.stk-link').first(), { after: 1600 });
        await page.waitForURL(/\/warehouse\/manifests\/[0-9a-f-]+/, { timeout: 25_000 });
        await page
          .getByRole('heading', { level: 1 })
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 3000);
      },

      async shipments({ page, stage }) {
        await page
          .locator('.sk-tbody .sk-tr')
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(page.locator('.sk-table').first(), 3400);
      },

      async move({ page, stage }) {
        await stage.clickIt(
          page.getByRole('button', { name: 'Move a shipment to another manifest' }),
          { after: 1200 },
        );
        const dialog = page.getByRole('dialog');
        /*
          THE "NOWHERE TO MOVE IT" NOTE, which is the honest frame: with
          one courier and one warehouse there is only ever one DRAFT, and
          the panel says so rather than offering an empty picker. If a
          second draft ever exists on this box the note is gone and this
          scene has to point at the select instead — named rather than
          left to time out.
        */
        const note = dialog.getByText(/No other DRAFT manifest/);
        if ((await note.count()) === 0) {
          throw new Error(
            'A second DRAFT manifest exists, so the "nowhere to move it" note the narration ' +
              'reads is not on screen — point at the target picker instead.',
          );
        }
        await stage.dwellOn(note, 3200);
      },

      async why({ page, stage }) {
        await stage.dwellOn(page.getByRole('dialog').locator('.sk-dialog__body').first(), 3200);
      },

      async close({ page, stage }) {
        await stage.clickIt(
          page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).first(),
          { after: 1000 },
        );
        // NOT PRESSED: closing is irreversible and CUR-4 made it a
        // fallback rather than a step. The button is the subject; the
        // press is not.
        await stage.dwellOn(page.getByRole('button', { name: 'Close manifest' }), 3200);
      },

      async outro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/warehouse/manifests`, { waitUntil: 'domcontentloaded' });
        await draftManifestRow(page).waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(page.locator('.sk-table').first(), 3400);
      },
    },
  },

  'take-a-return-in': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/warehouse/rto`, { waitUntil: 'domcontentloaded' });
        /*
          D0's `RSH-LIFE-ATDOOR` is the only parcel that ever puts a row
          on this list — a return the courier has handed back that nobody
          has received — and it is reached by the CUSTOMER's name, since
          both numbers on the row are minted per run. The seeding retires
          and rebuilds it after a take spends it (`spendable: true`).
        */
        await atDoorRow(page).waitFor({ state: 'visible', timeout: 25_000 });
        const waiting = await page.locator('.sk-tbody .sk-tr').count();
        if (waiting !== 1) {
          throw new Error(
            `${waiting} parcel(s) are at our door, expected exactly 1 — the flow receives ` +
              'whichever is first, so a second would be taken in on camera without being narrated.',
          );
        }
        await page.waitForTimeout(600);
        await stage.dwellOn(rtoTabs(page), 2800);
      },

      async door({ page, stage }) {
        // The tab panel's own sentence about how a parcel gets off this
        // list, which is what the narration reads rather than restates.
        await stage.dwellOn(page.locator('.wh-rto-panel > .wh-note').first(), 3200);
      },

      async why({ page, stage }) {
        await stage.dwellOn(atDoorRow(page), 3200);
      },

      async transit({ page, stage }) {
        await stage.clickIt(rtoTab(page, 'Still with the courier'), { after: 1400 });
        await page
          .locator('.sk-tbody .sk-tr')
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(page.locator('.sk-table').first(), 3000);
      },

      async bench({ page, stage }) {
        await stage.clickIt(rtoTab(page, 'On the bench'), { after: 1400 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.wh-stack').first(), 3000);
      },

      async pick({ page, stage }) {
        await stage.clickIt(rtoTab(page, 'At our door'), { after: 1200 });
        await atDoorRow(page).waitFor({ state: 'visible', timeout: 20_000 });
        /*
          THE WAYBILL IS A BUTTON. Clicking it fills the receive box and
          moves to the Receive tab in one act — which is the whole point
          of the control, and is what the narration is about.
        */
        await stage.clickIt(atDoorRow(page).locator('button.wh-awb-pick'), { after: 1400 });
        const field = page.getByLabel(/^AWB number/);
        await field.waitFor({ state: 'visible', timeout: 20_000 });
        const typed = (await field.inputValue()).trim();
        if (!/^\d{6,}$/.test(typed)) {
          throw new Error(`Clicking the waybill put "${typed}" in the receive box.`);
        }
        await stage.dwellOn(field, 2800);
      },

      async receive({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Receive', exact: true }), {
          after: 1800,
        });
        await page
          .getByText(/Shipment/)
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.wh-title').first(), 2800);
      },

      async hold({ page, stage }) {
        await stage.dwellOn(page.locator('.wh-card').last(), 3200);
      },

      async lines({ page, stage }) {
        const lines = page.locator('.wh-stack--tight > *');
        const n = await lines.count();
        if (n === 0) {
          throw new Error('The received parcel shows no lines to inspect.');
        }
        await stage.dwellOn(lines.first(), 3200);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.locator('.wh-card').last(), 3400);
      },
    },
  },

  'inspect-and-finalise-a-return': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage, baseUrl }) {
        /*
          STRAIGHT TO THE BENCH. The tab lives in the URL on purpose
          ("look at this one" is a link somebody sends), so the video
          opens where K1 left off rather than clicking its way there.

          `returnsBenchWorldFor` receives `RSH-LIFE-ATDOOR` and then
          asserts the whole box holds exactly ONE return with lines
          still to inspect; this re-asserts it from the SCREEN, because
          the flow works whichever row is first and a second would be
          finalised on camera without being narrated.
        */
        await page.goto(`${baseUrl}/warehouse/rto?tab=bench`, { waitUntil: 'domcontentloaded' });
        await benchRow(page).waitFor({ state: 'visible', timeout: 25_000 });
        const open = await page.locator('.sk-tbody .sk-tr').count();
        if (open !== 1) {
          throw new Error(
            `${open} return(s) are on the bench, expected exactly 1 \u2014 the flow opens the first.`,
          );
        }
        await page.waitForTimeout(500);
        await stage.dwellOn(page.locator('.sk-table').first(), 3000);
      },

      async open({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Work it' }), { after: 1600 });
        await rtoLine(page).waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(rtoLine(page), 3000);
      },

      async where({ page, stage }) {
        // The parcel's header: its number, how many lines, and the
        // status chip that says it has been taken in — which is the act
        // that booked the units into the hold the narration is about.
        await stage.dwellOn(page.locator('.wh-row--between').first(), 3200);
      },

      async condition({ page, stage }) {
        const field = page.getByLabel(/^Condition$/);
        await stage.point(field);
        await field.selectOption('DAMAGED');
        await page.waitForTimeout(500);
        /*
          GATED ON THE SENTENCE THE NARRATION QUOTES, not on the field:
          the line says a damaged unit opens a claim with the seller,
          and that is the field's own hint rather than anything this
          video invented.
        */
        const hint = page.getByText(/opens a damage ticket to the seller/i).first();
        await hint.waitFor({ state: 'visible', timeout: 15_000 });
        await stage.dwellOn(hint, 3000);
      },

      async choices({ page, stage }) {
        await stage.point(page.getByLabel(/^What happens to it$/));
        await page.waitForTimeout(700);
        // The screen's OWN account of the four choices, which is what
        // the narration tells the viewer to read.
        await stage.clickIt(page.getByText('What each choice does').first(), { after: 900 });
        const panel = page.locator('.wh-details p').first();
        await panel.waitFor({ state: 'visible', timeout: 15_000 });
        await stage.dwellOn(panel, 3200);
      },

      async mismatch({ page, stage }) {
        const field = page.getByLabel(/^What happens to it$/);
        await stage.point(field);
        await field.selectOption('RESTOCK');
        /*
          THE NOTICE, NOT THE FIELD. `dispositionMismatch` says a
          damaged unit put back in stock will be sold to the next
          customer — and says it WITHOUT refusing, which is the whole
          point of the scene. Gating on the field would pass against a
          build that had quietly stopped warning.
        */
        const notice = page.locator('.sk-field__msg[data-kind="notice"]').first();
        await notice.waitFor({ state: 'visible', timeout: 15_000 });
        await page.waitForTimeout(400);
        await stage.dwellOn(notice, 3200);
      },

      async split({ page, stage }) {
        /*
          THIS BUTTON ONLY EXISTS ON A LINE OF MORE THAN ONE UNIT
          (`split === null && item.quantity > 1`), which is why
          `RSH-LIFE-ATDOOR` carries two — see its note in
          lib/lifecycle.mjs. On a one-unit line the whole half of the
          bench this video is about is not on the screen at all.
        */
        await stage.clickIt(page.getByRole('button', { name: 'Split by quantity' }), {
          after: 1200,
        });
        await splitBlock(page).waitFor({ state: 'visible', timeout: 15_000 });
        await stage.dwellOn(splitBlock(page), 3000);
      },

      async arith({ page, stage }) {
        const counter = splitBlock(page).locator('> p.wh-note').first();
        await counter.waitFor({ state: 'visible', timeout: 15_000 });
        const said = (await counter.innerText()).trim();
        if (!/units? (have a decision|still need a decision)|more than the/i.test(said)) {
          throw new Error(`The split counter reads "${said}", which is not the arithmetic line.`);
        }
        await stage.dwellOn(counter, 3200);
      },

      async good({ page, stage }) {
        // Row one inherited the whole-line verdict, mismatch and all.
        // Correcting the condition is what clears the warning, which is
        // exactly what the narration says happens.
        const row = splitRow(page, 0);
        const field = row.getByLabel(/^Condition, row 1$/);
        await stage.point(field);
        await field.selectOption('GOOD');
        await page.waitForTimeout(600);
        if ((await row.locator('.sk-field__msg[data-kind="notice"]').count()) > 0) {
          throw new Error('Row one still carries a mismatch warning after being set to Good.');
        }
        const effect = row.locator('> p.wh-note').first();
        await effect.waitFor({ state: 'visible', timeout: 15_000 });
        await stage.dwellOn(effect, 2800);
      },

      async aside({ page, stage }) {
        const row = splitRow(page, 1);
        await row.getByLabel(/^Condition, row 2$/).selectOption('DAMAGED');
        await page.waitForTimeout(300);
        const what = row.getByLabel(/^What happens to them, row 2$/);
        await stage.point(what);
        await what.selectOption('HOLD_DAMAGED');
        const effect = row.locator('> p.wh-note').first();
        await effect.waitFor({ state: 'visible', timeout: 15_000 });
        await page.waitForTimeout(400);
        const said = (await effect.innerText()).trim();
        if (!/Damaged bin/i.test(said)) {
          throw new Error(`Row two's effect line reads "${said}" \u2014 expected the Damaged bin.`);
        }
        await stage.dwellOn(effect, 3000);
      },

      async save({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Save inspection' }), { after: 1600 });
        /*
          THE TAG, NOT THE TOAST. "Inspected" is written on the line and
          stays there; the toast is four and a half seconds of unpaused
          time and this scene has somewhere else to be.
        */
        const tag = rtoLine(page).locator('.wh-tag', { hasText: 'Inspected' }).first();
        await tag.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(500);
        await stage.dwellOn(tag, 2800);
      },

      async confirm({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Finalize disposition' }), {
          after: 1200,
        });
        const said = page.locator('.sk-confirm__consequence').first();
        await said.waitFor({ state: 'visible', timeout: 15_000 });
        const words = (await said.innerText()).trim();
        if (!/cannot be undone/i.test(words)) {
          throw new Error(`The confirm reads "${words}" \u2014 the narration quotes the warning.`);
        }
        await stage.dwellOn(said, 3400);
      },

      async press({ page, stage }) {
        await stage.clickIt(
          dialogFoot(page).getByRole('button', { name: 'Finalize disposition' }),
          {
            after: 1400,
          },
        );
        /*
          THE TOAST CANNOT BE HELD ON THIS SCREEN, and that is a fact
          about WHICH toast it uses rather than about the trick.

          The hover-pause every other flow leans on belongs to
          `@skydrop/ui/app/toast` (`usePausableTimer`, `data-paused`).
          The RTO station imports `useToast` from
          `@skydrop/ui/components` — the LEGACY provider, which is a
          bare `setTimeout(…, 3500)` with no pointer handler at all — so
          pointing at it does nothing and it is gone 3.5 s after it
          appears, whatever the pointer is doing. Nineteen admin files
          are still on that provider. Found here by the check frame
          showing an empty panel under a line about what the toast said.

          So the scene reads the toast INSIDE its life and then lands on
          the durable half: the station has let the parcel go, which is
          on screen from the same instant and stays.
        */
        const toast = page.getByText(/put back in stock/i).first();
        await toast.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.dwellOn(toast, 1900);
        const done = page.getByText('No shipment selected').first();
        await done.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(done, 2600);
      },

      async outro({ page, stage }) {
        /*
          THE BENCH IS EMPTY, which is the proof the parcel is finished
          with — and the station's worklists refetch themselves now, so
          this needs no reload.
        */
        await stage.clickIt(rtoTab(page, 'On the bench'), { after: 1400 });
        const empty = page.getByText(/Nothing waiting/i).first();
        await empty.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(page.locator('.sk-table').first(), 3400);
      },
    },
  },

  'correct-a-count': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/inventory/adjustments`, { waitUntil: 'domcontentloaded' });
        /*
          IT OPENS ON PENDING, which is the whole argument of the screen
          — everything else is history and only this is a job. The
          seeding puts exactly one row here and asserts it came back
          PENDING rather than auto-executing; this re-asserts it from the
          SCREEN, because the flow reviews whichever row is first.
        */
        await reviewButton(page).waitFor({ state: 'visible', timeout: 25_000 });
        const waiting = await page.locator('.sk-tbody .sk-tr').count();
        if (waiting !== 1) {
          throw new Error(
            `${waiting} adjustment(s) are waiting for approval, expected exactly 1 — the flow ` +
              'approves the first, and a second would move stock on camera unnarrated.',
          );
        }
        await page.waitForTimeout(500);
        await stage.dwellOn(page.locator('.sk-table').first(), 3000);
      },

      async tiles({ page, stage }) {
        await stage.dwellOn(page.locator('.stk-kpis').first(), 3200);
      },

      async open({ page, stage }) {
        await stage.clickIt(reviewButton(page), { after: 1400 });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(500);
        await stage.dwellOn(dialog, 2800);
      },

      async facts({ page, stage }) {
        /*
          THE SNAPSHOTTED THRESHOLD is the line the narration is about,
          and it is a fact on the row rather than a setting read now — so
          the gate is its LABEL inside the dialog, which is absent if the
          column is ever dropped.
        */
        const facts = page.getByRole('dialog').locator('.stk-dl').first();
        await facts.waitFor({ state: 'visible', timeout: 20_000 });
        const said = await facts.innerText();
        if (!/Approval threshold/i.test(said)) {
          throw new Error('The review panel does not state the threshold it was measured against.');
        }
        await stage.dwellOn(facts, 3600);
      },

      async why({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await stage.dwellOn(dialog.getByText(/Recounted twice by two people/i).first(), 2400);
        await stage.dwellOn(dialog.getByRole('table').first(), 2800);
      },

      async choices({ page, stage }) {
        await stage.dwellOn(dialogFoot(page), 3400);
      },

      async approve({ page, stage }) {
        await stage.clickIt(dialogFoot(page).getByRole('button', { name: /^Approve/ }), {
          after: 1600,
        });
        /*
          THE DIALOG CLOSING IS THE SIGNAL, not the toast: approving
          enqueues the executor, so the row becomes APPROVED and then
          EXECUTED a moment later, and a gate on either word is a race.
          The queue going empty is the durable fact and it is what the
          next scene opens on.
        */
        const gone = page.getByText(/Nothing waiting/i).first();
        await gone.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(gone, 2800);
      },

      async history({ page, stage }) {
        await stage.point(page.locator('#adj-status'));
        await page.locator('#adj-status').selectOption('');
        await page.waitForTimeout(900);
        const rows = page.locator('.sk-tbody .sk-tr');
        await rows.first().waitFor({ state: 'visible', timeout: 20_000 });
        const n = await rows.count();
        if (n < 3) {
          throw new Error(
            `Only ${n} adjustment(s) in the whole history — the line is about the settled ones ` +
              'sitting beside the approved one, so the seeding has not written them.',
          );
        }
        await stage.dwellOn(page.locator('.sk-table').first(), 3200);
      },

      async form({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'New adjustment' }), { after: 1400 });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        // The four identifiers and the sentence under them that says why
        // they are typed rather than picked.
        const grain = dialog.getByText(/read them off the count sheet/i).first();
        await grain.waitFor({ state: 'visible', timeout: 15_000 });
        await stage.dwellOn(grain, 3400);
        // Dismissed HERE so the next scene opens on a page rather than a
        // closing modal.
        await stage.clickIt(dialogFoot(page).getByRole('button', { name: 'Cancel' }), {
          after: 900,
        });
      },

      async held({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/warehouse/bins`, { waitUntil: 'domcontentloaded' });
        const type = page.locator('#bc-type');
        await type.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.point(type);
        await type.selectOption('DAMAGED');
        await page.waitForTimeout(1200);
        const section = page.locator('.stk-section').first();
        const said = await section.innerText();
        if (!/RSH-JAMDANI-IVORY/.test(said)) {
          throw new Error(
            'Filtering the overview to damaged shows no line — `ensureDamagedBinStock` keeps a ' +
              'unit or two on that shelf and is what the next three scenes act on.',
          );
        }
        await stage.dwellOn(section, 3200);
      },

      async bin({ page, stage }) {
        /*
          THE BIN BY ITS CODE, which is COMPOSED from coordinates and not
          typed (BIN-4), so it is the one stable handle on this page —
          every id here is minted per box.
        */
        await stage.clickIt(page.getByRole('link', { name: 'D-01-01', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/warehouse\/bins\/[0-9a-f-]+$/, { timeout: 30_000 });
        await returnOrScrap(page).waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        /*
          `.stk-card`, which is what `Panel` renders — NOT `.sk-card`,
          and there is no `.stk-section` on this page at all. A miss
          arrived as a thirty-second `scrollIntoViewIfNeeded` timeout on
          a page that was plainly loaded, which is the shape a selector
          miss takes here (see the README). The card carries both halves
          of the line: the "not pickable" sentence and the row.
        */
        const card = page.locator('.stk-card').first();
        const said = await card.innerText();
        /*
          THE CARD'S OWN SENTENCE, not the page header's. The header
          subtitle says "· Damaged · not pickable" and the card says
          "Nothing is picked from a damaged bin" — both true, and the
          halo is on the card, so gating on the header would pass while
          filming something that did not say it.
        */
        if (!/Nothing is picked from a damaged bin/i.test(said)) {
          throw new Error(
            `The bin card reads "${said.slice(0, 120)}" — expected it to say nothing is picked ` +
              'from a damaged bin.',
          );
        }
        await stage.dwellOn(card, 3000);
      },

      async prefilled({ page, stage }) {
        await stage.clickIt(returnOrScrap(page), { after: 1800 });
        await page.waitForURL(/\/inventory\/adjustments\?/, { timeout: 30_000 });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 25_000 });
        /*
          GATED ON THE REASON, not on the dialog. The link carries a
          whole line AND a reason chosen from the bin's TYPE
          (`adjustmentHref`), and a form that opened empty — or on the
          default "counting error" — would film a sentence about a choice
          already made for you.
        */
        const reason = dialog.getByLabel(/^Reason/);
        const chosen = await reason.inputValue();
        if (chosen !== 'RETURNED_TO_SELLER') {
          throw new Error(`The prefilled reason is "${chosen}", not returned to seller.`);
        }
        await stage.dwellOn(dialog.locator('.sk-field').first(), 2000);
        await stage.dwellOn(reason, 1800);
      },

      async cost({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await stage.typeIn(dialog.getByLabel(/^Quantity/), '1');
        /*
          THE UNIT COST FIELD. Without it this form could not be
          submitted at all for a batch with no recorded cost — which is
          most of them — because the value impact is what decides
          whether a second person is needed and the server refuses an
          adjustment it cannot price. Added 2026-10-01 while writing this
          video; see the curriculum's Bugs found.
        */
        await stage.typeIn(dialog.getByLabel(/^Unit cost/), '2400');
        await page.waitForTimeout(600);
        await stage.dwellOn(
          dialog.getByText(/decides whether this correction needs a second/i).first(),
          2600,
        );
      },

      async raise({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await stage.typeIn(
          dialog.getByLabel(/^What happened/),
          'Came back damaged and the seller asked for it back.',
        );
        await stage.clickIt(dialogFoot(page).getByRole('button', { name: /^Raise adjustment/ }), {
          after: 1600,
        });
        /*
          WHICH IT WAS is the line, and the toast is the only place that
          is said. This screen's toast is the NEW provider
          (`@skydrop/ui/app/toast`), so it pauses under the pointer —
          unlike the RTO station's, which is the legacy one. Read K2's
          entry before assuming either way.
        */
        const toast = page.locator('.sk-toast').first();
        await toast.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.point(toast);
        const said = await toast.innerText();
        if (!/Applied/i.test(said)) {
          throw new Error(`The adjustment came back "${said.trim()}" — expected it to apply.`);
        }
        await page.waitForTimeout(3200);
        await stage.clearHalo();
      },

      async outro({ page, stage }) {
        /*
          THE SCREEN'S OWN CLOSING SENTENCE. Raising the correction sent
          the page back to its default PENDING filter, and the empty
          state there says exactly what this video has been about —
          smaller corrections apply immediately, look under Executed for
          those — which is a better last frame than a row of zeroes.
        */
        const empty = page.getByText(/Smaller corrections apply immediately/i).first();
        await empty.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(500);
        await stage.dwellOn(empty, 3400);
      },
    },
  },

  'count-the-shelves': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
      /*
        THE COUNT SHEET. A cycle count is recorded per (variant, bin,
        batch) and the console prints those three ids nowhere together,
        so the video arrives holding them exactly as an operator does —
        off the sheet the floor walked with. `lib/fixture.mjs` says why
        this is not a back door for ordinary selectors; the narration
        says the same thing out loud.
      */
      ctx.sheet = await readFixture('count-the-shelves');
    },

    steps: {
      async intro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/inventory/cycle-counts`, { waitUntil: 'domcontentloaded' });
        const subtitle = page.locator('.sk-ph__subtitle').first();
        await subtitle.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(subtitle, 3000);
      },

      async tiles({ page, stage }) {
        await stage.dwellOn(page.locator('.stk-kpis').first(), 3000);
      },

      async schedule({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Schedule a count' }).first(), {
          after: 1400,
        });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        // The dialog's OWN promise, which is the line: scheduling changes
        // nothing until somebody starts it.
        const said = dialog.locator('.sk-dialog__desc').first();
        await said.waitFor({ state: 'visible', timeout: 15_000 });
        await stage.dwellOn(said, 2600);
        /*
          THE WAREHOUSE BY ITS CODE, read off the option rather than
          restated: the label is `<name> (<code>)` and spelling it out
          here would break on a rename with a message about a missing
          option.
        */
        const option = page.locator('#cc-wh option', { hasText: 'CCU-01' }).first();
        await option.waitFor({ state: 'attached', timeout: 15_000 });
        const value = await option.getAttribute('value');
        await stage.point(page.locator('#cc-wh'));
        await page.locator('#cc-wh').selectOption(value ?? '');
        await page.waitForTimeout(500);
      },

      async scope({ page, stage }) {
        await stage.dwellOn(page.locator('#cc-type'), 2600);
        await stage.clickIt(dialogFoot(page).getByRole('button', { name: /^Schedule$/ }), {
          after: 1800,
        });
        await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 25_000 });
      },

      async open({ page, stage }) {
        const row = scheduledCountRow(page);
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        const n = await page.locator('.sk-tbody .sk-tr', { hasText: 'scheduled' }).count();
        if (n !== 1) {
          throw new Error(
            `${n} count(s) are scheduled, expected exactly 1 — the flow opens the first, and a ` +
              'leftover from an earlier take would be worked on camera instead.',
          );
        }
        await stage.clickIt(row.getByRole('button', { name: 'Open' }), { after: 1600 });
        await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(500);
        await stage.dwellOn(dialogFoot(page), 2400);
      },

      async start({ page, stage }) {
        await stage.clickIt(dialogFoot(page).getByRole('button', { name: /^Start counting/ }), {
          after: 1800,
        });
        /*
          GATED ON THE SENTENCE, not the panel. "System quantity is
          snapshotted when you record, not when the count was scheduled"
          is the whole of this scene, and the panel renders with or
          without it.
        */
        const note = page.getByText(/snapshotted when you record/i).first();
        await note.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.dwellOn(note, 3000);
      },

      async ids({ page, stage, sheet }) {
        const dialog = page.getByRole('dialog');
        // Briskly: this is three uuids and a video, not a typing test.
        const fast = { delay: 16, after: 200 };
        await stage.typeIn(dialog.locator('#cc-variant'), sheet.variantId, fast);
        await stage.typeIn(dialog.locator('#cc-bin'), sheet.binId, fast);
        await stage.typeIn(dialog.locator('#cc-batch'), sheet.batchId, fast);
        await page.waitForTimeout(500);
      },

      async record({ page, stage, sheet }) {
        const dialog = page.getByRole('dialog');
        // ONE SHORT. The whole video turns on a difference existing.
        await stage.typeIn(dialog.locator('#cc-qty'), String(sheet.qtyOnHand - 1), { delay: 90 });
        await stage.clickIt(dialog.getByRole('button', { name: /^Record line/ }), { after: 1800 });
        const table = dialog.getByRole('table').first();
        await table.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(table, 2600);
      },

      async diff({ page, stage }) {
        const said = page.getByText(/differ from the system/i).first();
        await said.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(said, 1800);
        /*
          AND THE COLUMNS THE LINE IS ABOUT, which are off to the right.

          Two uuid columns at the front of that table are wider than a
          dialog, so System, Counted and Difference start out of frame.
          The table scrolls — `.sk-table-wrap` is `overflow-x: auto` and
          that is deliberate, not a defect — so the scene scrolls it, the
          way the person reading it would. Smoothly: a jump reads as a
          glitch in a recording.
        */
        const wrap = page.getByRole('dialog').locator('.sk-table-wrap').first();
        await wrap.evaluate((el) => el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' }));
        await page.waitForTimeout(900);
        await stage.dwellOn(wrap, 2400);
      },

      async button({ page, stage }) {
        /*
          THE LABEL IS THE SCENE. It counts the corrections it is about
          to raise, so a gate on the word "Complete" alone would pass
          against a button that had stopped doing the arithmetic.
        */
        const complete = dialogFoot(page).getByRole('button', { name: /^Complete — raises/ });
        await complete.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(complete, 3200);
      },

      async complete({ page, stage }) {
        await stage.clickIt(dialogFoot(page).getByRole('button', { name: /^Complete — raises/ }), {
          after: 1800,
        });
        await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 25_000 });
        const row = page.locator('.sk-tbody .sk-tr', { hasText: 'completed' }).first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(page.locator('.sk-table').first(), 2800);
      },

      async queue({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/inventory/adjustments`, { waitUntil: 'domcontentloaded' });
        const row = page.locator('.sk-tbody .sk-tr').first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        const said = await row.innerText();
        /*
          IT IS WAITING, AND IT IS PRICED AT NOTHING — both narrated, so
          both gated. A cycle count's adjustment is created PENDING
          whatever it is worth (`CycleCountService.complete` snapshots
          the threshold and never compares it), and the batch carries no
          unit cost, so the impact is zero. If a later box records costs
          this fails loudly and the line gets rewritten, which is the
          point of asking.
        */
        if (!/Pending/i.test(said)) {
          throw new Error(`The adjustment the count raised reads "${said}" — expected Pending.`);
        }
        if (!/₹0/.test(said)) {
          throw new Error(
            `The adjustment reads "${said}" — the narration says it is priced at nothing ` +
              'because the batch has no recorded cost.',
          );
        }
        await page.waitForTimeout(500);
        await stage.dwellOn(page.locator('.sk-table').first(), 3000);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 3200);
      },
    },
  },
  /*
    N1 — the money desk, read-only.

    TWO screens and not one click that writes anything, which is the
    whole argument for it being first in section N: every other video in
    the section writes to what this one reads.

    A KPI tile is reached through its OWN label element and not through
    `hasText` on the card: `hasText` is a case-insensitive SUBSTRING, and
    "Balance" is inside "Balance, less the floor and anything already
    requested" on the tile beside it — so the unscoped form matches two
    cards and `.first()` quietly takes whichever the grid puts first.
  */
  'how-seller-money-works': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
      await ctx.page.goto(`${ctx.baseUrl}/seller-wallets`, { waitUntil: 'domcontentloaded' });
      await ctx.page.waitForLoadState('networkidle').catch(() => {});
    },

    steps: {
      async intro({ page, stage }) {
        await page.getByRole('heading', { name: 'Seller wallets', exact: true }).first().waitFor({
          state: 'visible',
          timeout: 25_000,
        });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.locator('.sk-kpis, .mk-kpis').first(), 2600);
      },

      async owed({ page, stage }) {
        await stage.dwellOn(moneyKpi(page, 'We owe sellers'), 2400);
        await stage.dwellOn(moneyKpi(page, 'Sellers owe us'), 2600);
      },

      async 'not-yet'({ page, stage }) {
        await stage.dwellOn(moneyKpi(page, 'Withdrawals held'), 2600);
        await stage.dwellOn(moneyKpi(page, 'Top-ups in review'), 2800);
      },

      async row({ page, stage }) {
        const table = page.locator('table').filter({ hasText: 'Available balance' }).first();
        await table.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(table, 2200);
        const open = page.getByRole('link', { name: /Ledger/ }).first();
        await stage.clickIt(open, { after: 1500 });
        await page.waitForURL(/\/seller-wallets\/[0-9a-f-]{36}$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
      },

      async balance({ page, stage }) {
        await stage.dwellOn(moneyKpi(page, 'Balance'), 2200);
        await stage.dwellOn(moneyKpi(page, 'Available to withdraw'), 2600);
      },

      async held({ page, stage }) {
        const card = moneyCard(page, 'Where their money is held');
        await card.waitFor({ state: 'visible', timeout: 25_000 });
        await card.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(card, 4200);
      },

      async rules({ page, stage }) {
        const card = moneyCard(page, 'Wallet rules for this seller');
        await card.waitFor({ state: 'visible', timeout: 25_000 });
        await card.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(card, 4600);
      },

      /*
        The ledger table itself. Gated on a row TYPE rather than on the
        card, because the card renders its own empty state just as
        happily and a video about six kinds of line cannot open on
        "nothing moved yet".
      */
      async ledger({ page, stage }) {
        const table = page.locator('table').filter({ hasText: 'Balance after' }).first();
        await table.waitFor({ state: 'visible', timeout: 25_000 });
        await table.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await ledgerRow(page, 'Wallet top-up');
        await page.waitForTimeout(600);
        await stage.dwellOn(table, 3400);
      },

      async topup({ page, stage }) {
        await stage.dwellOn(await ledgerRow(page, 'Wallet top-up'), 4200);
      },

      async cod({ page, stage }) {
        await stage.dwellOn(await ledgerRow(page, 'COD collected'), 4600);
      },

      async gst({ page, stage }) {
        await stage.dwellOn(await ledgerRow(page, 'COD tax deduction'), 4400);
      },

      async charges({ page, stage }) {
        await stage.dwellOn(await ledgerRow(page, 'Order charges'), 2400);
        await stage.dwellOn(await ledgerRow(page, 'Return fee'), 3000);
      },

      async refund({ page, stage }) {
        await stage.dwellOn(await ledgerRow(page, 'Damage settlement'), 4200);
      },

      async tabs({ page, stage }) {
        await stage.clickIt(page.getByRole('tab', { name: 'Top-ups' }).first(), { after: 1600 });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.locator('table').first(), 2600);
        await stage.clickIt(page.getByRole('tab', { name: 'Withdrawal requests' }).first(), {
          after: 1600,
        });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.locator('table').first(), 2600);
      },

      async outro({ page, stage }) {
        await stage.clickIt(page.getByRole('tab', { name: 'Ledger' }).first(), { after: 1400 });
        await page.waitForTimeout(800);
        await stage.dwellOn(
          page.locator('table').filter({ hasText: 'Balance after' }).first(),
          3400,
        );
      },
    },
  },
  /*
    N9 — how much of the P&L is measured.

    Two screens, no clicks that write anything, and every scene gated on
    the SENTENCE the narration quotes rather than on the panel holding
    it: three of these lines render an identical-looking row whether or
    not their coverage note exists, and a video whose whole subject is
    the honesty of the page cannot film the version with nothing to be
    honest about.
  */
  'is-the-money-picture-true': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
      await ctx.page.goto(`${ctx.baseUrl}/pnl`, { waitUntil: 'domcontentloaded' });
      await ctx.page.waitForLoadState('networkidle').catch(() => {});
    },

    steps: {
      async intro({ page, stage }) {
        await page
          .getByRole('heading', { name: 'Profit & loss', exact: true })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(1200);
        await stage.dwellOn(page.locator('.mo-kpis').first(), 2800);
      },

      async headline({ page, stage }) {
        await stage.dwellOn(moneyKpi(page, 'Gross margin'), 2000);
        await stage.dwellOn(moneyKpi(page, 'Net'), 2600);
      },

      /*
        The callout's own words. It only renders when something IS
        uncovered, which is the state this video is about — so gating on
        it is also the assertion that the world is the right one.
      */
      async honest({ page, stage }) {
        const note = page.getByText(/nothing here is guessed to fill the gap/i).first();
        await note.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.dwellOn(note, 4200);
      },

      async sources({ page, stage }) {
        const section = page.locator('.sk-acc').first();
        await section.waitFor({ state: 'visible', timeout: 25_000 });
        await section.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(pnlLine(page, 'India delivery').locator('.pl-cover').first(), 3400);
      },

      async delivery({ page, stage }) {
        await stage.dwellOn(
          pnlLine(page, 'India delivery').locator('.pl-line__note').first(),
          5000,
        );
      },

      async quoted({ page, stage }) {
        const note = pnlLine(page, 'India delivery').locator('.pl-line__note').first();
        // The sentence this scene is about, asserted rather than assumed:
        // a window with nothing merely quoted renders the same note
        // without it, and the line would be spoken over a paragraph that
        // does not say it.
        const words = await note.innerText();
        if (!/quoted, not billed/i.test(words)) {
          throw new Error(`The delivery line's note does not mention quoted charges: ${words}`);
        }
        await stage.dwellOn(note, 4600);
      },

      async open({ page, stage }) {
        await stage.dwellOn(
          pnlLine(page, 'India delivery').locator('.pl-line__note').first(),
          4800,
        );
      },

      async returns({ page, stage }) {
        const line = pnlLine(page, 'Returns');
        await line.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(600);
        await stage.dwellOn(line.locator('.pl-line__note').first(), 4400);
      },

      async lines({ page, stage }) {
        await stage.glide(520);
        await stage.dwellOn(pnlLine(page, 'Damage & loss refunds to sellers'), 2400);
        await stage.dwellOn(pnlLine(page, 'Courier COD fees'), 2400);
      },

      /*
        Opening a line. `.pl-drill` is mounted only while the item is
        open and its rows are fetched then, so the wait is on the rows
        rather than on the click — the panel exists a moment before the
        records behind it do.
      */
      async drill({ page, stage }) {
        const line = pnlLine(page, 'Returns');
        await line.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await stage.clickIt(line.locator('.sk-acc__trigger').first(), { after: 1600 });
        const basis = page.locator('.pl-basis').first();
        await basis.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.dwellOn(basis, 2600);
        const rows = page.locator('.pl-rows').first();
        await rows.waitFor({ state: 'visible', timeout: 25_000 });
        await rows.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(600);
        await stage.dwellOn(rows, 2800);
      },

      async costsync({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/cost-sync`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        const sub = page.getByText(/download their wallet export/i).first();
        await sub.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.dwellOn(sub, 3600);
      },

      async silence({ page, stage }) {
        await stage.dwellOn(page.getByText(/the way this fails is silence/i).first(), 2600);
        // The card's own state line — whichever of the three it is. The
        // sentence is the subject, not the switch being off.
        await stage.dwellOn(page.locator('.cs-with-icon').first(), 2600);
      },

      async counts({ page, stage }) {
        await stage.dwellOn(moneyKpi(page, 'Parcels with a real cost'), 2400);
        await stage.dwellOn(moneyKpi(page, 'Returns with a real cost'), 2600);
      },

      async runs({ page, stage }) {
        const empty = page.getByText(/it has never finished far enough to say so/i).first();
        await empty.waitFor({ state: 'visible', timeout: 25_000 });
        await empty.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(empty, 4200);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(moneyKpi(page, 'Forward cost recorded'), 3600);
      },
    },
  },
  /*
    N2 — accepting a top-up, which IS the credit.

    The take SPENDS the claim it accepts, which is why its seeding makes
    two: one to credit on camera, and one left for the refusal scene to
    point at. Each row is reached by the AMOUNT printed on it — the
    reference is minted per run, deliberately, because two claims sharing
    one would teach the opposite of what this video says about matching,
    and nothing else on a claim is both stable and visible.
  */
  'accept-a-top-up': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
      await ctx.page.goto(`${ctx.baseUrl}/topups`, { waitUntil: 'domcontentloaded' });
      await ctx.page.waitForLoadState('networkidle').catch(() => {});
    },

    steps: {
      async intro({ page, stage }) {
        await page
          .getByRole('heading', { name: 'Wallet top-ups', exact: true })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        // Both claims, so the scene opens on a QUEUE. Gated on the second
        // as well as the first: with one row this video's last act has
        // nothing to point at, and an empty queue renders a perfectly
        // calm page that says nothing is wrong.
        await claimRow(page, TOPUP_TO_ACCEPT).waitFor({ state: 'visible', timeout: 25_000 });
        await claimRow(page, TOPUP_TO_REFUSE).waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(page.getByText(/check it against the statement first/i).first(), 2800);
      },

      async stakes({ page, stage }) {
        await stage.dwellOn(page.locator('table').first(), 3400);
      },

      async row({ page, stage }) {
        await stage.dwellOn(claimRow(page, TOPUP_TO_ACCEPT), 4000);
      },

      async account({ page, stage }) {
        await stage.dwellOn(claimRow(page, TOPUP_TO_ACCEPT).locator('td').nth(2), 4200);
      },

      async evidence({ page, stage }) {
        await stage.dwellOn(claimRow(page, TOPUP_TO_ACCEPT).locator('td').nth(4), 4200);
      },

      async statement({ page, stage }) {
        await stage.dwellOn(claimRow(page, TOPUP_TO_ACCEPT).locator('td').nth(4), 4600);
      },

      /*
        The accept, and the one piece of state this flow carries forward.

        AN ACCEPTED CLAIM IS HISTORY AND THE SEED LEAVES IT ALONE — correctly:
        it credited real money, and deleting it would leave a TOPUP ledger row
        whose claim does not exist. So the Credited tab grows by one ₹18,000
        row per take, and `claimRow`'s `.first()` then halos the row a PREVIOUS
        take credited rather than the one just pressed. Every step still
        passes and the frame still looks right — same seller, same amount, the
        same note typed by the same flow — but the REFERENCE under the halo is
        not the one the dialog named a moment earlier, and this video's whole
        subject is that the reference is what a claim is matched on.

        So the reference is read off the dialog — which is exactly what the
        operator reads — and the closing scene reaches for THAT row.
      */
      async accept(ctx) {
        const { page, stage } = ctx;
        await stage.clickIt(
          claimRow(page, TOPUP_TO_ACCEPT).getByRole('button', { name: 'Accept' }).first(),
          { after: 1400 },
        );
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(600);
        const subject = dialog.locator('.mk-subject').first();
        const ref = (await subject.innerText()).match(/ref\s+(\S+)/)?.[1];
        if (ref === undefined) {
          throw new Error(
            'The accept dialog names no reference — its subject line reads ' +
              `"${await subject.innerText()}". The closing scene reaches for the ` +
              'credited row by it.',
          );
        }
        ctx.acceptedRef = ref;
        await stage.dwellOn(subject, 3200);
      },

      async warning({ page, stage }) {
        await stage.dwellOn(
          page
            .getByRole('dialog')
            .getByText(/not reversible without an adjusting entry/i)
            .first(),
          4200,
        );
      },

      async note({ page, stage }) {
        const field = page.getByRole('dialog').getByRole('textbox').first();
        await stage.typeIn(field, 'Seen on the HDFC statement, 1 Oct, same reference.', {
          after: 600,
        });
        await page.waitForTimeout(1200);
      },

      /*
        The press. `AsyncButton` relabels itself through busy → done, so
        the wait is on the DIALOG going away rather than on the button —
        a button that has become "Credited" is still a button with a
        different name, and reaching for it again would find nothing.
      */
      async credit({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await stage.clickIt(
          dialog.getByRole('button', { name: /Credit the wallet|Credited|Working/ }).first(),
          { after: 1800 },
        );
        await dialog.waitFor({ state: 'detached', timeout: 25_000 });
        await page.waitForTimeout(800);
      },

      async credited({ page, stage, acceptedRef }) {
        await page
          .getByLabel(/^Status$/)
          .first()
          .selectOption('ACCEPTED');
        await page.waitForLoadState('networkidle').catch(() => {});
        // By the reference the dialog named, never by the amount: see
        // `accept`. A reference is minted per run, so one row or none.
        const row = page.getByRole('row').filter({ hasText: acceptedRef });
        await row.first().waitFor({ state: 'visible', timeout: 25_000 });
        const found = await row.count();
        if (found !== 1) {
          throw new Error(
            `${found} credited claims carry the reference ${acceptedRef}; it is ` +
              'minted per run and the halo means this one.',
          );
        }
        await page.waitForTimeout(700);
        await stage.dwellOn(row.locator('td').nth(5), 4200);
      },

      async reject({ page, stage }) {
        await page
          .getByLabel(/^Status$/)
          .first()
          .selectOption('PENDING');
        await page.waitForLoadState('networkidle').catch(() => {});
        const row = claimRow(page, TOPUP_TO_REFUSE);
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.clickIt(row.getByRole('button', { name: 'Reject' }).first(), { after: 1400 });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(dialog.getByText(/the seller sees this reason/i).first(), 3600);
      },

      /*
        Closed from the FOOTER. Every `Dialog` header carries an X with
        `aria-label="Close"` beside whatever the footer holds, so the
        unscoped reach dies on strict mode — and a dialog left open would
        put the next video's first frame behind a modal if anything ever
        followed this one.
      */
      async outro({ page, stage }) {
        await page
          .getByRole('dialog')
          .locator('.sk-dialog__foot')
          .getByRole('button', { name: 'Cancel' })
          .first()
          .click();
        await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 20_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(claimRow(page, TOPUP_TO_REFUSE), 3400);
      },
    },
  },
  /*
    N3 — approving a withdrawal, then paying it.

    TWO screens because the product deliberately splits the act in two:
    `/withdrawals` decides, `/remittances` pays, and only the second
    moves money (WAL-3). The take SPENDS both halves — the request ends
    PAID and a remittance exists — so its seeding removes the previous
    take's request and raises a fresh one.

    The request is reached by its AMOUNT. The seller's name is on every
    row of a one-seller demo world, and the id is minted per run.
  */
  'pay-a-seller-out': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
      await ctx.page.goto(`${ctx.baseUrl}/withdrawals`, { waitUntil: 'domcontentloaded' });
      await ctx.page.waitForLoadState('networkidle').catch(() => {});
    },

    steps: {
      async intro({ page, stage }) {
        await page
          .getByRole('heading', { name: 'Withdrawals', exact: true })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await payoutRow(page).waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.getByText(/Nothing here moves money/i).first(), 3000);
      },

      async request({ page, stage }) {
        await stage.dwellOn(payoutRow(page), 4200);
      },

      async rule({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-kpis, .mk-kpis').first(), 4400);
      },

      async approve({ page, stage }) {
        await stage.clickIt(payoutRow(page).getByRole('button', { name: 'Approve' }).first(), {
          after: 1500,
        });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(dialog, 2600);
      },

      async confirm({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await stage.dwellOn(dialog.getByText(/Nothing is paid yet/i).first(), 3200);
        await stage.clickIt(
          dialog
            .locator('.sk-dialog__foot')
            .getByRole('button', { name: /^Approve$/ })
            .first(),
          { after: 1800 },
        );
        await dialog.waitFor({ state: 'detached', timeout: 25_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
      },

      /*
        THE LIST OPENS ON PENDING AND NEVER LEAVES IT BY ITSELF. Approving
        is exactly what takes the request OUT of the filter the page
        opened on, so the row this scene is about has gone — which arrives
        as a thirty-second wait for a row that was on screen a moment ago
        rather than as anything about a filter. Drive the control.
      */
      async approved({ page, stage }) {
        await page
          .getByLabel(/^Status$/)
          .first()
          .selectOption('APPROVED');
        await page.waitForLoadState('networkidle').catch(() => {});
        const row = payoutRow(page);
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        // The state the narration names, not the row that holds it: a
        // failed approval leaves the row exactly where it was and the
        // scene would film "Pending" under a line about it being approved.
        await row
          .getByText(/approved/i)
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(row, 4000);
      },

      async remittances({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/remittances`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await stage.dwellOn(
          page.getByText(/debits the seller's wallet|debits the seller’s wallet/i).first(),
          2600,
        );
        await stage.clickIt(page.getByRole('button', { name: /^Pay$/ }).first(), { after: 1600 });
        await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(800);
      },

      async destination({ page, stage }) {
        const panel = page.getByRole('dialog').locator('.mk-panel').first();
        await panel.waitFor({ state: 'visible', timeout: 25_000 });
        await panel.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(600);
        await stage.dwellOn(panel.locator('.mk-panel__part').first(), 4600);
      },

      async cover({ page, stage }) {
        const parts = page.getByRole('dialog').locator('.mk-panel .mk-panel__part');
        await stage.dwellOn(parts.last(), 4800);
      },

      /*
        BDT, deliberately: a Bangladeshi seller is paid in taka out of
        the taka account, which is what makes the next two scenes about
        two currencies rather than one.

        AND NOTHING IS TYPED INTO THE AMOUNT. Opening the form from an
        approved request fills the source amount with that request's
        figure, so `typeIn` without `clear` APPENDED to it — 7500.00
        became 7500.007500, Chromium refused the form outright ("the two
        nearest valid values are 7500 and 7500.01"), and it presented
        three scenes later as the dialog simply never closing. The
        narration says the figure comes off the request, which is both
        true and the reason there is nothing to type.
      */
      async currencies({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await dialog
          .getByLabel(/Bank currency/)
          .first()
          .selectOption('BDT');
        await page.waitForTimeout(900);
        await stage.dwellOn(dialog.getByLabel(/^Source amount/).first(), 2600);
      },

      /*
        NO `$` ON EITHER OF THESE. `requiredMark` puts a `*` inside the
        label, so a required field's accessible name is `FX rate*` and an
        anchored-at-both-ends regex matches nothing at all — which arrives
        as a thirty-second scroll timeout on a field plainly in the frame.
      */
      async rate({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await stage.dwellOn(dialog.getByLabel(/^FX rate/).first(), 2600);
        await stage.dwellOn(dialog.getByLabel(/^Destination amount/).first(), 2800);
      },

      async fee({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await dialog
          .getByLabel(/^Paid from/)
          .first()
          .selectOption({ index: 1 });
        await page.waitForTimeout(600);
        await stage.typeIn(dialog.getByLabel(/^Bank fee/).first(), '250', { after: 600 });
        await page.waitForTimeout(900);
      },

      async reference({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await stage.typeIn(dialog.getByLabel(/^Bank reference/).first(), 'TRF-2026-10-01-88412', {
          after: 700,
        });
        await page.waitForTimeout(900);
      },

      /*
        TWO DIALOGS, AND THEY SHARE A BUTTON NAME. Submitting the form
        opens a confirm ("Record this remittance?") whose own footer
        button is also "Record remittance", so every reach here is
        scoped by the dialog's accessible NAME — and `getByRole('dialog')`
        unscoped dies on strict mode while both are open, which is how
        this was found. The confirm is not an obstacle to get past: its
        consequence line is the clearest statement in the product of what
        this press does, which is what the narration is saying over it.
      */
      async record({ page, stage }) {
        const form = page.getByRole('dialog', { name: 'Record remittance' });
        await stage.clickIt(
          form
            .locator('.sk-dialog__foot')
            .getByRole('button', { name: /Record|Recording|Recorded|Working/ })
            .first(),
          { after: 1200 },
        );
        const confirm = page.getByRole('dialog', { name: 'Record this remittance?' });
        await confirm.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(confirm.getByText(/Debits this seller/i).first(), 2800);
        await stage.clickIt(
          confirm
            .locator('.sk-dialog__foot')
            .getByRole('button', { name: /Record|Recording|Recorded|Working/ })
            .first(),
          { after: 2000 },
        );
        await confirm.waitFor({ state: 'detached', timeout: 30_000 });
        await form.waitFor({ state: 'detached', timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(900);
        await stage.dwellOn(page.locator('table').last(), 2800);
      },

      /*
        `?status=PAID` is NOT a thing: the filter is `useState` and reads
        no query string, so the link lands on Pending and the closing
        shot would be an empty table under a line about the request
        closing itself. The select is the only way in.
      */
      async outro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/withdrawals`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page
          .getByLabel(/^Status$/)
          .first()
          .selectOption('PAID');
        await page.waitForLoadState('networkidle').catch(() => {});
        const row = payoutRow(page);
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(row, 3600);
      },
    },
  },
  /*
    N4 — approving a change of bank account. One screen, one dialog, one
    press, and the shortest video in the section.

    The take SPENDS the request: approving WRITES THE NEW ACCOUNT
    THROUGH, so `pendingBankChange` would raise nothing on a second run
    (it compares what is on file). The seeding therefore puts the
    original account back before raising it again.
  */
  'approve-a-bank-change': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
      await ctx.page.goto(`${ctx.baseUrl}/bank-changes`, { waitUntil: 'domcontentloaded' });
      await ctx.page.waitForLoadState('networkidle').catch(() => {});
    },

    steps: {
      async intro({ page, stage }) {
        await page
          .getByRole('heading', { name: 'Bank detail changes', exact: true })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        // The CARD, not the page: the empty state renders the same
        // heading and the same subtitle just as happily, and a video
        // about approving one cannot open on "Nothing waiting".
        await page.locator('.mk-card').first().waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2400);
      },

      async until({ page, stage }) {
        await stage.dwellOn(page.getByText(/until you approve one/i).first(), 4000);
      },

      async first({ page, stage }) {
        await stage.dwellOn(page.locator('.mk-card__sub').first(), 3600);
      },

      async diff({ page, stage }) {
        await stage.dwellOn(page.locator('table').first(), 4200);
      },

      async number({ page, stage }) {
        await stage.dwellOn(bankField(page, 'Account number'), 4400);
      },

      async attack({ page, stage }) {
        await stage.dwellOn(bankField(page, 'Bank'), 4600);
      },

      async verify({ page, stage }) {
        await stage.dwellOn(page.locator('.mk-card').first(), 4600);
      },

      async open({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Approve' }).first(), { after: 1500 });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(dialog.locator('.mk-subject').first(), 3400);
      },

      async undo({ page, stage }) {
        await stage.dwellOn(
          page
            .getByRole('dialog')
            .getByText(/another change request and another approval/i)
            .first(),
          4400,
        );
      },

      async approve({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await stage.clickIt(
          dialog
            .locator('.sk-dialog__foot')
            .getByRole('button', { name: /Approve the new account|Approved|Working/ })
            .first(),
          { after: 1800 },
        );
        await dialog.waitFor({ state: 'detached', timeout: 25_000 });
        // The halo is still outlining where the dialog's footer WAS, and
        // with the dialog gone that is an empty box floating under an
        // empty page for the rest of the scene. Nothing else here is
        // worth pointing at — the toast says what happened.
        await stage.clearHalo();
        await page.waitForLoadState('networkidle').catch(() => {});
      },

      async after({ page, stage }) {
        const empty = page.getByText(/Nothing waiting/i).first();
        await empty.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(empty, 3800);
      },

      async outro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/withdrawals`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(900);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 3600);
      },
    },
  },
  /*
    N5 — recording a courier payout.

    The lines are filled by UPLOADING the courier's own remittance
    export, which is both the real operator path and the only watchable
    one: the allocation form takes an ORDER'S UUID, and typing one of
    those on camera teaches nothing. The file is written by the seed
    rather than committed, because an export names WAYBILLS and the
    waybills here were minted by the local simulator on this run.

    The take SPENDS it — a settlement is append-mostly, and recording one
    credits the COD — so the seeding removes the previous take's payout
    and the wallet entries its credit wrote (`unrecordTutorialPayouts`).
  */
  'record-a-courier-payout': {
    app: 'admin',

    async prologue(ctx) {
      // What the statement says, off the sheet the seed wrote with the
      // file — see `lib/fixture.mjs`. It is typed BEFORE the upload, so
      // it cannot be read off the lines, and a constant here was only
      // ever right for the set of parcels one box happened to have.
      ctx.payout = await readFixture('record-a-courier-payout');
      await signIn(ctx);
      await ctx.page.goto(`${ctx.baseUrl}/settlements`, { waitUntil: 'domcontentloaded' });
      await ctx.page.waitForLoadState('networkidle').catch(() => {});
    },

    steps: {
      async intro({ page, stage }) {
        await page
          .getByRole('heading', { name: 'Courier settlements', exact: true })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.getByText(/float we are carrying/i).first(), 2800);
      },

      async float({ page, stage }) {
        await stage.dwellOn(moneyKpi(page, 'Outstanding float'), 4000);
      },

      async window({ page, stage }) {
        await stage.dwellOn(page.getByText(/Delhivery states 5–10 days/i).first(), 4200);
      },

      async record({ page, stage, payout }) {
        await stage.clickIt(page.getByRole('button', { name: 'Record payout' }).first(), {
          after: 1500,
        });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(600);
        await dialog
          .getByLabel(/^Courier account/)
          .first()
          .selectOption({ index: 1 });
        await page.waitForTimeout(500);
        await stage.typeIn(dialog.getByLabel(/^Amount received/).first(), String(payout.totalInr), {
          after: 600,
        });
      },

      async reference({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await stage.typeIn(dialog.getByLabel(/^Payout reference/).first(), PAYOUT_REFERENCE, {
          after: 700,
        });
        await page.waitForTimeout(1200);
      },

      /*
        The upload. `setInputFiles` on the hidden input rather than a
        click on its label: the input is `sr-only` and Playwright refuses
        to act on something with no box, which is correct — a real
        operator clicks the label and the browser does this for them.
      */
      async allocate({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await stage.point(dialog.locator('.mk-drop').first(), { settle: 900 });
        await dialog.locator('input[type="file"]').first().setInputFiles(REMITTANCE_EXPORT);
        /*
          The lines the file filled. Gated on a VALUE in the first amount
          box, not on the box: the form ships with one empty line and an
          upload that matched nothing leaves exactly that.

          AND IT IS NOT CALLED "Amount". The input carries
          `aria-label="Amount attributed to this order"` beside its
          visible `label="Amount"`, and an `aria-label` on the control
          WINS — so the exact name is the long one and `'Amount'` matches
          nothing at all, which arrives as a wait for a box plainly in
          the frame with a number already in it. (Its `Order ID` sibling
          carries an `aria-label` that happens to equal its label, which
          is why the scene after this one was fine.)
        */
        const firstAmount = allocationAmount(dialog).first();
        await firstAmount.waitFor({ state: 'visible', timeout: 25_000 });
        for (let i = 0; i < 40; i += 1) {
          if (((await firstAmount.inputValue()) ?? '') !== '') break;
          await page.waitForTimeout(500);
        }
        if (((await firstAmount.inputValue()) ?? '') === '') {
          throw new Error('The remittance file matched no parcel — nothing was allocated.');
        }
        await page.waitForTimeout(800);
        await stage.clearHalo();
        /*
          THE LINES, THEN WHAT WAS LEFT OUT. `.mk-panel` was the first
          reach here and it is NOT ALWAYS THERE: it carries the file's own
          summary line, which the parser fills from a UTR column the
          seed's export does not have, so on this box it renders for
          nobody and the scene waited thirty seconds for it. The lines
          are the subject of the sentence and the warn callout is its
          second half.
        */
        await stage.dwellOn(dialog.locator('.mk-stack--tight').first(), 3200);
      },

      async expected({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await stage.dwellOn(dialog.getByLabel('Order ID', { exact: true }).first(), 4200);
      },

      /*
        THE LAST LINE IS THE SHORT ONE, by arrangement with the seed —
        which writes the file and shorts its final row for exactly this
        scene. It was `.nth(1)` and that is a different thing: rows the
        form cannot place are left out, so the file's second row and the
        form's second line are not the same line, and this haloed a
        parcel that had been paid in full under a sentence about paying
        less.
      */
      async short({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await stage.dwellOn(allocationAmount(dialog).last(), 4600);
      },

      async credit({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await stage.clickIt(
          dialog
            .locator('.sk-dialog__foot')
            .getByRole('button', { name: /Record|Recording|Recorded|Working/ })
            .first(),
          { after: 2000 },
        );
        await dialog.waitFor({ state: 'detached', timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(900);
        const row = page.getByRole('row').filter({ hasText: PAYOUT_REFERENCE }).first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.dwellOn(row, 2600);
      },

      async ledger({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/seller-wallets`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await stage.clickIt(page.getByRole('link', { name: /Ledger/ }).first(), { after: 1500 });
        await page.waitForURL(/\/seller-wallets\/[0-9a-f-]{36}$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await stage.dwellOn(await ledgerRow(page, 'COD collected'), 2400);
        await stage.dwellOn(await ledgerRow(page, 'COD tax deduction'), 2600);
      },

      async reversal({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/settlements`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await stage.dwellOn(moneyKpi(page, 'Short-paid orders'), 4400);
      },

      async unexplained({ page, stage }) {
        const row = page.getByRole('row').filter({ hasText: PAYOUT_REFERENCE }).first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await row.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(row, 4200);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(moneyKpi(page, 'Outstanding float'), 3600);
      },
    },
  },
  /*
    N6 — moving money in or out of a wallet by hand.

    ONE screen, and the take POSTS a real transfer: an append-only ledger
    row plus a pair of bank entries, with no way in the product to
    withdraw either (a mistake is put right with a transfer the other
    way, which is the lesson). `unpostStaffTransfers` removes the take's
    own rows — both halves, or the bank book's "held for a seller equals
    the positive part of their wallet" invariant stops being true.
  */
  'move-money-by-hand': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
      await ctx.page.goto(`${ctx.baseUrl}/wallet-transfers`, { waitUntil: 'domcontentloaded' });
      await ctx.page.waitForLoadState('networkidle').catch(() => {});
    },

    steps: {
      async intro({ page, stage }) {
        await page
          .getByRole('heading', { name: 'Wallet transfers', exact: true })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(
          page.getByText(/reads your reason on their wallet history/i).first(),
          2800,
        );
      },

      async notacorrection({ page, stage }) {
        await stage.dwellOn(page.getByText(/Not a correction/i).first(), 4200);
      },

      async seller({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /Rangpur Silk House/ }).first(), {
          after: 1600,
        });
        await page
          .getByLabel(/^Which way/)
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(page.locator('.mk-card').first(), 2400);
      },

      async direction({ page, stage }) {
        const field = page.getByLabel(/^Which way/).first();
        await stage.point(field, { settle: 800 });
        await field.selectOption('DEBIT');
        await page.waitForTimeout(1200);
        await stage.clearHalo();
        await stage.dwellOn(field, 2200);
      },

      async debit({ page, stage }) {
        await stage.dwellOn(
          page.getByText(/their wallet goes negative and they owe it to us/i).first(),
          4600,
        );
        await stage.typeIn(page.getByLabel(/^Amount/).first(), '1200', { after: 600 });
      },

      async reason({ page, stage }) {
        await stage.typeIn(
          page.locator('#wt-reason'),
          'Carton 3 of your August consignment never reached us — this is the freight we had already billed you for it, taken back.',
          { after: 700 },
        );
        await page.waitForTimeout(900);
      },

      async internal({ page, stage }) {
        await stage.typeIn(
          page.locator('#wt-note'),
          'Ticket TK-2026-000001, forwarder claim open.',
          {
            after: 700,
          },
        );
        await page.waitForTimeout(900);
      },

      async preview({ page, stage }) {
        await stage.clickIt(
          page.getByRole('button', { name: /^Preview|Worked out|Working it out/ }).first(),
          {
            after: 1800,
          },
        );
        const sentence = page.locator('[data-testid="wallet-transfer-sentence"]');
        await sentence.waitFor({ state: 'visible', timeout: 25_000 });
        await sentence.evaluate((el) =>
          el.scrollIntoView({ block: 'center', behavior: 'instant' }),
        );
        await page.waitForTimeout(700);
        await stage.dwellOn(sentence, 3000);
      },

      async numbers({ page, stage }) {
        const card = moneyCard(page, 'Preview');
        await stage.dwellOn(card.locator('.mk-dl').first(), 4600);
      },

      async confirm({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Post transfer' }).first(), {
          after: 1500,
        });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(dialog.getByText(/cannot be undone/i).first(), 3600);
      },

      async post({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await stage.clickIt(
          dialog
            .locator('.sk-dialog__foot')
            .getByRole('button', { name: /Yes, post it|Working|Done/ })
            .first(),
          { after: 2200 },
        );
        await page.waitForTimeout(1800);
      },

      /*
        The history, reached by RELOADING rather than by closing the
        dialog: `closeOnSuccess` is false on this one, so the confirm
        stays open with its result and the table behind it is the thing
        the next line is about.
      */
      async history({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/wallet-transfers`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        const row = page
          .getByRole('row')
          .filter({ hasText: /Carton 3 of your August consignment/ })
          .first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await row.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(row, 4200);
      },

      async outro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/seller-wallets`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await stage.clickIt(page.getByRole('link', { name: /Ledger/ }).first(), { after: 1500 });
        await page.waitForURL(/\/seller-wallets\/[0-9a-f-]{36}$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await stage.dwellOn(await ledgerRow(page, 'Debited by Skydrop'), 3600);
      },
    },
  },
  /*
    L3 — the stock ledger, read-only and entirely page-driven.

    NO FIXTURE and no seeding: every handle this video needs is on the
    screen, which is the default `lib/fixture.mjs` exists to stay the
    exception to. The variant it traces is read off a ROW rather than
    minted, because that is where an operator gets one too.
  */
  'read-the-stock-ledger': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage, baseUrl }) {
        await page.goto(`${baseUrl}/inventory/movements`, { waitUntil: 'domcontentloaded' });
        await ledgerRows(page);
        await stage.dwellOn(page.getByRole('heading', { name: 'Stock movements' }).first(), 3000);
      },

      async appendonly({ page, stage }) {
        // The promise this screen makes about itself, in its own words.
        const said = page.locator('.sk-ph__subtitle').first();
        await said.waitFor({ state: 'visible', timeout: 15_000 });
        await stage.dwellOn(said, 3400);
      },

      async row({ page, stage }) {
        const rows = await ledgerRows(page);
        await stage.dwellOn(rows.first(), 3600);
      },

      async change({ page, stage }) {
        /*
          THE HALO MOVES, which is the sentence. "What it changed, and
          what the shelf held afterwards" is two cells, and the second
          is the one the line is really about — so it is pointed at
          second and held, rather than both being gestured at once.
        */
        const first = (await ledgerRows(page)).first();
        await stage.point(ledgerCell(first, 'change'), { settle: 1500 });
        await stage.dwellOn(ledgerCell(first, 'after'), 2600);
      },

      async cause({ page, stage }) {
        const rows = await ledgerRows(page);
        const n = await rows.count();
        for (let i = 0; i < n; i += 1) {
          const cell = ledgerCell(rows.nth(i), 'cause');
          const said = (await cell.innerText()).trim();
          if (/^(order|parcel|adjustment) /.test(said)) {
            await stage.dwellOn(cell, 3600);
            return;
          }
        }
        throw new Error(
          'No row names what caused it. The column renders the kind before the id ' +
            '(order / parcel / adjustment) and the narration says so — a column of bare ' +
            'uuids is the bug this video found.',
        );
      },

      async types({ page, stage }) {
        await stage.dwellOn(page.locator('#mv-type'), 3200);
      },

      async pack({ page, stage }) {
        const rows = await applyLedgerFilter({ page, stage }, page.locator('#mv-type'), () =>
          page.locator('#mv-type').selectOption('PACK_CONFIRM'),
        );
        const n = await rows.count();
        if (n === 0) throw new Error('No pack-confirm movements — the whole scene is about them.');
        await page.waitForTimeout(500);
        /*
          A ROW, NEVER THE TABLE. `stage.point` calls
          `scrollIntoViewIfNeeded`, and this table is several screens
          tall — pointing at it scrolls to its middle and takes the
          filter toolbar, which every one of these scenes is about, out
          of the picture entirely.
        */
        await stage.dwellOn(rows.first(), 2800);
      },

      async transfer(ctx) {
        const { page, stage } = ctx;
        const rows = await applyLedgerFilter({ page, stage }, page.locator('#mv-type'), () =>
          page.locator('#mv-type').selectOption(''),
        );
        /*
          THE PAIR, PROVED rather than assumed. A transfer is a
          TRANSFER_OUT and a TRANSFER_IN written together and carrying
          the same cause, so the scene asserts both halves are on screen
          before haloing one of them — the other is the row beside it.
        */
        const n = await rows.count();
        let out = null;
        const ins = [];
        for (let i = 0; i < n; i += 1) {
          const row = rows.nth(i);
          const kind = (await ledgerCell(row, 'type').innerText()).trim();
          if (kind === 'transfer out' && out === null) out = { row, i };
          if (kind === 'transfer in') ins.push(i);
        }
        if (out === null || ins.length === 0) {
          throw new Error(
            'No transfer pair on the first page of the ledger — the scene says a move is ' +
              'always two rows and needs both of them visible.',
          );
        }
        await out.row.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(600);
        await stage.dwellOn(out.row, 3200);
        /*
          CARRIED FORWARD ON THE CONTEXT, which is the one object the
          prologue and every step share (see `record.mjs`). The next
          scene traces THIS product — the one the viewer has just been
          watching move — rather than whichever happens to be first.
        */
        ctx.variantId = (await ledgerCell(out.row, 'variant').innerText()).trim();
      },

      async variant({ page, stage, variantId }) {
        if (variantId === undefined) {
          throw new Error('The transfer scene did not hand a variant forward.');
        }
        await stage.typeIn(page.locator('#mv-variant'), variantId, { delay: 16, after: 900 });
        const rows = await ledgerRows(page);
        const n = await rows.count();
        if (n === 0) throw new Error(`Filtering to ${variantId} left no rows.`);
        await stage.dwellOn(page.locator('#mv-variant'), 2400);
      },

      async trace({ page, stage }) {
        const rows = await ledgerRows(page);
        const n = await rows.count();
        if (n < 3) {
          throw new Error(
            `Only ${n} row(s) for this product — the scene reads a HISTORY downwards.`,
          );
        }
        // "Read it downwards" — so it is read downwards, slowly, rather
        // than jumped to a halo somewhere in the middle of it.
        await stage.glide(520);
        await page.waitForTimeout(1200);
        await stage.glide(-520);
      },

      async bin({ page, stage }) {
        await page.locator('#mv-variant').fill('');
        // …and give the focus ring back, or the emptied field stays
        // outlined through a scene that is about the two selects beside it.
        await page.locator('#mv-variant').blur();
        await page.waitForTimeout(400);
        await applyLedgerFilter({ page, stage }, page.locator('#mv-wh'), () =>
          page.locator('#mv-wh').selectOption({ label: 'Kolkata Main' }),
        );
        /*
          THE BIN SELECT IS DISABLED UNTIL A WAREHOUSE IS PICKED — a
          shelf belongs to one building — and its own placeholder says
          "Pick a warehouse" while it is. That ordering IS the scene, so
          it is done in that order on camera rather than set up off it.
        */
        const rows = await applyLedgerFilter({ page, stage }, page.locator('#mv-bin'), () =>
          page.locator('#mv-bin').selectOption({ label: 'A-01-01' }),
        );
        const n = await rows.count();
        if (n === 0) throw new Error('No movements on A-01-01 — the scene is about one shelf.');
        for (let i = 0; i < n; i += 1) {
          const said = (await ledgerCell(rows.nth(i), 'bin').innerText()).trim();
          if (!said.startsWith('A-01-01')) {
            throw new Error(`Filtered to one shelf and a row reads "${said}".`);
          }
        }
        await stage.dwellOn(page.locator('#mv-bin'), 2600);
      },

      async reason({ page, stage }) {
        // Back out to every warehouse (which clears the bin with it) and
        // ask for corrections alone: the reason column is empty on the
        // movements an ordinary parcel writes, and full on these.
        await applyLedgerFilter({ page, stage }, page.locator('#mv-wh'), () =>
          page.locator('#mv-wh').selectOption(''),
        );
        const rows = await applyLedgerFilter({ page, stage }, page.locator('#mv-type'), () =>
          page.locator('#mv-type').selectOption('ADJUSTMENT_DECREASE'),
        );
        const n = await rows.count();
        const reasons = [];
        for (let i = 0; i < n; i += 1) {
          reasons.push((await ledgerCell(rows.nth(i), 'reason').innerText()).trim());
        }
        const first = reasons.findIndex((r) => r !== '' && r !== '—');
        if (first === -1) {
          throw new Error(
            'Every decrease here is missing its reason code — INV-7 requires one on an ' +
              'adjustment, and the scene is about reading it months later.',
          );
        }
        await stage.dwellOn(ledgerCell(rows.nth(first), 'reason'), 3000);
      },

      async outro({ page, stage }) {
        await applyLedgerFilter({ page, stage }, page.locator('#mv-type'), () =>
          page.locator('#mv-type').selectOption(''),
        );
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 3400);
      },
    },
  },
  /*
    M1 — courier accounts and credentials.

    It ADDS an account on camera, because the credential field is the
    whole point of the video and exists on no other screen, and then
    DEACTIVATES it, which is the rotation the page's own notice tells
    you to follow. `courierAccountWorldFor` removes the row before the
    next take. It touches NO master switch: turning a courier off
    diverts every unlinked seller's next parcel, which is not something
    to do for a camera.
  */
  'courier-accounts-and-credentials': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
      await ctx.page.goto(`${ctx.baseUrl}/courier-accounts`, { waitUntil: 'domcontentloaded' });
      await ctx.page.waitForLoadState('networkidle').catch(() => {});
    },

    steps: {
      async intro({ page, stage }) {
        await page
          .getByRole('heading', { name: 'Courier accounts', exact: true })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.sk-ph__title').first(), 2800);
      },

      async several({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 3600);
      },

      async credentials({ page, stage }) {
        // The notice is the sentence the rest of the video obeys, so it
        // is gated on its own words rather than on the panel around it.
        const said = page.getByText(/never returned by any endpoint/i).first();
        await said.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(said, 3800);
      },

      async rotate({ page, stage }) {
        await stage.dwellOn(
          page.getByText(/add a new account and deactivate the old/i).first(),
          3400,
        );
      },

      async switches({ page, stage }) {
        const card = page.locator('.ca-switch').first();
        await card.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(card, 3000);
      },

      async notakill({ page, stage }) {
        await stage.dwellOn(
          page.getByText(/keep being tracked, and can still be cancelled/i).first(),
          3800,
        );
      },

      async table({ page, stage }) {
        const table = page.getByRole('table').first();
        await table.waitFor({ state: 'visible', timeout: 20_000 });
        /*
          THE HEADER ROW, not the table: this one is short enough to sit
          in frame whole, and haloing the head keeps the column names —
          which the line reads out — inside the outline.
        */
        await stage.dwellOn(page.locator('.sk-thead').first(), 3200);
      },

      async default({ page, stage }) {
        const chip = page.locator('.sk-tbody .sk-tr').filter({ hasText: 'Default' }).first();
        await chip.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(chip, 3400);
      },

      async add(ctx) {
        const { page, stage } = ctx;
        /*
          "ADD ACCOUNT" IS TWO BUTTONS once the dialog is open — the page
          header's and the dialog footer's — so the page one is pressed
          while there is still only one of it, and every later reach is
          scoped to the dialog.
        */
        await stage.clickIt(page.getByRole('button', { name: 'Add account' }).first(), {
          after: 1200,
        });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        /*
          SANDBOX, deliberately. The form opens on production because
          that is the only live integration, and a video that leaves a
          production-labelled account behind on every take is a video
          that teaches the wrong habit. Nothing routes to it either way
          (it is not the default), so this costs the scene nothing.
        */
        await stage.point(dialog.locator('#ca-env'), { settle: 400 });
        await dialog.locator('#ca-env').selectOption('SANDBOX');
        await page.waitForTimeout(400);
        await stage.clearHalo();
        await stage.typeIn(dialog.locator('#ca-label'), M1_ACCOUNT_LABEL, {
          delay: 36,
          after: 700,
        });
      },

      async shape({ page, stage }) {
        const dialog = page.getByRole('dialog');
        const name = dialog.getByLabel(/^Credential field name$/);
        await name.waitFor({ state: 'visible', timeout: 15_000 });
        const filled = await name.inputValue();
        if (filled.trim() === '') {
          throw new Error(
            "The credential field name arrived empty. The line is that each courier's own " +
              'field names are filled in for you — an empty box says the opposite.',
          );
        }
        await stage.dwellOn(name, 3000);
      },

      async secret({ page, stage }) {
        const dialog = page.getByRole('dialog');
        const value = dialog.getByLabel(/^Credential value$/);
        const type = await value.getAttribute('type');
        if (type !== 'password') {
          throw new Error(
            `The credential value field is type="${type}". The line says it is never legible; ` +
              'a plain text box would put a live token on screen.',
          );
        }
        await stage.typeIn(value, 'sk-demo-token-not-a-real-one', { delay: 26, after: 900 });
      },

      async save({ page, stage }) {
        await stage.clickIt(dialogFoot(page).getByRole('button', { name: 'Add account' }), {
          after: 2000,
        });
        await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 25_000 });
        const row = page.locator('.sk-tbody .sk-tr').filter({ hasText: M1_ACCOUNT_LABEL }).first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        const said = await row.innerText();
        if (/Default/.test(said)) {
          throw new Error(
            `The new account reads "${said}" — the line says nothing routes to it yet, and a ` +
              'default account is where every unlinked seller ships from.',
          );
        }
        await page.waitForTimeout(600);
        await stage.dwellOn(row, 2800);
      },

      async retire({ page, stage }) {
        const row = page.locator('.sk-tbody .sk-tr').filter({ hasText: M1_ACCOUNT_LABEL }).first();
        await stage.clickIt(row.getByRole('button', { name: 'Deactivate' }), { after: 1400 });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        // The consequence the dialog states IS the line, so it is read
        // on camera before the button that commits it.
        await stage.dwellOn(
          dialog.getByText(/parcels it already carried keep their record/i),
          2400,
        );
        await stage.clickIt(dialogFoot(page).getByRole('button', { name: 'Deactivate' }), {
          after: 1800,
        });
        await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 25_000 });
        const after = page
          .locator('.sk-tbody .sk-tr')
          .filter({ hasText: M1_ACCOUNT_LABEL })
          .first();
        await after.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(after, 2400);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.getByText(/never returned by any endpoint/i).first(), 3400);
      },
    },
  },
  /*
    M2 — the courier health page, and it WRITES NOTHING.

    Every scene is a question: the poll's own status (the button beside
    it is M3 and is dangerous — this video does not press it), one
    waybill lookup that is reads-only by its own promise, and one
    serviceability probe that creates nothing. It does NOT press "Refill
    waybill pool" (that spends the account's real allocation) and does
    NOT register a warehouse.
  */
  'is-the-courier-healthy': {
    app: 'admin',

    async prologue(ctx) {
      await signIn(ctx);
      // The waybill the lookup scene types. An operator arrives holding
      // one too — off a label, or a customer's email.
      ctx.sheet = await readFixture('is-the-courier-healthy');
      await ctx.page.goto(`${ctx.baseUrl}/delhivery`, { waitUntil: 'domcontentloaded' });
      await ctx.page.waitForLoadState('networkidle').catch(() => {});
    },

    steps: {
      async intro({ page, stage }) {
        await page
          .getByRole('heading', { name: 'Delhivery', exact: true })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 2800);
      },

      async tracking({ page, stage }) {
        const said = page.getByText(/sends us no webhooks/i).first();
        await said.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(said, 3600);
      },

      async lookup({ page, stage, sheet }) {
        const box = page.getByLabel(/^AWB numbers$/);
        await box.waitFor({ state: 'visible', timeout: 20_000 });
        /*
          IT IS TYPED, NOT READ. The two numbers already in that box are
          a PLACEHOLDER — `getByText` cannot see them and neither can a
          person who clicks into it. A waybill is minted per box, so the
          seed hands one over.
        */
        await stage.typeIn(box, sheet.awbNumber, { delay: 28, after: 700 });
      },

      async reads({ page, stage }) {
        await stage.dwellOn(
          page.getByText(/no tracking event is written and no order moves/i).first(),
          3400,
        );
      },

      async result({ page, stage, sheet }) {
        await stage.clickIt(page.getByRole('button', { name: /^Look up$|^Looked up$/ }).first(), {
          after: 2200,
        });
        const card = page.locator('.af-strong.sk-ident', { hasText: sheet.awbNumber }).first();
        await card.waitFor({ state: 'visible', timeout: 30_000 });
        await page.waitForTimeout(900);
        /*
          IT HAS TO HAVE ANSWERED — and BOTH answers are the scene.

          The line is about the SHAPE of the reply: whether they know
          the waybill at all, their scans, and what our mapping makes of
          each one. "Delhivery has no scans" beside "we hold this
          shipment" is the most useful thing this panel ever says, so it
          is not a failure here. What WOULD be is a card with neither —
          a lookup that errored or never returned, which looks identical
          to a quiet one.
        */
        const panel = card.locator('xpath=ancestor::*[contains(@class,"af-card")][1]');
        const said = await panel.innerText();
        if (!/scans/i.test(said)) {
          throw new Error(
            `The lookup card for ${sheet.awbNumber} reads "${said}" — it names neither scans ` +
              'nor their absence, so the call did not come back.',
          );
        }
        await stage.dwellOn(panel, 3200);
      },

      async connection({ page, stage }) {
        const card = page
          .locator('.af-card')
          .filter({ hasText: /Live API|Stub mode/ })
          .first();
        await card.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await stage.dwellOn(card, 3000);
      },

      async guard({ page, stage }) {
        const card = page
          .locator('.af-card')
          .filter({ hasText: /Live writes (enabled|blocked)/ })
          .first();
        await stage.dwellOn(card, 3600);
      },

      async pool({ page, stage }) {
        const said = page.getByText(/five bulk requests per five minutes/i).first();
        await said.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await stage.dwellOn(said, 3400);
      },

      async states({ page, stage }) {
        const kpis = page.locator('.af-kpis').first();
        await kpis.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(kpis, 3200);
      },

      async budget({ page, stage }) {
        /*
          THE TIGHT ROW BY NAME. "waybill bulk" is five per five minutes
          against everything else's thousands, and it is the one the
          narration singles out — reaching for the first row instead
          would film whichever the API happened to return first.
        */
        const row = page.locator('.sk-tbody .sk-tr').filter({ hasText: 'waybill bulk' }).first();
        await row.waitFor({ state: 'visible', timeout: 20_000 });
        await row.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await stage.dwellOn(row, 3200);
      },

      async waf({ page, stage }) {
        await stage.dwellOn(page.getByText(/blocks our whole egress IP/i).first(), 3400);
      },

      async reach({ page, stage }) {
        const card = page.locator('.af-card').filter({ hasText: 'Reachability' }).first();
        await card.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await stage.clickIt(card.getByRole('button', { name: 'Check connection' }), {
          after: 2400,
        });
        await page.waitForTimeout(600);
        await stage.dwellOn(card, 2600);
      },

      async pickup({ page, stage }) {
        const card = page.locator('.af-card').filter({ hasText: 'Pickup location' }).first();
        await card.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await stage.dwellOn(page.getByText(/Delhivery matches it exactly/i).first(), 3600);
      },

      async outro({ page, stage }) {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await page.waitForTimeout(600);
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 3200);
      },
    },
  },
};

/**
 * I4's two request cards, each by a phrase from the reason its seeding
 * wrote — the order numbers are minted per run, so there is nothing
 * stable to name them by except the words on them.
 */
function firstAsk(page) {
  return page.locator('.oo-qcard', { hasText: 'confused this with another order' }).first();
}

function secondAsk(page) {
  return page.locator('.oo-qcard', { hasText: 'declined over the delivery charge' }).first();
}

/** J1's four panels, each by the words in its own heading — the page is
 *  five thousand pixels tall and nothing on it carries an id. */
function overviewSection(page) {
  return page.locator('.stk-section', { hasText: "What's in every bin" }).first();
}

function trackingPanel(page) {
  return page.locator('.stk-card', { hasText: 'Location tracking' }).first();
}

function addBinSection(page) {
  return page.locator('.stk-section', { hasText: 'Add a bin' }).first();
}

function layoutSection(page) {
  return page.locator('.stk-section', { hasText: 'plus FLOOR' }).first();
}

/** J2's row and its two product lines, each by the SKU printed on it —
 *  "Received qty" and "Damaged" repeat per line, so every reach has to
 *  be scoped to one of them or it matches both. */
function receiveRow(page) {
  /*
    THE ONE PENDING ROW. The list's columns are the receipt number, the
    consignment, the seller and the status — the seller's own reference
    is NOT among them, so there is nothing stable to name it by: both
    numbers are minted per run. The seeding asserts the whole box holds
    exactly one PENDING goods receipt, which is what makes this
    deterministic rather than a coin toss.
  */
  return page.locator('.sk-tbody .sk-tr', { hasText: 'Pending' }).first();
}

function kanthaLine(page) {
  return page.locator('.wh-item', { hasText: 'RSH-KANTHA-BLUE' }).first();
}

function jamdaniLine(page) {
  return page.locator('.wh-item', { hasText: 'RSH-JAMDANI-IVORY' }).first();
}

/**
 * Put a counted line into the FLOOR bin.
 *
 * A BIN IS REQUIRED HERE WHATEVER THE WAREHOUSE SAYS. `onRecordAll`
 * refuses any line with `qty > 0` and no bin — unconditionally, with no
 * reference to `binTrackingEnabled` — so on CCU-01, where location
 * tracking is OFF and J1's own copy says "receiving can still note one,
 * but it is only a note", the operator is still made to choose one. It
 * is recorded in the curriculum as an inconsistency rather than fixed:
 * the stricter client produces a TRUER record (BIN-1 says an explicitly
 * supplied real bin is honoured either way), and the video does what an
 * operator must do.
 *
 * Reached by the option's own value, because the label is
 * `<code> (<type>)` and restating it would break on a type change with
 * a message about a missing option.
 */
async function putIntoFloor(page, line) {
  const option = line.locator('option', { hasText: 'FLOOR' }).first();
  await option.waitFor({ state: 'attached', timeout: 20_000 });
  const binId = await option.getAttribute('value');
  if (binId === null || binId === '') {
    throw new Error(
      'No FLOOR bin offered on this receipt line — the warehouse has nowhere to put stock.',
    );
  }
  await line.getByLabel(/^Putaway bin$/).selectOption(binId);
}

/**
 * J3's three parcels, by the destination pin the seeding gives them.
 *
 * The label queue's columns are the order number, the seller, the
 * courier, the waybill, the destination, the COD and the item count.
 * Both numbers are minted per run and the seller is shared with five
 * other parcels in the same queue — two of which belong to other videos
 * and must not be printed — so the pin is the only stable handle, and
 * the seeding asserts exactly three waiting parcels carry it.
 */
function ourParcels(page) {
  return page.locator('.sk-tbody .sk-tr', { hasText: '560103' });
}

/**
 * J4's two parcels and the codes its scans carry.
 *
 * KEEP IN STEP WITH `PICK_ORDERS` in `seed-demo-data.mjs`. The recipient
 * names are the stable handle on the pack queue — both the order number
 * and the waybill are minted per run — and the first parcel is the
 * two-line one, which is the only reason the set-versus-count scene has
 * anything to show.
 *
 * `twice` is the product the box wants TWO of and `once` the product it
 * wants one of, which is what makes "two of one thing and none of the
 * other" reachable on camera, and what the over-scan lands on.
 */
const PACK = {
  first: 'Ananya Iyer',
  other: 'Vikram Choudhury',
  twice: 'RSH-JAMDANI-IVORY',
  once: 'RSH-KANTHA-BLUE',
  cancelReason: 'Outer carton crushed in the aisle; repacking into a new box',
};

/** One row of the pack queue, by the recipient printed on it. */
function packRow(page, recipient) {
  return page.locator('.wh-list li', { hasText: recipient }).first();
}

/**
 * J5's reason, typed in two halves.
 *
 * The first is under the twenty characters `force-complete` insists on,
 * so the scene about the floor has a dead button to point at; the second
 * finishes it. Appended rather than retyped \u2014 clearing a controlled
 * field is the trap that wrote a thirteen into an agent cap.
 */
const FORCE = {
  half: 'Barcode torn',
  rest: ' off the carton in transit; contents counted by hand against the picking sheet',
};

/**
 * K1's parcel at the door — the ONLY row on that worklist.
 *
 * There is nothing on the row to name it by: the columns are the
 * waybill, the order, the item count, what the courier says and how long
 * it has waited, and the one name among them is the SELLER's, which six
 * other parcels share. Both numbers are minted per run. So the handle is
 * the list itself, and `intro` asserts it holds exactly one —
 * `RSH-LIFE-ATDOOR` is the only parcel in D0 that ever puts a row here,
 * and the seeding retires and rebuilds it after a take receives it.
 */
function atDoorRow(page) {
  return page.locator('.sk-tbody .sk-tr').first();
}

/** The RTO station's tab bar, and one tab of it by its label. */
function rtoTabs(page) {
  return page.locator('.wh-rto-tabs').first();
}

function rtoTab(page, label) {
  return rtoTabs(page).getByRole('tab', { name: new RegExp(`^${label}`) });
}

/**
 * K2's row on the returns bench, and the panel it opens.
 *
 * Reached by POSITION rather than by name, and the seeding is what
 * makes that honest: `returnsBenchWorldFor` asserts the whole box holds
 * exactly one return with lines still to inspect, and the flow
 * re-asserts it from the screen before touching anything. Nothing on
 * the row is stable to name — the waybill, the parcel number and the
 * order number are all minted per run, and the seller and the customer
 * are the same on every D0 parcel.
 */
function benchRow(page) {
  return page.locator('.sk-tbody .sk-tr').first();
}

/** L1's one waiting adjustment, and the link out of the damaged shelf. */
function reviewButton(page) {
  return page.getByRole('button', { name: 'Review' }).first();
}

/** L2's one scheduled count, by the status word on its chip. */
function scheduledCountRow(page) {
  return page.locator('.sk-tbody .sk-tr', { hasText: 'scheduled' }).first();
}

/**
 * The control beside a line in a DAMAGED bin.
 *
 * It is literally called something else there — `bin-detail.tsx` reads
 * "Return or scrap" for a damaged bin and "Adjust" everywhere else —
 * which is the scene. Reached by its `aria-label`, which names the SKU
 * and the bin and is therefore the only handle that cannot match the
 * wrong row.
 */
function returnOrScrap(page) {
  return page.getByRole('link', { name: /in bin D-01-01$/ }).first();
}

/** The one returned line in the station below. */
function rtoLine(page) {
  return page.locator('.wh-item').first();
}

/**
 * The split-by-quantity block and one of its rows.
 *
 * By its `aria-label` rather than its class: `.wh-stack--tight` is also
 * the wrapper around the LIST of returned lines, so the class alone
 * matches the thing containing this one.
 */
function splitBlock(page) {
  return page.locator('[aria-label="Split by quantity"]').first();
}

function splitRow(page, index) {
  return splitBlock(page).locator('.wh-split-row').nth(index);
}

/**
 * J8's open manifest, by the one status word that can appear once.
 *
 * The list is newest first and the only DRAFT is today's — a second one
 * exists only when another is open for the same courier AND warehouse,
 * which one courier and one building cannot produce. The number is
 * minted per month, so the status is the handle.
 */
function draftManifestRow(page) {
  return page.locator('.sk-tbody .sk-tr', { hasText: 'Draft' }).first();
}

/** J7's reason, and the two rows its screen turns on. */
const PICKUP = {
  reason: 'Checked the Delhivery One panel — no request listed for this warehouse on that date.',
};

/**
 * The FAILED attempt, by the only word on the row that tells it apart.
 *
 * The status chip is the status lower-cased, and the seeding asserts
 * exactly one failed attempt exists — the date is tomorrow's and is
 * therefore not something to hard-code.
 */
function failedPickupRow(page) {
  return page.locator('.sk-tbody .sk-tr', { hasText: 'failed' }).first();
}

/** Today's open request — the one the pack bench raised for us. */
function openPickupRow(page) {
  return page.locator('.sk-tbody .sk-tr', { hasText: 'requested' }).first();
}

/**
 * J6's two parcels, by the recipient the handover queue prints.
 *
 * KEEP IN STEP WITH `PICK_ORDERS` in `seed-demo-data.mjs`. Both numbers
 * on a row are minted per run, so the name is the handle — the same
 * reasoning as the pack queue's.
 */
const HANDOVER = { first: 'Ananya Iyer', second: 'Vikram Choudhury' };

/** One row of what is waiting for a van. */
function handoverRow(page, recipient) {
  return page.locator('.wh-list li', { hasText: recipient }).first();
}

/**
 * The running list of what this session has put on the van.
 *
 * REACHED BY ITS HEADING, not by `hasText`. `hasText` is a
 * case-insensitive SUBSTRING, and the scan card above says "1 scanned in
 * this session." — so `.wh-card` filtered on "This session" matched TWO
 * cards and `.first()` took the scan card, whose `.wh-list li` does not
 * exist. It presented as a thirty-second timeout on an element plainly
 * on the screen in the failure shot. `has:` + an exact heading is the
 * form that says "the card whose title is this".
 */
function sessionList(page) {
  return page
    .locator('.wh-card')
    .filter({ has: page.getByRole('heading', { name: 'This session', exact: true }) })
    .first();
}

/** What is still standing at the bench, by its own heading. */
function waitingCard(page) {
  return page
    .locator('.wh-card')
    .filter({ has: page.getByRole('heading', { name: /waiting for a van$/ }) })
    .first();
}

/**
 * A handover scan: the waybill typed into the one field, and Enter.
 *
 * Its own helper rather than the pack bench's `scanIn` because the field
 * has a different id and this bench has no concept of a product scan —
 * sharing one would mean a parameter that exists to tell two unrelated
 * screens apart.
 */
async function handoverScan(page, stage, awb, { settle = 900 } = {}) {
  const field = page.locator('#handover-scan');
  await field.waitFor({ state: 'visible', timeout: 20_000 });
  await stage.typeIn(field, awb, { after: 250 });
  await field.press('Enter');
  await page.waitForTimeout(settle);
}

/** The control that reveals the override \u2014 deliberately not beside the close. */
function forceOpener(page) {
  return page.getByRole('button', { name: 'These products have no labels to scan' });
}

/** The override block itself, by the class that marks it off from the cancel above it. */
function forcePanel(page) {
  return page.locator('.wh-divide').first();
}

function reasonField(page) {
  return forcePanel(page).getByLabel(/^Reason for packing without scanning$/);
}

function forceSubmit(page) {
  return forcePanel(page).getByRole('button', { name: 'Pack without scanning' });
}

/** One outstanding line of the open box, by the SKU printed on it. */
function packLine(page, skuCode) {
  return page.locator('.wh-line', { hasText: skuCode }).first();
}

/**
 * A scan, which is a code typed into the one field and Enter.
 *
 * A barcode reader types the digits and presses Enter itself, so this is
 * literally what the hardware does — and it is the ONLY way into the
 * bench: there is no submit button to click. `typeIn` does not press
 * Enter, so the press is here rather than left to each scene to
 * remember.
 */
async function scanIn(page, stage, code) {
  const field = page.locator('#pack-scan');
  await field.waitFor({ state: 'visible', timeout: 20_000 });
  await stage.typeIn(field, code, { after: 250 });
  await field.press('Enter');
  await page.waitForTimeout(900);
}

/**
 * Assert a line reads what the narration says it reads.
 *
 * The counter is the whole subject of four of these scenes, and a scan
 * that was refused leaves the field cleared and the page otherwise
 * identical — so without this a take would sail past a rejected scan
 * and film a line that never moved. Checked against the FIGURE the line
 * prints, which is the thing a viewer is looking at.
 */
async function expectCount(page, skuCode, reads) {
  const figure = packLine(page, skuCode).locator('.wh-line__figure');
  await figure.waitFor({ state: 'visible', timeout: 20_000 });
  const got = (await figure.innerText()).replace(/\s+/g, ' ').trim();
  if (got !== reads) {
    const alert = await page
      .locator('.wh-alert')
      .first()
      .innerText()
      .catch(() => '');
    throw new Error(
      `${skuCode} reads "${got}", expected "${reads}"` +
        (alert === '' ? '' : ` — the bench says: ${alert.trim()}`),
    );
  }
}

/**
 * One KPI tile on a MONEY screen, by the words on its OWN label.
 *
 * Named apart from `kpi` above, which is the stock and freight pages'
 * grid and a different element entirely.
 *
 * `page.locator('.sk-kpi', { hasText: 'Balance' })` is the obvious form
 * and it is wrong here: `hasText` is a case-insensitive SUBSTRING over
 * the whole card, and the tile beside Balance reads "Balance, less the
 * floor and anything already requested" — so it matches two, `.first()`
 * takes whichever the grid happens to put first, and the halo lands on
 * the wrong figure while every step passes. Matching the LABEL element
 * exactly is what says "this tile and no other".
 */
function moneyKpi(page, label) {
  return page
    .locator('.sk-kpi')
    .filter({ has: page.locator('.sk-kpi__label', { hasText: label }) })
    .filter({ hasText: label })
    .first();
}

/** One card on a wallet screen, by its title rather than by its prose. */
function moneyCard(page, title) {
  return page
    .locator('.mk-card')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    .first();
}

/**
 * One line of the P&L, by its label and nothing else.
 *
 * `hasText` over the accordion item would be a substring over the whole
 * row — label, coverage note, four figures — and several of these labels
 * are inside each other's notes ("COD" and "courier cost" both appear in
 * the delivery line's prose). The label element carries exactly the
 * line's name, so matching it exactly is the only form that means one
 * line.
 */
function pnlLine(page, label) {
  return page
    .locator('.sk-acc__item')
    .filter({
      has: page.locator('.pl-line__label', {
        hasText: new RegExp(`^${label.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
      }),
    })
    .first();
}

/**
 * N2's two claims, by the figure printed on them.
 *
 * Keep in step with `DESK_TOPUP_INR` and `DESK_SECOND_TOPUP_INR` in
 * `seed-demo-data.mjs`. Not by the reference, which is minted per run on
 * purpose — the video's whole subject is matching a claim against a
 * statement, and two claims sharing a reference would teach the opposite.
 */
const TOPUP_TO_ACCEPT = 18000;
const TOPUP_TO_REFUSE = 4250;

/** One claim's row, by its amount however the API chose to render it. */
function claimRow(page, amountInr) {
  const grouped = amountInr.toLocaleString('en-IN');
  return page
    .getByRole('row')
    .filter({
      hasText: new RegExp(`\\b(${amountInr}|${grouped.replaceAll(',', ',?')})(\\.00)?\\b`),
    })
    .first();
}

/**
 * N3's withdrawal request, by the figure printed on it.
 *
 * Keep in step with `DESK_WITHDRAWAL_INR` in `seed-demo-data.mjs`. The
 * seller's name is on every row of a one-seller demo world and the id is
 * minted per run, so the amount is the only handle that means this row
 * and no other.
 */
const PAYOUT_INR = 7500;

function payoutRow(page) {
  const grouped = PAYOUT_INR.toLocaleString('en-IN').replaceAll(',', ',?');
  return page
    .getByRole('row')
    .filter({ hasText: new RegExp(`\\b(${PAYOUT_INR}|${grouped})(\\.00)?\\b`) })
    .first();
}

/**
 * One row of the bank-change diff, by the FIELD name in its first cell.
 *
 * `hasText` over the row would also match the values, and a bank name
 * and an account name share words on any real request.
 */
function bankField(page, label) {
  return page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: label, exact: true }) })
    .first();
}

/**
 * N5's payout reference, and the export the seed wrote for it.
 *
 * The prefix is what `unrecordTutorialPayouts` finds to undo a previous
 * take, so the two must agree or the second take opens on a float of
 * zero.
 *
 * The AMOUNT is not here. It is typed by the operator from the
 * STATEMENT rather than taken from the file — the form's own rule: the
 * file is the courier's claim and the bank is the fact — and it is read
 * from the seed's fixture, because a constant was only ever right for
 * the set of parcels one box happened to have unsettled.
 */
const PAYOUT_REFERENCE = 'UTR-TUT-20261001-4417';
const REMITTANCE_EXPORT = path.join(GENERATED_DIR, 'courier-remittance.csv');

/**
 * One allocation line's amount box, BY ITS `aria-label`.
 *
 * The input carries `aria-label="Amount attributed to this order"` next
 * to a visible `label="Amount"`, and an `aria-label` on the control is
 * the accessible name — so the word on screen is not the handle. Named
 * once here because two scenes reach for it and the next person to read
 * either of them would otherwise have to rediscover why.
 */
function allocationAmount(dialog) {
  return dialog.getByLabel('Amount attributed to this order', { exact: true });
}
